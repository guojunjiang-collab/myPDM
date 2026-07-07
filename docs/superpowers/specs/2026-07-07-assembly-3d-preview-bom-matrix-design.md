# 装配级 3D 预览设计方案（BOM + 变换矩阵 DMU）

日期：2026-07-07
状态：设计定稿，待实施
关联参考：CATIA-Copilot-PLM（DocDokuPLM）产品结构 DMU 实现

---

## 1. 背景与目标

myPDM 现已具备**单件** 3D 预览能力：
- 每个零件的 STP 附件经 Mayo/OCCT 转成一个 GLB（`stp_converter.py` → `stp_to_gltf.py`，Draco 压缩，缓存于 `glb_cache`）。
- 前端有功能完整的单件查看器 `STPViewer`（React-Three-Fiber）：装配树、隔离、剖切、测量、爆炸、自动上色、坐标轴 Gizmo。

**缺口**：没有**装配级** 3D 预览——无法把一个装配体下的多个零件 GLB，按 BOM 关系与各自的空间变换矩阵，摆放到正确的世界坐标系里，形成整机数字样机（DMU）。

**参考对象**（CATIA-Copilot-PLM / DocDokuPLM）的精髓：**几何与位置分离**。
- 每个零件几何只转一次；
- 装配关系与每个实例（instance）的世界矩阵单独存储；
- 服务端递归走产品结构树，累乘 `world = parent_world × local`，对**有几何的叶子节点**输出 `{path, partIterationId, matrix[16], 几何文件(多 LOD) + bbox}`；
- 前端不做树运算，只负责"加载去重后的几何 + 贴世界矩阵"，并按视觉大小自适应选择 LOD 档位。
- 核心算法见 `InstanceBodyWriterTools.generateInstanceStreamWithGlobalMatrix`；实例的本地变换见 `CADInstance`（rx/ry/rz + tx/ty/tz 的 ANGLE 形式，或 3×3 旋转矩阵 + 平移的 MATRIX 形式）。

**本方案目标**：把上述 DMU 能力以最小改动引入 myPDM，交付一个务实 MVP。

## 2. 关键设计决策（已确认）

| 决策点 | 选择 |
|---|---|
| 变换矩阵来源 | **解析装配体 STEP 自动提取**（OCCT/XCAF） |
| v1 范围 | **务实 MVP**，复用现有查看器 + 摆位，不做重型全局调度 |
| 结构对接 | **匹配现有逻辑 BOM，只贴矩阵**；不自动建零件树，未匹配项仅报告 |
| LOD | **三档（Coarse / Normal / Fine），v1 即上距离式 `THREE.LOD` 自适应**（档位数量可后续调整） |
| STEP 解析实现 | **pythonocc-core**：只抽结构 + 矩阵，几何仍走现有 Mayo 单件管线 |
| 矩阵存储 | **`BOMItem` 新增 JSONB 列 `cad_instances`**，不新建表、无破坏性迁移 |

## 3. 数据流总览

```
装配体STEP ──①解析(pythonocc)──> [occurrence树 + 每实例4x4本地矩阵 + 组件名]
                          │
                          ②按 PartMaster.code/name 匹配现有 BOMItem 子链接
                          │
                          ③把本地矩阵写入 BOMItem.cad_instances (JSONB)
                          │  未匹配 occurrence → 返回"未匹配报告"，不建数据
                          │
打开装配查看器 ──④后端展平──> GET /assembly-instances
                          │  递归走BOM树, world = parent_world @ local,
                          │  叶子节点输出 {path, glb_urls{coarse,fine}, matrix[16], bbox}
                          │
                          ⑤前端AssemblyViewer:
                             每实例 THREE.LOD([clone(coarse), clone(normal), clone(fine)]),
                             matrixAutoUpdate=false, 贴世界矩阵, 挂进场景;
                             相机距离自动切档
```

## 4. 组件设计

### 4.1 STEP 解析器（后端新模块 `backend/app/cad/assembly_parser.py`）

**职责单一**：输入一个装配体 STEP 路径，输出结构化的 occurrence 树，**只含结构与矩阵，不碰几何**。

**实现**：pythonocc-core
- `STEPCAFControl_Reader` 读入 → `XCAFDoc_ShapeTool` 遍历装配树（自由形状 / 组件 / 引用）。
- 对每个 occurrence 取 `TopLoc_Location` → 转 4×4（`gp_Trsf`）。
- 组件名取自 STEP 的 `Name` 属性（`XCAFDoc` label name）。
- 支持多级装配与同一子件多实例（quantity>1 不同位姿）。

**输出结构**（Python dict / Pydantic）：
```python
{
  "occurrences": [
     {
       "name": "BRACKET-01",           # 用于匹配 PartMaster
       "path": [rootId, childId, ...], # 结构路径
       "parent_name": "SUB-ASSY-A",
       "local_matrix": [16 floats],     # 相对父件的 4x4（行主序）
     }, ...
  ],
  "unit": "mm"                          # STEP 原生单位，用于单位归一化
}
```

**接口边界**：不依赖 myPDM 的任何数据库模型，纯函数式，可独立单元测试（喂已知装配 STEP，断言矩阵与树结构）。

### 4.2 结构匹配 + 矩阵回填（`crud_parts.py` 新增函数）

`apply_step_matrices(db, assembly_revision_id, parsed_tree) -> MatchReport`

- 从装配 revision 取其 `BOMItem` 子链接树。
- 按 `PartMaster.code`（优先）/ `name` 把每个 occurrence 匹配到对应 BOMItem 子链接。
- 匹配成功：把 `local_matrix`（含单位归一化，见 §6）追加到 `BOMItem.cad_instances`。同名多 occurrence → 一个 BOMItem 挂多个矩阵元素。
- 匹配失败：计入 `MatchReport.unmatched`，**不创建任何零件/链接**。
- 幂等：同一装配重复导入时，先清空该 revision 下 `source='step'` 的旧矩阵再回填。

返回 `MatchReport { matched: [...], unmatched: [...], multi_instance: [...] }` 给前端展示。

### 4.3 矩阵存储（`models.py` 的 `BOMItem` 扩展）

```python
# BOMItem 新增列
cad_instances = Column(JSONB, default=[])
# 元素结构：
# { "matrix": [16 floats], "source": "step"|"manual", "label": "实例1" }
```

- 沿用 myPDM 既有 JSONB 惯例（`custom_fields`、`document_links`），迁移仅一列、可回滚。
- 一个 BOMItem 挂 N 个实例 = 同一子件在父件下摆 N 处，对应 DocDoku 的 `List<CADInstance>`。
- 迁移脚本加进 `migrations_components.py`（现有迁移入口）。

### 4.4 装配展平接口（`routers/parts.py` 新增）

`GET /api/parts/revisions/{assembly_revision_id}/assembly-instances`

- 递归走 `BOMItem` 树，累乘世界矩阵：`world = parent_world @ local`（numpy 4×4）。
- 每个 BOMItem 的每个 `cad_instances` 元素各生成一条分支（多实例）。
- 叶子判定：无子 BOMItem，或自身挂有 CAD 附件（有 GLB）。
- 叶子输出：
```json
{
  "path": "rootId/childId/instanceIdx",
  "part_code": "BRACKET-01",
  "revision_id": "...",
  "glb_urls": { "coarse": "/api/.../coarse.glb", "normal": "/api/.../normal.glb", "fine": "/api/.../fine.glb" },
  "matrix": [16 floats],
  "bbox": { "min": [x,y,z], "max": [x,y,z] }
}
```
- GLB URL 复用现有单件 GLB 服务；去重由前端 `useLoader` 按 url 缓存自然完成。
- 该接口是 `InstanceBodyWriterTools.generateInstanceStreamWithGlobalMatrix` 的 Python 对应实现，但数据源是 myPDM 的 BOM 表。

### 4.5 前端 AssemblyViewer（`frontend/src/components/AssemblyViewer/`）

- 复用 `STPViewer` 的底座：`ViewerCanvas`、相机控制器、`AxisGizmo`、灯光。
- 拉取 `assembly-instances` → 对每个实例：
  - `THREE.LOD` 对象，挂 `clone(coarse)`、`clone(normal)`、`clone(fine)` 三个 level；
  - **必须 clone**（同一 GLB 被多实例复用，`SkeletonUtils.clone` 或 `scene.clone(true)`）；
  - `matrixAutoUpdate = false`，直接 `object.matrix.fromArray(worldMatrix)`；
  - LOD 距离阈值按实例 `bbox` 尺寸归一化（小件更早切粗模）。
- 装配树来自**后端 BOM**（非 GLB 节点树），树节点 ↔ 实例对象映射，复用现有显隐 / 隔离 / 选中高亮逻辑。
- 入口：装配型（`PartMaster.type == 'assembly'`）零件详情页新增「装配 3D 预览」按钮；未匹配报告以提示条展示。

## 5. LOD 设计（自适应提速）

**后端多精度产物**
- 复用 `stp_to_gltf.py` 现有 `QUALITY_MAP`，把"按大小挑一档"改为**每零件转 3 档**（`Coarse` / `Normal` / `Fine`），缓存为 `{name}_coarse.glb` / `{name}_normal.glb` / `{name}_fine.glb`。
- 每零件记录 `bbox`（从 GLB 或 OCCT 取），随 `assembly-instances` 返回，用于 LOD 距离阈值与视锥估算。
- 档位数量为可调参数（后续可增减）。

**前端自适应**
- 每实例用 `THREE.LOD`，按相机距离自动切档；距离是"视觉大小"的代理，缩放/远近时自动换档，无需自定义调度。
- 超小 / 超远实例切最低档甚至剔除。

**分层演进**
- v1：距离式 `THREE.LOD`——低成本拿到"按缩放比例自适应提速"。
- v2（预留、不返工）：DocDoku 式**全局三角面预算 + 降级平衡器**（万件级整机统一调度），接口已通过 `glb_urls`/`bbox` 预留。

## 6. 必须钉死的正确性风险

1. **单位归一化**：Mayo 导出的 GLB 以**米**为单位（`ModelLoader` 注释：1 单位 = 1000mm），而 STEP 装配矩阵平移量为**毫米**。世界矩阵平移分量必须 `/1000` 再贴，否则零件"飞出天际"。归一化在 §4.2 回填时统一处理，存进 `cad_instances` 的矩阵即已归一化为米。
2. **坐标系 / 朝向**：STEP/OCCT 多为 Z-up 右手系，three.js 为 Y-up。若叶子 GLB 转换时已烘焙 Z-up→Y-up，直接贴 STEP 空间矩阵会整体歪。策略：装配根节点统一施加一次 Z-up→Y-up（`rotX −90°`），单件矩阵保持 STEP 原生系；实现时用一个已知装配**实测校准**，确认 GLB 是否已烘焙旋转。

## 7. 测试策略

- **解析器单测**：喂已知小装配 STEP（2–3 级、含复用件），断言 occurrence 树、矩阵值、单位。
- **匹配回填单测**：构造已有 BOM + 解析结果，断言匹配/未匹配/多实例分类与 `cad_instances` 写入。
- **展平接口单测**：构造多级 BOM + 矩阵，断言世界矩阵累乘结果与叶子清单。
- **前端**：`buildAssemblyTree` 纯函数单测；查看器以一个基准装配做视觉回归（人工确认摆位正确）。
- **端到端校准**：用一个真实/已知装配走完整链路，人工确认三维摆位、单位、朝向正确（正确性风险 §6 的落地验证）。

## 8. 范围边界（YAGNI）

**v1 不做**：
- 全局三角面预算 / 降级平衡器（v2）。
- 查看器内手动摆位 / TransformControls 编辑矩阵（未选此路径）。
- 装配 STEP 自动建零件树（明确不做，只匹配现有 BOM）。
- 剖切 / 测量 / 爆炸在装配级的完整适配（v1 先保证摆位 + 树导航 + 显隐 + 选中；其余按需增量）。

## 9. 实施顺序（供后续 writing-plans 细化）

1. 后端：`BOMItem.cad_instances` 迁移 + STEP 解析器 `assembly_parser.py`（含单测）。
2. 后端：匹配回填 `apply_step_matrices` + 上传装配 STEP 触发入口（含单测）。
3. 后端：多档 GLB 生成 + bbox + 展平接口 `assembly-instances`（含单测）。
4. 前端：`AssemblyViewer` 摆位 + BOM 树导航 + 显隐/选中。
5. 前端：`THREE.LOD` 距离自适应接入 + 入口按钮 + 未匹配报告提示。
6. 端到端校准（§6 单位/朝向）。
