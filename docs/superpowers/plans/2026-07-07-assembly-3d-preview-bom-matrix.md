# 装配级 3D 预览（BOM + 变换矩阵 DMU）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 myPDM 能把一个装配体下的多个零件 GLB，按 BOM 关系与从装配 STEP 解析出的空间变换矩阵，摆放到正确的世界坐标系，形成整机 3D 预览（DMU）；侧栏展示层级 BOM 树并与 3D 模型双向对齐；按视觉大小自适应切换三档 LOD 提速。零件与部件在详情页有统一的 3D 预览入口。

**Architecture:** 几何与位置分离。零件 GLB 复用现有单件转换（每零件转三档精度）；装配 STEP 用 pythonocc-core 只解析"结构 + 每实例本地矩阵"，按零件代号/名称匹配现有 `BOMItem` 并把矩阵写进新增的 JSONB 列 `cad_instances`；展平接口递归累乘世界矩阵输出叶子实例（带 `bom_path`），配套嵌套 `assembly-tree` 接口；前端 `AssemblyViewer` 用 `THREE.LOD` 逐实例贴世界矩阵并按相机距离切档，左侧层级 BOM 树经 `assemblyViewerStore` 与模型双向对齐（点树↔点模型）。

**Tech Stack:** FastAPI + SQLAlchemy(PostgreSQL/测试 SQLite) + numpy + pythonocc-core（OCCT）+ Mayo CLI；前端 React + React-Three-Fiber + three.js。

---

## 设计依据

- Spec：`docs/superpowers/specs/2026-07-07-assembly-3d-preview-bom-matrix-design.md`
- 参考实现：DocDokuPLM `InstanceBodyWriterTools.generateInstanceStreamWithGlobalMatrix`（世界矩阵累乘 + 叶子输出）、`CADInstance`（本地变换）。

## 文件结构（改动地图）

**后端**
- 修改 `backend/app/models.py` — `BOMItem` 增加 `cad_instances` JSONB 列。
- 修改 `backend/app/migrations_components.py` — 增加 `ALTER TABLE bom_items ADD COLUMN cad_instances`（幂等）。
- 新建 `backend/app/cad/__init__.py`（若不存在）。
- 新建 `backend/app/cad/matrix_utils.py` — 纯矩阵工具（4×4 累乘、单位归一化、Z-up→Y-up、trsf→列表）。
- 新建 `backend/app/cad/assembly_parser.py` — pythonocc 解析装配 STEP → occurrence 树 + 本地矩阵。
- 修改 `backend/app/crud_parts.py` — 新增 `apply_step_matrices()` 与 `get_assembly_instances()`。
- 修改 `backend/app/schemas_parts.py` — 新增 `AssemblyInstanceDTO` / `MatchReport` schema。
- 修改 `backend/app/routers/parts.py` — 新增 `import-assembly-step`、`assembly-instances`、`assembly-tree`、附件 LOD glb 三个/四个端点。
- 修改 `backend/app/stp_to_gltf.py` + `backend/app/stp_converter.py` — 支持指定精度档位 + 三档批量转换 + bbox 提取。
- 修改 `backend/app/crud_parts.py` — 新增 `apply_step_matrices` / `get_assembly_instances` / `get_assembly_tree`。
- 新建测试：`backend/tests/test_matrix_utils.py`、`test_assembly_parser.py`、`test_apply_step_matrices.py`、`test_lod_paths.py`、`test_assembly_instances.py`、`test_assembly_routes.py`。

**前端**
- 修改 `frontend/src/services/api.ts` — 新增 `assemblyViewerApi`（instances/tree/importStep）+ 类型。
- 新建 `frontend/src/components/AssemblyViewer/index.tsx` — 装配查看器容器（树 + canvas）。
- 新建 `frontend/src/components/AssemblyViewer/InstancedScene.tsx` — 逐实例 THREE.LOD 摆位 + raycast 反选 + 高亮/隔离/显隐订阅。
- 新建 `frontend/src/components/AssemblyViewer/AssemblyTreePanel.tsx` — 层级 BOM 树侧栏。
- 新建 `frontend/src/components/AssemblyViewer/assemblyViewerStore.ts` — 双向对齐状态（选中/隐藏/隔离）。
- 新建 `frontend/src/components/AssemblyViewer/buildInstanceIndex.ts` + `.test.ts` — bomItem ⇄ 实例 path 双向索引。
- 修改 `frontend/src/components/PartDetailModal.tsx` — 零件/部件统一 3D 预览入口 + 导入装配 STEP + 未匹配报告提示。

## 约定

- 后端测试：`cd backend && pytest tests/<file>::<test> -v`。DB 用 conftest 的内存 SQLite `db` fixture（JSONB 已编译为 JSON）。
- 矩阵统一 **行主序 16 元素 float 列表**，单位 **米**（存库前已归一化）。
- pythonocc-core 属重依赖；解析器测试用 `pytest.importorskip("OCC")` 跳过无 OCCT 的环境，矩阵纯函数不依赖 OCCT，必测。

---

## Task 1: `BOMItem.cad_instances` 存储列

**Files:**
- Modify: `backend/app/models.py:23-33`
- Modify: `backend/app/migrations_components.py`
- Test: `backend/tests/test_matrix_utils.py`（本任务末尾附带一个建表冒烟）

- [ ] **Step 1: 给 BOMItem 增加列**

修改 `backend/app/models.py`，在 `BOMItem` 的 `sort_order` 行之后加入：

```python
    sort_order = Column(Integer, default=0)
    cad_instances = Column(JSONB, default=list)  # [{matrix:[16 float], source:'step'|'manual', label:str}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

确认文件顶部已 `from sqlalchemy.dialects.postgresql import UUID, JSONB`（models.py 已用 JSONB，无需改 import）。

- [ ] **Step 2: 幂等迁移加列**

在 `backend/app/migrations_components.py` 的 `migrate_components` 函数末尾、`db.commit()` 之前插入：

```python
    # 11. bom_items 增加 cad_instances 列（装配 3D 预览：每实例世界坐标本地矩阵）
    db.execute(text("""
        ALTER TABLE bom_items
        ADD COLUMN IF NOT EXISTS cad_instances JSONB DEFAULT '[]'::jsonb
    """))
```

- [ ] **Step 3: 建表冒烟测试**

创建 `backend/tests/test_matrix_utils.py`（后续任务继续往里加）：

```python
import uuid
from app import models


def test_bomitem_has_cad_instances(db):
    item = models.BOMItem(id=uuid.uuid4(), quantity=1, sort_order=0, cad_instances=[])
    db.add(item); db.commit(); db.refresh(item)
    assert item.cad_instances == []
```

- [ ] **Step 4: 运行测试**

Run: `cd backend && pytest tests/test_matrix_utils.py::test_bomitem_has_cad_instances -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/migrations_components.py backend/tests/test_matrix_utils.py
git commit -m "feat(3d): BOMItem 增加 cad_instances 矩阵存储列"
```

---

## Task 2: 矩阵工具（纯函数，TDD）

**Files:**
- Create: `backend/app/cad/__init__.py`
- Create: `backend/app/cad/matrix_utils.py`
- Test: `backend/tests/test_matrix_utils.py`

四个纯函数：`identity()`、`multiply(a,b)`（4×4 行主序累乘）、`normalize_translation_mm_to_m(matrix)`（平移分量 /1000）、`z_up_to_y_up()`（绕 X 轴 −90° 的 4×4）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_matrix_utils.py` 追加：

```python
import numpy as np
from app.cad import matrix_utils as mu


def test_identity_is_16_floats():
    m = mu.identity()
    assert len(m) == 16
    assert m == [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]


def test_multiply_identity_keeps_matrix():
    a = mu.identity()
    b = [1,0,0,5, 0,1,0,6, 0,0,1,7, 0,0,0,1]  # 平移 (5,6,7)
    assert mu.multiply(a, b) == b


def test_multiply_composes_translations():
    t1 = [1,0,0,10, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    t2 = [1,0,0,0, 0,1,0,20, 0,0,1,0, 0,0,0,1]
    # 父 t1 × 子 t2 → 平移应为 (10,20,0)
    out = mu.multiply(t1, t2)
    assert out[3] == 10 and out[7] == 20 and out[11] == 0


def test_normalize_mm_to_m_divides_translation_only():
    m = [1,0,0,1000, 0,1,0,2000, 0,0,1,3000, 0,0,0,1]
    out = mu.normalize_translation_mm_to_m(m)
    assert out[3] == 1.0 and out[7] == 2.0 and out[11] == 3.0
    # 旋转/缩放部分不动
    assert out[0] == 1.0 and out[5] == 1.0 and out[10] == 1.0


def test_z_up_to_y_up_maps_z_axis_to_y():
    R = np.array(mu.z_up_to_y_up()).reshape(4, 4)
    v = np.array([0, 0, 1, 1.0])   # Z-up 的"上"
    out = R @ v
    assert abs(out[1] - 1.0) < 1e-6   # 变成 Y-up 的"上"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_matrix_utils.py -k "identity or multiply or normalize or z_up" -v`
Expected: FAIL（`No module named app.cad`）

- [ ] **Step 3: 实现**

创建 `backend/app/cad/__init__.py`（空文件）。创建 `backend/app/cad/matrix_utils.py`：

```python
"""4x4 变换矩阵工具（行主序 16 元素 float 列表）。

约定：矩阵按行主序展开为 16 个 float，[m00,m01,m02,m03, m10,...]。
平移分量位于索引 3/7/11。
"""
from __future__ import annotations
from typing import List
import math
import numpy as np


def identity() -> List[float]:
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def multiply(a: List[float], b: List[float]) -> List[float]:
    """返回 a × b（父世界矩阵 × 子本地矩阵），行主序 16 元素。"""
    ma = np.array(a, dtype=float).reshape(4, 4)
    mb = np.array(b, dtype=float).reshape(4, 4)
    return (ma @ mb).reshape(16).tolist()


def normalize_translation_mm_to_m(matrix: List[float]) -> List[float]:
    """把平移分量从毫米转米（/1000），旋转部分保持不变。"""
    out = list(matrix)
    out[3] = matrix[3] / 1000.0
    out[7] = matrix[7] / 1000.0
    out[11] = matrix[11] / 1000.0
    return out


def z_up_to_y_up() -> List[float]:
    """绕 X 轴 -90° 的 4x4：把 STEP/OCCT 的 Z-up 右手系转成 three.js 的 Y-up。"""
    c = math.cos(-math.pi / 2)
    s = math.sin(-math.pi / 2)
    return [
        1, 0, 0, 0,
        0, c, -s, 0,
        0, s, c, 0,
        0, 0, 0, 1,
    ]
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_matrix_utils.py -v`
Expected: PASS（全部）

- [ ] **Step 5: Commit**

```bash
git add backend/app/cad/__init__.py backend/app/cad/matrix_utils.py backend/tests/test_matrix_utils.py
git commit -m "feat(3d): 矩阵工具(累乘/单位归一化/Z-up→Y-up)"
```

---

## Task 3: 装配 STEP 解析器（pythonocc）

**Files:**
- Create: `backend/app/cad/assembly_parser.py`
- Test: `backend/tests/test_assembly_parser.py`

**产物结构（不依赖 DB）：**

```python
# 返回 dict:
{
  "unit": "mm",
  "occurrences": [
     {"name": str, "path": List[str], "parent_name": str | None, "local_matrix": List[float]},
     ...
  ],
}
```

- [ ] **Step 1: 先写"trsf→矩阵"纯函数的失败测试**

`gp_Trsf` → 16 元素矩阵的转换是可独立测试的纯逻辑。创建 `backend/tests/test_assembly_parser.py`：

```python
import pytest


def test_trsf_values_to_matrix_row_major():
    from app.cad.assembly_parser import _trsf_values_to_matrix
    # 模拟 OCCT gp_Trsf.Value(i,j)：3x4（旋转3x3 + 平移列），i,j 从1开始
    class FakeTrsf:
        def Value(self, i, j):
            table = {
                (1,1):1,(1,2):0,(1,3):0,(1,4):100,
                (2,1):0,(2,2):1,(2,3):0,(2,4):200,
                (3,1):0,(3,2):0,(3,3):1,(3,4):300,
            }
            return table[(i, j)]
    m = _trsf_values_to_matrix(FakeTrsf())
    assert m == [1,0,0,100, 0,1,0,200, 0,0,1,300, 0,0,0,1]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_assembly_parser.py::test_trsf_values_to_matrix_row_major -v`
Expected: FAIL（模块/函数不存在）

- [ ] **Step 3: 实现解析器**

创建 `backend/app/cad/assembly_parser.py`：

```python
"""用 pythonocc-core(OCCT) 解析装配 STEP，抽取结构 + 每实例本地矩阵。

只负责结构与矩阵，不碰几何（几何走现有 Mayo 单件转换）。
返回的矩阵为 STEP 原生单位(通常 mm)、STEP 原生坐标系(Z-up)，
单位归一化与 Z-up→Y-up 由上层(crud/viewer)统一处理。
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


def _trsf_values_to_matrix(trsf) -> List[float]:
    """OCCT gp_Trsf → 行主序 16 元素矩阵。gp_Trsf 是 3x4（含旋转+平移）。"""
    rows = []
    for i in range(1, 4):
        for j in range(1, 5):
            rows.append(float(trsf.Value(i, j)))
    rows += [0.0, 0.0, 0.0, 1.0]
    return rows


def parse_assembly_step(step_path: str) -> Dict[str, Any]:
    """读入装配 STEP，返回 {unit, occurrences[]}。

    occurrences 为展开的组件实例列表，每项含相对父件的 local_matrix。
    """
    from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
    from OCC.Core.TDocStd import TDocStd_Document
    from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
    from OCC.Core.TCollection import TCollection_ExtendedString
    from OCC.Core.TDF import TDF_LabelSequence
    from OCC.Core.TDataStd import TDataStd_Name

    doc = TDocStd_Document(TCollection_ExtendedString("pdm-doc"))
    reader = STEPCAFControl_Reader()
    reader.ReadFile(step_path)
    reader.Transfer(doc)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())

    def label_name(label) -> str:
        from OCC.Core.TDF import TDF_Label
        name_attr = TDataStd_Name()
        if label.FindAttribute(TDataStd_Name.GetID(), name_attr):
            return name_attr.Get().ToExtString()
        return ""

    occurrences: List[Dict[str, Any]] = []

    def walk(label, path: List[str], parent_name: Optional[str]):
        comps = TDF_LabelSequence()
        shape_tool.GetComponents(label, comps)
        for i in range(1, comps.Length() + 1):
            comp_label = comps.Value(i)
            name = label_name(comp_label) or f"occ_{i}"
            # 组件相对父件的位置
            from OCC.Core.XCAFDoc import XCAFDoc_Location
            loc = shape_tool.GetLocation(comp_label)
            trsf = loc.Transformation()
            local_matrix = _trsf_values_to_matrix(trsf)
            this_path = path + [name]
            occurrences.append({
                "name": name,
                "path": this_path,
                "parent_name": parent_name,
                "local_matrix": local_matrix,
            })
            # 若该组件引用了一个子装配，继续下钻
            ref_label = comp_label
            referred = shape_tool.GetReferredShape(comp_label, ref_label)
            target = ref_label if referred else comp_label
            if shape_tool.IsAssembly(target):
                walk(target, this_path, name)

    free_shapes = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_shapes)
    for i in range(1, free_shapes.Length() + 1):
        root = free_shapes.Value(i)
        root_name = label_name(root) or "root"
        if shape_tool.IsAssembly(root):
            walk(root, [root_name], None)

    return {"unit": "mm", "occurrences": occurrences}
```

> 注：`GetReferredShape` 的 out 参数用法随 pythonocc 版本略有差异；执行时若签名报错，改用 `shape_tool.GetReferredShape(comp_label)` 的返回布尔 + 单独取 label 的形式。这是本任务唯一需要按环境校准处。

- [ ] **Step 4: 运行纯函数测试**

Run: `cd backend && pytest tests/test_assembly_parser.py::test_trsf_values_to_matrix_row_major -v`
Expected: PASS

- [ ] **Step 5: 加一个"有 OCCT 才跑"的端到端解析测试（可跳过）**

在 `test_assembly_parser.py` 追加：

```python
def test_parse_assembly_step_smoke(tmp_path):
    OCC = pytest.importorskip("OCC")  # 无 pythonocc 环境自动跳过
    # 需要一个已知装配 STEP 夹具；放在 tests/fixtures/mini_assembly.step
    import os
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "mini_assembly.step")
    if not os.path.exists(fixture):
        pytest.skip("缺少 mini_assembly.step 夹具")
    from app.cad.assembly_parser import parse_assembly_step
    result = parse_assembly_step(fixture)
    assert result["unit"] == "mm"
    assert len(result["occurrences"]) >= 1
    for occ in result["occurrences"]:
        assert len(occ["local_matrix"]) == 16
```

- [ ] **Step 6: 运行（无 OCCT 会 skip）**

Run: `cd backend && pytest tests/test_assembly_parser.py -v`
Expected: `test_trsf...` PASS；`test_parse...smoke` SKIP（本机无 OCCT/夹具时）

- [ ] **Step 7: Commit**

```bash
git add backend/app/cad/assembly_parser.py backend/tests/test_assembly_parser.py
git commit -m "feat(3d): pythonocc 装配 STEP 结构+矩阵解析器"
```

---

## Task 4: 匹配 + 矩阵回填 `apply_step_matrices`

**Files:**
- Modify: `backend/app/crud_parts.py`（文件末尾追加）
- Modify: `backend/app/schemas_parts.py`（追加 schema）
- Test: `backend/tests/test_apply_step_matrices.py`

**逻辑：** 输入装配 revision + 解析结果；按 `PartMaster.code`（优先）/`name` 把 occurrence 匹配到该 revision 当前迭代下的 `BOMItem` 子链接；成功则把（单位归一化后的）矩阵追加进 `cad_instances`（先清空 `source=='step'` 的旧项，幂等）；失败计入未匹配报告；不建任何数据。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_apply_step_matrices.py`：

```python
import uuid
from app import models, models_parts
from app import crud_parts


def _make_part(db, code, name):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=name, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", latest_iteration=1)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def test_apply_matrices_matches_by_code_and_backfills(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-1", "总装")
    child_m, child_rev, _ = _make_part(db, "BRACKET-01", "支架")
    bom = models.BOMItem(
        id=uuid.uuid4(), iteration_id=asm_it.id,
        parent_revision_id=asm_rev.id, child_revision_id=child_rev.id,
        quantity=1, sort_order=0, cad_instances=[],
    )
    db.add(bom); db.commit()

    parsed = {"unit": "mm", "occurrences": [
        {"name": "BRACKET-01", "path": ["ASM-1", "BRACKET-01"],
         "parent_name": "ASM-1",
         "local_matrix": [1,0,0,1000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    report = crud_parts.apply_step_matrices(db, asm_rev.id, parsed)

    db.refresh(bom)
    assert len(bom.cad_instances) == 1
    # 平移已从 mm 归一化为米
    assert bom.cad_instances[0]["matrix"][3] == 1.0
    assert bom.cad_instances[0]["source"] == "step"
    assert report["matched"] == ["BRACKET-01"]
    assert report["unmatched"] == []


def test_apply_matrices_reports_unmatched(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-2", "总装2")
    parsed = {"unit": "mm", "occurrences": [
        {"name": "GHOST", "path": ["ASM-2", "GHOST"], "parent_name": "ASM-2",
         "local_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    report = crud_parts.apply_step_matrices(db, asm_rev.id, parsed)
    assert report["unmatched"] == ["GHOST"]
    assert report["matched"] == []


def test_apply_matrices_is_idempotent(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-3", "总装3")
    _, child_rev, _ = _make_part(db, "P-9", "件9")
    bom = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                         parent_revision_id=asm_rev.id, child_revision_id=child_rev.id,
                         quantity=1, sort_order=0, cad_instances=[])
    db.add(bom); db.commit()
    parsed = {"unit": "mm", "occurrences": [
        {"name": "P-9", "path": ["ASM-3", "P-9"], "parent_name": "ASM-3",
         "local_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    crud_parts.apply_step_matrices(db, asm_rev.id, parsed)
    crud_parts.apply_step_matrices(db, asm_rev.id, parsed)  # 第二次
    db.refresh(bom)
    step_items = [c for c in bom.cad_instances if c["source"] == "step"]
    assert len(step_items) == 1  # 不重复累积
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_apply_step_matrices.py -v`
Expected: FAIL（`apply_step_matrices` 不存在）

- [ ] **Step 3: 实现**

在 `backend/app/crud_parts.py` 末尾追加（文件已 `import` 了 `models`、`models_parts`、`Session`、`UUID`；新增 numpy 工具 import）：

```python
from .cad import matrix_utils as _mu


def _current_iteration(db: Session, revision_id):
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None
    return (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )


def apply_step_matrices(db: Session, assembly_revision_id, parsed: dict) -> dict:
    """把解析出的 occurrence 矩阵，按 code/name 匹配现有 BOM 子链接并回填。

    返回 {matched:[名字], unmatched:[名字], multi_instance:[名字]}。
    幂等：先清空各链接里 source=='step' 的旧矩阵。
    """
    iteration = _current_iteration(db, assembly_revision_id)
    if iteration is None:
        return {"matched": [], "unmatched": [o["name"] for o in parsed.get("occurrences", [])],
                "multi_instance": []}

    bom_items = (
        db.query(models.BOMItem)
        .filter(models.BOMItem.iteration_id == iteration.id,
                models.BOMItem.deleted_at.is_(None))
        .all()
    )

    # 建立 code/name → BOMItem 索引
    index = {}
    for item in bom_items:
        child_rev = get_part_revision(db, item.child_revision_id)
        if not child_rev:
            continue
        master = get_part_master(db, child_rev.master_id)
        if not master:
            continue
        index.setdefault(("code", master.code), item)
        index.setdefault(("name", master.name), item)

    # 先清空 step 来源的旧矩阵（幂等）
    touched = set()
    for item in bom_items:
        kept = [c for c in (item.cad_instances or []) if c.get("source") != "step"]
        if kept != (item.cad_instances or []):
            item.cad_instances = kept
            touched.add(item.id)

    matched, unmatched = [], []
    per_item_count = {}

    for occ in parsed.get("occurrences", []):
        name = occ["name"]
        item = index.get(("code", name)) or index.get(("name", name))
        if not item:
            unmatched.append(name)
            continue
        norm = _mu.normalize_translation_mm_to_m(occ["local_matrix"])
        instances = list(item.cad_instances or [])
        instances.append({"matrix": norm, "source": "step", "label": name})
        item.cad_instances = instances
        touched.add(item.id)
        matched.append(name)
        per_item_count[item.id] = per_item_count.get(item.id, 0) + 1

    # SQLAlchemy 对 JSONB 就地修改需要显式标脏
    from sqlalchemy.orm.attributes import flag_modified
    for item in bom_items:
        if item.id in touched:
            flag_modified(item, "cad_instances")

    db.commit()

    multi = [i for i, c in per_item_count.items() if c > 1]
    multi_names = []
    for item in bom_items:
        if item.id in multi:
            cr = get_part_revision(db, item.child_revision_id)
            m = get_part_master(db, cr.master_id) if cr else None
            if m:
                multi_names.append(m.code)

    return {"matched": matched, "unmatched": unmatched, "multi_instance": multi_names}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_apply_step_matrices.py -v`
Expected: PASS（3 个）

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_parts.py backend/tests/test_apply_step_matrices.py
git commit -m "feat(3d): 按 code/name 匹配 BOM 并回填装配矩阵(幂等)"
```

---

## Task 5: 三档 LOD GLB 生成 + bbox

**Files:**
- Modify: `backend/app/stp_to_gltf.py`
- Modify: `backend/app/stp_converter.py`
- Test: `backend/tests/test_lod_paths.py`

目标：把"按大小挑一档"扩展为"指定档位转换"，并提供每零件三档路径与 bbox 读取。GLB 实际转换依赖 Mayo（容器内），故单测只覆盖**路径规划**与**bbox 解析**纯逻辑。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_lod_paths.py`：

```python
from pathlib import Path
from app import stp_converter as sc


def test_lod_glb_paths_three_tiers(tmp_path):
    paths = sc.get_lod_glb_paths("abc123", file_path="document/GD40_A/part.stp")
    assert set(paths.keys()) == {"coarse", "normal", "fine"}
    assert paths["coarse"].name == "part_coarse.glb"
    assert paths["normal"].name == "part_normal.glb"
    assert paths["fine"].name == "part_fine.glb"
    # 三档同目录
    assert paths["coarse"].parent == paths["fine"].parent


def test_read_glb_bbox_parses_min_max(tmp_path):
    # 构造一个最小合法 glTF(JSON)含 accessor min/max，验证 bbox 读取
    import json, struct
    gltf = {
        "asset": {"version": "2.0"},
        "accessors": [{"type": "VEC3", "componentType": 5126, "count": 2,
                       "min": [-1.0, -2.0, -3.0], "max": [4.0, 5.0, 6.0]}],
    }
    p = tmp_path / "m.gltf"
    p.write_text(json.dumps(gltf))
    bbox = sc.read_gltf_bbox(str(p))
    assert bbox == {"min": [-1.0, -2.0, -3.0], "max": [4.0, 5.0, 6.0]}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_lod_paths.py -v`
Expected: FAIL（函数不存在）

- [ ] **Step 3: stp_to_gltf 支持指定档位**

修改 `backend/app/stp_to_gltf.py` 的 `convert` 签名，允许外部指定精度（默认保持"按大小自动"）：

```python
def convert(input_path: str, output_path: str, quality: str | None = None):
    if not os.path.exists(input_path):
        logger.error(f"输入文件不存在: {input_path}")
        sys.exit(1)
    logger.info(f"转换: {input_path} → {output_path}")
    # Step 1: 选择网格精度（外部未指定则按大小自动）
    if quality is None:
        quality = _get_quality_for_file(input_path)
    logger.info(f"网格精度: {quality}")
    # ...(后续不变)
```

并把 `__main__` 入口改为可选第三参：

```python
if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        print(f"用法: {sys.argv[0]} <input.stp> <output.glb> [quality]")
        sys.exit(1)
    q = sys.argv[3] if len(sys.argv) == 4 else None
    convert(sys.argv[1], sys.argv[2], q)
```

- [ ] **Step 4: stp_converter 增加三档路径 + bbox + 三档转换**

在 `backend/app/stp_converter.py` 追加：

```python
import json

LOD_QUALITIES = {"coarse": "Coarse", "normal": "Normal", "fine": "Fine"}


def get_lod_glb_paths(attachment_id: str, file_path: str = None) -> dict:
    """返回三档 LOD 的 glb 路径 {coarse, normal, fine}。"""
    base = get_glb_cache_path(attachment_id, file_path)  # .../part.glb
    stem = base.stem  # part
    out = {}
    for tier in ("coarse", "normal", "fine"):
        out[tier] = base.with_name(f"{stem}_{tier}.glb")
    return out


def convert_stp_to_lod(stp_path: str, attachment_id: str, file_path: str = None) -> dict:
    """把 STP 转成三档 LOD glb，返回 {tier: str(path)}（已存在则跳过）。"""
    stp_file = Path(stp_path)
    if not stp_file.exists():
        logger.error(f"STP 文件不存在: {stp_path}")
        return {}
    paths = get_lod_glb_paths(attachment_id, file_path)
    results = {}
    for tier, glb_path in paths.items():
        if glb_path.exists():
            results[tier] = str(glb_path)
            continue
        tmp_glb = stp_file.with_suffix(f'.{tier}.tmp.glb')
        with _stp_semaphore:
            if glb_path.exists():
                results[tier] = str(glb_path); continue
            try:
                result = subprocess.run(
                    ['python3', CONVERTER_SCRIPT, str(stp_file), str(tmp_glb), LOD_QUALITIES[tier]],
                    capture_output=True, text=True, timeout=180,
                )
                if result.returncode == 0 and tmp_glb.exists():
                    glb_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(tmp_glb), str(glb_path))
                    results[tier] = str(glb_path)
                else:
                    logger.error(f"{tier} 档转换失败: {result.stderr[:300]}")
                    if tmp_glb.exists(): tmp_glb.unlink()
            except Exception as e:
                logger.error(f"{tier} 档转换异常: {e}")
                if tmp_glb.exists(): tmp_glb.unlink()
    return results


def read_gltf_bbox(gltf_or_glb_path: str) -> dict | None:
    """从 glTF(.gltf JSON) 读取所有 POSITION accessor 的整体 bbox。
    仅支持 JSON 版；.glb 二进制场景由前端在加载后计算，后端返回 None 即可。
    """
    p = Path(gltf_or_glb_path)
    if p.suffix.lower() != ".gltf":
        return None
    try:
        data = json.loads(p.read_text())
    except Exception:
        return None
    mins, maxs = None, None
    for acc in data.get("accessors", []):
        if acc.get("type") == "VEC3" and "min" in acc and "max" in acc and len(acc["min"]) == 3:
            amin, amax = acc["min"], acc["max"]
            mins = amin if mins is None else [min(a, b) for a, b in zip(mins, amin)]
            maxs = amax if maxs is None else [max(a, b) for a, b in zip(maxs, amax)]
    if mins is None:
        return None
    return {"min": mins, "max": maxs}
```

> bbox：Mayo 导出 `.glb`（二进制）时后端不解析，`read_gltf_bbox` 返回 None，改由前端加载后用 `THREE.Box3().setFromObject` 计算（见 Task 8）。此函数保留是为将来 `.gltf` 直读与单测覆盖路径逻辑。

- [ ] **Step 5: 运行确认通过**

Run: `cd backend && pytest tests/test_lod_paths.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/stp_to_gltf.py backend/app/stp_converter.py backend/tests/test_lod_paths.py
git commit -m "feat(3d): 三档 LOD glb 生成 + glTF bbox 读取"
```

---

## Task 6: 展平接口 `get_assembly_instances`（世界矩阵累乘）

**Files:**
- Modify: `backend/app/crud_parts.py`（追加）
- Test: `backend/tests/test_assembly_instances.py`

递归走 BOM 树，`world = parent_world @ local`，对叶子输出实例。为可测，本函数接收一个 `glb_url_resolver(child_revision_id) -> dict|None` 回调，解耦 GLB 存储细节。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_assembly_instances.py`：

```python
import uuid
from app import models, models_parts, crud_parts


def _mk(db, code):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", latest_iteration=1)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def _link(db, parent_it, parent_rev, child_rev, matrix):
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=parent_it.id,
                       parent_revision_id=parent_rev.id, child_revision_id=child_rev.id,
                       quantity=1, sort_order=0,
                       cad_instances=[{"matrix": matrix, "source": "step", "label": "x"}])
    db.add(b); db.commit()
    return b


def test_two_level_world_matrix_composition(db):
    # ASM -> SUB(平移X+1米) -> LEAF(平移Y+2米)；LEAF 世界应为 (1,2,0)
    _, asm_r, asm_it = _mk(db, "ASM")
    _, sub_r, sub_it = _mk(db, "SUB")
    _, leaf_r, _ = _mk(db, "LEAF")
    _link(db, asm_it, asm_r, sub_r, [1,0,0,1, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    _link(db, sub_it, sub_r, leaf_r, [1,0,0,0, 0,1,0,2, 0,0,1,0, 0,0,0,1])

    def resolver(child_revision_id):
        return {"coarse": "c.glb", "normal": "n.glb", "fine": "f.glb"} if str(child_revision_id) == str(leaf_r.id) else None

    instances = crud_parts.get_assembly_instances(db, asm_r.id, resolver)
    assert len(instances) == 1
    inst = instances[0]
    assert inst["part_code"] == "LEAF"
    assert inst["matrix"][3] == 1.0 and inst["matrix"][7] == 2.0
    assert inst["glb_urls"]["fine"] == "f.glb"


def test_multi_instance_expands(db):
    _, asm_r, asm_it = _mk(db, "ASM2")
    _, leaf_r, _ = _mk(db, "BOLT")
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                       parent_revision_id=asm_r.id, child_revision_id=leaf_r.id,
                       quantity=2, sort_order=0, cad_instances=[
                           {"matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b1"},
                           {"matrix": [1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b2"},
                       ])
    db.add(b); db.commit()
    instances = crud_parts.get_assembly_instances(db, asm_r.id, lambda cid: {"coarse":"c","normal":"n","fine":"f"})
    assert len(instances) == 2
    xs = sorted(i["matrix"][3] for i in instances)
    assert xs == [0.0, 5.0]


def test_instance_carries_bom_path(db):
    _, asm_r, asm_it = _mk(db, "ASM-BP")
    _, sub_r, sub_it = _mk(db, "SUB-BP")
    _, leaf_r, _ = _mk(db, "LEAF-BP")
    l1 = _link(db, asm_it, asm_r, sub_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    l2 = _link(db, sub_it, sub_r, leaf_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    instances = crud_parts.get_assembly_instances(db, asm_r.id, lambda cid: {"coarse":"c","normal":"n","fine":"f"})
    assert instances[0]["bom_path"] == [str(l1.id), str(l2.id)]


def test_assembly_tree_nested_structure(db):
    _, asm_r, asm_it = _mk(db, "ASM-T")
    _, sub_r, sub_it = _mk(db, "SUB-T")
    _, leaf_r, _ = _mk(db, "LEAF-T")
    _link(db, asm_it, asm_r, sub_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    _link(db, sub_it, sub_r, leaf_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    tree = crud_parts.get_assembly_tree(db, asm_r.id)
    assert len(tree) == 1
    assert tree[0]["part_code"] == "SUB-T"
    assert tree[0]["is_leaf"] is False
    assert tree[0]["children"][0]["part_code"] == "LEAF-T"
    assert tree[0]["children"][0]["is_leaf"] is True
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && pytest tests/test_assembly_instances.py -v`
Expected: FAIL

- [ ] **Step 3: 实现**

在 `backend/app/crud_parts.py` 追加：

```python
def get_assembly_instances(db: Session, assembly_revision_id, glb_url_resolver) -> list:
    """递归展平装配 BOM 树，返回叶子实例清单（每个含世界矩阵）。

    glb_url_resolver(child_revision_id) -> {coarse,normal,fine} | None
    叶子判定：无子 BOMItem，或该 revision 能解析到 GLB。
    """
    instances = []

    def children_of(rev_id, iteration_id):
        return (
            db.query(models.BOMItem)
            .filter(models.BOMItem.iteration_id == iteration_id,
                    models.BOMItem.deleted_at.is_(None))
            .all()
        )

    def walk(rev_id, world, path, bom_path, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        iteration = _current_iteration(db, rev_id)
        child_links = children_of(rev_id, iteration.id) if iteration else []

        if not child_links:
            return  # 叶子的几何在其父链接处输出，这里无子直接返回

        for link in child_links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            master = get_part_master(db, child_rev.master_id)
            child_iter = _current_iteration(db, child_rev.id)
            grandchildren = children_of(child_rev.id, child_iter.id) if child_iter else []
            glb_urls = glb_url_resolver(child_rev.id)

            insts = link.cad_instances or [{"matrix": _mu.identity(), "source": "implicit", "label": ""}]
            for idx, ci in enumerate(insts):
                local = ci.get("matrix") or _mu.identity()
                child_world = _mu.multiply(world, local)
                child_path = path + [f"{link.id}:{idx}"]
                child_bom_path = bom_path + [str(link.id)]  # BOMItem id 链，供双向对齐

                is_leaf = (not grandchildren) and glb_urls is not None
                if is_leaf:
                    instances.append({
                        "path": "/".join(child_path),
                        "bom_path": child_bom_path,
                        "part_code": master.code if master else "",
                        "revision_id": str(child_rev.id),
                        "glb_urls": glb_urls,
                        "matrix": child_world,
                        "bbox": None,
                    })
                else:
                    walk(child_rev.id, child_world, child_path, child_bom_path, visited)

    walk(assembly_revision_id, _mu.identity(), [str(assembly_revision_id)], [], set())
    return instances


def get_assembly_tree(db: Session, assembly_revision_id) -> list:
    """递归构建嵌套 BOM 树，供 AssemblyViewer 侧栏渲染 + 双向对齐锚点。

    节点：{bom_item_id, part_code, part_name, quantity, instance_count, is_leaf, children:[...]}
    bom_item_id 与 get_assembly_instances 返回的 bom_path 段一一对应。
    """
    def build(rev_id, visited):
        if rev_id in visited:
            return []
        visited = visited | {rev_id}
        iteration = _current_iteration(db, rev_id)
        if not iteration:
            return []
        links = (
            db.query(models.BOMItem)
            .filter(models.BOMItem.iteration_id == iteration.id,
                    models.BOMItem.deleted_at.is_(None))
            .order_by(models.BOMItem.sort_order)
            .all()
        )
        nodes = []
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            master = get_part_master(db, child_rev.master_id)
            children = build(child_rev.id, visited)
            nodes.append({
                "bom_item_id": str(link.id),
                "part_code": master.code if master else "",
                "part_name": master.name if master else "",
                "quantity": link.quantity,
                "instance_count": len(link.cad_instances or []),
                "is_leaf": len(children) == 0,
                "children": children,
            })
        return nodes

    return build(assembly_revision_id, set())
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && pytest tests/test_assembly_instances.py -v`
Expected: PASS（4 个）

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_parts.py backend/tests/test_assembly_instances.py
git commit -m "feat(3d): 装配 BOM 展平+世界矩阵累乘+嵌套树+bom_path"
```

---

## Task 7: 路由接口（导入装配 STEP + 展平实例）

**Files:**
- Modify: `backend/app/schemas_parts.py`
- Modify: `backend/app/routers/parts.py`
- Test: `backend/tests/test_assembly_routes.py`

三个端点：
- `POST /parts/revisions/{revision_id}/import-assembly-step`（上传装配 STEP，body 用已有 CAD 附件或直接上传文件 → 解析 → 匹配回填 → 返回 MatchReport）。
- `GET /parts/revisions/{revision_id}/assembly-instances`（返回展平实例清单，含 `bom_path`）。
- `GET /parts/revisions/{revision_id}/assembly-tree`（返回嵌套 BOM 树，供侧栏 + 双向对齐）。

- [ ] **Step 1: 加 schema**

在 `backend/app/schemas_parts.py` 追加：

```python
from pydantic import BaseModel
from typing import List, Optional, Dict


class MatchReport(BaseModel):
    matched: List[str]
    unmatched: List[str]
    multi_instance: List[str]


class AssemblyInstanceDTO(BaseModel):
    path: str
    bom_path: List[str]
    part_code: str
    revision_id: str
    glb_urls: Dict[str, str]
    matrix: List[float]
    bbox: Optional[Dict[str, List[float]]] = None


class AssemblyTreeNodeDTO(BaseModel):
    bom_item_id: str
    part_code: str
    part_name: str
    quantity: int
    instance_count: int
    is_leaf: bool
    children: List["AssemblyTreeNodeDTO"] = []


AssemblyTreeNodeDTO.model_rebuild()  # 解析自引用（pydantic v2）
```

- [ ] **Step 2: 写路由 + GLB 解析器**

在 `backend/app/routers/parts.py` 顶部确保 import：

```python
from fastapi import UploadFile, File
import tempfile, os
from ..cad.assembly_parser import parse_assembly_step
from ..stp_converter import convert_stp_to_lod, get_lod_glb_paths
from ..schemas_parts import MatchReport, AssemblyInstanceDTO, AssemblyTreeNodeDTO
```

追加端点：

```python
def _glb_url_resolver_factory(db):
    """返回 resolver(child_revision_id) -> {coarse,normal,fine} | None。
    以该 revision 当前迭代下 category=='cad' 的首个 STP 附件为准，
    URL 走前端已有的 gltf token 机制（见前端 Task 8）。
    """
    from ..models_parts import PartIteration, PartAttachment

    def resolver(child_revision_id):
        rev = crud_parts.get_part_revision(db, child_revision_id)
        if not rev:
            return None
        it = (db.query(PartIteration)
              .filter(PartIteration.revision_id == rev.id,
                      PartIteration.iteration == rev.latest_iteration).first())
        if not it:
            return None
        att = (db.query(PartAttachment)
               .filter(PartAttachment.iteration_id == it.id,
                       PartAttachment.category == "cad").first())
        if not att:
            return None
        paths = get_lod_glb_paths(str(att.id), att.file_path)
        # 仅在文件已生成时给 URL，缺失档回退到 fine
        urls = {}
        for tier, p in paths.items():
            if os.path.exists(p):
                urls[tier] = f"/api/parts/attachments/{att.id}/lod/{tier}"
        if not urls:
            return None
        # 缺档回退
        fallback = urls.get("fine") or next(iter(urls.values()))
        for tier in ("coarse", "normal", "fine"):
            urls.setdefault(tier, fallback)
        return urls

    return resolver


@router.post("/revisions/{revision_id}/import-assembly-step", response_model=MatchReport)
async def import_assembly_step(
    revision_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:edit")),
):
    """上传装配 STEP，解析结构+矩阵，按 code/name 匹配现有 BOM 并回填。"""
    suffix = os.path.splitext(file.filename or "a.step")[1] or ".step"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        parsed = parse_assembly_step(tmp_path)
    finally:
        os.unlink(tmp_path)
    report = crud_parts.apply_step_matrices(db, revision_id, parsed)
    return report


@router.get("/revisions/{revision_id}/assembly-instances", response_model=List[AssemblyInstanceDTO])
def assembly_instances(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:view")),
):
    resolver = _glb_url_resolver_factory(db)
    return crud_parts.get_assembly_instances(db, revision_id, resolver)


@router.get("/revisions/{revision_id}/assembly-tree", response_model=List[AssemblyTreeNodeDTO])
def assembly_tree(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:view")),
):
    """嵌套 BOM 树，供 AssemblyViewer 侧栏 + 双向对齐。"""
    return crud_parts.get_assembly_tree(db, revision_id)


@router.get("/attachments/{attachment_id}/lod/{tier}")
def get_attachment_lod_glb(
    attachment_id: uuid.UUID,
    tier: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:view")),
):
    """按档位返回某 CAD 附件的 LOD glb 文件。"""
    from ..models_parts import PartAttachment
    if tier not in ("coarse", "normal", "fine"):
        raise HTTPException(status_code=400, detail="非法档位")
    att = db.query(PartAttachment).filter(PartAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    # 惰性转换：首次访问触发三档生成
    convert_stp_to_lod(att.file_path, str(att.id), att.file_path)
    paths = get_lod_glb_paths(str(att.id), att.file_path)
    glb = paths.get(tier)
    if not glb or not os.path.exists(glb):
        raise HTTPException(status_code=404, detail="LOD 未生成")
    return FileResponse(str(glb), media_type="model/gltf-binary", filename=glb.name)
```

> 权限名 `parts:edit` / `parts:view` 按 `backend/app/permissions/` 现有清单核对，若命名不同改为对应项。

- [ ] **Step 3: 写路由集成测试（用 FastAPI TestClient + 依赖覆盖）**

创建 `backend/tests/test_assembly_routes.py`：

```python
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.permissions import require_permission
from app import models, models_parts, crud_parts


def _override_db(db):
    def _f():
        yield db
    return _f


def _mk(db, code):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", latest_iteration=1)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def test_assembly_instances_route_empty(db, engineer_user):
    _, asm_r, _ = _mk(db, "ASM-R")
    app.dependency_overrides[get_db] = _override_db(db)
    # 绕过权限校验
    from app.routers import parts as parts_router
    app.dependency_overrides[require_permission("parts:view")] = lambda: engineer_user
    try:
        client = TestClient(app)
        resp = client.get(f"/api/parts/revisions/{asm_r.id}/assembly-instances")
        assert resp.status_code == 200
        assert resp.json() == []
    finally:
        app.dependency_overrides.clear()
```

> 若 `require_permission` 的 override key 机制在本项目行不通（依赖工厂每次返回新函数），参照 `tests/test_parts_perms.py` 现有做法覆盖鉴权；该文件已存在，照其模式写。

- [ ] **Step 4: 运行**

Run: `cd backend && pytest tests/test_assembly_routes.py -v`
Expected: PASS（或按现有鉴权 override 模式修正后 PASS）

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas_parts.py backend/app/routers/parts.py backend/tests/test_assembly_routes.py
git commit -m "feat(3d): 装配 STEP 导入 + 实例展平 + LOD glb 路由"
```

---

## Task 8: 前端 AssemblyViewer（THREE.LOD 摆位 + BOM 树 ⇄ 模型双向对齐）

**Files:**
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/components/AssemblyViewer/buildInstanceIndex.ts`
- Create: `frontend/src/components/AssemblyViewer/buildInstanceIndex.test.ts`
- Create: `frontend/src/components/AssemblyViewer/assemblyViewerStore.ts`
- Create: `frontend/src/components/AssemblyViewer/InstancedScene.tsx`
- Create: `frontend/src/components/AssemblyViewer/AssemblyTreePanel.tsx`
- Create: `frontend/src/components/AssemblyViewer/index.tsx`

- [ ] **Step 1: API 客户端（instances 带 bom_path + tree + importStep）**

在 `frontend/src/services/api.ts` 追加（沿用现有 `api` 实例）：

```typescript
export interface AssemblyInstance {
  path: string;
  bom_path: string[]; // BOMItem id 链，末段为叶子链接
  part_code: string;
  revision_id: string;
  glb_urls: { coarse: string; normal: string; fine: string };
  matrix: number[]; // 16, row-major, meters
  bbox: { min: number[]; max: number[] } | null;
}

export interface AssemblyTreeNode {
  bom_item_id: string;
  part_code: string;
  part_name: string;
  quantity: number;
  instance_count: number;
  is_leaf: boolean;
  children: AssemblyTreeNode[];
}

export const assemblyViewerApi = {
  instances: (revisionId: string) =>
    api.get<AssemblyInstance[]>(`/parts/revisions/${revisionId}/assembly-instances`).then((r) => r.data),
  tree: (revisionId: string) =>
    api.get<AssemblyTreeNode[]>(`/parts/revisions/${revisionId}/assembly-tree`).then((r) => r.data),
  importStep: (revisionId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/parts/revisions/${revisionId}/import-assembly-step`, fd).then((r) => r.data);
  },
};
```

- [ ] **Step 2: buildInstanceIndex 纯函数 + 测试（TDD，双向映射的核心）**

创建 `frontend/src/components/AssemblyViewer/buildInstanceIndex.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { buildInstanceIndex } from './buildInstanceIndex';
import type { AssemblyInstance } from '../../services/api';

const inst = (path: string, bom: string[]): AssemblyInstance => ({
  path, bom_path: bom, part_code: 'X', revision_id: 'r',
  glb_urls: { coarse: 'c', normal: 'n', fine: 'f' },
  matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], bbox: null,
});

describe('buildInstanceIndex', () => {
  const idx = buildInstanceIndex([
    inst('p1', ['A', 'B']),
    inst('p2', ['A', 'C']),
    inst('p3', ['A']),
  ]);

  it('maps a bom node to all instance paths under it', () => {
    // 'A' 是三个实例的共同祖先
    expect(idx.pathsByBomItem.get('A')?.sort()).toEqual(['p1', 'p2', 'p3']);
    // 'B' 只覆盖 p1
    expect(idx.pathsByBomItem.get('B')).toEqual(new Set(['p1']));
  });

  it('maps an instance path to its leaf bom item', () => {
    expect(idx.leafBomItemByPath.get('p1')).toBe('B');
    expect(idx.leafBomItemByPath.get('p3')).toBe('A');
  });
});
```

创建 `frontend/src/components/AssemblyViewer/buildInstanceIndex.ts`：

```typescript
import type { AssemblyInstance } from '../../services/api';

export interface InstanceIndex {
  // bomItemId → 该节点(含后代)覆盖的所有实例 path
  pathsByBomItem: Map<string, Set<string>>;
  // 实例 path → 其叶子 bomItemId（bom_path 末段），用于点模型反选树
  leafBomItemByPath: Map<string, string>;
}

export function buildInstanceIndex(instances: AssemblyInstance[]): InstanceIndex {
  const pathsByBomItem = new Map<string, Set<string>>();
  const leafBomItemByPath = new Map<string, string>();
  for (const inst of instances) {
    for (const bomId of inst.bom_path) {
      const set = pathsByBomItem.get(bomId) ?? new Set<string>();
      set.add(inst.path);
      pathsByBomItem.set(bomId, set);
    }
    const leaf = inst.bom_path[inst.bom_path.length - 1];
    if (leaf) leafBomItemByPath.set(inst.path, leaf);
  }
  return { pathsByBomItem, leafBomItemByPath };
}
```

- [ ] **Step 3: 运行前端单测**

Run: `cd frontend && npx vitest run src/components/AssemblyViewer/buildInstanceIndex.test.ts`
Expected: PASS

- [ ] **Step 4: assemblyViewerStore（镜像现有 viewerStore 语义）**

创建 `frontend/src/components/AssemblyViewer/assemblyViewerStore.ts`（用 zustand，与 `stores/viewerStore.ts` 同风格）：

```typescript
import { create } from 'zustand';

interface AssemblyViewerState {
  selectedBomItemId: string | null;  // 当前选中的 BOM 节点
  hiddenBomItemIds: Set<string>;     // 被隐藏的 BOM 节点
  isolateMode: boolean;              // 选中时其余半透明
  selectBomItem: (id: string | null) => void;
  toggleHidden: (id: string) => void;
  setIsolate: (v: boolean) => void;
  reset: () => void;
}

export const useAssemblyStore = create<AssemblyViewerState>((set) => ({
  selectedBomItemId: null,
  hiddenBomItemIds: new Set<string>(),
  isolateMode: true,
  selectBomItem: (id) => set({ selectedBomItemId: id }),
  toggleHidden: (id) => set((s) => {
    const next = new Set(s.hiddenBomItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { hiddenBomItemIds: next };
  }),
  setIsolate: (v) => set({ isolateMode: v }),
  reset: () => set({ selectedBomItemId: null, hiddenBomItemIds: new Set() }),
}));
```

- [ ] **Step 5: InstancedScene（摆位 + raycast 反选 + 订阅高亮/隔离/显隐）**

创建 `frontend/src/components/AssemblyViewer/InstancedScene.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssemblyInstance } from '../../services/api';
import type { InstanceIndex } from './buildInstanceIndex';
import { useAssemblyStore } from './assemblyViewerStore';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    sceneCache.set(url, loader.loadAsync(url).then((g) => g.scene));
  }
  return sceneCache.get(url)!;
}

// STEP(Z-up) → three(Y-up)：绕 X 轴 -90°，施加在装配根 group
const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

interface Props { instances: AssemblyInstance[]; index: InstanceIndex; }

export function InstancedScene({ instances, index }: Props) {
  const [root] = useState(() => new THREE.Group());
  // path → LOD 对象，供订阅时按 path 定位
  const lodByPath = useRef<Map<string, THREE.LOD>>(new Map());
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);

  // ① 加载 + 摆位
  useEffect(() => {
    let cancelled = false;
    root.matrixAutoUpdate = false;
    root.matrix.copy(Z_UP_TO_Y_UP);
    lodByPath.current.clear();

    (async () => {
      for (const inst of instances) {
        const [coarse, normal, fine] = await Promise.all([
          loadScene(inst.glb_urls.coarse),
          loadScene(inst.glb_urls.normal),
          loadScene(inst.glb_urls.fine),
        ]);
        if (cancelled) return;

        const lod = new THREE.LOD();
        const fineC = SkeletonUtils.clone(fine);
        const normalC = SkeletonUtils.clone(normal);
        const coarseC = SkeletonUtils.clone(coarse);
        // 每个 mesh 独立材质，供高亮/隔离就地改色不互相影响
        fineC.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && m.material && !Array.isArray(m.material)) m.material = (m.material as THREE.Material).clone();
        });

        const size = new THREE.Box3().setFromObject(fineC).getSize(new THREE.Vector3()).length() || 1;
        lod.addLevel(fineC, 0);
        lod.addLevel(normalC, size * 4);
        lod.addLevel(coarseC, size * 12);

        lod.matrixAutoUpdate = false;
        lod.matrix.fromArray(inst.matrix).transpose(); // 行主序→three 列主序
        lod.userData.path = inst.path;
        lod.userData.bomPath = inst.bom_path;
        root.add(lod);
        lodByPath.current.set(inst.path, lod);
      }
    })();

    return () => { cancelled = true; root.clear(); lodByPath.current.clear(); };
  }, [instances, root]);

  // ② 订阅 store：高亮/隔离/显隐
  useEffect(() => {
    const apply = (state: ReturnType<typeof useAssemblyStore.getState>) => {
      const { selectedBomItemId, hiddenBomItemIds, isolateMode } = state;
      const selectedPaths = selectedBomItemId
        ? index.pathsByBomItem.get(selectedBomItemId) ?? new Set<string>()
        : null;

      lodByPath.current.forEach((lod, path) => {
        const bomPath: string[] = lod.userData.bomPath ?? [];
        const hidden = bomPath.some((id) => hiddenBomItemIds.has(id));
        lod.visible = !hidden;

        const isSelected = selectedPaths ? selectedPaths.has(path) : false;
        lod.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (!mesh.isMesh || Array.isArray(mesh.material)) return;
          const std = mesh.material as THREE.MeshStandardMaterial;
          if (!selectedPaths) {
            if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
            std.transparent = false; std.opacity = 1; std.depthWrite = true;
          } else if (isSelected) {
            if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
            std.transparent = false; std.opacity = 1; std.depthWrite = true;
          } else {
            if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
            if (isolateMode) { std.transparent = true; std.opacity = 0.12; std.depthWrite = false; }
            else { std.transparent = false; std.opacity = 1; std.depthWrite = true; }
          }
          std.needsUpdate = true;
        });
      });
    };
    apply(useAssemblyStore.getState());
    return useAssemblyStore.subscribe(apply);
  }, [index]);

  // ③ 点模型 → 反选树（raycast 命中 LOD，取其 bom_path 末段）
  const handleClick = (e: any) => {
    e.stopPropagation();
    let obj: THREE.Object3D | null = e.object;
    while (obj && !(obj as THREE.LOD).isLOD) obj = obj.parent;
    const bomPath: string[] | undefined = obj?.userData?.bomPath;
    if (bomPath && bomPath.length) selectBomItem(bomPath[bomPath.length - 1]);
  };

  return <primitive object={root} onClick={handleClick} />;
}
```

> 关键：`inst.matrix` 行主序 → three `Matrix4` 列主序，故 `.transpose()`；轴系用根 group 的 `Z_UP_TO_Y_UP`。二者都在 Task 10 实测校准。

- [ ] **Step 6: AssemblyTreePanel（层级 BOM 树，点节点 → 选中/显隐）**

创建 `frontend/src/components/AssemblyViewer/AssemblyTreePanel.tsx`：

```tsx
import type { AssemblyTreeNode } from '../../services/api';
import { useAssemblyStore } from './assemblyViewerStore';

function TreeRow({ node, depth }: { node: AssemblyTreeNode; depth: number }) {
  const selectedId = useAssemblyStore((s) => s.selectedBomItemId);
  const hidden = useAssemblyStore((s) => s.hiddenBomItemIds.has(node.bom_item_id));
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);
  const toggleHidden = useAssemblyStore((s) => s.toggleHidden);
  const isSel = selectedId === node.bom_item_id;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-0.5 cursor-pointer ${isSel ? 'bg-primary-100 text-primary-700' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => selectBomItem(isSel ? null : node.bom_item_id)}
      >
        <button
          className="text-xs opacity-60 hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); toggleHidden(node.bom_item_id); }}
          title={hidden ? '显示' : '隐藏'}
        >{hidden ? '🙈' : '👁'}</button>
        <span className="truncate">{node.part_code} {node.part_name}</span>
        {node.instance_count > 1 && <span className="opacity-50">×{node.instance_count}</span>}
      </div>
      {node.children.map((c) => <TreeRow key={c.bom_item_id} node={c} depth={depth + 1} />)}
    </div>
  );
}

export function AssemblyTreePanel({ tree }: { tree: AssemblyTreeNode[] }) {
  return (
    <aside className="w-64 overflow-auto border-r p-2 text-sm">
      {tree.map((n) => <TreeRow key={n.bom_item_id} node={n} depth={0} />)}
    </aside>
  );
}
```

> `primary-*` / 选中底色沿用项目现有配色（memory: 前端风格统一）。展开/折叠、图标可按 `ModelTreePanel` 既有样式细化。

- [ ] **Step 7: AssemblyViewer 容器（拼装 tree + canvas，参照 STPViewer 布局）**

创建 `frontend/src/components/AssemblyViewer/index.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { assemblyViewerApi, type AssemblyInstance, type AssemblyTreeNode } from '../../services/api';
import { InstancedScene } from './InstancedScene';
import { AssemblyTreePanel } from './AssemblyTreePanel';
import { buildInstanceIndex } from './buildInstanceIndex';
import { useAssemblyStore } from './assemblyViewerStore';

interface Props { revisionId: string; }

export function AssemblyViewer({ revisionId }: Props) {
  const [instances, setInstances] = useState<AssemblyInstance[] | null>(null);
  const [tree, setTree] = useState<AssemblyTreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reset = useAssemblyStore((s) => s.reset);

  useEffect(() => {
    reset();
    Promise.all([assemblyViewerApi.instances(revisionId), assemblyViewerApi.tree(revisionId)])
      .then(([ins, tr]) => { setInstances(ins); setTree(tr); })
      .catch(() => setError('加载装配数据失败'));
  }, [revisionId, reset]);

  const index = useMemo(() => buildInstanceIndex(instances ?? []), [instances]);

  if (error) return <div className="p-4 text-red-500">{error}</div>;
  if (!instances) return <div className="p-4">加载中…</div>;
  if (instances.length === 0) return <div className="p-4">该装配暂无已摆位的零件（先导入装配 STEP）</div>;

  return (
    <div className="flex h-full">
      <AssemblyTreePanel tree={tree} />
      <div className="flex-1">
        <Canvas camera={{ position: [4, 4, 4], fov: 50 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 10, 7]} intensity={1} />
          <InstancedScene instances={instances} index={index} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
}
```

> 灯光/相机/背景对齐 `STPViewer/index.tsx` 与 `ViewerCanvas.tsx` 既有参数，保持视觉一致。

- [ ] **Step 8: 前端构建校验**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/components/AssemblyViewer`
Expected: 类型通过 + 单测 PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/components/AssemblyViewer
git commit -m "feat(3d): AssemblyViewer + THREE.LOD 摆位 + BOM树⇄模型双向对齐"
```

---

## Task 9: 统一入口按钮（零件 3D预览 / 部件 装配预览）+ 未匹配报告

**Files:**
- Modify: `frontend/src/components/PartDetailModal.tsx`

零件与部件都在详情页给出明确 3D 预览入口：
- **零件（单件）**：「3D预览」按钮 → 打开现有 `STPViewer`（加载该零件 CAD 附件的 GLB）。
- **部件（`master.type === 'assembly'` 或 BOM 有子项）**：「装配3D预览」按钮 → 打开 `AssemblyViewer`；另有「导入装配STEP」按钮，导入后提示匹配/未匹配数。

- [ ] **Step 1: 引入 + 状态**

在 `PartDetailModal.tsx` 引入（`STPViewer` 按项目现有单件查看器组件名/路径对齐；若单件预览是独立页面则复用其打开方式）：

```tsx
import { AssemblyViewer } from './AssemblyViewer';
import { assemblyViewerApi } from '../services/api';
```

在组件内加状态（`revision`/`master` 按该文件既有变量名对齐；`isAssembly` 用既有判断：`master.type === 'assembly'` 或 BOM 有子项）：

```tsx
const [showAssembly, setShowAssembly] = useState(false);
const [showPart3D, setShowPart3D] = useState(false);
const assemblyFileRef = useRef<HTMLInputElement>(null);

const handleImportStep = async (file: File) => {
  const report = await assemblyViewerApi.importStep(revision.id, file);
  // toast 用该项目既有通知组件；此处示意
  alert(`匹配 ${report.matched.length} 个，未匹配 ${report.unmatched.length} 个` +
        (report.unmatched.length ? `：${report.unmatched.join(', ')}` : ''));
};
```

- [ ] **Step 2: 渲染按钮 + 弹窗（零件/部件分支）**

在操作区（按该文件既有按钮区）插入：

```tsx
{isAssembly ? (
  <>
    <button className="btn-secondary" onClick={() => assemblyFileRef.current?.click()}>导入装配STEP</button>
    <input ref={assemblyFileRef} type="file" accept=".stp,.step" hidden
           onChange={(e) => e.target.files?.[0] && handleImportStep(e.target.files[0])} />
    <button className="btn-primary" onClick={() => setShowAssembly(true)}>装配3D预览</button>
  </>
) : (
  <button className="btn-primary" onClick={() => setShowPart3D(true)}>3D预览</button>
)}

{showAssembly && (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setShowAssembly(false)}>
    <div className="bg-white w-[90vw] h-[85vh] rounded" onClick={(e) => e.stopPropagation()}>
      <AssemblyViewer revisionId={revision.id} />
    </div>
  </div>
)}
{showPart3D && (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setShowPart3D(false)}>
    <div className="bg-white w-[90vw] h-[85vh] rounded" onClick={(e) => e.stopPropagation()}>
      {/* 复用现有单件查看器；prop 按其签名传入该零件 CAD 附件的 glb url/attachmentId */}
      <STPViewer revisionId={revision.id} />
    </div>
  </div>
)}
```

> 单件预览：若项目已有从附件行打开 `STPViewer` 的方式，这个「3D预览」按钮只是把同一入口提升到详情页头部，`STPViewer` 的 prop 按其现有签名传（glb url 或 attachmentId）。`btn-primary`/`btn-secondary`、弹窗优先复用项目**共享 Modal 组件**而非裸 div（memory: 前端风格统一）。

- [ ] **Step 3: 构建校验**

Run: `cd frontend && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PartDetailModal.tsx
git commit -m "feat(3d): 零件/部件统一详情页 3D 预览入口"
```

---

## Task 10: 端到端校准（单位 / 朝向）— 人工验证

**Files:** 无代码产物（可能微调 Task 8 的 `.transpose()` / Task 2 的 `z_up_to_y_up` 符号）

Spec §6 的两个正确性风险必须实测钉死。

- [ ] **Step 1: 准备基准装配**

选一个**已知真实装配**：其零件都已在 myPDM 建档、各自有 CAD STP 附件、且已建好逻辑 BOM。导出该装配的装配体 STEP。

- [ ] **Step 2: 走完整链路**

在该装配零件详情：导入装配 STEP → 确认 MatchReport 全部匹配（未匹配需先核对代号/名称一致）→ 打开装配 3D 预览。

- [ ] **Step 3: 核对四点**

1. **摆位**：各零件相对位置与真实装配一致（不重叠、不飞散）。
2. **单位**：整机尺度合理（不是 1000× 过大或 0.001× 过小）→ 验证 mm→m 归一化正确。
3. **朝向**：整机不躺倒/不镜像 → 验证 Z-up→Y-up 正确。
4. **双向对齐**：点左侧 BOM 树节点 → 对应零件在 3D 高亮/隔离、眼睛图标可显隐；点 3D 里某零件 → 左侧树对应叶子节点被选中。

- [ ] **Step 4: 按现象修正**

- 整机躺倒 90° → 调整 `InstancedScene` 根 group 的 `Z_UP_TO_Y_UP`（或去掉，若 GLB 已烘焙轴变换）。
- 零件个体旋转错但整机位置对 → 检查 `lod.matrix.fromArray(...).transpose()` 的行/列主序。
- 尺度差 1000× → 检查 `normalize_translation_mm_to_m` 是否被绕过或重复。

- [ ] **Step 5: 记录结论**

把最终确认的"轴系 + 主序"结论写进 spec 文档 §6 作为定论（避免后人再踩），commit：

```bash
git add docs/superpowers/specs/2026-07-07-assembly-3d-preview-bom-matrix-design.md
git commit -m "docs(3d): 记录装配预览轴系/单位校准结论"
```

---

## 自检回顾（写作者已核对）

- **Spec 覆盖**：矩阵来源(Task3/4/7)、务实MVP复用查看器(Task8/9)、只匹配不建树(Task4)、三档LOD+距离自适应(Task5/8)、pythonocc(Task3)、BOMItem JSONB列(Task1)、**层级BOM树⇄模型双向对齐**(Task6 tree/bom_path + Task8 store/index/panel/raycast)、**零件与部件统一入口**(Task9) —— §2/§4.5 全部有对应任务。§6 两大风险 → Task2 + Task10。§7 测试策略 → 各任务 TDD + Task10 端到端(含双向对齐验证)。
- **类型一致**：`cad_instances` 元素结构 `{matrix, source, label}` 在 Task1/4/6 一致；`glb_urls{coarse,normal,fine}` 在 Task5/6/7/8 一致；`bom_path: string[]` 在 Task6(crud) ↔ Task7(DTO) ↔ Task8(interface/index) 一致；`AssemblyTreeNode` 字段在 Task6(crud) ↔ Task7(DTO) ↔ Task8(前端 interface/panel) 一致；`assemblyViewerStore` 的 `selectBomItem`/`toggleHidden` 在 store/panel/scene 三处调用名一致。
- **待环境校准点（已在正文标注）**：Task3 `GetReferredShape` 签名、Task7 权限名与鉴权 override 写法、Task8 矩阵主序 `.transpose()` 与轴系符号、Task9 单件 `STPViewer` 组件名/prop 签名 → 均在 Task10 或对齐现有代码时收口。
