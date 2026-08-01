import { create } from 'zustand';
import type { TreeNode } from '../components/STPViewer/treeTypes';
import type { CompareNode, DisplayMode, Side } from '../components/STPViewer/compareTypes';

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
  streamProgress: { loaded: number; total: number } | null;

  /** BOM 3D 对比分片；null 表示非对比模式（其余三种预览模式均为 null） */
  compare: {
    tree: CompareNode;
    nodeMap: Map<string, CompareNode>;
    /** mesh uuid → 所属配对行与侧别，供 3D 点选反查 */
    meshOwner: Map<string, { key: string; side: Side }>;
    displayMode: DisplayMode;
    onlyDiff: boolean;
    ghostOpacity: number;
    selectedKey: string | null;
    leftMissing: boolean;
    rightMissing: boolean;
  } | null;

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
  setStreamProgress: (p: { loaded: number; total: number } | null) => void;
  setCompareTree: (tree: CompareNode, opts: { leftMissing: boolean; rightMissing: boolean }) => void;
  mergeCompareMeshes: (key: string, side: Side, meshUuids: string[]) => void;
  selectCompareKey: (key: string | null) => void;
  selectCompareByMesh: (meshUuid: string) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setOnlyDiff: (v: boolean) => void;
  setGhostOpacity: (v: number) => void;
  toggleCompareSideVisibility: (key: string, side: Side) => void;
  mergeInstanceMeshes: (nodeId: string, meshUuids: string[]) => void;
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
  streamProgress: null as { loaded: number; total: number } | null,
  compare: null as ViewerState['compare'],
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
  autoColor: true,
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

  setStreamProgress: (p) => set({ streamProgress: p }),

  setCompareTree: (tree, opts) => {
    const nodeMap = new Map<string, CompareNode>();
    const visit = (n: CompareNode) => {
      nodeMap.set(n.key, n);
      n.children.forEach(visit);
    };
    visit(tree);
    set({
      compare: {
        tree,
        nodeMap,
        meshOwner: new Map(),
        displayMode: 'both',
        onlyDiff: false,
        ghostOpacity: 0.12,
        selectedKey: null,
        leftMissing: opts.leftMissing,
        rightMissing: opts.rightMissing,
      },
      expandedIds: new Set(['ROOT']),
      hiddenParts: new Set(),
    });
  },

  // 流式加载：把某侧某行的 mesh uuid 增量并入该节点及其所有祖先的同侧
  // （祖先聚合供组级显隐/高亮），并把 meshOwner 指向该行。
  mergeCompareMeshes: (key, side, meshUuids) => {
    const c = get().compare;
    if (!c || meshUuids.length === 0) return;
    const node = c.nodeMap.get(key);
    if (!node) return;

    let cur: CompareNode | null = node;
    while (cur) {
      const target = cur[side];
      if (target) {
        const merged = new Set(target.meshUuids);
        for (const u of meshUuids) merged.add(u);
        target.meshUuids = Array.from(merged);
      }
      cur = cur.parentKey ? c.nodeMap.get(cur.parentKey) ?? null : null;
    }

    const meshOwner = new Map(c.meshOwner);
    for (const u of meshUuids) meshOwner.set(u, { key, side });
    // 浅拷贝 tree 触发面板重渲染
    set({ compare: { ...c, tree: { ...c.tree }, meshOwner } });
  },

  selectCompareKey: (key) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, selectedKey: key } });
  },

  selectCompareByMesh: (meshUuid) => {
    const c = get().compare;
    if (!c) return;
    const owner = c.meshOwner.get(meshUuid);
    if (!owner) return;
    // 沿 parentKey 上溯展开所有祖先；expanded 自带去重，兼作环路防护
    const expanded = new Set(get().expandedIds);
    let p = c.nodeMap.get(owner.key)?.parentKey ?? null;
    while (p && !expanded.has(p)) {
      expanded.add(p);
      p = c.nodeMap.get(p)?.parentKey ?? null;
    }
    set({ compare: { ...c, selectedKey: owner.key }, expandedIds: expanded });
  },

  setDisplayMode: (mode) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, displayMode: mode } });
  },

  setOnlyDiff: (v) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, onlyDiff: v } });
  },

  setGhostOpacity: (v) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, ghostOpacity: v } });
  },

  // 切换某配对行某一侧的显隐（作用于该侧 meshUuids，与既有 hiddenParts 同一套机制）
  toggleCompareSideVisibility: (key, side) => {
    const c = get().compare;
    if (!c) return;
    const node = c.nodeMap.get(key);
    const uuids = node?.[side]?.meshUuids ?? [];
    if (uuids.length === 0) return;
    const hidden = new Set(get().hiddenParts);
    const allHidden = uuids.every((u) => hidden.has(u));
    if (allHidden) uuids.forEach((u) => hidden.delete(u));
    else uuids.forEach((u) => hidden.add(u));
    set({ hiddenParts: hidden });
  },

  // 流式加载：把某叶子实例的 mesh uuid 增量并入其节点及所有祖先（祖先聚合供组级显隐/高亮），
  // 并把 meshOwner 指向该叶子。以浅拷贝 treeData 触发面板重渲染。
  mergeInstanceMeshes: (nodeId, meshUuids) => {
    const { treeData, nodeMap, meshOwner } = get();
    if (!treeData || meshUuids.length === 0) return;
    const leaf = nodeMap.get(nodeId);
    if (!leaf) return;
    let cur: TreeNode | null = leaf;
    while (cur) {
      const merged = new Set(cur.meshUuids);
      for (const u of meshUuids) merged.add(u);
      cur.meshUuids = Array.from(merged);
      cur = cur.parentId ? nodeMap.get(cur.parentId) ?? null : null;
    }
    const newOwner = new Map(meshOwner);
    for (const u of meshUuids) newOwner.set(u, leaf);
    const root = nodeMap.get(treeData.id) ?? treeData;
    set({ treeData: { ...root }, meshOwner: newOwner });
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
