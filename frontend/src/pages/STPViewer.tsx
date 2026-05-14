import { useEffect, useState } from 'react';
import { ViewerCanvas } from '../components/STPViewer/ViewerCanvas';
import { Toolbar } from '../components/STPViewer/Toolbar';
import { useViewerStore } from '../stores/viewerStore';
import axios from 'axios';

export default function STPViewerPage() {
  const [state, setState] = useState<'checking' | 'converting' | 'loading' | 'ready' | 'error'>('checking');
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const loadingState = useViewerStore((s) => s.loadingState);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) { setState('error'); return; }

    const gltfUrl = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    checkAndLoad(gltfUrl);
  }, []);

  // Track loading progress from ModelLoader
  useEffect(() => {
    if (state === 'loading' && loadingState === 'ready') {
      setState('ready');
    }
  }, [loadingState, state]);

  async function checkAndLoad(gltfUrl: string) {
    try {
      const resp = await axios.head(gltfUrl);
      if (resp.status === 200) { setUrl(gltfUrl); setState('loading'); return; }
      if (resp.status === 202) { setState('converting'); poll(gltfUrl); return; }
      setState('error');
    } catch (e: any) {
      if (e.response?.status === 202) { setState('converting'); poll(gltfUrl); }
      else setState('error');
    }
  }

  function poll(gltfUrl: string) {
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const resp = await axios.head(gltfUrl);
        if (resp.status === 200) { clearInterval(t); setUrl(gltfUrl); setState('loading'); }
      } catch (e: any) {
        if (e.response?.status !== 202) { clearInterval(t); setState('error'); }
      }
      if (tries >= 30) { clearInterval(t); setState('error'); }
    }, 2000);
  }

  if (state === 'checking') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载中...</div>;
  if (state === 'converting') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">模型转换中，请稍后...</div>;
  if (state === 'error') return <div className="w-screen h-screen flex items-center justify-center text-red-500">加载失败，请关闭后重试</div>;

  return (
    <div className="w-screen h-screen relative">
      <ViewerCanvas url={url!} />
      <Toolbar />
      {/* 加载遮罩：Canvas 在背后渲染，遮罩盖在上面 */}
      {state === 'loading' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在加载模型...</div>
          <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}
    </div>
  );
}
