import { useEffect, useState } from 'react';
import { ViewerCanvas } from '../components/STPViewer/ViewerCanvas';
import { Toolbar } from '../components/STPViewer/Toolbar';
import { BOMPanel } from '../components/STPViewer/BOMPanel';
import { useViewerStore } from '../stores/viewerStore';
import axios from 'axios';

export default function STPViewerPage() {
  const { modelUrl, loadingState, setModelUrl, setLoadingState, reset } = useViewerStore();
  const [bomOpen, setBomOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) {
      setLoadingState('error', '缺少参数');
      return;
    }

    const url = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    checkAndLoad(url);
    return () => reset();
  }, []);

  async function checkAndLoad(url: string) {
    setLoadingState('converting', '正在检查模型...');
    try {
      const resp = await axios.head(url);
      if (resp.status === 200) {
        setModelUrl(url);
        setLoadingState('loading');
        return;
      }
      if (resp.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        poll(url);
        return;
      }
      setLoadingState('error', '服务器异常');
    } catch (e: any) {
      if (e.response?.status === 202) {
        setLoadingState('converting', '模型转换中，请稍后...');
        poll(url);
      } else {
        setLoadingState('error', '加载失败');
      }
    }
  }

  function poll(url: string) {
    let retries = 0;
    const timer = setInterval(async () => {
      retries++;
      try {
        const resp = await axios.head(url);
        if (resp.status === 200) {
          clearInterval(timer);
          setModelUrl(url);
          setLoadingState('loading');
        }
      } catch (e: any) {
        if (e.response?.status !== 202) {
          clearInterval(timer);
          setLoadingState('error', '转换失败');
        }
      }
      if (retries >= 30) {
        clearInterval(timer);
        setLoadingState('error', '转换超时，请关闭后重试');
      }
    }, 2000);
  }

  return (
    <div className="w-screen h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="h-10 border-b flex items-center px-4 text-sm text-gray-500 shrink-0">
        <span>STP 三维预览</span>
        <div className="ml-auto" />
      </div>

      <div className="flex-1 flex relative">
        {/* Viewer */}
        <div className="flex-1 relative">
          {loadingState === 'converting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mx-auto mb-2" />
                <p className="text-gray-500 text-sm">模型转换中，请稍后...</p>
              </div>
            </div>
          )}

          {loadingState === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
              <p className="text-red-500 text-sm">模型加载失败，请关闭后重试</p>
            </div>
          )}

          {modelUrl && <ViewerCanvas url={modelUrl} />}
          {modelUrl && <Toolbar />}
        </div>

        {/* BOM Panel toggle */}
        {modelUrl && (
          <>
            <button
              onClick={() => setBomOpen(!bomOpen)}
              className="absolute right-0 top-2 z-20 px-2 py-1 bg-white border text-xs rounded-l"
            >
              {bomOpen ? '»' : '« 零件'}
            </button>
            {bomOpen && (
              <div className="w-64 border-l bg-white overflow-auto shrink-0 relative z-10">
                <BOMPanel />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
