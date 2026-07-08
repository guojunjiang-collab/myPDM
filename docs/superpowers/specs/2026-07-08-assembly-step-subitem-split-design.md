# 装配 STEP 逐子项拆分 + 多层级矩阵回填 设计方案

日期：2026-07-08
状态：设计定稿，待实施
关联：`2026-07-07-assembly-3d-preview-bom-matrix-design.md`（装配 3D 预览 / 矩阵）

---

## 1. 背景

装配 3D 预览已能解析装配 STEP、把**顶层直接子件**的变换矩阵回填到 BOM。现要在同一趟解析里再做两件事：

1. **多层级矩阵回填**：不止顶层，把 BOM 树**每一层**父→子的局部矩阵都解析出来、填进对应 BOMItem。
2. **逐子项拆分 STEP**：把装配 STEP 里每个（唯一的）子项几何，拆成独立 STEP 文件，存到该子项的**生产附件**，命名 `件号.STEP`。

两者共用一次 STEP 解析。

## 2. 关键决策（已确认）

| 决策点 | 选择 |
|---|---|
| 拆分机制 | **纯 Python STEP 子集提取**（沿用现有零依赖解析器，不引入 pythonocc） |
| 拆分粒度 | **所有层级**：叶件=单件实体 STEP；子装配=其子树 mini 装配 STEP |
| 子项去重 | 同一子项（`child_revision_id`）**只拆一次**；多实例差异由矩阵承载，几何相同 |
| STEP 写入门槛 | **草稿 且 当前用户已检出** 才生成/覆盖；否则跳过并报告 |
| 同名替换 | 生成前删掉该迭代下同名 `件号.STEP` 生产附件（含文件 + GLB 缓存），再写新 |
| GLB 转换 | 写入时**不触发**；首次预览时由现有 `/gltf` 端点懒转（避免上传时批量转换堵塞） |
| 矩阵回填门槛 | **不设门槛，始终写入**（`cad_instances` 是摆位派生缓存，不改逻辑 BOM，写全保证整机摆位完整） |

## 3. 数据流

```
POST /parts/revisions/{id}/import-assembly-step  (上传装配 STEP，一次解析)
  │
  ├─ ① parse_assembly_step(现有)  → occurrences[(父件名, 子件名, 局部矩阵)...]
  │
  ├─ ② 多层级矩阵回填(always)
  │      按 (父件号,子件号) 匹配 BOM 树任意层级的 BOMItem，
  │      填 local_matrix 到 cad_instances（多实例→N 个；先清 source=='step' 旧值，幂等）
  │
  └─ ③ 逐唯一子项拆分 STEP(gated)
         对每个匹配到的唯一 child_revision：
           ├ 门槛：draft 且 check_out_user_id==当前用户？否→记 skipped
           ├ step_splitter：子集提取该子项(叶件/子装配)的 STEP 文本
           ├ 删同名旧生产附件 件号.STEP(记录+文件+glb缓存)
           └ 直接写生产附件 件号.STEP（category='production'，sha256，**不转 GLB**）
  →  返回 Report{ matched, unmatched, multi_instance, generated, skipped_not_editable, failed }
```

## 4. 组件设计

### 4.1 STEP 子集提取器（新模块 `backend/app/cad/step_splitter.py`）

**职责**：输入原装配 STEP 内容 + 一个根 `PRODUCT_DEFINITION`，输出一个自包含的合法 STEP 文本，只含该子项（叶件或子装配子树）的几何/结构。纯函数、零依赖、可独立单测。

**统一闭包算法**（叶件是子装配的退化情形）：
1. **included PD 集合** = 根 PD + 经 `NEXT_ASSEMBLY_USAGE_OCCURRENCE` 可达的全部下级 PD（叶件→仅自身）。
2. **种子实体**：对每个 included PD，取其 `PRODUCT / PRODUCT_DEFINITION_FORMATION / PRODUCT_DEFINITION / PRODUCT_DEFINITION_SHAPE / SHAPE_DEFINITION_REPRESENTATION / SHAPE_REPRESENTATION`；加入父子**都**在集合内的 `NAUO` 及其关联的 `REPRESENTATION_RELATIONSHIP(_WITH_TRANSFORMATION) / ITEM_DEFINED_TRANSFORMATION / AXIS2_PLACEMENT_3D`（保留下级位姿）。
3. **前向可达闭包**：从种子出发沿 `#引用` 遍历，收集全部几何（点/向量/曲线/曲面/体/壳）与共享的 `APPLICATION_CONTEXT / *_UNIT / GEOMETRIC_REPRESENTATION_CONTEXT` 等（靠可达性自然带出）。
4. **重编号 + 写出**：闭包实体按原 id 排序重编号 `#1..#N`，重写所有 `#old→#new`；套用原 HEADER（`FILE_NAME` 第一字段改为 `件号.STEP`），输出 `ISO-10303-21` 文件。

> 需在解析层保留每个实体的**原始文本片段**（`_extract_entities` 增补 raw），重编号时按 raw 重写。

**接口（示意）**：
```python
def split_subitem_step(step_content: str, root_pd_id: int, entities, raw_by_id, header: str, file_label: str) -> str
```
不依赖 DB，纯文本进/纯文本出。

### 4.2 多层级矩阵回填（改 `crud_parts.apply_step_matrices`）

现状只匹配顶层 revision 的直接子件。改为**全层级**：
- 递归 walk 装配 BOM 树，收集所有 BOMItem，建索引 `(parent_master_code, child_master_code) → BOMItem`（`name` 作兜底键）。
- 每条 occurrence 按 `(parent_name, child_name)` 命中 BOMItem，把（单位归一化后的）`local_matrix` 追加进 `cad_instances`。
- 多实例：同 (父,子) 多条 → 多个矩阵。幂等：回填前先清各 BOMItem 里 `source=='step'` 的旧矩阵。
- 顶层是特例：直接子件的 `parent_name` = 装配件号，统一走同一套 (父,子) 匹配。
- **不设门槛**：无论父件状态都写。

### 4.3 子项 STEP 生成 + 门槛 + 替换（新 `crud_parts.generate_subitem_steps`）

- 遍历 BOM 树的**唯一** `child_revision`（`visited` 去重）。
- 定位该子项在装配 STEP 中的根 PD（按件号匹配 product 名 → PD）。匹配不上→`unmatched`。
- **门槛**：`child_rev.status=='draft'` 且 `child_rev.check_out_user_id==current_user`？否→`skipped_not_editable`。
- 取当前迭代；删该迭代下 `category=='production'` 且 `file_name=='件号.STEP'` 的旧附件（DB 记录 + 磁盘文件 + `delete_glb_cache`）。
- `step_splitter.split_subitem_step(...)` → 写文件到 `./uploads/parts/{code}/{version}/{iter}/件号.STEP`，建 `PartAttachment(category='production', sha256)`。**不调用 `convert_stp_to_gltf`**。
- 成功→`generated`；子集提取/写盘异常→`failed`（不中断整趟）。

### 4.4 触发接口（改 `routers/parts.py` 的 import-assembly-step）

在现有解析 + 矩阵回填后追加子项拆分调用；返回扩展后的 `MatchReport`。前端提示条展示各计数（可点开看件号清单）。

**职责分离（两条上传路径互不干扰）**：
- **装配导入** `POST .../import-assembly-step`（专用动作）：**唯一**触发解析 + 多层级矩阵回填 + 逐子项拆分的入口。上传的装配 STEP **仅作解析源**，解析完矩阵 + 拆完子项即弃（临时文件），**不**存为装配体自身的生产附件（整机/子装配 3D 预览靠汇总叶件，不用装配自身 STEP）。
- **普通生产附件上传** `POST .../attachments`（`category=production`，现有端点）：**只做文件落库**（保持现状，含其原有 GLB 处理），**绝不**触发上述任何解析/矩阵/拆分。用户手动传的 STEP 就是普通附件。

## 5. 存储与 GLB 懒转

- 落盘复用现有零件附件路径 `./uploads/parts/{code}/{version}/{iter}/件号.STEP`。
- **写入不转 GLB**。首次单件"3D预览"读 `production` 类 STP → 命中 `/gltf` 端点（`attachments_v2.py:674`）：缓存未命中即后台异步转 + 返回 202、前端轮询。转换成本摊到真正预览时，避免一次导入批量转换堵塞。

## 6. 报告结构（扩展 `MatchReport`）

```python
class MatchReport(BaseModel):
    matched: List[str]                 # 矩阵匹配上的 (父/子)
    unmatched: List[str]               # 未匹配到 BOM 的子项
    multi_instance: List[str]
    generated: List[str]               # 成功拆出 STEP 的件号(去重)
    skipped_not_editable: List[str]    # 因非草稿/未检出跳过
    failed: List[str]                  # 子集提取/写盘失败
```

## 7. 必须钉死的正确性风险

1. **子装配闭包完整性**：子装配 STEP 必须连带下级几何 + NAUO/IDT 位姿，否则拆出的 mini 装配缺件或散架。用一个已知两级装配做**往返测试**：拆出的子装配 STEP 重新喂 `parse_assembly_step`，断言其 occurrences/几何数与原子树一致。
2. **重编号引用一致性**：`#old→#new` 必须覆盖实体内所有引用（含嵌套括号内的 `#`）。断言拆出文件里无悬空引用（每个 `#N` 都在文件内有定义）。
3. **多层级矩阵消歧**：不同子装配下同名子件必须靠 `(父,子)` 键分开，不能串到别的 BOMItem。
4. **单位/坐标系**：子项 STEP 保持其**原生局部坐标系**（子集提取不改坐标），单位随原文件；与查看器侧的 mm→m、Z-up→Y-up 归一化互不影响。

## 8. 测试策略

- **step_splitter 单测**：喂已知装配 STEP，拆叶件→往返解析断言几何非空、无悬空 `#`；拆子装配→断言含下级 occurrences。
- **多层级矩阵单测**：构造两级 BOM + 解析结果，断言各级 BOMItem 的 `cad_instances` 正确、同名子件不串。
- **门槛/替换单测**：草稿+检出→生成；已发布/未检出→skipped；重复导入→同名替换只留一份、不触发 GLB。
- **端到端**：真实两级装配走完整链路，人工确认各级矩阵、拆出的单件/子装配 STEP 可单独预览。

## 9. 范围边界（YAGNI）

- 不做：内容哈希去重跳过（先用同名删除即可）；颜色/PMI/装配约束保留（几何为主）；装配体自身 STEP 落库（上传仅作解析源、用完即弃，查看器汇总叶件不用它）；写入时预转 GLB。
- 不做：普通生产附件上传（`POST .../attachments`）触发解析/矩阵/拆分——那条路径只存文件，保持现状。

## 10. 实施顺序（供 writing-plans 细化）

1. 解析层：`_extract_entities` 保留 raw 文本 + 暴露 PD/NAUO 索引（含单测）。
2. `step_splitter.split_subitem_step`：统一闭包 + 重编号 + 写出（含往返单测）。
3. `apply_step_matrices` 改多层级 (父,子) 匹配（含单测）。
4. `generate_subitem_steps`：去重 + 门槛 + 同名替换 + 写生产附件(不转 GLB)（含单测）。
5. import-assembly-step 接入 + `MatchReport` 扩展 + 前端报告提示。
6. 端到端校准（§7 子装配闭包 / 多层级矩阵）。
