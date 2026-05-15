import { useEffect, useState } from 'react';
import { ViewerCanvas } from '../components/STPViewer/ViewerCanvas';
import { Toolbar } from '../components/STPViewer/Toolbar';
import { useViewerStore } from '../stores/viewerStore';
import axios from 'axios';

export default function STPViewerPage() {
  const [state, setState] = useState<'checking' | 'converting' | 'loading' | 'ready' | 'error'>('checking');
  const [url, setUrl] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const loadingState = useViewerStore((s) => s.loadingState);
  const errorMessage = useViewerStore((s) => s.errorMessage);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) { setState('error'); return; }

    const gltfUrl = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    checkAndLoad(gltfUrl);
  }, []);

  async function checkAndLoad(gltfUrl: string) {
    try {
      const resp = await axios.head(gltfUrl);
      if (resp.status === 200) { downloadFile(gltfUrl); return; }
      if (resp.status === 202) { setState('converting'); poll(gltfUrl); return; }
      setState('error');
    } catch (e: any) {
      if (e.response?.status === 202) { setState('converting'); poll(gltfUrl); }
      else setState('error');
    }
  }

  async function downloadFile(gltfUrl: string) {
    setState('loading');
    try {
      const resp = await axios.get(gltfUrl, {
        responseType: 'blob',
        onDownloadProgress: (e) => {
          if (e.total) setDownloadPct(Math.round((e.loaded / e.total) * 100));
        },
      });
      const blobUrl = URL.createObjectURL(resp.data);
      setUrl(blobUrl);
      // Go directly to ready — ModelLoader will handle parse status via loadingState
      setState('ready');
    } catch {
      setState('error');
    }
  }

  function poll(gltfUrl: string) {
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const resp = await axios.head(gltfUrl);
        if (resp.status === 200) { clearInterval(t); downloadFile(gltfUrl); }
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
      {url && <ViewerCanvas url={url} />}
      <Toolbar />
      {/* Download progress overlay */}
      {state === 'loading' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在下载模型... {downloadPct}%</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${downloadPct}%` }} />
          </div>
        </div>
      )}
      {/* Parsing overlay — show while ModelLoader hasn't finished yet */}
      {url && state === 'ready' && loadingState !== 'ready' && loadingState !== 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在解析渲染...</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-pulse" style={{ width: '70%' }} />
          </div>
        </div>
      )}
      {/* Model loading error — GLTFErrorBoundary sets this */}
      {url && loadingState === 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-red-500 text-sm">模型加载失败</div>
          {errorMessage && <div className="text-gray-400 text-xs">{errorMessage}</div>}
          <div className="text-gray-400 text-xs mt-1">请关闭后重试</div>
        </div>
      )}
    </div>
  );
}
