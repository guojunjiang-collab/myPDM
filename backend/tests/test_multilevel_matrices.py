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


def test_top_level_name_mismatch_uses_target_assembly(db):
    """STEP 顶层装配名与 myPDM 目标件号不一致(如 NX 导出名 '起落架-solidworks_step')时，
    顶层直接子件的父就是本次导入的目标装配，应按目标件号匹配并回填。"""
    _, asm_r, asm_it = _mk(db, "ASM")
    _, leaf_r, _ = _mk(db, "LEAF")
    link = _link(db, asm_it, asm_r, leaf_r)
    parsed = {"unit": "mm", "occurrences": [
        {"name": "LEAF", "parent_name": "ASM_EXPORTED_NAME",
         "local_matrix": [1,0,0,5000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    crud_parts.apply_step_matrices(db, asm_r.id, parsed)
    db.refresh(link)
    assert link.cad_instances[0]["matrix"][3] == 5.0
