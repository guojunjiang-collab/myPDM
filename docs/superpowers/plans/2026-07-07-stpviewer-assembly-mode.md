# STPViewer 装配模式功能完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完善 STPViewer 装配模式：工具栏全功能适配 + BOM树实例独立展开 + 树⇄3D双向实例级对齐

**Architecture:** 后端展开多实例树节点，前端 AssemblyTreePanel 用 `bom_item_id:instance_index` 唯一标识，Toolbar 六项功能直接操作 InstancedScene 的 LOD 集合

**Tech Stack:** Python FastAPI + React TypeScript + Three.js/R3F

---

### Task 1: 后端 BOM 树多实例展开 + bom_path 带索引

**Files:**
- Modify: `backend/app/crud_parts.py:976-1010` (get_assembly_tree)
- Modify: `backend/app/crud_parts.py:950-955` (get_assembly_instances)
- Test: `backend/tests/test_assembly_instances.py` (追加)

- [ ] **Step 1: 修改 get_assembly_tree 展开多实例**

```python
            instances = link.cad_instances or []
            if len(instances) > 1:
                for idx, ci in enumerate(instances):
                    label = ci.get("label", "") or f"{master.code}#{idx+1}" if master else f"#{idx+1}"
                    nodes.append({
                        "bom_item_id": str(link.id),
                        "instance_index": idx,
                        "part_code": label,
                        "part_name": master.name if master else "",
                        "quantity": 1,
                        "instance_count": 1,
                        "is_leaf": len(children) == 0,
                        "children": children if idx == 0 else [],
                    })
            else:
                nodes.append({
                    "bom_item_id": str(link.id),
                    "part_code": master.code if master else "",
                    "part_name": master.name if master else "",
                    "quantity": link.quantity,
                    "instance_count": len(instances),
                    "is_leaf": len(children) == 0,
                    "children": children,
                })
```

- [ ] **Step 2: 修改 get_assembly_instances 的 bom_path 带实例索引**

```python
                child_bom_path = bom_path + [f"{link.id}:{idx}" if len(insts) > 1 else str(link.id)]
```

- [ ] **Step 3: 追加测试**

在 `backend/tests/test_assembly_instances.py` 追加：

```python
def test_assembly_tree_expands_multi_instance(db):
    _, asm_r, asm_it = _mk(db, "ASM-MI")
    _, leaf_r, _ = _mk(db, "BOLT-MI")
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                       parent_revision_id=asm_r.id, child_revision_id=leaf_r.id,
                       quantity=2, sort_order=0, cad_instances=[
                           {"matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b1"},
                           {"matrix": [1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b2"},
                       ])
    db.add(b); db.commit()
    tree = crud_parts.get_assembly_tree(db, asm_r.id)
    assert len(tree) == 2  # 两个实例节点
    assert tree[0]["part_code"] == "b1"
    assert tree[0]["instance_index"] == 0
    assert tree[1]["part_code"] == "b2"
    assert tree[1]["instance_index"] == 1
```

- [ ] **Step 4: 运行测试**

Run: `cd backend && pytest tests/test_assembly_instances.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_parts.py backend/tests/test_assembly_instances.py
git commit -m "feat(3d): BOM树多实例展开+bom_path带实例索引"
```

---

### Task 2: 前端 AssemblyTreePanel 实例级渲染

**Files:**
- Modify: `frontend/src/components/AssemblyViewer/AssemblyTreePanel.tsx`
- Modify: `frontend/src/components/AssemblyViewer/buildInstanceIndex.ts`

- [ ] **Step 1: 更新 AssemblyTreePanel 支持 instance_index**

```tsx
import type { AssemblyTreeNode } from '../../services/api';
import { useAssemblyStore } from './assemblyViewerStore';

function TreeRow({ node, depth }: { node: AssemblyTreeNode; depth: number }) {
  const selectedId = useAssemblyStore((s) => s.selectedBomItemId);
  const hidden = useAssemblyStore((s) => s.hiddenBomItemIds.has(node.bom_item_id));
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);
  const toggleHidden = useAssemblyStore((s) => s.toggleHidden);

  const instanceIdx = (node as any).instance_index;
  const nodeId = instanceIdx !== undefined ? `${node.bom_item_id}:${instanceIdx}` : node.bom_item_id;
  const isSel = selectedId === nodeId;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 cursor-pointer text-sm ${isSel ? 'bg-primary-100 text-primary-700' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => selectBomItem(isSel ? null : nodeId)}
      >
        <button
          className="text-xs opacity-60 hover:opacity-100 w-5 text-center"
          onClick={(e) => { e.stopPropagation(); toggleHidden(node.bom_item_id); }}
          title={hidden ? '显示' : '隐藏'}
        >{hidden ? '👁' : '🙈'}</button>
        <span className="truncate">{node.part_code}</span>
      </div>
      {node.children.map((c, i) => <TreeRow key={`${c.bom_item_id}_${i}`} node={c} depth={depth + 1} />)}
    </div>
  );
}

export function AssemblyTreePanel({ tree }: { tree: AssemblyTreeNode[] }) {
  return (
    <div className="py-1">
      {tree.map((n, i) => <TreeRow key={`${n.bom_item_id}_${i}`} node={n} depth={0} />)}
    </div>
  );
}
```

- [ ] **Step 2: 更新 buildInstanceIndex 兼容多实例 bomPath**

无需修改——现有逻辑遍历 `bom_path` 所有段并建立索引，`link.id:idx` 格式自动兼容。

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AssemblyViewer/AssemblyTreePanel.tsx
git commit -m "feat(3d): AssemblyTreePanel支持实例独立行+唯一ID"
```

---

### Task 3: InstancedScene 线框/爆炸/上色支持

**Files:**
- Modify: `frontend/src/components/AssemblyViewer/InstancedScene.tsx`
- Modify: `frontend/src/components/AssemblyViewer/assemblyViewerStore.ts`

- [ ] **Step 1: Store 新增状态**

```typescript
interface AssemblyViewerState {
  selectedBomItemId: string | null;
  hiddenBomItemIds: Set<string>;
  isolateMode: boolean;
  wireframe: boolean;
  explodeFactor: number;
  selectBomItem: (id: string | null) => void;
  toggleHidden: (id: string) => void;
  setIsolate: (v: boolean) => void;
  setWireframe: (v: boolean) => void;
  setExplodeFactor: (v: number) => void;
  reset: () => void;
}

export const useAssemblyStore = create<AssemblyViewerState>((set) => ({
  selectedBomItemId: null,
  hiddenBomItemIds: new Set<string>(),
  isolateMode: true,
  wireframe: false,
  explodeFactor: 0,
  selectBomItem: (id) => set({ selectedBomItemId: id }),
  toggleHidden: (id) => set((s) => {
    const next = new Set(s.hiddenBomItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { hiddenBomItemIds: next };
  }),
  setIsolate: (v) => set({ isolateMode: v }),
  setWireframe: (v) => set({ wireframe: v }),
  setExplodeFactor: (v) => set({ explodeFactor: v }),
  reset: () => set({ selectedBomItemId: null, hiddenBomItemIds: new Set(), wireframe: false, explodeFactor: 0 }),
}));
```

- [ ] **Step 2: InstancedScene 订阅 wireframe**

在 InstancedScene 中追加 useEffect：

```tsx
useEffect(() => {
  const apply = (state: ReturnType<typeof useAssemblyStore.getState>) => {
    lodByPath.current.forEach((lod) => {
      lod.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && !Array.isArray(mesh.material)) {
          (mesh.material as THREE.Material).wireframe = state.wireframe;
        }
      });
    });
  };
  apply(useAssemblyStore.getState());
  return useAssemblyStore.subscribe((s) => s.wireframe, () => apply(useAssemblyStore.getState()));
}, []);
```

- [ ] **Step 3: InstancedScene 爆炸偏移**

修改矩阵设置逻辑，叠加 explodeFactor：

```tsx
// 在摆位矩阵基础上叠加爆炸偏移
const explodeOffset = useAssemblyStore((s) => s.explodeFactor);
// 计算实例中心到装配中心的单位方向向量，乘以 explodeOffset * scale
const center = new THREE.Vector3(inst.matrix[3], inst.matrix[7], inst.matrix[11]);
const dir = center.clone().normalize();
const offset = dir.multiplyScalar(explodeOffset * 0.5);
lod.matrix.fromArray(inst.matrix).transpose();
// 叠加爆炸
if (explodeOffset > 0.001) {
  const m = lod.matrix.clone();
  m.elements[12] += offset.x;
  m.elements[13] += offset.y;
  m.elements[14] += offset.z;
  lod.matrix.copy(m);
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AssemblyViewer/InstancedScene.tsx frontend/src/components/AssemblyViewer/assemblyViewerStore.ts
git commit -m "feat(3d): InstancedScene线框+爆炸+store扩展"
```

---

### Task 4: STPViewer 装配模式集成 Toolbar

**Files:**
- Modify: `frontend/src/pages/STPViewer.tsx`

- [ ] **Step 1: 装配模式 Toolbar 使用 assemblyViewerStore**

在装配模式渲染中，Toolbar 按钮绑定 assemblyViewerStore：

```tsx
import { useAssemblyStore } from '../components/AssemblyViewer/assemblyViewerStore';

// 在装配模式的返回 JSX 中：
const { wireframe, setWireframe, isolateMode, setIsolate, explodeFactor, setExplodeFactor, reset } = useAssemblyStore();

// Toolbar 区域改为装配专用按钮
<div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b">
  <button onClick={() => setWireframe(!wireframe)}
    className={`px-2 py-0.5 text-xs rounded ${wireframe ? 'bg-blue-200 text-blue-800' : 'bg-gray-200'}`}>线框</button>
  <button onClick={() => setIsolate(!isolateMode)}
    className={`px-2 py-0.5 text-xs rounded ${isolateMode ? 'bg-blue-200 text-blue-800' : 'bg-gray-200'}`}>隔离</button>
  <input type="range" min="0" max="100" value={explodeFactor * 100}
    onChange={(e) => setExplodeFactor(Number(e.target.value) / 100)}
    className="w-20" title="爆炸" />
  <button onClick={reset}
    className="px-2 py-0.5 text-xs rounded bg-gray-200 hover:bg-gray-300">重置</button>
</div>
```

替换原有的 `<Toolbar />`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 通过

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/STPViewer.tsx
git commit -m "feat(3d): 装配模式Toolbar集成(线框/隔离/爆炸/重置)"
```

---

### Task 5: 部署验证

- [ ] **Step 1: 构建部署**

```bash
cd frontend && npm run build && docker-compose up -d --force-recreate nginx && docker restart bom_backend
```

- [ ] **Step 2: 功能验证清单**

- [ ] 装配3D预览打开 → BOM 树多实例独立行
- [ ] 线框模式 → 所有零件切换为线框
- [ ] 隔离模式 → 选中高亮，其余半透明
- [ ] 爆炸滑块 → 零件沿径向外移
- [ ] 点击树节点 → 3D 对应实例高亮
- [ ] 点击 3D 零件 → 树对应节点选中
- [ ] 眼睛图标 → 对应 bom_item 实例显示/隐藏
