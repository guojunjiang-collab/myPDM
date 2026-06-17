import { useEffect, useRef, useCallback, useState } from 'react';
import { Modal } from '../Modal';
import { ViewerCanvas } from './ViewerCanvas';
import { Toolbar } from './Toolbar';
import { ModelTreePanel } from './ModelTreePanel';
import { ViewCube } from './ViewCube';
import { useViewerStore } from '../../stores/viewerStore';
import { mediaApi } from '../../services/api';
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
  const [treeWidth, setTreeWidth] = useState(240);
  const dragging = useRef(false);
  const gltfUrlRef = useRef<string | null>(null);

  // Start loading when modal opens
  useEffect(() => {
    if (!open || !attachmentId) return;
    setLoadingState('converting', '正在检查模型...');
    mediaApi.token(attachmentId, 'gltf').then(mt => {
      const url = `/api/v2/attachments/${attachmentId}/gltf?token=${encodeURIComponent(mt)}`;
      gltfUrlRef.current = url;
      checkAndLoad(url);
    }).catch(() => {
      setLoadingState('error', '获取令牌失败');
    });
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [open, attachmentId]);

  // Resize handle
  const onResizeDown = useCallback(() => { dragging.current = true; }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setTreeWidth(Math.max(160, Math.min(e.clientX - 16, window.innerWidth * 0.55)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      reset();
    };
  }, []);

  const checkAndLoad = useCallback(async (gltfUrl: string) => {
    try {
      const resp = await axios.head(gltfUrl);
      if (resp.status === 200) {
        setModelUrl(gltfUrl);
        setLoadingState('loading');
        return;
      }
      if (resp.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        startPolling(gltfUrl);
        return;
      }
      setLoadingState('error', '服务器异常');
    } catch (e: any) {
      if (e.response?.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        startPolling(gltfUrl);
      } else {
        setLoadingState('error', e.response?.status === 404 ? '附件不存在' : '加载失败');
      }
    }
  }, []);

  const startPolling = useCallback((gltfUrl: string) => {
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
  }, []);

  return (
    <Modal open={open} title={`三维预览 - ${fileName || ''}`} onClose={onClose} width="full" zIndex={60}>
      <div className="-mx-6 -my-4" style={{ height: 'calc(100vh - 88px)' }}>
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
          <div className="flex h-full">
            {/* Left: Model Tree */}
            <div style={{ width: treeWidth }} className="shrink-0 h-full">
              <ModelTreePanel />
            </div>
            {/* Resize handle */}
            <div
              onMouseDown={onResizeDown}
              className="w-1.5 cursor-col-resize hover:bg-blue-400 bg-gray-200 shrink-0 transition-colors"
            />
            {/* Right: Toolbar + Canvas */}
            <div className="flex-1 flex flex-col min-w-0">
              <Toolbar />
              <div className="flex-1 relative">
                <ViewerCanvas url={modelUrl} />
                <ViewCube />
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
