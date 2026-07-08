# 装配 STEP 逐子项拆分 + 多层级矩阵回填 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在装配 STEP 导入(`import-assembly-step`)时，一趟解析同时做两件事：把 BOM 树**各级**父→子局部矩阵回填到对应 BOMItem(始终写)；把每个**唯一**子项(叶件/子装配)用纯 Python STEP 子集提取拆成独立 STEP，存为该子项的生产附件 `件号.STEP`(草稿+当前用户检出才写、同名替换、不转 GLB)。装配自身 STEP 只作解析源、用完即弃。

**Architecture:** 纯 Python：`assembly_parser` 增加"结构索引"(实体原始文本 + 产品名→PD + PD→shape rep + NAUO 父子 PD 图)；新 `step_splitter` 用引用图可达性闭包 + 重编号，把一个根 PD 的子树几何输出为自包含 STEP；`crud_parts.apply_step_matrices` 改多层级 `(父码,子码)` 匹配；新 `crud_parts.generate_subitem_steps` 去重+门槛+同名替换写生产附件；路由去掉"存装配自身"、改调子项拆分。

**Tech Stack:** FastAPI + SQLAlchemy(PostgreSQL/测试 SQLite) + 纯 Python STEP 文本处理。无新外部依赖。

---

## 设计依据

Spec：`docs/superpowers/specs/2026-07-08-assembly-step-subitem-split-design.md`

## 文件结构

- 修改 `backend/app/schemas_parts.py` — `MatchReport` 增加 `generated / skipped_not_editable / failed`。
- 修改 `backend/app/cad/assembly_parser.py` — 新增 `build_structure_index(content)` 暴露原始文本 + 索引。
- 新建 `backend/app/cad/step_splitter.py` — `split_subitem_step(index, root_pd_id, file_label)`(闭包+重编号+写出)。
- 修改 `backend/app/crud_parts.py` — `apply_step_matrices` 改多层级；新增 `generate_subitem_steps`。
- 修改 `backend/app/routers/parts.py` — `import_assembly_step` 去掉存装配自身、接子项拆分、返回扩展报告。
- 新建测试：`test_step_structure_index.py`、`test_step_splitter.py`、`test_multilevel_matrices.py`、`test_generate_subitem_steps.py`。

## 约定

- 后端测试：`cd backend && python -m pytest tests/<file>::<test> -v`。DB 用 conftest 内存 SQLite `db`。
- 矩阵行主序 16 元素、单位归一化为米(复用 `matrix_utils`)。
- 引用图/重编号用 STEP 实体的**完整语句原文** `#id = TYPE(...);`，正则 `#(\d+)` 取引用。

---

## Task 1: MatchReport 扩展

**Files:**
- Modify: `backend/app/schemas_parts.py:149-152`
- Test: `backend/tests/test_generate_subitem_steps.py`（本任务只加 schema，测试在 Task 5 补全；此处加最小断言）

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_generate_subitem_steps.py`：

```python
from app.schemas_parts import MatchReport


def test_match_report_has_split_fields():
    r = MatchReport(matched=[], unmatched=[], multi_instance=[],
                    generated=["A"], skipped_not_editable=["B"], failed=["C"])
    assert r.generated == ["A"]
    assert r.skipped_not_editable == ["B"]
    assert r.failed == ["C"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_generate_subitem_steps.py::test_match_report_has_split_fields -v`
Expected: FAIL（unexpected keyword argument）

- [ ] **Step 3: 扩展 schema**

修改 `backend/app/schemas_parts.py` 的 `MatchReport`：

```python
class MatchReport(BaseModel):
    matched: List[str]
    unmatched: List[str]
    multi_instance: List[str]
    generated: List[str] = []              # 成功拆出 STEP 的件号(去重)
    skipped_not_editable: List[str] = []   # 非草稿/未检出跳过
    failed: List[str] = []                 # 子集提取/写盘失败
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_generate_subitem_steps.py::test_match_report_has_split_fields -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas_parts.py backend/tests/test_generate_subitem_steps.py
git commit -m "feat(split): MatchReport 增加子项拆分结果字段"
```

---

## Task 2: 解析器暴露结构索引

**Files:**
- Modify: `backend/app/cad/assembly_parser.py`（追加，不动现有 `parse_assembly_step`）
- Test: `backend/tests/test_step_structure_index.py`

`build_structure_index` 复用 `_extract_entities`，额外提供：每实体完整语句原文、`header`、产品名→根 PD、PD→shape rep、NAUO 父 PD→子 PD 列表。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_step_structure_index.py`：

```python
from app.cad.assembly_parser import build_structure_index

# 最小合成 STEP：一个产品 P1，PD #10，shape rep #30
MINI = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('a.step','',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('P1','P1','',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#3=APPLICATION_CONTEXT('core');
#5=PRODUCT_DEFINITION_FORMATION('','',#1);
#10=PRODUCT_DEFINITION('','',#5,#6);
#6=PRODUCT_DEFINITION_CONTEXT('',#3,'design');
#20=PRODUCT_DEFINITION_SHAPE('','',#10);
#25=SHAPE_DEFINITION_REPRESENTATION(#20,#30);
#30=SHAPE_REPRESENTATION('',(#31),#40);
#31=AXIS2_PLACEMENT_3D('',#32,$,$);
#32=CARTESIAN_POINT('',(0.,0.,0.));
#40=(GEOMETRIC_REPRESENTATION_CONTEXT(3));
ENDSEC;
END-ISO-10303-21;
"""


def test_structure_index_basic():
    idx = build_structure_index(MINI)
    # 原始语句可取回，且含引用
    assert idx.raw_by_id[10].startswith('#10=PRODUCT_DEFINITION')
    assert '#5' in idx.raw_by_id[10]
    # 产品名 → 根 PD
    assert idx.root_pd_by_product_name['P1'] == 10
    # PD → shape rep
    assert idx.shape_rep_by_pd[10] == 30
    # header 保留
    assert 'FILE_SCHEMA' in idx.header


def test_refs_of_parses_all_ids():
    from app.cad.assembly_parser import refs_of
    assert refs_of('#30=SHAPE_REPRESENTATION(\\'\\',(#31),#40);') == {31, 40}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_step_structure_index.py -v`
Expected: FAIL（`build_structure_index` 不存在）

- [ ] **Step 3: 实现**

在 `backend/app/cad/assembly_parser.py` 末尾追加：

```python
import re as _re2
from dataclasses import dataclass, field


# 完整语句：#id = ... 到分号（支持跨行）
_RE_FULL_STMT = _re2.compile(r'#(\d+)\s*=\s*(.*?);', _re2.DOTALL)
_RE_REF = _re2.compile(r'#(\d+)')


def refs_of(stmt: str) -> set:
    """取语句里引用的全部实体 id（跳过自身定义的 id）。"""
    ids = [int(x) for x in _RE_REF.findall(stmt)]
    return set(ids[1:]) if ids else set()  # 第一个是自身 id


@dataclass
class StructureIndex:
    header: str
    raw_by_id: dict                          # id -> 完整语句 '#id=...;'
    root_pd_by_product_name: dict            # 产品名 -> 根 PRODUCT_DEFINITION id
    shape_rep_by_pd: dict                    # PD id -> SHAPE_REPRESENTATION id
    child_pds_by_parent_pd: dict = field(default_factory=dict)  # 父PD -> [子PD...]
    nauo_ids: list = field(default_factory=list)                # 全部 NAUO 语句 id


def build_structure_index(content: str) -> StructureIndex:
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    entities = _extract_entities(content)

    # header：ISO 行到 DATA; 之前
    m = _re2.search(r'HEADER;(.*?)ENDSEC;', content, _re2.DOTALL)
    header = m.group(0) if m else "HEADER;\nENDSEC;"

    # 完整语句原文
    raw_by_id = {}
    for mm in _RE_FULL_STMT.finditer(content):
        raw_by_id[int(mm.group(1))] = f"#{mm.group(1)}={mm.group(2).strip()};"

    # 产品名 -> product id -> PD id
    products = {}          # product id -> name
    pd_to_product = {}     # PD id -> product id
    for eid, (etype, args) in entities.items():
        if etype == 'PRODUCT' and len(args) >= 1:
            products[eid] = _decode_step_string(str(args[0]))
        elif etype == 'PRODUCT_DEFINITION' and len(args) >= 3:
            fid = _ref_id(_ref_str(args[2]))
            fent = entities.get(fid) if fid else None
            if fent and fent[0] in ('PRODUCT_DEFINITION_FORMATION',
                                    'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE'):
                pref = _ref_id(_ref_str(fent[1][-1]))
                if pref:
                    pd_to_product[eid] = pref
    root_pd_by_product_name = {}
    for pd_id, prod_id in pd_to_product.items():
        nm = products.get(prod_id)
        if nm:
            root_pd_by_product_name.setdefault(nm, pd_id)

    # PD -> shape rep（复用现有 _find_shape_representation）
    shape_rep_by_pd = {}
    for pd_id in pd_to_product:
        sr = _find_shape_representation(pd_id, entities)
        if sr:
            shape_rep_by_pd[pd_id] = sr

    # NAUO 父 PD -> 子 PD
    child_pds_by_parent_pd = {}
    nauo_ids = []
    for eid, (etype, args) in entities.items():
        if etype == 'NEXT_ASSEMBLY_USAGE_OCCURRENCE' and len(args) >= 5:
            nauo_ids.append(eid)
            parent_pd = _ref_id(_ref_str(args[3]))
            child_pd = _ref_id(_ref_str(args[4]))
            if parent_pd and child_pd:
                child_pds_by_parent_pd.setdefault(parent_pd, []).append(child_pd)

    return StructureIndex(
        header=header, raw_by_id=raw_by_id,
        root_pd_by_product_name=root_pd_by_product_name,
        shape_rep_by_pd=shape_rep_by_pd,
        child_pds_by_parent_pd=child_pds_by_parent_pd,
        nauo_ids=nauo_ids,
    )
```

> 注：不同 CAD 的 PRODUCT/PD 参数顺序略有差异；若 `root_pd_by_product_name` 为空，按 Task 7 用真实文件校准 `args` 下标。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_step_structure_index.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/cad/assembly_parser.py backend/tests/test_step_structure_index.py
git commit -m "feat(split): 解析器暴露结构索引(原文/产品→PD/PD→shape/NAUO图)"
```

---

## Task 3: STEP 子集提取器

**Files:**
- Create: `backend/app/cad/step_splitter.py`
- Test: `backend/tests/test_step_splitter.py`

统一算法：根 PD → included PD 集合(根 + NAUO 后代) → 种子(各 PD 的结构语句 + shape rep + 父子都在集合内的 NAUO) → 前向可达闭包 → 重编号 → 套 header 写出。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_step_splitter.py`：

```python
from app.cad.assembly_parser import build_structure_index
from app.cad.step_splitter import split_subitem_step
from tests.test_step_structure_index import MINI


def test_split_leaf_is_self_contained():
    idx = build_structure_index(MINI)
    root_pd = idx.root_pd_by_product_name['P1']
    out = split_subitem_step(idx, root_pd, 'P1.STEP')

    # 合法外壳
    assert out.startswith('ISO-10303-21;')
    assert 'DATA;' in out and 'END-ISO-10303-21;' in out
    # 无悬空引用：出现的每个 #N 都在文件内被定义
    import re
    defined = set(re.findall(r'(?m)^#(\d+)\s*=', out))
    used = set(re.findall(r'#(\d+)', out))
    assert used.issubset(defined), f"悬空引用: {used - defined}"
    # 几何仍在（重编号后 CARTESIAN_POINT 应出现）
    assert 'CARTESIAN_POINT' in out
    # 重编号从 #1 起
    assert '#1=' in out.replace(' ', '')


def test_split_reparseable():
    # 拆出的叶件 STEP 应能被 parse_assembly_step 读取而不抛异常
    from app.cad.assembly_parser import parse_assembly_step
    import tempfile, os
    idx = build_structure_index(MINI)
    out = split_subitem_step(idx, idx.root_pd_by_product_name['P1'], 'P1.STEP')
    fd, path = tempfile.mkstemp(suffix='.step')
    os.close(fd)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        result = parse_assembly_step(path)  # 不抛异常即可
        assert result['unit'] == 'mm'
    finally:
        os.unlink(path)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_step_splitter.py -v`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `backend/app/cad/step_splitter.py`：

```python
"""纯 Python STEP 子集提取：把一个根 PRODUCT_DEFINITION 的子树几何输出为自包含 STEP。"""
from __future__ import annotations
from typing import List
from .assembly_parser import StructureIndex, refs_of


def _included_pds(index: StructureIndex, root_pd: int) -> set:
    """根 PD + 经 NAUO 可达的全部下级 PD（叶件→仅自身）。"""
    seen = set()
    stack = [root_pd]
    while stack:
        pd = stack.pop()
        if pd in seen:
            continue
        seen.add(pd)
        for c in index.child_pds_by_parent_pd.get(pd, []):
            if c not in seen:
                stack.append(c)
    return seen


def split_subitem_step(index: StructureIndex, root_pd: int, file_label: str) -> str:
    """输出以 root_pd 为根的自包含 STEP 文本。"""
    pds = _included_pds(index, root_pd)

    # 种子：included PD 的结构语句 + 其 shape rep；父子都在集合内的 NAUO
    seeds = set()
    for pd in pds:
        if pd in index.raw_by_id:
            seeds.add(pd)
        sr = index.shape_rep_by_pd.get(pd)
        if sr:
            seeds.add(sr)
    for nid in index.nauo_ids:
        stmt = index.raw_by_id.get(nid, '')
        ref_ids = refs_of(stmt)
        # NAUO 引用里若父、子 PD 都在集合内 → 保留该装配关系
        if len(pds & ref_ids) >= 2:
            seeds.add(nid)

    # 前向可达闭包
    included = set()
    stack = list(seeds)
    while stack:
        eid = stack.pop()
        if eid in included or eid not in index.raw_by_id:
            continue
        included.add(eid)
        for r in refs_of(index.raw_by_id[eid]):
            if r not in included:
                stack.append(r)

    # 重编号：旧 id 升序 → #1..#N
    old_ids = sorted(included)
    remap = {old: new for new, old in enumerate(old_ids, start=1)}

    import re
    def _renumber(stmt: str) -> str:
        # 替换所有 #old → #new（含自身定义 id）
        return re.sub(r'#(\d+)', lambda m: f"#{remap.get(int(m.group(1)), m.group(1))}", stmt)

    body_lines = [_renumber(index.raw_by_id[old]) for old in old_ids]

    # header：把 FILE_NAME 第一字段换成 file_label
    header = re.sub(r"FILE_NAME\('[^']*'", f"FILE_NAME('{file_label}'", index.header, count=1)

    return (
        "ISO-10303-21;\n"
        + header.strip() + "\n"
        + "DATA;\n"
        + "\n".join(body_lines) + "\n"
        + "ENDSEC;\n"
        + "END-ISO-10303-21;\n"
    )
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_step_splitter.py -v`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add backend/app/cad/step_splitter.py backend/tests/test_step_splitter.py
git commit -m "feat(split): 纯Python STEP 子集提取(闭包+重编号+写出)"
```

---

## Task 4: 多层级矩阵回填

**Files:**
- Modify: `backend/app/crud_parts.py:850-917`（重写 `apply_step_matrices`）
- Test: `backend/tests/test_multilevel_matrices.py`

按 `(parent_code, child_code)` 匹配 BOM 树**任意层级**的 BOMItem。

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_multilevel_matrices.py`：

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


def _link(db, parent_it, parent_rev, child_rev):
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=parent_it.id,
                       parent_revision_id=parent_rev.id, child_revision_id=child_rev.id,
                       quantity=1, sort_order=0, cad_instances=[])
    db.add(b); db.commit()
    return b


def test_matrix_backfilled_at_all_levels(db):
    # ASM -> SUB -> LEAF
    _, asm_r, asm_it = _mk(db, "ASM")
    _, sub_r, sub_it = _mk(db, "SUB")
    _, leaf_r, _ = _mk(db, "LEAF")
    top = _link(db, asm_it, asm_r, sub_r)     # ASM→SUB
    deep = _link(db, sub_it, sub_r, leaf_r)   # SUB→LEAF

    parsed = {"unit": "mm", "occurrences": [
        {"name": "SUB", "parent_name": "ASM",
         "local_matrix": [1,0,0,1000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
        {"name": "LEAF", "parent_name": "SUB",
         "local_matrix": [1,0,0,0, 0,1,0,2000, 0,0,1,0, 0,0,0,1]},
    ]}
    crud_parts.apply_step_matrices(db, asm_r.id, parsed)

    db.refresh(top); db.refresh(deep)
    assert top.cad_instances[0]["matrix"][3] == 1.0     # mm→m
    assert deep.cad_instances[0]["matrix"][7] == 2.0     # 深层也回填了


def test_same_child_name_disambiguated_by_parent(db):
    # ASM 下有 SUBA、SUBB，各挂一个都叫 SCREW 的子件（不同版本）
    _, asm_r, asm_it = _mk(db, "ASM2")
    _, suba_r, suba_it = _mk(db, "SUBA")
    _, subb_r, subb_it = _mk(db, "SUBB")
    _, s1_r, _ = _mk(db, "SCREW")   # 注意：件号相同的两个版本用不同 master
    m2 = models_parts.PartMaster(id=uuid.uuid4(), code="SCREW", name="SCREW", type="part")
    db.add(m2); db.commit()
    s2_r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m2.id, version="A", latest_iteration=1)
    db.add(s2_r); db.commit()
    s2_it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=s2_r.id, iteration=1)
    db.add(s2_it); db.commit()

    _link(db, asm_it, asm_r, suba_r)
    _link(db, asm_it, asm_r, subb_r)
    la = _link(db, suba_it, suba_r, s1_r)   # SUBA→SCREW
    lb = _link(db, subb_it, subb_r, s2_r)   # SUBB→SCREW

    parsed = {"unit": "mm", "occurrences": [
        {"name": "SCREW", "parent_name": "SUBA",
         "local_matrix": [1,0,0,7000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
        {"name": "SCREW", "parent_name": "SUBB",
         "local_matrix": [1,0,0,9000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    crud_parts.apply_step_matrices(db, asm_r.id, parsed)
    db.refresh(la); db.refresh(lb)
    assert la.cad_instances[0]["matrix"][3] == 7.0    # SUBA 下的没串到 SUBB
    assert lb.cad_instances[0]["matrix"][3] == 9.0
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_multilevel_matrices.py -v`
Expected: FAIL（当前只匹配顶层，deep/消歧断言不过）

- [ ] **Step 3: 重写 apply_step_matrices**

把 `backend/app/crud_parts.py` 的 `apply_step_matrices`（850-917 行整体）替换为：

```python
def apply_step_matrices(db: Session, assembly_revision_id, parsed: dict) -> dict:
    """多层级：按 (父件号, 子件号) 匹配 BOM 树任意层级的 BOMItem 并回填矩阵。始终写。"""
    from sqlalchemy.orm.attributes import flag_modified

    # 递归收集 BOM 树全部 BOMItem，建 (parent_code, child_code) -> BOMItem 索引
    index = {}
    all_items = []

    def walk(rev_id, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        it = _current_iteration(db, rev_id)
        if not it:
            return
        parent_rev = get_part_revision(db, rev_id)
        parent_master = get_part_master(db, parent_rev.master_id) if parent_rev else None
        links = (db.query(models.BOMItem)
                 .filter(models.BOMItem.iteration_id == it.id,
                         models.BOMItem.deleted_at.is_(None)).all())
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            child_master = get_part_master(db, child_rev.master_id)
            if parent_master and child_master:
                index.setdefault((parent_master.code, child_master.code), link)
                index.setdefault((parent_master.name, child_master.name), link)
            all_items.append(link)
            walk(child_rev.id, visited)

    walk(assembly_revision_id, set())

    # 幂等：先清各 BOMItem 里 source=='step' 的旧矩阵
    touched = set()
    for item in all_items:
        kept = [c for c in (item.cad_instances or []) if c.get("source") != "step"]
        if kept != (item.cad_instances or []):
            item.cad_instances = kept
            touched.add(item.id)

    matched, unmatched = [], []
    per_item_count = {}
    for occ in parsed.get("occurrences", []):
        cname = occ.get("name")
        pname = occ.get("parent_name")
        item = index.get((pname, cname)) if pname else None
        if not item:
            unmatched.append(cname)
            continue
        norm = _mu.normalize_translation_mm_to_m(occ["local_matrix"])
        instances = list(item.cad_instances or [])
        instances.append({"matrix": norm, "source": "step", "label": cname})
        item.cad_instances = instances
        touched.add(item.id)
        matched.append(cname)
        per_item_count[item.id] = per_item_count.get(item.id, 0) + 1

    for item in all_items:
        if item.id in touched:
            flag_modified(item, "cad_instances")
    db.commit()

    multi_names = []
    for item in all_items:
        if per_item_count.get(item.id, 0) > 1:
            cr = get_part_revision(db, item.child_revision_id)
            m = get_part_master(db, cr.master_id) if cr else None
            if m:
                multi_names.append(m.code)

    return {"matched": matched, "unmatched": unmatched, "multi_instance": multi_names}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_multilevel_matrices.py -v`
Expected: PASS（2 个）

- [ ] **Step 5: 回归**

Run: `cd backend && python -m pytest tests/test_assembly_instances.py tests/test_apply_step_matrices.py -v`
Expected: PASS（若 `test_apply_step_matrices.py` 旧用例依赖"仅按子名匹配"，按新 (父,子) 语义更新其 parsed 里的 `parent_name`）

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_parts.py backend/tests/test_multilevel_matrices.py
git commit -m "feat(split): 矩阵回填改多层级(父码,子码)匹配"
```

---

## Task 5: 子项 STEP 生成(去重+门槛+同名替换)

**Files:**
- Modify: `backend/app/crud_parts.py`（追加 `generate_subitem_steps`）
- Test: `backend/tests/test_generate_subitem_steps.py`（续 Task 1 文件）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_generate_subitem_steps.py` 追加：

```python
import uuid, os
from app import models, models_parts, crud_parts


def _mk(db, code, status="draft", checkout=None):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A",
                                  latest_iteration=1, status=status, check_out_user_id=checkout)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def _link(db, pit, pr, cr):
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=pit.id, parent_revision_id=pr.id,
                       child_revision_id=cr.id, quantity=1, sort_order=0, cad_instances=[])
    db.add(b); db.commit(); return b


# 假拆分器：不真跑几何，返回可辨识文本；用 monkeypatch 注入
def _fake_split(index, root_pd, label):
    return f"ISO-10303-21;\n// {label}\nEND-ISO-10303-21;\n"


def test_generates_for_draft_checked_out_only(db, monkeypatch, tmp_path):
    user = uuid.uuid4()
    _, asm_r, asm_it = _mk(db, "ASM", status="draft", checkout=user)
    _, edit_r, _ = _mk(db, "EDITABLE", status="draft", checkout=user)     # 可写
    _, rel_r, _ = _mk(db, "RELEASED", status="released", checkout=None)   # 跳过
    _link(db, asm_it, asm_r, edit_r)
    _link(db, asm_it, asm_r, rel_r)

    # index：产品名 → 假 root_pd（EDITABLE/RELEASED 都能定位）
    class Idx:
        root_pd_by_product_name = {"EDITABLE": 1, "RELEASED": 2}
    monkeypatch.setattr(crud_parts, "_split_subitem_step_impl", _fake_split, raising=False)
    monkeypatch.setattr(crud_parts, "_uploads_root", str(tmp_path), raising=False)

    report = crud_parts.generate_subitem_steps(db, asm_r.id, Idx(), current_user_id=user)
    assert report["generated"] == ["EDITABLE"]
    assert report["skipped_not_editable"] == ["RELEASED"]


def test_same_name_replace_and_no_glb(db, monkeypatch, tmp_path):
    user = uuid.uuid4()
    _, asm_r, asm_it = _mk(db, "ASM2", status="draft", checkout=user)
    _, p_r, p_it = _mk(db, "P", status="draft", checkout=user)
    _link(db, asm_it, asm_r, p_r)

    class Idx:
        root_pd_by_product_name = {"P": 1}
    monkeypatch.setattr(crud_parts, "_split_subitem_step_impl", _fake_split, raising=False)
    monkeypatch.setattr(crud_parts, "_uploads_root", str(tmp_path), raising=False)
    calls = {"glb": 0}
    monkeypatch.setattr(crud_parts, "_trigger_glb", lambda *a, **k: calls.__setitem__("glb", calls["glb"] + 1), raising=False)

    crud_parts.generate_subitem_steps(db, asm_r.id, Idx(), current_user_id=user)
    crud_parts.generate_subitem_steps(db, asm_r.id, Idx(), current_user_id=user)  # 再来一次

    atts = (db.query(models_parts.PartAttachment)
            .filter(models_parts.PartAttachment.iteration_id == p_it.id,
                    models_parts.PartAttachment.category == "production",
                    models_parts.PartAttachment.file_name == "P.STEP").all())
    assert len(atts) == 1          # 同名替换：只留一份
    assert calls["glb"] == 0       # 不触发 GLB
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_generate_subitem_steps.py -v`
Expected: FAIL（`generate_subitem_steps` 不存在）

- [ ] **Step 3: 实现**

在 `backend/app/crud_parts.py` 追加（顶部已有 `models`/`models_parts`/`os` 视情况 import；此处显式）：

```python
import os as _os_split
import hashlib as _hashlib_split

_uploads_root = "./uploads"


def _split_subitem_step_impl(index, root_pd, label):
    from .cad.step_splitter import split_subitem_step
    return split_subitem_step(index, root_pd, label)


def _trigger_glb(*args, **kwargs):
    """占位：本特性写入不转 GLB（预览时懒转）。保留以便测试断言不被调用。"""
    return None


def generate_subitem_steps(db: Session, assembly_revision_id, structure_index, current_user_id) -> dict:
    """遍历唯一子项，草稿+当前用户检出者拆出 件号.STEP 写生产附件(同名替换、不转GLB)。"""
    generated, skipped, unmatched, failed = [], [], [], []
    seen_rev = set()

    def walk(rev_id, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        it = _current_iteration(db, rev_id)
        if not it:
            return
        links = (db.query(models.BOMItem)
                 .filter(models.BOMItem.iteration_id == it.id,
                         models.BOMItem.deleted_at.is_(None)).all())
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev or child_rev.id in seen_rev:
                continue
            seen_rev.add(child_rev.id)
            _process(child_rev)
            walk(child_rev.id, visited)

    def _process(child_rev):
        master = get_part_master(db, child_rev.master_id)
        if not master:
            return
        code = master.code
        root_pd = getattr(structure_index, "root_pd_by_product_name", {}).get(code) \
            or getattr(structure_index, "root_pd_by_product_name", {}).get(master.name)
        if root_pd is None:
            unmatched.append(code)
            return
        # 门槛：草稿 且 当前用户已检出
        if not (child_rev.status == "draft"
                and str(child_rev.check_out_user_id or "") == str(current_user_id)):
            skipped.append(code)
            return
        child_it = _current_iteration(db, child_rev.id)
        if not child_it:
            skipped.append(code)
            return
        fname = f"{code}.STEP"
        try:
            text = _split_subitem_step_impl(structure_index, root_pd, fname)
        except Exception:
            failed.append(code)
            return
        # 同名替换：删旧记录 + 文件 + glb 缓存
        olds = (db.query(models_parts.PartAttachment)
                .filter(models_parts.PartAttachment.iteration_id == child_it.id,
                        models_parts.PartAttachment.category == "production",
                        models_parts.PartAttachment.file_name == fname).all())
        for old in olds:
            try:
                if old.file_path and _os_split.path.exists(old.file_path):
                    _os_split.remove(old.file_path)
            except OSError:
                pass
            try:
                from .stp_converter import delete_glb_cache
                delete_glb_cache(str(old.id), old.file_path)
            except Exception:
                pass
            db.delete(old)
        db.commit()
        # 写新文件
        upload_dir = f"{_uploads_root}/parts/{code}/{child_rev.version}/{child_it.iteration}"
        _os_split.makedirs(upload_dir, exist_ok=True)
        fpath = _os_split.path.join(upload_dir, fname)
        data = text.encode("utf-8")
        with open(fpath, "wb") as f:
            f.write(data)
        att = models_parts.PartAttachment(
            iteration_id=child_it.id, category="production", file_name=fname,
            file_size=len(data), file_path=fpath,
            file_hash=_hashlib_split.sha256(data).hexdigest(),
        )
        db.add(att); db.commit()
        # 不触发 GLB（预览时懒转）
        generated.append(code)

    walk(assembly_revision_id, set())
    return {"generated": generated, "skipped_not_editable": skipped,
            "unmatched": unmatched, "failed": failed}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_generate_subitem_steps.py -v`
Expected: PASS（3 个：schema + 两个行为）

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_parts.py backend/tests/test_generate_subitem_steps.py
git commit -m "feat(split): 子项STEP生成(去重+门槛+同名替换+不转GLB)"
```

---

## Task 6: 路由接入（去掉存装配自身，接子项拆分）

**Files:**
- Modify: `backend/app/routers/parts.py:863-919`

- [ ] **Step 1: 替换路由体**

把 `import_assembly_step`（863-919 行）改为：解析 → 结构索引 → 多层级矩阵 → 子项拆分；**删除**原"保存装配 STEP 为生产附件"整块。

```python
@router.post("/revisions/{revision_id}/import-assembly-step", response_model=MatchReport)
async def import_assembly_step(
    revision_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    """上传装配 STEP（仅作解析源）：多层级矩阵回填 + 逐子项拆分为生产附件。不存装配自身。"""
    content = await file.read()
    suffix = _os.path.splitext(file.filename or "a.step")[1] or ".step"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        parsed = parse_assembly_step(tmp_path)
        from ..cad.assembly_parser import build_structure_index
        text = content.decode("utf-8", errors="ignore")
        index = build_structure_index(text)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    finally:
        _os.unlink(tmp_path)

    report = crud_parts.apply_step_matrices(db, revision_id, parsed)
    split = crud_parts.generate_subitem_steps(db, revision_id, index, current_user.id)
    report.update(split)   # 合并 generated/skipped_not_editable/failed；unmatched 取拆分侧更准
    return report
```

> `report` 与 `split` 都有 `unmatched`：以矩阵侧为主键、用 `report.update(split)` 会让拆分侧覆盖；若要并集，改为 `report["unmatched"] = sorted(set(report["unmatched"]) | set(split["unmatched"]))` 再 update 其余字段。实现时二选一并保持 MatchReport 字段齐全。

- [ ] **Step 2: 集成测试（TestClient + 依赖覆盖）**

在 `backend/tests/test_generate_subitem_steps.py` 追加一个走路由的冒烟（参照 `tests/test_assembly_routes.py` 的鉴权 override 写法），断言返回 JSON 含 `generated/skipped_not_editable/failed` 键。

```python
def test_import_route_returns_split_report(db, engineer_user, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db as _get_db
    from app.permissions import require_permission
    import uuid, io

    _, asm_r, _ = _mk(db, "ASMR", status="draft", checkout=engineer_user.id)
    app.dependency_overrides[_get_db] = lambda: (yield db)
    app.dependency_overrides[require_permission("components:update")] = lambda: engineer_user
    monkeypatch.setattr(crud_parts, "_uploads_root", str(tmp_path), raising=False)
    try:
        client = TestClient(app)
        files = {"file": ("a.step", io.BytesIO(b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"), "application/step")}
        resp = client.post(f"/api/parts/revisions/{asm_r.id}/import-assembly-step", files=files)
        assert resp.status_code == 200
        body = resp.json()
        assert "generated" in body and "skipped_not_editable" in body and "failed" in body
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 3: 运行**

Run: `cd backend && python -m pytest tests/test_generate_subitem_steps.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/parts.py backend/tests/test_generate_subitem_steps.py
git commit -m "feat(split): import-assembly-step 接子项拆分,去掉存装配自身"
```

---

## Task 7: 端到端校准（真实装配）— 人工验证

**Files:** 无代码产物（可能微调 Task 2 的 PRODUCT/PD 下标、Task 3 的种子规则）

- [ ] **Step 1: 准备真实两级装配**：其零件都已在 myPDM 建档、草稿且当前用户检出；有一个已发布子件用于验证跳过。

- [ ] **Step 2: 导入装配 STEP**，看返回报告：`matched`(各级矩阵)、`generated`(拆出的件号)、`skipped_not_editable`(已发布件)、`unmatched`/`failed`。

- [ ] **Step 3: 核对四点**
  1. **各级矩阵**：顶层与子装配内部的 BOMItem 都有 `cad_instances`（装配 3D 预览摆位正确）。
  2. **拆出单件**：叶件生产附件 `件号.STEP` 可单独"3D预览"（首次触发懒转 GLB）。
  3. **拆出子装配**：子装配 `件号.STEP` 重新导入/预览时结构完整（含下级）。
  4. **门槛/替换**：已发布件被跳过；重复导入同名只留一份；导入当下未批量转 GLB。

- [ ] **Step 4: 按现象修正**
  - 拆出文件缺件/悬空引用 → 调 Task 3 种子（NAUO/关系实体纳入规则）。
  - `root_pd_by_product_name` 为空 → 调 Task 2 PRODUCT/PD 参数下标。
  - 子装配散架 → 确认 NAUO 及其 IDT/placement 已纳入闭包。

- [ ] **Step 5: 记录结论**到 spec §7，commit。

---

## 自检回顾（写作者已核对）

- **Spec 覆盖**：多层级矩阵始终写(Task4)、纯Python子集提取(Task2/3)、去重(Task5 seen_rev)、门槛草稿+当前用户检出(Task5)、同名替换(Task5)、不转GLB(Task5 `_trigger_glb` 不调 + 断言)、装配自身不落库(Task6 删除原保存块)、手动附件上传不触发(不改 `add_attachment`，Task6 只改 import 路由)、报告扩展(Task1)。
- **类型一致**：`MatchReport` 字段(Task1) ↔ 路由 `report.update(split)`(Task6) ↔ `generate_subitem_steps` 返回键(Task5) 一致；`StructureIndex.root_pd_by_product_name`(Task2) ↔ splitter(Task3) ↔ generate(Task5) 一致；`split_subitem_step(index, root_pd, label)` 签名三处一致。
- **待环境校准点（已标注）**：Task2 CAD 参数下标、Task3 子装配闭包种子规则、Task4 旧 `test_apply_step_matrices` 需补 `parent_name` → 均在 Task7 或对齐现有测试时收口。
```
