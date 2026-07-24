# 装配 3D 预览流式加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 装配 3D 预览（`/stp-viewer?assembly=`）打开后立即显示模型树与可交互画布，零件按模型树顺序逐个加载弹出，顶部显示进度，相机首件取景且收尾 refit 让位于用户交互。

**Architecture:** 渐进显示。`AssemblyModelLoader` 在加载循环前就写入空 mesh 的完整树并置 `loadingState='ready'`；循环中每加载一个实例，调用新的 `viewerStore.mergeInstanceMeshes` 把 mesh uuid 增量并入对应叶子及其祖先节点，并更新 `streamProgress`。`STPViewer` 的全屏「正在解析渲染」阻塞遮罩换成不挡交互的小进度角标。无后端改动。

**Tech Stack:** React + TypeScript, zustand, three.js / @react-three/fiber, vitest。

**参考规范：** `docs/superpowers/specs/2026-07-24-assembly-3d-streaming-load-design.md`

---

## File Structure

- Modify: `frontend/src/stores/viewerStore.ts` — 新增 `streamProgress` 状态、`setStreamProgress`、`mergeInstanceMeshes`；`reset` 清空 `streamProgress`。
- Test: `frontend/src/stores/viewerStore.test.ts` — 覆盖新 store 方法。
- Modify: `frontend/src/components/STPViewer/AssemblyModelLoader.tsx` — 加载编排：即时树 + ready、按树顺序排序实例、逐件 merge + 进度、相机首件 fit 与收尾让位。
- Modify: `frontend/src/pages/STPViewer.tsx` — 用非阻塞进度角标替换全屏解析遮罩。

---

## Task 1: viewerStore 增量流式支持

**Files:**
- Modify: `frontend/src/stores/viewerStore.ts`
- Test: `frontend/src/stores/viewerStore.test.ts`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/stores/viewerStore.test.ts` 末尾（最后一个 `});` 之前的 describe 内，追加：

```typescript
  it('mergeInstanceMeshes 把 mesh 并入叶子及祖先并更新 meshOwner', () => {
    const st = useViewerStore.getState();
    // 用空 mesh 的树初始化（模拟流式开始时）
    const empty: TreeNode = {
      id: 'A', name: 'A', type: 'group', parentId: null, meshUuids: [],
      children: [{
        id: 'G', name: 'G', type: 'group', parentId: 'A', meshUuids: [],
        children: [
          { id: 'P1', name: 'm1', type: 'part', parentId: 'G', meshUuids: [], children: [] },
          { id: 'P2', name: 'm2', type: 'part', parentId: 'G', meshUuids: [], children: [] },
        ],
      }],
    };
    st.setTreeData(empty);
    st.mergeInstanceMeshes('P1', ['u1', 'ua']);
    const s = useViewerStore.getState();
    // 叶子拿到 mesh
    expect(s.nodeMap.get('P1')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    // 祖先聚合
    expect(s.nodeMap.get('G')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    expect(s.nodeMap.get('A')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    // meshOwner 指向叶子
    expect(s.meshOwner.get('u1')!.id).toBe('P1');
    expect(s.meshOwner.get('ua')!.id).toBe('P1');
    // 选中/展开仍可用
    st.selectByMesh('u1');
    expect(useViewerStore.getState().selectedNodeId).toBe('P1');
  });

  it('mergeInstanceMeshes 去重且第二个叶子独立聚合', () => {
    const st = useViewerStore.getState();
    const empty: TreeNode = {
      id: 'A', name: 'A', type: 'group', parentId: null, meshUuids: [],
      children: [
        { id: 'P1', name: 'm1', type: 'part', parentId: 'A', meshUuids: [], children: [] },
        { id: 'P2', name: 'm2', type: 'part', parentId: 'A', meshUuids: [], children: [] },
      ],
    };
    st.setTreeData(empty);
    st.mergeInstanceMeshes('P1', ['u1']);
    st.mergeInstanceMeshes('P1', ['u1']); // 重复 → 去重
    st.mergeInstanceMeshes('P2', ['u2']);
    const s = useViewerStore.getState();
    expect(s.nodeMap.get('P1')!.meshUuids).toEqual(['u1']);
    expect(s.nodeMap.get('A')!.meshUuids.sort()).toEqual(['u1', 'u2']);
    expect(s.meshOwner.get('u2')!.id).toBe('P2');
  });

  it('setStreamProgress 与 reset', () => {
    const st = useViewerStore.getState();
    st.setStreamProgress({ loaded: 2, total: 5 });
    expect(useViewerStore.getState().streamProgress).toEqual({ loaded: 2, total: 5 });
    st.reset();
    expect(useViewerStore.getState().streamProgress).toBeNull();
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/stores/viewerStore.test.ts`
Expected: FAIL —「mergeInstanceMeshes is not a function」/「setStreamProgress is not a function」。

- [ ] **Step 3: 在 ViewerState 接口加类型**

`frontend/src/stores/viewerStore.ts`，在 `treeData: TreeNode | null;` 附近的状态区加：

```typescript
  streamProgress: { loaded: number; total: number } | null;
```

在 Actions 区（`setTreeData` 声明附近）加：

```typescript
  setStreamProgress: (p: { loaded: number; total: number } | null) => void;
  mergeInstanceMeshes: (nodeId: string, meshUuids: string[]) => void;
```

- [ ] **Step 4: 在 initialState 加默认值**

在 `const initialState = { ... }` 中，`treeData: null as TreeNode | null,` 之后加：

```typescript
  streamProgress: null as { loaded: number; total: number } | null,
```

（`reset()` 已 `...initialState`，因此自动清空 `streamProgress`，无需另改 reset。）

- [ ] **Step 5: 实现两个 action**

在 store 实现体中，`setTreeData` 之后加：

```typescript
  setStreamProgress: (p) => set({ streamProgress: p }),

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
    set({ treeData: { ...treeData }, meshOwner: newOwner });
  },
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/stores/viewerStore.test.ts`
Expected: PASS（含既有测试全绿）。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/stores/viewerStore.ts frontend/src/stores/viewerStore.test.ts
git commit -m "feat: viewerStore 支持流式增量合并 mesh 与加载进度"
```

---

## Task 2: STPViewer 非阻塞进度角标

**Files:**
- Modify: `frontend/src/pages/STPViewer.tsx`

- [ ] **Step 1: 订阅 streamProgress**

在组件顶部已有的 store 订阅附近（`const loadingState = useViewerStore((s) => s.loadingState);` 之后）加：

```typescript
  const streamProgress = useViewerStore((s) => s.streamProgress);
```

- [ ] **Step 2: 移除全屏解析遮罩，加非阻塞角标**

找到这段全屏阻塞遮罩并**删除**：

```jsx
      {!assemblyRevId && url && state === 'ready' && loadingState !== 'ready' && loadingState !== 'error' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/90 gap-4">
          <div className="text-gray-500 text-sm">正在解析渲染...</div>
          <div className="w-72 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full animate-pulse" style={{ width: '70%' }} />
          </div>
        </div>
      )}
```

替换为（单件解析角标 + 装配流式进度角标，均不覆盖画布、不挡交互）：

```jsx
      {/* 单件：解析渲染中（非阻塞角标） */}
      {!assemblyRevId && url && state === 'ready' && loadingState !== 'ready' && loadingState !== 'error' && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 bg-white/90 rounded-full shadow px-3 py-1.5 pointer-events-none">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-green-500 border-t-transparent" />
          <span className="text-gray-600 text-xs">正在解析渲染...</span>
        </div>
      )}

      {/* 装配：流式加载进度（非阻塞角标） */}
      {assemblyRevId && streamProgress && streamProgress.loaded < streamProgress.total && (
        <div className="absolute top-3 right-3 z-30 flex items-center gap-2 bg-white/90 rounded-full shadow px-3 py-1.5 pointer-events-none">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent" />
          <span className="text-gray-600 text-xs tabular-nums">
            已加载 {streamProgress.loaded}/{streamProgress.total}
          </span>
        </div>
      )}
```

（`loadingState === 'error'` 的红色遮罩保留不动。`pointer-events-none` 确保角标不吞画布交互。）

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 退出码 0，无错误。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/STPViewer.tsx
git commit -m "feat: STP 预览用非阻塞进度角标替换全屏解析遮罩"
```

---

## Task 3: AssemblyModelLoader 流式编排

**Files:**
- Modify: `frontend/src/components/STPViewer/AssemblyModelLoader.tsx`

- [ ] **Step 1: 引入 useThree 与新 store 方法**

顶部 import 增加 `useThree`：

```typescript
import { useThree } from '@react-three/fiber';
```

在解构 store 处（`const { setTreeData, setModelScale, setLoadingState, selectByMesh, resetViewTrigger, measureMode } = useViewerStore();`）追加两个方法：

```typescript
  const { setTreeData, setModelScale, setLoadingState, selectByMesh, resetViewTrigger, measureMode,
    mergeInstanceMeshes, setStreamProgress } = useViewerStore();
```

在组件体内（`const pointerDown = ...` 附近）加交互探测与首件标志的 ref，以及 gl：

```typescript
  const { gl } = useThree();
  const userInteracted = useRef(false);
  const firstFitDone = useRef(false);
```

- [ ] **Step 2: 监听用户相机交互**

在 `useSceneVisualState(groupRef, origColorRef);` 之后加一个 effect（程序化 fit 不经 DOM 事件，故无误报）：

```typescript
  // 探测用户是否手动操作过相机：一旦交互，收尾 refit 让位、不再抢镜头
  useEffect(() => {
    const el = gl.domElement;
    const mark = () => { userInteracted.current = true; };
    el.addEventListener('pointerdown', mark);
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', mark);
      el.removeEventListener('wheel', mark);
    };
  }, [gl]);
```

- [ ] **Step 3: 加叶子顺序辅助函数**

在文件模块作用域（组件函数外，`Z_UP_TO_Y_UP` 常量附近）加：

```typescript
// 按装配树 DFS 得到叶子 key 顺序（key 与实例 bom_path 末段一致），用于让画面自上而下填充
function leafOrderFromTree(tree: AssemblyTreeNode[]): string[] {
  const order: string[] = [];
  const keyOf = (n: AssemblyTreeNode) =>
    n.instance_index !== undefined && n.instance_index !== null
      ? `${n.bom_item_id}:${n.instance_index}`
      : n.bom_item_id;
  const walk = (nodes: AssemblyTreeNode[]) => {
    for (const n of nodes) {
      if (n.is_leaf || !n.children || n.children.length === 0) order.push(keyOf(n));
      else walk(n.children);
    }
  };
  walk(tree);
  return order;
}
```

- [ ] **Step 4: 抽取 fitToView 辅助（effect 内闭包）**

在主加载 effect 内、`(async () => {` 之前，加一个基于当前 `rootGroup` 包围盒取景并保存初始状态的闭包（替代原先只在末尾做一次的取景代码）：

```typescript
    const fitToView = () => {
      rootGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rootGroup);
      if (box.isEmpty() || !groupRef.current) return;
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z);
      const scale = maxDim > 0.001 ? 4 / maxDim : 1;
      setModelScale(scale / 1000);
      const center = box.getCenter(new THREE.Vector3());
      groupRef.current.scale.setScalar(scale);
      groupRef.current.position.copy(center.multiplyScalar(-scale));
      setInitialState({
        groupScale: scale,
        groupPos: [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z],
        camPos: [5, 5, 5],
        camTarget: [0, 0, 0],
      });
    };
```

- [ ] **Step 5: 装配模式即时显示树 + ready + 进度初始化**

在 effect 内，把原来的：

```typescript
    if (!displayTree) {
      setLoadingState('loading');
    }
```

替换为：

```typescript
    if (!displayTree) {
      // 装配模式：立即用空 mesh 的完整树渲染面板，并让画布可见可交互
      setTreeData(buildAssemblyTreeNodes(tree, new Map<string, string[]>()));
      setLoadingState('ready');
      setStreamProgress({ loaded: 0, total: instances.length });
    }
```

- [ ] **Step 6: 循环内排序 + 逐件 merge + 进度 + 首件 fit**

将 `for (const inst of instances) {` 改为按叶子顺序遍历：

```typescript
      const order = leafOrderFromTree(tree);
      const ordered = [...instances].sort((a, b) => {
        const ka = a.bom_path[a.bom_path.length - 1];
        const kb = b.bom_path[b.bom_path.length - 1];
        const ia = order.indexOf(ka); const ib = order.indexOf(kb);
        return (ia < 0 ? Number.MAX_SAFE_INTEGER : ia) - (ib < 0 ? Number.MAX_SAFE_INTEGER : ib);
      });

      let loadedCount = 0;
      for (const inst of ordered) {
```

在循环体末尾——即现有收集 `meshByBomItem` 的 `if (leafBom) { ... }` 块**之后**、for 结束前——加逐件流式更新：

```typescript
        // 流式：装配模式增量把该实例 mesh 并入树节点并更新进度；首件加入后取景一次
        if (!displayTree) {
          const uuids: string[] = [];
          lod.traverse((c) => { if ((c as THREE.Mesh).isMesh) uuids.push(c.uuid); });
          if (leafBom) mergeInstanceMeshes(leafBom, uuids);
          loadedCount++;
          setStreamProgress({ loaded: loadedCount, total: ordered.length });
          if (!firstFitDone.current) { fitToView(); firstFitDone.current = true; }
        }
```

（注意：`leafBom` 与 `lod` 均为循环体内已存在的变量；此块在它们之后。）

- [ ] **Step 7: 循环结束后：树写入与收尾 fit 分模式处理**

将循环结束后的这段（原代码）：

```typescript
      if (cancelled) return;
      origColorRef.current = origColor;

      // 注册装配树（走 viewerStore，树面板/高亮/隔离全部复用）
      if (displayTree) {
        // config 模式：回填 mesh uuid 到配置项树中
        const merged = mergeMeshUuidsIntoConfigTree(displayTree, tree, meshByBomItem);
        setTreeData(merged);
      } else {
        setTreeData(buildAssemblyTreeNodes(tree, meshByBomItem));
      }

      // 缩放居中 + 保存初始状态（同 ModelLoader）
      rootGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rootGroup);
      if (!box.isEmpty() && groupRef.current) {
        const s = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(s.x, s.y, s.z);
        const scale = maxDim > 0.001 ? 4 / maxDim : 1;
        setModelScale(scale / 1000);
        const center = box.getCenter(new THREE.Vector3());
        groupRef.current.scale.setScalar(scale);
        groupRef.current.position.copy(center.multiplyScalar(-scale));
        setInitialState({
          groupScale: scale,
          groupPos: [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z],
          camPos: [5, 5, 5],
          camTarget: [0, 0, 0],
        });
      }

      setLoadingState('ready');
```

替换为：

```typescript
      if (cancelled) return;
      origColorRef.current = origColor;

      if (displayTree) {
        // config 模式：树保持一次性写入（退化路径，不做增量流式）
        const merged = mergeMeshUuidsIntoConfigTree(displayTree, tree, meshByBomItem);
        setTreeData(merged);
        // config 模式此前无首件 fit，这里做一次取景收尾
        fitToView();
      } else {
        // 装配模式：树已在流式中增量写好；进度收尾清空
        setStreamProgress(null);
        // 收尾 refit 让位于用户交互：用户没碰过相机才按完整装配重新取景
        if (!firstFitDone.current) fitToView();          // 极端：无零件成功加载时兜底
        else if (!userInteracted.current) fitToView();
      }

      setLoadingState('ready');
```

- [ ] **Step 8: 更新 effect 依赖数组**

effect 依赖数组补上新引用（保持既有项）：

```typescript
  }, [instances, tree, rootGroup, setTreeData, setModelScale, setLoadingState, setInitialState,
      mergeInstanceMeshes, setStreamProgress, displayTree]);
```

- [ ] **Step 9: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: tsc 退出码 0；build 成功产出 `dist/`。

- [ ] **Step 10: 提交**

```bash
git add frontend/src/components/STPViewer/AssemblyModelLoader.tsx
git commit -m "feat: 装配3D预览流式加载——即时树+逐件弹出+进度+相机让位"
```

---

## Task 4: 部署与人工验证

**Files:** 无（部署 + 验证）

- [ ] **Step 1: 全量前端测试与构建**

Run: `cd frontend && npx vitest run && npm run build`
Expected: 测试全绿；build 成功。

- [ ] **Step 2: 部署前端到 nginx**

前端 `dist` 已由 build 产出，nginx 卷挂载 `./frontend/dist` 即时生效，无需重启容器。

- [ ] **Step 3: 人工验证清单**

在浏览器强刷（Ctrl+Shift+R）后，打开一个**装配**零部件详情 →「3D预览」，确认：
- 打开后**左侧模型树立即全量显示**（零件未加载完也可见结构）。
- 右上出现「已加载 X/Y」角标，随加载递增，加载完消失。
- 零件**按树顺序自上而下逐个弹出**。
- **加载过程中即可旋转/缩放/平移**（角标不挡交互）。
- 首个零件出现时画面已取好景；加载中若手动转过视角，**加载完不被拽回**（未交互则收尾自动取景）。
- 已加载零件的**显隐眼睛按钮/点击高亮/隔离**可用。
- 回归：**config 清单预览**（若可测）与**单件 STP 附件预览**均正常。

---

## Self-Review 记录

- **Spec 覆盖**：即时树→Task3 S5；即时可交互画布→Task2 + Task3 S5；逐件弹出→Task3 S6（rootGroup.add 已存在，merge/进度新增）；进度 X/Y→Task1+Task2+Task3；相机首件 fit→Task3 S6，收尾让位→Task3 S2/S7；按树顺序→Task3 S3/S6；store 增量+单测→Task1；config 退化→Task3 S7；无后端改动→全程未涉及。
- **占位符**：无 TBD/TODO；每个代码步给出完整代码。
- **类型/命名一致**：`mergeInstanceMeshes(nodeId, meshUuids)`、`setStreamProgress({loaded,total})`、`streamProgress` 全文一致；`leafOrderFromTree`、`fitToView`、`firstFitDone`、`userInteracted` 命名一致。
