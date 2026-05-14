import { useEffect, useRef, useCallback } from 'react';
import { Modal } from '../Modal';
import { ViewerCanvas } from './ViewerCanvas';
import { useViewerStore } from '../../stores/viewerStore';
import { useAuthStore } from '../../stores/auth';
import axios from 'axios';

interface STPViewerModalProps {
  open: boolean;
  attachmentId: string;
  fileName?: string;
  onClose: () => void;
}

export function STPViewerModal({ open, attachmentId, fileName, onClose }: STPViewerModalProps) {
  const { modelUrl, loadingState, setModelUrl, setLoadingState, reset } = useViewerStore();
  const token = useAuthStore((s) => s.token);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gltfUrl = `/api/v2/attachments/${attachmentId}/gltf?token=${encodeURIComponent(token || '')}`;

  // Start loading when modal opens
  useEffect(() => {
    if (!open || !token) return;
    setLoadingState('converting', '正在检查模型...');
    checkAndLoad();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [open, attachmentId, token]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      reset();
    };
  }, []);

  const checkAndLoad = useCallback(async () => {
    try {
      const resp = await axios.head(gltfUrl);
      if (resp.status === 200) {
        setModelUrl(gltfUrl);
        setLoadingState('loading');
        return;
      }
      if (resp.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        startPolling();
        return;
      }
      setLoadingState('error', '服务器异常');
    } catch (e: any) {
      if (e.response?.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        startPolling();
      } else {
        setLoadingState('error', e.response?.status === 404 ? '附件不存在' : '加载失败');
      }
    }
  }, [gltfUrl]);

  const startPolling = useCallback(() => {
    let retries = 0;
    const maxRetries = 30;
    pollingRef.current = setInterval(async () => {
      retries++;
      try {
        const resp = await axios.head(gltfUrl);
        if (resp.status === 200) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setModelUrl(gltfUrl);
          setLoadingState('loading');
        }
      } catch (e: any) {
        if (e.response?.status !== 202) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setLoadingState('error', '转换失败');
        }
      }
      if (retries >= maxRetries) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setLoadingState('error', '转换超时，请关闭后重试');
      }
    }, 2000);
  }, [gltfUrl]);

  return (
    <Modal open={open} title={`三维预览 - ${fileName || ''}`} onClose={onClose} width="full" zIndex={60}>
      <div className="relative w-full" style={{ height: 'calc(100vh - 120px)' }}>
        {/* Converting State */}
        {loadingState === 'converting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-500 border-t-transparent mx-auto mb-3" />
              <p className="text-gray-500 text-sm">模型转换中，请稍后...</p>
              <p className="text-gray-400 text-xs mt-1">首次预览需转换格式，后续将直接加载</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {loadingState === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <div className="text-center text-red-500 text-sm">
              <p>模型加载失败</p>
              <p className="text-gray-400 text-xs mt-1">请关闭后重试</p>
            </div>
          </div>
        )}

        {/* Viewer */}
        {modelUrl && (
          <ViewerCanvas url={modelUrl} />
        )}
      </div>
    </Modal>
  );
}
