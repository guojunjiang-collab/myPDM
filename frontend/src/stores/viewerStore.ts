import { create } from 'zustand';
import type { TreeNode } from '../components/STPViewer/treeTypes';

export interface ViewerState {
  // 模型状态
  modelUrl: string | null;
  loadingState: 'idle' | 'converting' | 'loading' | 'ready' | 'error';
  errorMessage: string;

  // 零件交互

  // 装配树
  treeData: TreeNode | null;
  nodeMap: Map<string, TreeNode>;
  meshOwner: Map<string, TreeNode>;
  selectedNodeId: string | null;
  isolateMode: boolean;
  expandedIds: Set<string>;
  hiddenParts: Set<string>;

  // 视图
  modelScale: number;
  clipPlanes: { axis: 'x' | 'y' | 'z'; position: number; flip: boolean }[];
  measureMode: 'off' | 'distance' | 'angle';
  explodeDistance: number;
  wireframe: boolean;
  autoColor: boolean;
  cameraMode: 'orthographic' | 'perspective';
  viewTarget: string | null;
  cameraQuat: [number, number, number, number];
  resetViewTrigger: number;
  // 初始状态（重置时恢复）
  initGroupScale: number;
  initGroupPos: [number, number, number];
  initCamPos: [number, number, number];
  initCamTarget: [number, number, number];

  // Actions
  setModelUrl: (url: string | null) => void;
  setModelScale: (s: number) => void;
  setLoadingState: (state: ViewerState['loadingState'], msg?: string) => void;
  setTreeData: (t: TreeNode | null) => void;
  selectNode: (id: string | null) => void;
  selectByMesh: (meshUuid: string) => void;
  setIsolateMode: (v: boolean) => void;
  toggleExpanded: (id: string) => void;
  toggleNodeVisibility: (node: TreeNode) => void;
  setClipPlane: (axis: 'x' | 'y' | 'z', position: number) => void;
  toggleClipFlip: (axis: 'x' | 'y' | 'z') => void;
  removeClipPlane: (axis: 'x' | 'y' | 'z') => void;
  setMeasureMode: (mode: ViewerState['measureMode']) => void;
  setExplodeDistance: (d: number) => void;
  toggleWireframe: () => void;
  toggleAutoColor: () => void;
  toggleCameraMode: () => void;
  setViewTarget: (view: string | null) => void;
  triggerResetView: () => void;
  setInitialState: (s: { groupScale: number; groupPos: [number, number, number]; camPos: [number, number, number]; camTarget: [number, number, number] }) => void;
  reset: () => void;
}

const initialState = {
  modelUrl: null as string | null,
  loadingState: 'idle' as const,
  errorMessage: '',
  treeData: null as TreeNode | null,
  nodeMap: new Map<string, TreeNode>(),
  meshOwner: new Map<string, TreeNode>(),
  selectedNodeId: null as string | null,
  isolateMode: true,
  expandedIds: new Set<string>(),
  hiddenParts: new Set<string>(),
  modelScale: 1,
  clipPlanes: [] as { axis: 'x' | 'y' | 'z'; position: number; flip: boolean }[],
  measureMode: 'off' as const,
  explodeDistance: 0,
  wireframe: false,
  autoColor: false,
  cameraMode: 'orthographic' as const,
  viewTarget: null as string | null,
  cameraQuat: [0, 0, 0, 1] as [number, number, number, number],
  resetViewTrigger: 0,
  initGroupScale: 1,
  initGroupPos: [0, 0, 0] as [number, number, number],
  initCamPos: [5, 5, 5] as [number, number, number],
  initCamTarget: [0, 0, 0] as [number, number, number],
};

export const useViewerStore = create<ViewerState>((set, get) => ({
  ...initialState,

  setModelUrl: (url) => set({ modelUrl: url }),
  setModelScale: (s) => set({ modelScale: s }),
  setLoadingState: (state, msg = '') =>
    set({ loadingState: state, errorMessage: msg }),

  setTreeData: (t) => {
    const nodeMap = new Map<string, TreeNode>();
    const meshOwner = new Map<string, TreeNode>();
    const visit = (n: TreeNode) => {
      nodeMap.set(n.id, n);
      if (n.type === 'part') n.meshUuids.forEach((u) => meshOwner.set(u, n));
      n.children.forEach(visit);
    };
    if (t) visit(t);
    set({ treeData: t, nodeMap, meshOwner, selectedNodeId: null, hiddenParts: new Set() });
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  selectByMesh: (meshUuid) => {
    const { meshOwner, nodeMap } = get();
    const owner = meshOwner.get(meshUuid);
    if (!owner) return;
    const expanded = new Set(get().expandedIds);
    // 沿 parentId 上溯展开所有祖先；expanded 自带去重，兼作环路防护
    let p = owner.parentId;
    while (p && !expanded.has(p)) {
      expanded.add(p);
      p = nodeMap.get(p)?.parentId ?? null;
    }
    set({ selectedNodeId: owner.id, expandedIds: expanded });
  },

  setIsolateMode: (v) => set({ isolateMode: v }),

  toggleExpanded: (id) => {
    const e = new Set(get().expandedIds);
    e.has(id) ? e.delete(id) : e.add(id);
    set({ expandedIds: e });
  },

  toggleNodeVisibility: (node) => {
    if (node.meshUuids.length === 0) return; // 无关联 mesh，避免无谓的 set 触发重渲染
    const hidden = new Set(get().hiddenParts);
    const allHidden = node.meshUuids.every((u) => hidden.has(u));
    if (allHidden) {
      node.meshUuids.forEach((u) => hidden.delete(u)); // 当前全隐 → 显示
    } else {
      node.meshUuids.forEach((u) => hidden.add(u)); // 否则 → 隐藏
    }
    set({ hiddenParts: hidden });
  },

  setClipPlane: (axis, position) => {
    const planes = get().clipPlanes.filter((p) => p.axis !== axis);
    set({ clipPlanes: [...planes, { axis, position, flip: false }] });
  },

  toggleClipFlip: (axis) => {
    set({
      clipPlanes: get().clipPlanes.map((p) =>
        p.axis === axis ? { ...p, flip: !p.flip } : p
      ),
    });
  },

  removeClipPlane: (axis) => {
    set({ clipPlanes: get().clipPlanes.filter((p) => p.axis !== axis) });
  },

  // 进入测量模式时清除已选中零件，避免高亮/隔离透明遮挡测量
  setMeasureMode: (mode) =>
    set(mode === 'off' ? { measureMode: mode } : { measureMode: mode, selectedNodeId: null }),
  setExplodeDistance: (d) => set({ explodeDistance: d }),
  toggleWireframe: () => set({ wireframe: !get().wireframe }),
  toggleAutoColor: () => set({ autoColor: !get().autoColor }),
  toggleCameraMode: () => set({ cameraMode: get().cameraMode === 'orthographic' ? 'perspective' : 'orthographic' }),
  setViewTarget: (view) => set({ viewTarget: view }),
  triggerResetView: () => set({ resetViewTrigger: get().resetViewTrigger + 1 }),
  setInitialState: (s) => set({
    initGroupScale: s.groupScale,
    initGroupPos: s.groupPos,
    initCamPos: s.camPos,
    initCamTarget: s.camTarget,
  }),

  reset: () =>
    set({
      ...initialState,
      nodeMap: new Map(),
      meshOwner: new Map(),
      expandedIds: new Set(),
      hiddenParts: new Set(),
    }),
}));
