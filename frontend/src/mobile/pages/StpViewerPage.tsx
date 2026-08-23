import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { assemblyViewerApi, bomApi } from '../../services/api';
import type { AssemblyInstance, AssemblyTreeNode } from '../../services/api';
import type { BOMCompareResponse } from '../../types';
import { ViewerCanvas } from '../../components/STPViewer/ViewerCanvas';
import { ModelTreePanel } from '../../components/STPViewer/ModelTreePanel';
import { CompareTreePanel } from '../../components/STPViewer/CompareTreePanel';
import { ViewCube } from '../../components/STPViewer/ViewCube';
import { buildCompareTree } from '../../components/STPViewer/buildCompareTree';
import { useViewerStore } from '../../stores/viewerStore';
import { backInterceptReducer } from '../hooks/backIntercept';
import Button from '../../components/ui/Button';
import type { BackAction, BackLayer } from '../hooks/backIntercept';

/**
 * 移动端 STP 3D 查看器（Task 12 + 装配/对比模式扩展）。
 *
 * 参数约定与桌面版 pages/STPViewer.tsx 完全一致：
 *   单件预览：/stp-viewer?id=<附件id>&token=<媒体令牌>[&code=&version=&name=]
 *     → gltf 地址 /api/v2/attachments/{id}/gltf?token=...，code/version/name 透传给 ViewerCanvas。
 *   装配预览：/stp-viewer?assembly=<版本id>[&code=&version=&name=]
 *     → assemblyViewerApi.instances/tree 加载全部叶项实例（含变换矩阵），
 *       ViewerCanvas kind='assembly' 按矩阵摆放渲染。
 *   BOM 对比：/stp-viewer?compare-left=<版本id>&compare-right=<版本id>
 *     → bomApi.compare + 两侧 instances/tree → buildCompareTree 配对树（CompareTreePanel），
 *       ViewerCanvas kind='compare' 左右叠加渲染（新增绿 / 删除红）。
 * 配置清单（config-profile）模式为桌面工程流程，移动端暂不支持，给出明确的桌面端提示。
 *
 * 交互：
 * - 画布容器 touch-action: none，防止页面手势（滚动/双指缩放浏览器级手势）抢走
 *   单指旋转 / 双指缩放的触控事件。
 * - 左右抽屉走 backInterceptReducer + history.pushState 哨兵：
 *   · 打开抽屉 → pushState({ drawer: 'tree'|'tools' })；
 *   · 系统返回/浏览器返回（popstate）→ dispatch pop 先关抽屉（哨兵已被浏览器弹出，无需补偿）；
 *   · 用户点击关闭（按钮/遮罩）→ dispatch close-drawer + history.back() 弹出哨兵，
 *     保持 history 栈与 UI 层数一致（避免下一次系统返回"吃掉"哨兵）。
 *   循环防护：history.back() 只在用户关闭路径调用，popstate 处理器从不调用 back()；
 *   lastCloseWasPop 标志区分"用户关闭"与"popstate 关闭"，并在 backLayer 回到 page 时复位。
 */

type DrawerId = 'tree' | 'tools';
type Phase = 'checking' | 'converting' | 'loading' | 'ready' | 'error';

/** 工具抽屉：直接复用 useViewerStore 的 actions（与桌面 Toolbar 同一语义，不新增 state） */
function ToolsPanel() {
  const vs = useViewerStore();
  const { clipPlanes, measureMode, explodeDistance, wireframe, cameraMode, autoColor, compare } = vs;

  const planeOf = (axis: 'x' | 'y' | 'z') => clipPlanes.find((p) => p.axis === axis);

  const btnBase =
    'w-full min-h-11 rounded-lg border text-sm font-medium transition-colors ' +
    'active:opacity-80';
  const btnOn = 'bg-[var(--ui-btn-primary-bg)] text-white border-[var(--ui-btn-primary-bg)]';
  const btnOff = 'bg-[var(--ui-bg-surface)] text-[var(--ui-text-secondary)] border-[var(--ui-border)]';
  const btnDisabled = 'bg-[var(--ui-bg-subtle)] text-gray-300 border-gray-100 cursor-not-allowed';

  const DISPLAY_MODES = [
    { value: 'both' as const, label: '叠加' },
    { value: 'left' as const, label: '只看左' },
    { value: 'right' as const, label: '只看右' },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* 对比显示（仅对比模式） */}
      {compare && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs text-[var(--ui-text-tertiary)] font-medium">对比显示</div>
          <div className="flex rounded-lg overflow-hidden border border-[var(--ui-border)]">
            {DISPLAY_MODES.map((m, i) => (
              <button
                key={m.value}
                type="button"
                onClick={() => vs.setDisplayMode(m.value)}
                className={`flex-1 min-h-10 text-xs font-medium ${
                  compare.displayMode === m.value
                    ? 'bg-[var(--ui-btn-primary-bg)] text-white'
                    : 'bg-[var(--ui-bg-surface)] text-[var(--ui-text-secondary)]'
                } ${i > 0 ? 'border-l border-[var(--ui-border)]' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 min-h-10 text-sm text-[var(--ui-text-secondary)] select-none">
            <input
              type="checkbox"
              checked={compare.onlyDiff}
              onChange={(e) => vs.setOnlyDiff(e.target.checked)}
              className="h-4 w-4 accent-primary-600"
            />
            仅显示差异
          </label>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-[var(--ui-text-secondary)]">幽灵</span>
            <input
              type="range"
              min={0.02}
              max={0.5}
              step={0.01}
              value={compare.ghostOpacity}
              onChange={(e) => vs.setGhostOpacity(Number(e.target.value))}
              className="flex-1 h-8 accent-primary-600"
              aria-label="幽灵透明度"
            />
            <span className="shrink-0 w-8 text-right text-xs tabular-nums text-[var(--ui-text-tertiary)]">
              {compare.ghostOpacity.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* 测量 */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-[var(--ui-text-tertiary)] font-medium">测量</div>
        <button
          type="button"
          onClick={() => vs.setMeasureMode(measureMode === 'distance' ? 'off' : 'distance')}
          className={`${btnBase} ${measureMode === 'distance' ? btnOn : btnOff}`}
        >
          {measureMode === 'distance' ? '测量中（点击关闭）' : '距离测量'}
        </button>
      </div>

      {/* 剖切 */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-[var(--ui-text-tertiary)] font-medium">剖切</div>
        {(['x', 'y', 'z'] as const).map((axis) => {
          const plane = planeOf(axis);
          return (
            <div key={axis} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => (plane ? vs.removeClipPlane(axis) : vs.setClipPlane(axis, 0))}
                className={`${btnBase} ${plane ? btnOn : btnOff}`}
              >
                {axis.toUpperCase()} 剖切面{plane ? '（开）' : ''}
              </button>
              {plane && (
                <div className="flex items-center gap-2 pl-1">
                  <input
                    type="range"
                    min={-5}
                    max={5}
                    step={0.1}
                    value={plane.position}
                    onChange={(e) => vs.setClipPlane(axis, Number(e.target.value))}
                    className="flex-1 h-8 accent-primary-600"
                    aria-label={`${axis.toUpperCase()} 剖切位置`}
                  />
                  <button
                    type="button"
                    onClick={() => vs.toggleClipFlip(axis)}
                    className={`shrink-0 min-w-11 min-h-11 rounded-lg border text-xs font-medium ${
                      plane.flip ? btnOn : btnOff
                    }`}
                  >
                    反向
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 爆炸 */}
      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-[var(--ui-text-tertiary)] font-medium">爆炸</div>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={explodeDistance}
          onChange={(e) => vs.setExplodeDistance(Number(e.target.value))}
          className="w-full h-8 accent-primary-600"
          aria-label="爆炸距离"
        />
      </div>

      {/* 线框 / 上色 / 相机 */}
      <button type="button" onClick={vs.toggleWireframe} className={`${btnBase} ${wireframe ? btnOn : btnOff}`}>
        线框{wireframe ? '（开）' : ''}
      </button>
      <button
        type="button"
        onClick={vs.toggleAutoColor}
        disabled={!!compare}
        className={`${btnBase} ${compare ? btnDisabled : autoColor ? btnOn : btnOff}`}
      >
        上色{compare ? '（对比模式不可用）' : autoColor ? '（开）' : ''}
      </button>
      <button type="button" onClick={vs.toggleCameraMode} className={`${btnBase} ${btnOff}`}>
        {cameraMode === 'orthographic' ? '平行视图' : '透视视图'}
      </button>

      {/* 重置 */}
      <Button
        onClick={vs.triggerResetView}
        variant="ghost"
        size="touch"
        className="w-full"
      >
        重置视图
      </Button>
    </div>
  );
}

/** 查看器参数（与桌面 pages/STPViewer.tsx 约定一致），路由壳从 URL 解析，BOM 对比内嵌时直接传入 */
export interface ViewerParams {
  id?: string | null;
  token?: string | null;
  assembly?: string | null;
  compareLeft?: string | null;
  compareRight?: string | null;
  configProfile?: string | null;
  code?: string;
  version?: string;
  name?: string;
}

/**
 * 查看器主体（可复用）：
 * - 路由场景：/stp-viewer?...
 * - BOM 对比内嵌：作为全屏浮层（返回仅关闭浮层，对比页状态不丢）
 */
export function StpViewerCore({
  params,
  onBack,
}: {
  params: ViewerParams;
  onBack: () => void;
}) {
  // —— 参数（与桌面 pages/STPViewer.tsx 约定一致）——
  const id = params.id;
  const token = params.token;
  const assemblyRevId = params.assembly;
  const compareLeftId = params.compareLeft;
  const compareRightId = params.compareRight;
  const partCode = params.code;
  const partVersion = params.version;
  const partName = params.name;
  const compareMode = !!(compareLeftId && compareRightId);
  const unsupportedMode = !!params.configProfile;

  // —— 模型加载（单件复刻桌面 checkAndLoad / downloadFile / poll 逻辑；装配/对比走 instances/tree）——
  const [phase, setPhase] = useState<Phase>('checking');
  const [url, setUrl] = useState<string | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [asmInstances, setAsmInstances] = useState<AssemblyInstance[] | null>(null);
  const [asmTree, setAsmTree] = useState<AssemblyTreeNode[]>([]);
  const [cmpLeftInstances, setCmpLeftInstances] = useState<AssemblyInstance[]>([]);
  const [cmpRightInstances, setCmpRightInstances] = useState<AssemblyInstance[]>([]);
  const blobUrlRef = useRef<string | null>(null);
  const resetStore = useViewerStore((s) => s.reset);
  const setCompareTree = useViewerStore((s) => s.setCompareTree);
  const loadingState = useViewerStore((s) => s.loadingState);
  const errorMessage = useViewerStore((s) => s.errorMessage);

  useEffect(() => {
    resetStore();
    blobUrlRef.current = null;
    setUrl(null);
    if (unsupportedMode) return;
    if (compareLeftId && compareRightId) {
      // 对比模式：BOM 对比 + 两侧装配实例/树 → 配对树（与桌面 pages/STPViewer.tsx 一致）
      let cancelled = false;
      setPhase('loading');
      setCmpLeftInstances([]);
      setCmpRightInstances([]);
      Promise.all([
        bomApi.compare(compareLeftId, compareRightId),
        assemblyViewerApi.instances(compareLeftId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareLeftId).catch(() => [] as AssemblyTreeNode[]),
        assemblyViewerApi.instances(compareRightId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareRightId).catch(() => [] as AssemblyTreeNode[]),
      ])
        .then(([cmpRes, li, lt, ri, rt]) => {
          if (cancelled) return;
          const result = cmpRes.data as BOMCompareResponse;
          const tree = buildCompareTree(result, lt, rt);
          setCompareTree(tree, { leftMissing: li.length === 0, rightMissing: ri.length === 0 });
          setCmpLeftInstances(li);
          setCmpRightInstances(ri);
          setPhase('ready');
        })
        .catch(() => {
          if (!cancelled) setPhase('error');
        });
      return () => {
        cancelled = true;
        resetStore();
      };
    }
    if (assemblyRevId) {
      // 装配模式：加载全部叶项实例（含变换矩阵）与模型树，按矩阵摆放渲染
      let cancelled = false;
      setPhase('loading');
      setAsmInstances(null);
      setAsmTree([]);
      Promise.all([
        assemblyViewerApi.instances(assemblyRevId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(assemblyRevId).catch(() => [] as AssemblyTreeNode[]),
      ])
        .then(([ins, tr]) => {
          if (cancelled) return;
          setAsmInstances(ins);
          setAsmTree(tr);
          setPhase('ready');
        })
        .catch(() => {
          if (!cancelled) setPhase('error');
        });
      return () => {
        cancelled = true;
        resetStore();
      };
    }
    if (!id || !token) {
      setPhase('error');
      return;
    }
    const gltfUrl = `/api/v2/attachments/${id}/gltf?token=${encodeURIComponent(token)}`;
    let cancelled = false;

    const downloadFile = async () => {
      if (cancelled) return;
      setPhase('loading');
      try {
        const resp = await axios.get(gltfUrl, {
          responseType: 'blob',
          onDownloadProgress: (e) => {
            if (e.total && !cancelled) setDownloadPct(Math.round((e.loaded / e.total) * 100));
          },
        });
        if (cancelled) return;
        const blobUrl = URL.createObjectURL(resp.data);
        blobUrlRef.current = blobUrl;
        setUrl(blobUrl);
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('error');
      }
    };

    // 后端 STP→glTF 转换未完成时返回 202，轮询 HEAD 直到 200（最多 30 次 × 2s）
    const pollConvert = () =>
      new Promise<void>((resolve) => {
        let tries = 0;
        const t = setInterval(async () => {
          tries += 1;
          try {
            const resp = await axios.head(gltfUrl);
            if (resp.status === 200) {
              clearInterval(t);
              await downloadFile();
              resolve();
              return;
            }
          } catch (e: any) {
            if (e.response?.status !== 202) {
              clearInterval(t);
              if (!cancelled) setPhase('error');
              resolve();
              return;
            }
          }
          if (tries >= 30) {
            clearInterval(t);
            if (!cancelled) setPhase('error');
            resolve();
          }
        }, 2000);
      });

    (async () => {
      try {
        const resp = await axios.head(gltfUrl);
        if (resp.status === 200) {
          await downloadFile();
        } else if (resp.status === 202) {
          setPhase('converting');
          await pollConvert();
        } else if (!cancelled) {
          setPhase('error');
        }
      } catch (e: any) {
        if (e.response?.status === 202) {
          setPhase('converting');
          await pollConvert();
        } else if (!cancelled) {
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      resetStore();
    };
  }, [id, token, unsupportedMode, assemblyRevId, compareLeftId, compareRightId, resetStore, setCompareTree]);

  // —— 返回拦截：左右抽屉 + history 哨兵（backInterceptReducer）——
  const [backLayer, dispatch] = useReducer<React.Reducer<BackLayer, BackAction>>(
    backInterceptReducer,
    { kind: 'page' },
  );
  // 与 reducer 状态同步的 ref：popstate 处理器与关闭函数需要读到"当前"层，
  // 而组件闭包里的 backLayer 在渲染前是旧值。
  const layerRef = useRef<BackLayer>({ kind: 'page' });
  // 区分"用户关闭"与"popstate 关闭"：popstate 关抽屉时哨兵已被浏览器弹出，
  // 无需再 back()；用户主动关闭时才需要 back() 弹出哨兵保持 history 栈一致。
  const lastCloseWasPop = useRef(false);

  const dispatchLayer = useCallback((action: BackAction) => {
    dispatch(action);
    layerRef.current = backInterceptReducer(layerRef.current, action);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      // 弹出前若正处于 drawer 层，本次 pop 属于"系统返回关抽屉"
      if (layerRef.current.kind === 'drawer') lastCloseWasPop.current = true;
      // 只关抽屉、从不调用 history.back()：UI 关闭路径的 back() 触发本处理器时
      // 层已是 page，dispatch pop 为 no-op，天然无循环。
      dispatchLayer({ type: 'pop' });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [dispatchLayer]);

  // 层回到 page 时复位标志，避免下一次"用户关闭"误判为 popstate 关闭而漏掉 back()
  useEffect(() => {
    if (backLayer.kind === 'page') lastCloseWasPop.current = false;
  }, [backLayer]);

  const openDrawer = useCallback(
    (drawerId: DrawerId) => {
      if (layerRef.current.kind === 'drawer') return; // 已有抽屉打开时不重复入栈
      dispatchLayer({ type: 'open-drawer', drawerId });
      window.history.pushState({ drawer: drawerId }, '');
    },
    [dispatchLayer],
  );

  const closeDrawer = useCallback(() => {
    if (layerRef.current.kind === 'page') return;
    dispatchLayer({ type: 'close-drawer' });
    if (!lastCloseWasPop.current) {
      // 用户主动关闭：哨兵仍在栈中 → back() 弹出，保持 history 栈与 UI 层一致
      window.history.back();
    }
    lastCloseWasPop.current = false;
  }, [dispatchLayer]);

  const drawer = backLayer.kind === 'drawer' ? (backLayer.drawerId as DrawerId) : null;
  const displayTitle = compareMode
    ? '3D 对比'
    : [partCode, partVersion, partName].filter(Boolean).join('_') ||
      (assemblyRevId ? '装配 3D 模型' : '3D 模型');

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-100 flex flex-col">
      {/* 顶部返回条：返回按钮 + 模型名 */}
      <div className="flex items-center gap-1 bg-[var(--ui-bg-surface)] border-b border-[var(--ui-border)] px-2 shrink-0">
        <button
          type="button"
          aria-label="返回"
          onClick={onBack}
          className="shrink-0 min-w-11 h-11 flex items-center justify-center text-2xl leading-none text-[var(--ui-text-secondary)]"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1 text-sm font-medium text-[var(--ui-text-primary)] truncate">{displayTitle}</div>
      </div>

      {/* 画布容器：touch-action: none 防止页面手势抢走单指旋转/双指缩放 */}
      <div className="relative flex-1 min-h-0" style={{ touchAction: 'none' }}>
        {phase === 'ready' && url && (
          <ViewerCanvas source={{ kind: 'single', url, code: partCode, version: partVersion, name: partName }} />
        )}
        {phase === 'ready' && assemblyRevId && asmInstances && (
          <ViewerCanvas source={{ kind: 'assembly', instances: asmInstances, tree: asmTree }} />
        )}
        {phase === 'ready' && compareMode && (
          <ViewerCanvas
            source={{ kind: 'compare', leftInstances: cmpLeftInstances, rightInstances: cmpRightInstances }}
          />
        )}

        {/* 桌面工程模式（配置清单）暂不支持移动端 */}
        {unsupportedMode && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-gray-100">
            <div className="text-sm text-[var(--ui-text-secondary)]">该模式暂不支持移动端查看，请使用电脑浏览器</div>
            <Button
              onClick={onBack}
              size="touch"
            >
              返回
            </Button>
          </div>
        )}

        {!unsupportedMode && phase === 'checking' && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--ui-bg-subtle)]">
            <span className="text-sm text-[var(--ui-text-secondary)]">加载中...</span>
          </div>
        )}
        {!unsupportedMode && phase === 'converting' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[var(--ui-bg-subtle)]">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
            <span className="text-sm text-[var(--ui-text-secondary)]">模型转换中，请稍后...</span>
          </div>
        )}
        {!unsupportedMode && phase === 'loading' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--ui-bg-surface)]">
            <div className="text-sm text-[var(--ui-text-secondary)]">
              {compareMode
                ? '正在加载对比模型...'
                : assemblyRevId
                  ? '正在加载装配模型...'
                  : `正在下载模型... ${downloadPct}%`}
            </div>
            {!assemblyRevId && !compareMode && (
              <div className="w-64 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadPct}%` }}
                />
              </div>
            )}
          </div>
        )}
        {!unsupportedMode && phase === 'ready' && compareMode && cmpLeftInstances.length === 0 && cmpRightInstances.length === 0 && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--ui-bg-subtle)]">
            <div className="text-sm text-[var(--ui-text-secondary)]">两侧装配均无已摆位的零件（先导入装配 STEP）</div>
            <Button
              onClick={onBack}
              size="touch"
            >
              返回
            </Button>
          </div>
        )}
        {!unsupportedMode && phase === 'ready' && assemblyRevId && asmInstances && asmInstances.length === 0 && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--ui-bg-subtle)]">
            <div className="text-sm text-[var(--ui-text-secondary)]">该装配暂无已摆位的零件（先导入装配 STEP）</div>
            <Button
              onClick={onBack}
              size="touch"
            >
              返回
            </Button>
          </div>
        )}
        {!unsupportedMode && phase === 'error' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--ui-bg-subtle)]">
            <div className="text-sm text-red-500">加载失败，请关闭后重试</div>
            <Button
              onClick={onBack}
              size="touch"
            >
              返回
            </Button>
          </div>
        )}

        {/* 单件：glTF 解析渲染中（非阻塞角标） */}
        {!unsupportedMode && phase === 'ready' && url && loadingState !== 'ready' && loadingState !== 'error' && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-[var(--ui-bg-surface)] rounded-full shadow px-3 py-1.5 pointer-events-none">
            <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-green-500 border-t-transparent" />
            <span className="text-[var(--ui-text-secondary)] text-xs">正在解析渲染...</span>
          </div>
        )}
        {!unsupportedMode && loadingState === 'error' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[var(--ui-bg-surface)]">
            <div className="text-red-500 text-sm">模型加载失败</div>
            {errorMessage && <div className="text-[var(--ui-text-tertiary)] text-xs">{errorMessage}</div>}
            <div className="text-[var(--ui-text-tertiary)] text-xs">请关闭后重试</div>
          </div>
        )}

        {/* 姿态球（ViewCube）：跟随相机姿态，点击前/后/左/右/上/下切换视角（参考桌面版） */}
        {!unsupportedMode && phase === 'ready' && (url || asmInstances || compareMode) && (
          <ViewCube />
        )}

        {/* 浮动按钮（抽屉打开时被遮罩盖住不可点） */}
        {!unsupportedMode && phase === 'ready' && (url || asmInstances || compareMode) && (
          <>
            <Button
              onClick={() => openDrawer('tree')}
              variant="secondary"
              size="xs"
              className="absolute left-3 bottom-5 z-20 min-w-11 min-h-11 px-3 rounded-full shadow-md"
            >
              模型树
            </Button>
            <Button
              onClick={() => openDrawer('tools')}
              variant="secondary"
              size="xs"
              className="absolute right-3 bottom-5 z-20 min-w-11 min-h-11 px-3 rounded-full shadow-md"
            >
              工具
            </Button>
          </>
        )}

        {/* 左抽屉：模型树 */}
        {drawer === 'tree' && (
          <>
            <div className="absolute inset-0 z-30 bg-black/30" onClick={closeDrawer} />
            <div className="absolute inset-y-0 left-0 z-40 w-64 bg-[var(--ui-bg-surface)] shadow-lg flex flex-col">
              <div className="flex items-center justify-between px-3 border-b border-gray-100 shrink-0">
                <span className="text-sm font-semibold text-[var(--ui-text-secondary)] truncate">模型树</span>
                <button
                  type="button"
                  aria-label="关闭模型树"
                  onClick={closeDrawer}
                  className="shrink-0 min-w-11 h-11 flex items-center justify-center text-[var(--ui-text-tertiary)] text-xl"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {compareMode ? <CompareTreePanel /> : <ModelTreePanel />}
              </div>
            </div>
          </>
        )}

        {/* 右抽屉：工具 */}
        {drawer === 'tools' && (
          <>
            <div className="absolute inset-0 z-30 bg-black/30" onClick={closeDrawer} />
            <div className="absolute inset-y-0 right-0 z-40 w-64 bg-[var(--ui-bg-surface)] shadow-lg flex flex-col">
              <div className="flex items-center justify-between px-3 border-b border-gray-100 shrink-0">
                <span className="text-sm font-semibold text-[var(--ui-text-secondary)]">工具</span>
                <button
                  type="button"
                  aria-label="关闭工具"
                  onClick={closeDrawer}
                  className="shrink-0 min-w-11 h-11 flex items-center justify-center text-[var(--ui-text-tertiary)] text-xl"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-3">
                <ToolsPanel />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 路由壳：/stp-viewer 参数解析 → StpViewerCore（单件/装配/对比模式） */
export default function StpViewerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const viewerParams: ViewerParams = {
    id: params.get('id'),
    token: params.get('token'),
    assembly: params.get('assembly'),
    compareLeft: params.get('compare-left'),
    compareRight: params.get('compare-right'),
    configProfile: params.get('config-profile'),
    code: params.get('code') || undefined,
    version: params.get('version') || undefined,
    name: params.get('name') || undefined,
  };
  return <StpViewerCore params={viewerParams} onBack={() => navigate(-1)} />;
}
