import { useEffect, useState, useCallback, useRef } from 'react';
import { ViewerCanvas } from '../components/STPViewer/ViewerCanvas';
import { Toolbar } from '../components/STPViewer/Toolbar';
import { ModelTreePanel } from '../components/STPViewer/ModelTreePanel';
import { CompareTreePanel } from '../components/STPViewer/CompareTreePanel';
import { ViewCube } from '../components/STPViewer/ViewCube';
import { useViewerStore } from '../stores/viewerStore';import { assemblyViewerApi, bomApi } from '../services/api';
import type { AssemblyInstance, AssemblyTreeNode } from '../services/api';
import { configurationProfileApi, type ConfigProfilePreviewData } from '../services/api';
import { buildConfigTreeNodes } from '../components/STPViewer/buildConfigTreeNodes';
import { buildCompareTree } from '../components/STPViewer/buildCompareTree';
import type { TreeNode } from '../components/STPViewer/treeTypes';
import type { BOMCompareResponse } from '../types';
import { toast } from '../components/Toast';
import axios from 'axios';

export default function STPViewerPage() {
  const [state, setState] = useState<'checking' | 'converting' | 'loading' | 'loading-config' | 'ready' | 'error'>('checking');
  const [url, setUrl] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [treeWidth, setTreeWidth] = useState(240);
  const dragging = useRef(false);
  const loadingState = useViewerStore((s) => s.loadingState);
  const streamProgress = useViewerStore((s) => s.streamProgress);
  const errorMessage = useViewerStore((s) => s.errorMessage);
  const reset = useViewerStore((s) => s.reset);
  const setTreeData = useViewerStore((s) => s.setTreeData);
  const setLoadingState = useViewerStore((s) => s.setLoadingState);

  const params = new URLSearchParams(location.search);
  const assemblyRevId = params.get('assembly');
  const configProfileId = params.get('config-profile');
  const partCode = params.get('code') || undefined;
  const partVersion = params.get('version') || undefined;
  const partName = params.get('name') || undefined;
  const compareLeftId = params.get('compare-left');
  const compareRightId = params.get('compare-right');

  const [asmInstances, setAsmInstances] = useState<AssemblyInstance[] | null>(null);
  const [asmTree, setAsmTree] = useState<AssemblyTreeNode[]>([]);
  const [asmError, setAsmError] = useState<string | null>(null);
  const [configPreviewData, setConfigPreviewData] = useState<ConfigProfilePreviewData | null>(null);
  const [configPreviewTitle, setConfigPreviewTitle] = useState('');
  const [configDisplayTree, setConfigDisplayTree] = useState<TreeNode | null>(null);
  const [cmpLeftInstances, setCmpLeftInstances] = useState<AssemblyInstance[]>([]);
  const [cmpRightInstances, setCmpRightInstances] = useState<AssemblyInstance[]>([]);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const setCompareTree = useViewerStore((s) => s.setCompareTree);
  const compareSlice = useViewerStore((s) => s.compare);

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
    reset();
    if (compareLeftId && compareRightId) {
      setState('loading');
      Promise.all([
        bomApi.compare(compareLeftId, compareRightId),
        assemblyViewerApi.instances(compareLeftId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareLeftId).catch(() => [] as AssemblyTreeNode[]),
        assemblyViewerApi.instances(compareRightId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareRightId).catch(() => [] as AssemblyTreeNode[]),
      ])
        .then(([cmpRes, li, lt, ri, rt]) => {
          const result = cmpRes.data as BOMCompareResponse;
          const tree = buildCompareTree(result, lt, rt);
          setCompareTree(tree, { leftMissing: li.length === 0, rightMissing: ri.length === 0 });
          setCmpLeftInstances(li);
          setCmpRightInstances(ri);
          setState('ready');
        })
        .catch(() => { setCmpError('对比数据加载失败，请关闭后重试'); setState('error'); });
      return;
    }
    if (assemblyRevId) {
      Promise.all([
        assemblyViewerApi.instances(assemblyRevId),
        assemblyViewerApi.tree(assemblyRevId),
      ])
        .then(([ins, tr]) => { setAsmInstances(ins); setAsmTree(tr); setState('ready'); })
        .catch(() => setAsmError('加载装配数据失败'));
      return;
    }
    if (configProfileId) {
      setState('loading-config');
      configurationProfileApi.preview3d(configProfileId)
        .then((data) => {
          setConfigPreviewData(data);
          setConfigPreviewTitle(`${data.profile_name}（${data.profile_code}）`);
          if (data.config_tree_nodes) {
            const tree = buildConfigTreeNodes(data.config_tree_nodes);
            setConfigDisplayTree(tree);
            setTreeData(tree);
            setLoadingState('ready');
          }
          setState('ready');
          if (data.total_count > data.loaded_count) {
            setTimeout(() => {
              toast.info(`共 ${data.total_count} 个零部件，已加载 ${data.loaded_count} 个3D模型`, 5000);
            }, 800);
          }
        })
        .catch(() => { setState('error'); });
      return;
    }
    const id = params.get('id');
    const token = params.get('token');
    if (!id || !token) { setState('error'); return; }
    const gltfUrl = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    checkAndLoad(gltfUrl);
    return () => { reset(); };
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

  // 对比模式的前置态
  if (compareLeftId && compareRightId) {
    if (cmpError) return <div className="w-screen h-screen flex items-center justify-center text-red-500">{cmpError}</div>;
    if (state !== 'ready') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载对比数据...</div>;
  }

  // 装配模式的前置态（加载/空/错误）
  if (assemblyRevId) {
    if (asmError) return <div className="w-screen h-screen flex items-center justify-center text-red-500">{asmError}</div>;
    if (!asmInstances) return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载中...</div>;
    if (asmInstances.length === 0) return <div className="w-screen h-screen flex items-center justify-center text-gray-500">该装配暂无已摆位的零件（先导入装配 STEP）</div>;
  } else {
    if (state === 'checking') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载中...</div>;
    if (state === 'converting') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">模型转换中，请稍后...</div>;
    if (state === 'error') return <div className="w-screen h-screen flex items-center justify-center text-red-500">加载失败，请关闭后重试</div>;
  }

  return (
    <div className="w-screen h-screen relative flex">
      {(asmTree.length > 0 || !!configDisplayTree || !!(compareLeftId && compareRightId) ||
        (!assemblyRevId && !configProfileId && !compareLeftId && loadingState === 'ready')) && (
        <>
          <div style={{ width: treeWidth }} className="shrink-0 h-full">
            {compareLeftId && compareRightId ? <CompareTreePanel /> : <ModelTreePanel />}
          </div>
          <div
            onMouseDown={onResizeDown}
            className="w-1.5 cursor-col-resize hover:bg-blue-400 bg-gray-200 shrink-0 transition-colors"
          />
        </>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Toolbar />
          {compareSlice && compareSlice.leftMissing !== compareSlice.rightMissing && (
            <div className="px-4 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs text-yellow-800">
              {compareSlice.leftMissing ? '左部件' : '右部件'}尚无 3D 模型，仅显示{compareSlice.leftMissing ? '右' : '左'}侧
            </div>
          )}
        <div className="flex-1 relative">
          {(state === 'ready' || state === 'loading') && (() => {
            if (compareLeftId && compareRightId) return <ViewerCanvas source={{ kind: 'compare', leftInstances: cmpLeftInstances, rightInstances: cmpRightInstances }} />;
            if (configProfileId && configPreviewData) return <ViewerCanvas source={{ kind: 'assembly', instances: configPreviewData.instances, tree: configPreviewData.tree, applyZUp: false, displayTree: configDisplayTree }} />;
            if (assemblyRevId && asmInstances) return <ViewerCanvas source={{ kind: 'assembly', instances: asmInstances, tree: asmTree }} />;
            if (url) return <ViewerCanvas source={{ kind: 'single', url, code: partCode, version: partVersion, name: partName }} />;
            return null;
          })()}
          <ViewCube />
          {compareLeftId && compareRightId && cmpLeftInstances.length === 0 && cmpRightInstances.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-gray-500 pointer-events-none">
              两个部件均无 3D 模型
            </div>
          )}
        </div>
      </div>

      {/* 单件模式下载/解析进度 */}
      {!assemblyRevId && state === 'loading' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在下载模型... {downloadPct}%</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${downloadPct}%` }} />
          </div>
        </div>
      )}
      {state === 'loading-config' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-gray-900/20 backdrop-blur-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mb-3" />
          <p className="text-sm text-white">正在加载配置清单3D模型...</p>
        </div>
      )}
      {/* 单件：解析渲染中（非阻塞角标） */}
      {!assemblyRevId && url && state === 'ready' && loadingState !== 'ready' && loadingState !== 'error' && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 bg-white/90 rounded-full shadow px-3 py-1.5 pointer-events-none">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-green-500 border-t-transparent" />
          <span className="text-gray-600 text-xs">正在解析渲染...</span>
        </div>
      )}

      {/* 装配：流式加载进度（非阻塞角标） */}
      {(assemblyRevId || (compareLeftId && compareRightId)) && streamProgress && streamProgress.loaded < streamProgress.total && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 bg-white/90 rounded-full shadow px-3 py-1.5 pointer-events-none">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent" />
          <span className="text-gray-600 text-xs tabular-nums">
            已加载 {streamProgress.loaded}/{streamProgress.total}
          </span>
        </div>
      )}
      {loadingState === 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-red-500 text-sm">模型加载失败</div>
          {errorMessage && <div className="text-gray-400 text-xs">{errorMessage}</div>}
          <div className="text-gray-400 text-xs mt-1">请关闭后重试</div>
        </div>
      )}
    </div>
  );
}
