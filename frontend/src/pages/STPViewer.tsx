import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ViewerCanvas } from '../components/STPViewer/ViewerCanvas';
import { Toolbar } from '../components/STPViewer/Toolbar';
import { ModelTreePanel } from '../components/STPViewer/ModelTreePanel';
import { ViewCube } from '../components/STPViewer/ViewCube';
import { useViewerStore } from '../stores/viewerStore';
import { AssemblyTreePanel } from '../components/AssemblyViewer/AssemblyTreePanel';
import { InstancedScene } from '../components/AssemblyViewer/InstancedScene';
import { buildInstanceIndex } from '../components/AssemblyViewer/buildInstanceIndex';
import { useAssemblyStore } from '../components/AssemblyViewer/assemblyViewerStore';
import { assemblyViewerApi } from '../services/api';
import type { AssemblyInstance, AssemblyTreeNode } from '../services/api';
import axios from 'axios';

function AssemblyToolbar() {
  const wireframe = useAssemblyStore((s) => s.wireframe);
  const setWireframe = useAssemblyStore((s) => s.setWireframe);
  const isolateMode = useAssemblyStore((s) => s.isolateMode);
  const setIsolate = useAssemblyStore((s) => s.setIsolate);
  const explodeFactor = useAssemblyStore((s) => s.explodeFactor);
  const setExplodeFactor = useAssemblyStore((s) => s.setExplodeFactor);
  const reset = useAssemblyStore((s) => s.reset);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b text-xs">
      <button onClick={() => setWireframe(!wireframe)}
        className={`px-2 py-0.5 rounded ${wireframe ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 hover:bg-gray-300'}`}>
        线框
      </button>
      <button onClick={() => setIsolate(!isolateMode)}
        className={`px-2 py-0.5 rounded ${isolateMode ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 hover:bg-gray-300'}`}>
        隔离
      </button>
      <span className="text-gray-400">爆炸</span>
      <input type="range" min="0" max="100" value={Math.round(explodeFactor * 100)}
        onChange={(e) => setExplodeFactor(Number(e.target.value) / 100)}
        className="w-20 h-4" title="爆炸幅度" />
      <button onClick={reset}
        className="px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 ml-auto">
        重置
      </button>
    </div>
  );
}

export default function STPViewerPage() {
  const [state, setState] = useState<'checking' | 'converting' | 'loading' | 'ready' | 'error'>('checking');
  const [url, setUrl] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [treeWidth, setTreeWidth] = useState(240);
  const dragging = useRef(false);
  const loadingState = useViewerStore((s) => s.loadingState);
  const errorMessage = useViewerStore((s) => s.errorMessage);

  const params = new URLSearchParams(location.search);
  const assemblyRevId = params.get('assembly');

  // 装配模式状态
  const [asmInstances, setAsmInstances] = useState<AssemblyInstance[] | null>(null);
  const [asmTree, setAsmTree] = useState<AssemblyTreeNode[]>([]);
  const [asmError, setAsmError] = useState<string | null>(null);
  const asmReset = useAssemblyStore((s) => s.reset);

  // Resize handle
  const onResizeDown = useCallback(() => { dragging.current = true; }, []);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setTreeWidth(Math.max(160, Math.min(e.clientX, window.innerWidth * 0.55)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    if (assemblyRevId) {
      asmReset();
      Promise.all([
        assemblyViewerApi.instances(assemblyRevId),
        assemblyViewerApi.tree(assemblyRevId),
      ])
        .then(([ins, tr]) => { setAsmInstances(ins); setAsmTree(tr); setState('ready'); })
        .catch(() => setAsmError('加载装配数据失败'));
      return;
    }
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) { setState('error'); return; }

    const gltfUrl = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    checkAndLoad(gltfUrl);
  }, []);

  const asmIndex = useMemo(() => buildInstanceIndex(asmInstances ?? []), [asmInstances]);

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

  // ── 装配模式渲染 ──
  if (assemblyRevId) {
    if (asmError) return <div className="w-screen h-screen flex items-center justify-center text-red-500">{asmError}</div>;
    if (!asmInstances) return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载中...</div>;
    if (asmInstances.length === 0) return <div className="w-screen h-screen flex items-center justify-center text-gray-500">该装配暂无已摆位的零件（先导入装配 STEP）</div>;

    return (
      <div className="w-screen h-screen relative flex">
        {/* Left: BOM 结构树 */}
        <div style={{ width: treeWidth }} className="shrink-0 h-full overflow-auto border-r bg-white">
          <AssemblyTreePanel tree={asmTree} />
        </div>
        {/* Resize handle */}
        <div
          onMouseDown={onResizeDown}
          className="w-1.5 cursor-col-resize hover:bg-blue-400 bg-gray-200 shrink-0 transition-colors"
        />
        {/* Right: Toolbar + Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          <AssemblyToolbar />
          <div className="flex-1 relative">
            <Canvas camera={{ position: [4, 4, 4], fov: 50 }}>
              <ambientLight intensity={0.8} />
              <directionalLight position={[5, 10, 7]} intensity={1} />
              <InstancedScene instances={asmInstances} index={asmIndex} />
              <OrbitControls makeDefault />
            </Canvas>
            <ViewCube />
          </div>
        </div>
      </div>
    );
  }

  // ── 单件模式渲染 ──
  if (state === 'checking') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载中...</div>;
  if (state === 'converting') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">模型转换中，请稍后...</div>;
  if (state === 'error') return <div className="w-screen h-screen flex items-center justify-center text-red-500">加载失败，请关闭后重试</div>;

  return (
    <div className="w-screen h-screen relative flex">
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
          {url && <ViewerCanvas url={url} />}
          <ViewCube />
        </div>
      </div>
      {/* Download progress overlay */}
      {state === 'loading' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在下载模型... {downloadPct}%</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${downloadPct}%` }} />
          </div>
        </div>
      )}
      {/* Parsing overlay */}
      {url && state === 'ready' && loadingState !== 'ready' && loadingState !== 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在解析渲染...</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-pulse" style={{ width: '70%' }} />
          </div>
        </div>
      )}
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
