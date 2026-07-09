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
