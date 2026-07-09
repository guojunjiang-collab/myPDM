import uuid
from app import models, models_parts, crud_parts


def _mk(db, code):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A",
                                  latest_iteration=1, status="draft")
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def test_checkout_part_copies_custom_fields_no_import_error(db):
    """签出会复制上一迭代自定义字段(走 crud._copy_iteration_custom_fields)，
    该处曾用错误的 'from ..' 相对导入导致 ImportError→500。此处防回归。"""
    _, r, _ = _mk(db, "P1")
    user = uuid.uuid4()
    rev, err = crud_parts.checkout_part(db, r.id, user)
    assert err is None
    assert rev.check_out_user_id == user
    assert rev.latest_iteration == 2


def test_cascade_checkout_assembly(db):
    _, asm_r, asm_it = _mk(db, "ASM")
    _, leaf_r, _ = _mk(db, "LEAF")
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                       parent_revision_id=asm_r.id, child_revision_id=leaf_r.id,
                       quantity=1, sort_order=0, cad_instances=[])
    db.add(b); db.commit()
    user = uuid.uuid4()
    result = crud_parts.cascade_checkout(db, asm_r.id, user)
    assert result["failed_count"] == 0
    assert result["succeed_count"] == 2  # ASM + LEAF


def test_undocheckout_clears_copied_attachments_and_bom(db):
    """撤销签出删新迭代时，必须预先清理复制来的附件和 BOMItem，否则外键报错。"""
    import uuid as _uuid
    from app import models_parts as mp

    _, r, it = _mk(db, "P1")
    # 模拟签出后存在附属数据（_copy_iteration_data 会复制）
    att = mp.PartAttachment(iteration_id=it.id, category="production",
                            file_name="x.STEP", file_size=100, file_path="x")
    db.add(att)
    b = models.BOMItem(id=_uuid.uuid4(), iteration_id=it.id,
                       parent_revision_id=r.id, child_revision_id=r.id,
                       quantity=1, sort_order=0, cad_instances=[])
    db.add(b); db.commit()
    user = _uuid.uuid4()
    # 先签出（会创建 iteration=2 并复制附件/BOM）
    crud_parts.checkout_part(db, r.id, user)
    # 再撤销——应不报错，且回到 iteration=1
    rev, err = crud_parts.undocheckout_part(db, r.id, user)
    assert err is None
    assert rev.latest_iteration == 1
