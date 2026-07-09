"""纯 Python STEP 子集提取：把一个根 PRODUCT_DEFINITION 的子树几何输出为自包含 STEP。"""
from __future__ import annotations
import re
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
    placement_srs = set()
    for pd in pds:
        if pd in index.raw_by_id:
            seeds.add(pd)
        sr = index.shape_rep_by_pd.get(pd)
        if sr:
            seeds.add(sr)
            placement_srs.add(sr)
    for nid in index.nauo_ids:
        stmt = index.raw_by_id.get(nid, '')
        ref_ids = refs_of(stmt)
        # NAUO 引用里若父、子 PD 都在集合内 → 保留该装配关系
        if len(pds & ref_ids) >= 2:
            seeds.add(nid)

    # 几何关联：SolidWorks/AP214 里零件的 B-rep 实体几何存于独立的
    # ADVANCED_BREP_SHAPE_REPRESENTATION，通过"纯" SHAPE_REPRESENTATION_RELATIONSHIP
    # 与放置 SHAPE_REPRESENTATION 关联（区别于装配放置用的 ..._WITH_TRANSFORMATION）。
    # 若一条纯关系触及本次 included 的放置 SR，则把关系实体本身 + 两端 representation
    # 一并纳入种子，闭包会自动带出 MANIFOLD_SOLID_BREP 等全部几何。
    for eid, stmt in index.raw_by_id.items():
        if 'SHAPE_REPRESENTATION_RELATIONSHIP' in stmt and 'WITH_TRANSFORMATION' not in stmt:
            rel_refs = refs_of(stmt)
            if rel_refs & placement_srs:
                seeds.add(eid)
                seeds |= rel_refs

    # 前向可达闭包
    def _forward(seedset: set) -> set:
        inc = set()
        stack = list(seedset)
        while stack:
            eid = stack.pop()
            if eid in inc or eid not in index.raw_by_id:
                continue
            inc.add(eid)
            for r in refs_of(index.raw_by_id[eid]):
                if r not in inc:
                    stack.append(r)
        return inc

    included = _forward(seeds)

    # 反向胶水补全：STEP 的关联/管理实体（PRODUCT_DEFINITION_SHAPE、
    # SHAPE_DEFINITION_REPRESENTATION、SHAPE_REPRESENTATION_RELATIONSHIP、装配变换关系、
    # PRODUCT_RELATED_PRODUCT_CATEGORY、STYLED_ITEM 颜色等）是"反向引用"骨架实体的，
    # 前向闭包抓不到，导致 OpenCASCADE 无法从 PRODUCT_DEFINITION 走到几何(File transfer problem)。
    # 规则：凡"引用的实体全部已在集合内"的语句都纳入(安全——不会引入范围外的兄弟零件)，
    # 迭代至稳定。子装配场景下这会自动带回 NAUO/装配变换，保持内部零件摆位。
    changed = True
    while changed:
        changed = False
        for eid, stmt in index.raw_by_id.items():
            if eid in included:
                continue
            refs = refs_of(stmt)
            if refs and refs <= included:
                included.add(eid)
                changed = True


    # 重编号：旧 id 升序 → #1..#N
    old_ids = sorted(included)
    remap = {old: new for new, old in enumerate(old_ids, start=1)}

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
