# STPViewer 装配模式功能完善设计

> 状态：设计完成 | 日期：2026-07-07

## 一、背景

装配 3D 预览已实现基本的模型摆位（通过变换矩阵将零件 GLB 放置到世界坐标），现需完善 STPViewer 装配模式，使其功能与单件模式对齐。

## 二、目标

- 工具栏全功能适配（线框/隔离/剖切/爆炸/测量/自动上色/重置视图）
- BOM 树按实例独立展开（同一件号的多个实例各自一行）
- 树 ⇄ 3D 双向对齐支持实例级粒度

## 三、架构

装配模式复用 STPViewer 布局（左树+右工具栏+画布），`InstancedScene` 替代单件的 `ViewerCanvas` 作为渲染核心。

```
STPViewer (assembly mode)
├── 左侧: AssemblyTreePanel (实例级BOM树, 可拖拽宽度)
├── 右侧顶部: Toolbar (线框/隔离/剖切/爆炸/测量/上色/重置)
├── 右侧画布: Canvas + InstancedScene + OrbitControls + ViewCube
└── 通信: assemblyViewerStore + InstanceIndex
```

## 四、功能适配

### 4.1 工具栏

| 功能 | 实现方式 |
|------|---------|
| **线框** | 遍历所有 LOD 实例，逐 mesh 设置 `material.wireframe = true/false` |
| **隔离模式** | 已有，通过 `store.isolateMode` 控制 |
| **剖切面** | `SectionPlanes` 的 `clipPlanes` 传给 Canvas，Three.js 原生作用于所有 LOD |
| **爆炸视图** | 计算装配中心→实例中心的偏移向量，动态叠加到实例矩阵上 |
| **测量** | raycast 命中任意 LOD 子 mesh → 取点计算距离 |
| **自动上色** | 按 `part_code` 生成颜色 map，遍历所有实例应用 |
| **重置视图** | 计算全部实例包围盒，相机适配距离 + lookAt 中心 |

### 4.2 BOM 树实例展开

后端 `get_assembly_tree` 当 `len(cad_instances) > 1` 时展开为子节点，每个实例携带 `instance_index`。

节点 ID 格式：`{bom_item_id}:{instance_index}`，`buildInstanceIndex` 的 `bom_path` 同步适配。

### 4.3 双向对齐

- **树→3D**: 点击树节点 → store 设置 `selectedBomItemId` → InstancedScene 高亮对应实例
- **3D→树**: raycast 命中 LOD → 取 `userData.bomPath` 末段 → store 选中对应节点

## 五、Store 扩展

`assemblyViewerStore` 新增状态：

| 状态 | 类型 | 说明 |
|------|------|------|
| `wireframe` | boolean | 线框模式开关 |
| `explodeFactor` | number | 爆炸幅度 (0~1) |
| `colorMap` | `Record<string, string>` | part_code → hex颜色 |
| `sectionPlanes` | `Array<{normal, constant}>` | 剖切面 |

## 六、文件清单

| 文件 | 变更 |
|------|------|
| `backend/crud_parts.py` | `get_assembly_tree` 展开多实例；`get_assembly_instances` bom_path 带实例索引 |
| `frontend/AssemblyTreePanel.tsx` | 实例级渲染 + `instance_index` |
| `frontend/InstancedScene.tsx` | 线框切换、爆炸偏移、自动上色 |
| `frontend/buildInstanceIndex.ts` | 兼容 `link.id:idx` 格式 |
| `frontend/pages/STPViewer.tsx` | 装配模式集成 Toolbar/SectionPlanes |
| `frontend/stores/assemblyViewerStore.ts` | 新增 wireframe/explode/colorMap 状态 |
