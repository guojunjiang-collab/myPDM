# STP 预览装配模型树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 STP 三维预览中增加映射 GLB 真实层级的可折叠装配模型树，实现树↔3D 双向点击高亮、用户可自由开关的"选中高亮、其余透明"隔离聚焦，以及树节点勾选显隐。

**Architecture:** 纯函数 `buildModelTree` 把 `gltf.scene` 的 Object3D 层级解析成 `TreeNode` 树；`viewerStore` 扩展派生 `nodeMap`/`meshOwner` 支撑双向查找，并用 `hiddenParts` 隐藏集管理显隐；`ModelLoader` 按选中节点的 `meshUuids` 集合做 emissive 高亮 + 隔离透明，并按 `hiddenParts` 控制可见性；`ModelTreePanel` 递归渲染树（含展开折叠、勾选显隐、隔离开关）替换扁平 `BOMPanel`；`PartHighlighter` 接通并改为绘制选中节点整子树的包围盒。

**Tech Stack:** React 18 + TypeScript, @react-three/fiber 8 + three 0.184, zustand 5, vitest（新引入，仅测纯逻辑）, vite 5。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `frontend/src/components/STPViewer/treeTypes.ts` | `TreeNode` 类型 | Create |
| `frontend/src/components/STPViewer/buildModelTree.ts` | GLB scene → TreeNode 纯函数 | Create |
| `frontend/src/components/STPViewer/buildModelTree.test.ts` | buildModelTree 单测 | Create |
| `frontend/src/stores/viewerStore.ts` | 状态扩展 + nodeMap/meshOwner 派生 + hiddenParts 显隐 | Modify |
| `frontend/src/stores/viewerStore.test.ts` | store 选中/隔离/显隐/派生逻辑单测 | Create |
| `frontend/src/components/STPViewer/ModelLoader.tsx` | 加载建树 + 材质 clone + 隔离高亮 + 显隐 + 点击修复 | Modify |
| `frontend/src/components/STPViewer/PartHighlighter.tsx` | 选中节点整子树包围盒 | Modify |
| `frontend/src/components/STPViewer/ViewerCanvas.tsx` | 挂载 PartHighlighter | Modify |
| `frontend/src/components/STPViewer/ModelTreePanel.tsx` | 递归层级树面板 + 勾选显隐 + 隔离开关 | Create |
| `frontend/src/components/STPViewer/index.tsx` | BOMPanel → ModelTreePanel | Modify |
| `frontend/src/pages/STPViewer.tsx` | 补上 ModelTreePanel | Modify |
| `frontend/src/components/STPViewer/BOMPanel.tsx` | 被替换后删除 | Delete |
| `frontend/vite.config.ts` | 加 vitest test 配置 | Modify |
| `frontend/package.json` | 加 vitest devDep + test 脚本 | Modify |

---

## Task 1: 引入 vitest 测试基础设施

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Test: `frontend/src/_smoke.test.ts`

- [ ] **Step 1: 安装 vitest**

Run: `cd frontend && npm install -D vitest@^2.1.8`
Expected: `package.json` devDependencies 出现 `vitest`，安装成功无 error。

- [ ] **Step 2: 加 test 脚本到 package.json**

在 `frontend/package.json` 的 `scripts` 中加一行（放在 `"build"` 后）：

```json
"test": "vitest run",
```

- [ ] **Step 3: 在 vite.config.ts 加 test 配置**

读 `frontend/vite.config.ts`。把顶部 `import { defineConfig } from 'vite'` 改为 `import { defineConfig } from 'vitest/config'`（获得 `test` 字段类型），并在 `defineConfig({...})` 顶层对象里加 `test` 字段（three 对象图不需要 DOM，用 node 环境）：

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
```

- [ ] **Step 4: 写 smoke 测试**

Create `frontend/src/_smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('vitest works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行确认通过**

Run: `cd frontend && npm test`
Expected: PASS，1 passed。

- [ ] **Step 6: 删除 smoke 测试并提交**

```bash
rm frontend/src/_smoke.test.ts
git add frontend/package.json frontend/vite.config.ts frontend/package-lock.json
git commit -m "test: 引入 vitest 测试框架(仅纯逻辑单测)"
```

---

## Task 2: `TreeNode` 类型 + `buildModelTree` 纯函数

**Files:**
- Create: `frontend/src/components/STPViewer/treeTypes.ts`
- Create: `frontend/src/components/STPViewer/buildModelTree.ts`
- Test: `frontend/src/components/STPViewer/buildModelTree.test.ts`

- [ ] **Step 1: 写类型文件**

Create `frontend/src/components/STPViewer/treeTypes.ts`:

```ts
export interface TreeNode {
  /** 稳定唯一 id，取自 Object3D.uuid */
  id: string;
  /** 显示名（中文零件/子装配名） */
  name: string;
  /** group=子装配(无mesh) / part=零件(有mesh) */
  type: 'group' | 'part';
  /** 该节点(含整个子树)关联的所有 mesh uuid，用于高亮/透明/包围盒/显隐 */
  meshUuids: string[];
  /** 父节点 id，根为 null，用于 3D→树 展开祖先 */
  parentId: string | null;
  children: TreeNode[];
}
```

- [ ] **Step 2: 写失败测试**

Create `frontend/src/components/STPViewer/buildModelTree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildModelTree } from './buildModelTree';

function mesh(name: string): THREE.Mesh {
  const m = new THREE.Mesh();
  m.name = name;
  return m;
}

describe('buildModelTree', () => {
  it('单根装配体保留多级层级', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'GD40_Assembly';
    const power = new THREE.Group(); power.name = '动力组件';
    power.add(mesh('电机_1'), mesh('电机_2'));
    root.add(power);
    scene.add(root);

    const tree = buildModelTree(scene)!;
    expect(tree.name).toBe('GD40_Assembly');
    expect(tree.type).toBe('group');
    expect(tree.parentId).toBeNull();
    expect(tree.children).toHaveLength(1);

    const p = tree.children[0];
    expect(p.name).toBe('动力组件');
    expect(p.type).toBe('group');
    expect(p.parentId).toBe(tree.id);
    expect(p.children.map((c) => c.name)).toEqual(['电机_1', '电机_2']);
    expect(p.children[0].type).toBe('part');
    expect(p.children[0].parentId).toBe(p.id);
  });

  it('分组节点聚合整子树 meshUuids', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'A';
    const g = new THREE.Group(); g.name = 'G';
    const m1 = mesh('m1'); const m2 = mesh('m2');
    g.add(m1, m2); root.add(g); scene.add(root);

    const tree = buildModelTree(scene)!;
    expect([...tree.meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
    expect([...tree.children[0].meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
  });

  it('叶子零件 meshUuids 只含自己', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'A';
    const m = mesh('only'); root.add(m); scene.add(root);

    const tree = buildModelTree(scene)!;
    expect(tree.children[0].type).toBe('part');
    expect(tree.children[0].meshUuids).toEqual([m.uuid]);
  });

  it('扁平场景(多顶层节点)降级为虚拟根下单层', () => {
    const scene = new THREE.Scene();
    scene.add(mesh('p1'), mesh('p2'), mesh('p3'));

    const tree = buildModelTree(scene)!;
    expect(tree.children).toHaveLength(3);
    expect(tree.children.every((c) => c.type === 'part')).toBe(true);
  });

  it('空场景返回 null', () => {
    expect(buildModelTree(new THREE.Scene())).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/STPViewer/buildModelTree.test.ts`
Expected: FAIL，报 `buildModelTree` 未导出/未定义。

- [ ] **Step 4: 实现 buildModelTree**

Create `frontend/src/components/STPViewer/buildModelTree.ts`:

```ts
import * as THREE from 'three';
import type { TreeNode } from './treeTypes';

function isMeshObj(obj: THREE.Object3D): boolean {
  return (obj as THREE.Mesh).isMesh === true;
}

/** 收集 obj 自身及所有后代里的 mesh uuid */
function collectMeshUuids(obj: THREE.Object3D): string[] {
  const out: string[] = [];
  obj.traverse((o) => {
    if (isMeshObj(o)) out.push(o.uuid);
  });
  return out;
}

function buildNode(obj: THREE.Object3D, parentId: string | null): TreeNode {
  const mesh = isMeshObj(obj);
  return {
    id: obj.uuid,
    name: obj.name || (mesh ? '未命名零件' : '未命名组件'),
    type: mesh ? 'part' : 'group',
    meshUuids: collectMeshUuids(obj),
    parentId,
    children: obj.children.map((c) => buildNode(c, obj.uuid)),
  };
}

/**
 * 把 gltf.scene 的 Object3D 层级解析成装配树。
 * - 单一顶层节点(典型 Mayo 装配根) → 直接以它为树根
 * - 多个顶层节点(扁平 GLB) → 合成虚拟根，子节点平铺
 * - 空场景 → null
 */
export function buildModelTree(root: THREE.Object3D): TreeNode | null {
  const top = root.children;
  if (top.length === 0) return null;
  if (top.length === 1) return buildNode(top[0], null);

  const virtualId = 'virtual-root';
  return {
    id: virtualId,
    name: '模型',
    type: 'group',
    meshUuids: collectMeshUuids(root),
    parentId: null,
    children: top.map((c) => buildNode(c, virtualId)),
  };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd frontend && npx vitest run src/components/STPViewer/buildModelTree.test.ts`
Expected: PASS，5 passed。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/treeTypes.ts frontend/src/components/STPViewer/buildModelTree.ts frontend/src/components/STPViewer/buildModelTree.test.ts
git commit -m "feat(STPViewer): buildModelTree 解析 GLB 装配层级为树"
```

---

## Task 3: `viewerStore` 扩展（状态 + 派生 + 双向查找 + 显隐）

**Files:**
- Modify: `frontend/src/stores/viewerStore.ts`
- Test: `frontend/src/stores/viewerStore.test.ts`

**说明：** 新增 `hiddenParts`（隐藏 mesh uuid 集合，空=全显）与 `toggleNodeVisibility` 管理显隐，取代旧的 `visibleParts` 白名单机制。现有 `visibleParts`/`togglePartVisibility` 仅 BOMPanel 与 ModelLoader 使用，二者在本计划中分别删除/重写，故旧机制在 Task 7 一并清理。本任务先新增，不删旧，保证每步可编译。

- [ ] **Step 1: 写失败测试**

Create `frontend/src/stores/viewerStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './viewerStore';
import type { TreeNode } from '../components/STPViewer/treeTypes';

// 构造: 根A > 组G(part P1->u1, part P2->u2)
const tree: TreeNode = {
  id: 'A', name: 'A', type: 'group', parentId: null,
  meshUuids: ['u1', 'u2'],
  children: [{
    id: 'G', name: 'G', type: 'group', parentId: 'A',
    meshUuids: ['u1', 'u2'],
    children: [
      { id: 'P1', name: 'm1', type: 'part', parentId: 'G', meshUuids: ['u1'], children: [] },
      { id: 'P2', name: 'm2', type: 'part', parentId: 'G', meshUuids: ['u2'], children: [] },
    ],
  }],
};

beforeEach(() => {
  useViewerStore.getState().reset();
});

describe('viewerStore tree extensions', () => {
  it('setTreeData 构建 nodeMap 与 meshOwner', () => {
    useViewerStore.getState().setTreeData(tree);
    const s = useViewerStore.getState();
    expect(s.nodeMap.get('G')!.name).toBe('G');
    expect(s.meshOwner.get('u1')!.id).toBe('P1');
    expect(s.meshOwner.get('u2')!.id).toBe('P2');
  });

  it('selectByMesh 选中所属叶子并展开祖先', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.selectByMesh('u1');
    const s = useViewerStore.getState();
    expect(s.selectedNodeId).toBe('P1');
    expect(s.expandedIds.has('A')).toBe(true);
    expect(s.expandedIds.has('G')).toBe(true);
  });

  it('isolateMode 默认 true，可切换', () => {
    expect(useViewerStore.getState().isolateMode).toBe(true);
    useViewerStore.getState().setIsolateMode(false);
    expect(useViewerStore.getState().isolateMode).toBe(false);
  });

  it('toggleExpanded 增删展开 id', () => {
    const st = useViewerStore.getState();
    st.toggleExpanded('G');
    expect(useViewerStore.getState().expandedIds.has('G')).toBe(true);
    st.toggleExpanded('G');
    expect(useViewerStore.getState().expandedIds.has('G')).toBe(false);
  });

  it('toggleNodeVisibility 切换整子树显隐', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.toggleNodeVisibility(tree.children[0]); // 隐藏 G 整组
    let s = useViewerStore.getState();
    expect(s.hiddenParts.has('u1')).toBe(true);
    expect(s.hiddenParts.has('u2')).toBe(true);
    st.toggleNodeVisibility(tree.children[0]); // 再切回显示
    s = useViewerStore.getState();
    expect(s.hiddenParts.has('u1')).toBe(false);
    expect(s.hiddenParts.has('u2')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/stores/viewerStore.test.ts`
Expected: FAIL，`setTreeData`/`nodeMap`/`toggleNodeVisibility` 等未定义。

- [ ] **Step 3: 扩展 ViewerState 接口**

修改 `frontend/src/stores/viewerStore.ts`。先在文件顶部加导入：

```ts
import type { TreeNode } from '../components/STPViewer/treeTypes';
```

在 `ViewerState` 接口中，`visibleParts: Set<string>;` 一行之后，加入装配树字段：

```ts
  // 装配树
  treeData: TreeNode | null;
  nodeMap: Map<string, TreeNode>;
  meshOwner: Map<string, TreeNode>;
  selectedNodeId: string | null;
  isolateMode: boolean;
  expandedIds: Set<string>;
  hiddenParts: Set<string>;
```

在 `// Actions` 区块加入新 action 签名：

```ts
  setTreeData: (t: TreeNode | null) => void;
  selectNode: (id: string | null) => void;
  selectByMesh: (meshUuid: string) => void;
  setIsolateMode: (v: boolean) => void;
  toggleExpanded: (id: string) => void;
  toggleNodeVisibility: (node: TreeNode) => void;
```

- [ ] **Step 4: 扩展 initialState**

在 `const initialState = {...}` 对象里，于 `visibleParts: new Set<string>(),` 之后加入：

```ts
    treeData: null as TreeNode | null,
    nodeMap: new Map<string, TreeNode>(),
    meshOwner: new Map<string, TreeNode>(),
    selectedNodeId: null as string | null,
    isolateMode: true,
    expandedIds: new Set<string>(),
    hiddenParts: new Set<string>(),
```

- [ ] **Step 5: 实现新 actions**

在 `create<ViewerState>((set, get) => ({ ...initialState, ...})` 内，于 `highlightPart` action 之后加入：

```ts
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
    const owner = get().meshOwner.get(meshUuid);
    if (!owner) return;
    const expanded = new Set(get().expandedIds);
    let p = owner.parentId;
    while (p) {
      expanded.add(p);
      p = get().nodeMap.get(p)?.parentId ?? null;
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
    const hidden = new Set(get().hiddenParts);
    const allHidden = node.meshUuids.every((u) => hidden.has(u));
    if (allHidden) {
      node.meshUuids.forEach((u) => hidden.delete(u)); // 当前全隐 → 显示
    } else {
      node.meshUuids.forEach((u) => hidden.add(u)); // 否则 → 隐藏
    }
    set({ hiddenParts: hidden });
  },
```

- [ ] **Step 6: 修正 reset 重置新集合**

把 `reset` action 改为同时清空新派生结构：

```ts
  reset: () =>
    set({
      ...initialState,
      visibleParts: new Set(),
      nodeMap: new Map(),
      meshOwner: new Map(),
      expandedIds: new Set(),
      hiddenParts: new Set(),
    }),
```

- [ ] **Step 7: 运行确认通过**

Run: `cd frontend && npx vitest run src/stores/viewerStore.test.ts`
Expected: PASS，5 passed。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/stores/viewerStore.ts frontend/src/stores/viewerStore.test.ts
git commit -m "feat(STPViewer): viewerStore 增加装配树状态/双向查找/显隐"
```

---

## Task 4: `ModelLoader` — 建树 + 材质 clone + 隔离高亮 + 显隐 + 点击修复

**Files:**
- Modify: `frontend/src/components/STPViewer/ModelLoader.tsx`

无单测（依赖 WebGL/R3F）；用 `tsc` 类型检查 + 后续手动验证。

- [ ] **Step 1: 替换 ModelLoader 的导入与 store 取值**

在 `frontend/src/components/STPViewer/ModelLoader.tsx` 顶部加导入：

```ts
import { buildModelTree } from './buildModelTree';
```

把组件内的 `const { ... } = useViewerStore();` 一行替换为：

```ts
  const {
    setLoadingState, setModelScale, setTreeData, selectByMesh,
    selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe,
  } = useViewerStore();
```

- [ ] **Step 2: 加载完成时 clone 材质 + 建树 + 缩放**

把"Mark ready"那个计算 scale 的 `useEffect` 整体替换为下面版本（新增材质 clone 与 `setTreeData`）：

```ts
  useEffect(() => {
    if (!gltf?.scene || !groupRef.current) return;

    // 1) 每个 mesh 独立材质，避免隔离透明时共享材质互相影响
    gltf.scene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        m.material = (m.material as THREE.Material).clone();
      }
    });

    // 2) 解析装配树
    setTreeData(buildModelTree(gltf.scene));

    setLoadingState('ready');

    // 3) 缩放居中
    requestAnimationFrame(() => {
      if (!groupRef.current) return;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0.001 ? 4 / maxDim : 1;
      const unitScale = maxDim < 0.5 ? 1000 : 1;
      const modelScaleVal = unitScale > 1 ? scale / unitScale : scale;
      setModelScale(modelScaleVal);
      groupRef.current.scale.setScalar(scale);
      groupRef.current.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-scale));
    });
  }, [gltf, setLoadingState, setModelScale, setTreeData]);
```

- [ ] **Step 3: 替换高亮/显隐 useEffect 为隔离+显隐逻辑**

把现有处理 `wireframe, visibleParts, highlightedPartId` 的那个 `useEffect` 整体替换为基于 `selectedNodeId` + `meshUuids` + `isolateMode` + `hiddenParts` 的版本：

```ts
  useEffect(() => {
    if (!groupRef.current) return;
    const selNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    const sel = selNode ? new Set(selNode.meshUuids) : null;

    groupRef.current.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      const std = mat as THREE.MeshStandardMaterial;

      std.wireframe = wireframe;
      mesh.visible = !hiddenParts.has(mesh.uuid);

      if (!sel) {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else if (sel.has(mesh.uuid)) {
        if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        if (isolateMode) {
          std.transparent = true; std.opacity = 0.12; std.depthWrite = false;
        } else {
          std.transparent = false; std.opacity = 1; std.depthWrite = true;
        }
      }
      std.needsUpdate = true;
    });
  }, [selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe]);
```

- [ ] **Step 4: 修复点击 — 用 uuid 反查选中**

把 `handleClick` 替换为：

```ts
  const handleClick = (e: any) => {
    e.stopPropagation();
    if (e.object?.uuid) selectByMesh(e.object.uuid);
  };
```

- [ ] **Step 5: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 退出码 0。（若报 `highlightedPartId`/`visibleParts` 等未使用，确认 Step 1 解构已移除它们。）

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/ModelLoader.tsx
git commit -m "feat(STPViewer): ModelLoader 隔离透明高亮+显隐+建树+点击反查"
```

---

## Task 5: 接通 `PartHighlighter`（选中节点整子树包围盒）

**Files:**
- Modify: `frontend/src/components/STPViewer/PartHighlighter.tsx`
- Modify: `frontend/src/components/STPViewer/ViewerCanvas.tsx`

- [ ] **Step 1: 改写 PartHighlighter 用 selectedNodeId + 子树包围盒**

把 `frontend/src/components/STPViewer/PartHighlighter.tsx` 的组件主体替换为下面实现——读 `selectedNodeId` 经 `nodeMap` 取 `meshUuids`，对这些 mesh 求合并包围盒。保留文件顶部原有 import 与 `PartHighlighterProps` 接口不变：

```ts
export function PartHighlighter({ url }: PartHighlighterProps) {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const nodeMap = useViewerStore((s) => s.nodeMap);
  const lineRef = useRef<THREE.LineSegments>(null);

  const { scene } = useGLTF(url);

  const edgeGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.EdgesGeometry(box);
  }, []);

  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#4488ff',
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    []
  );

  const _box = useMemo(() => new THREE.Box3(), []);
  const _c = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    const node = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    if (!node) { line.visible = false; return; }

    const sel = new Set(node.meshUuids);
    _box.makeEmpty();
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && sel.has(o.uuid)) _box.expandByObject(o);
    });
    if (_box.isEmpty()) { line.visible = false; return; }

    _box.getCenter(_c);
    _box.getSize(_s);
    line.position.copy(_c);
    line.scale.set(Math.max(_s.x, 1e-3), Math.max(_s.y, 1e-3), Math.max(_s.z, 1e-3));
    line.visible = true;
  });

  return (
    <lineSegments ref={lineRef} visible={false} geometry={edgeGeometry} material={lineMaterial} renderOrder={999} />
  );
}
```

- [ ] **Step 2: 在 ViewerCanvas 挂载 PartHighlighter**

在 `frontend/src/components/STPViewer/ViewerCanvas.tsx` 顶部加导入：

```ts
import { PartHighlighter } from './PartHighlighter';
```

把 Suspense 块改为在 `ModelLoader` 之后加入 `PartHighlighter`（同 url）：

```tsx
      <Suspense fallback={null}>
        <GLTFErrorBoundary>
          <ModelLoader url={url} />
          <PartHighlighter url={url} />
        </GLTFErrorBoundary>
      </Suspense>
```

- [ ] **Step 3: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/STPViewer/PartHighlighter.tsx frontend/src/components/STPViewer/ViewerCanvas.tsx
git commit -m "feat(STPViewer): 接通 PartHighlighter 绘制选中子树包围盒"
```

---

## Task 6: `ModelTreePanel` 递归层级树面板（含勾选显隐 + 隔离开关）

**Files:**
- Create: `frontend/src/components/STPViewer/ModelTreePanel.tsx`

- [ ] **Step 1: 创建 ModelTreePanel**

Create `frontend/src/components/STPViewer/ModelTreePanel.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import type { TreeNode } from './treeTypes';

function NodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const expandedIds = useViewerStore((s) => s.expandedIds);
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const selectNode = useViewerStore((s) => s.selectNode);
  const toggleExpanded = useViewerStore((s) => s.toggleExpanded);
  const toggleNodeVisibility = useViewerStore((s) => s.toggleNodeVisibility);

  const isGroup = node.type === 'group';
  const expanded = expandedIds.has(node.id);
  const selected = selectedNodeId === node.id;
  // 该节点子树有任一 mesh 可见即视为"显示"
  const visible = node.meshUuids.some((u) => !hiddenParts.has(u));
  const rowRef = useRef<HTMLDivElement>(null);

  // 选中时滚动到可视区(3D 点击触发的选中也会滚动到此)
  useEffect(() => {
    if (selected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  return (
    <li>
      <div
        ref={rowRef}
        onClick={() => selectNode(node.id)}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer select-none text-xs transition-colors
          ${selected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50 text-gray-700'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.name}
      >
        {isGroup ? (
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <input
          type="checkbox"
          checked={visible}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleNodeVisibility(node)}
          className="w-3.5 h-3.5 rounded border-gray-300 accent-blue-500 cursor-pointer shrink-0"
        />
        <span className={`truncate flex-1 ${visible ? '' : 'text-gray-300 line-through'}`}>{node.name}</span>
        {isGroup && <span className="text-[10px] text-gray-400 tabular-nums">{node.children.length}</span>}
      </div>
      {isGroup && expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ModelTreePanel() {
  const treeData = useViewerStore((s) => s.treeData);
  const loadingState = useViewerStore((s) => s.loadingState);
  const isolateMode = useViewerStore((s) => s.isolateMode);
  const setIsolateMode = useViewerStore((s) => s.setIsolateMode);
  const selectNode = useViewerStore((s) => s.selectNode);

  if (loadingState !== 'ready' || !treeData) return null;

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 w-64 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">模型树</span>
        <button
          onClick={() => selectNode(null)}
          className="text-[11px] text-gray-400 hover:text-primary-600 cursor-pointer"
        >
          取消选中
        </button>
      </div>

      {/* 隔离开关 */}
      <label className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isolateMode}
          onChange={(e) => setIsolateMode(e.target.checked)}
          className="w-3.5 h-3.5 accent-blue-500"
        />
        <span className="text-[11px] text-gray-600">隔离模式（选中后其余透明）</span>
      </label>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-0.5">
        <ul>
          <NodeRow node={treeData} depth={0} />
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 退出码 0。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/STPViewer/ModelTreePanel.tsx
git commit -m "feat(STPViewer): ModelTreePanel 递归层级树+勾选显隐+隔离开关"
```

---

## Task 7: 两入口接入 + 删除 BOMPanel + 清理旧显隐机制

**Files:**
- Modify: `frontend/src/components/STPViewer/index.tsx`
- Modify: `frontend/src/pages/STPViewer.tsx`
- Modify: `frontend/src/stores/viewerStore.ts`
- Delete: `frontend/src/components/STPViewer/BOMPanel.tsx`

- [ ] **Step 1: 弹窗版替换 BOMPanel**

在 `frontend/src/components/STPViewer/index.tsx`：
- 把 `import { BOMPanel } from './BOMPanel';` 改为 `import { ModelTreePanel } from './ModelTreePanel';`
- 把 JSX 里的 `<BOMPanel />` 改为 `<ModelTreePanel />`

- [ ] **Step 2: 独立页版加入面板**

在 `frontend/src/pages/STPViewer.tsx`：
- 顶部加导入：`import { ModelTreePanel } from '../components/STPViewer/ModelTreePanel';`
- 把渲染区改为左右布局，让画布与树面板并排。把：

```tsx
    <div className="w-screen h-screen relative">
      {url && <ViewerCanvas url={url} />}
      <Toolbar />
```

改为：

```tsx
    <div className="w-screen h-screen relative flex">
      <div className="flex-1 relative">
        {url && <ViewerCanvas url={url} />}
        <Toolbar />
      </div>
      <ModelTreePanel />
```

注意：原来紧跟其后的覆盖层 `{state === 'loading' && (...)}` 等遮罩块用 `absolute inset-0`，应留在最外层 `<div className="...flex">` 内（它们相对最外层定位），且最外层 `</div>` 仍在文件末尾正确闭合。

- [ ] **Step 3: 删除 BOMPanel 文件**

```bash
git rm frontend/src/components/STPViewer/BOMPanel.tsx
```

- [ ] **Step 4: 清理 viewerStore 旧显隐机制**

在 `frontend/src/stores/viewerStore.ts` 移除已无引用的旧白名单机制：
- `ViewerState` 接口删除 `visibleParts: Set<string>;`
- Actions 签名删除 `togglePartVisibility: (id: string) => void;`
- `initialState` 删除 `visibleParts: new Set<string>(),`
- 实现里删除整个 `togglePartVisibility: (id) => {...},` action
- `reset` 里删除 `visibleParts: new Set(),` 一行

- [ ] **Step 5: 类型检查 + 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 退出码 0；`built in ...`。
（若 tsc 报找不到 `BOMPanel` 或 `visibleParts`，说明仍有残留引用，按报错位置清理。）

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/index.tsx frontend/src/pages/STPViewer.tsx frontend/src/stores/viewerStore.ts
git commit -m "feat(STPViewer): 两入口接入 ModelTreePanel，移除 BOMPanel 与旧显隐机制"
```

---

## Task 8: 全量验证 + 手动端到端

**Files:** 无（仅验证）

- [ ] **Step 1: 全量单测 + 构建**

Run: `cd frontend && npm test && npm run build`
Expected: 测试全 PASS（buildModelTree 5 + viewerStore 5）；构建退出码 0。

- [ ] **Step 2: 手动验证（在系统里打开 GD40 装配体三维预览）**

逐项确认：
- [ ] 右侧出现「模型树」，层级与真实装配一致：`GD40_Assembly > 机架组件/动力组件/起落架组件 > 各零件`，可▸▾折叠展开
- [ ] 点树里某个零件（如「电机_1」）→ 3D 对应零件高亮 + 蓝色包围盒；「隔离模式」勾选时其余零件变半透明
- [ ] 点一个分组（如「动力组件」）→ 该组下所有零件（电机_1/2、螺旋桨_1/2）整体高亮，组外透明
- [ ] 关闭「隔离模式」→ 透明立即消失、全部实色（仍保留选中高亮），可在完整上下文里点击更深层子组件
- [ ] 点 3D 里某个零件 → 模型树自动展开到该节点并滚动高亮（双向联动）
- [ ] 取消勾选某节点的复选框 → 对应零件（分组则整子树）在 3D 中隐藏；再勾选 → 恢复显示；节点名变灰删除线
- [ ] 「取消选中」→ 恢复全部实色、无高亮、无包围盒

- [ ] **Step 3: 提交（如手动验证中有微调）**

```bash
git add -A
git commit -m "fix(STPViewer): 模型树端到端验证微调"
```

---

## Self-Review Notes

- **Spec 覆盖**：装配层级树→Task2/6；双向高亮→Task4(3D→树 selectByMesh)/Task6(树→3D selectNode)；隔离透明可选开关→Task4(逻辑)+Task6(开关)；分组整子树高亮→Task2(meshUuids 聚合)+Task4(sel 集合)；包围盒→Task5；勾选显隐(spec §4.4)→Task3(hiddenParts/toggleNodeVisibility)+Task4(visible)+Task6(复选框)；两入口统一→Task7；修复点击不高亮→Task4 Step4；接通 PartHighlighter→Task5。
- **类型一致**：`TreeNode`(treeTypes.ts) 贯穿；store action 名 `setTreeData/selectNode/selectByMesh/setIsolateMode/toggleExpanded/toggleNodeVisibility` 在 Task3 定义、Task4/6 使用一致；`meshUuids/parentId/nodeMap/meshOwner/hiddenParts` 命名统一。
- **显隐语义**：用 `hiddenParts`（隐藏集，空=全显），勾选框 `checked = 子树有任一可见`，`toggleNodeVisibility` 对整子树 meshUuids 批量增删。取代旧 `visibleParts` 白名单（Task7 Step4 清理）。
- **已知风险**(spec §8)：材质共享→Task4 Step2 clone 解决；性能→高亮/显隐 effect 依赖数组仅 selectedNodeId/isolateMode/hiddenParts 等变化触发(非逐帧)；id 唯一→用 Object3D.uuid。
- **增量可编译**：Task3 先增不删（保留旧 visibleParts 以免中途 ModelLoader 编译失败），待 Task4 ModelLoader 改用 hiddenParts、Task7 删 BOMPanel 后，于 Task7 Step4 统一清理旧机制。
