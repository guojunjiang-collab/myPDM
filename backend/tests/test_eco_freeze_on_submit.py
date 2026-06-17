"""提交审批冻结草稿件 / 撤回驳回解冻 / 冻结-发布件编辑锁。"""
import uuid

import pytest
from fastapi import HTTPException

from app import models, crud
from app.models_eco import ECO
from app import crud_eco


def _part(db, status="draft"):
    p = models.Part(id=uuid.uuid4(), code=f"P-{uuid.uuid4().hex[:6]}", name="part", status=status)
    db.add(p); db.commit(); db.refresh(p)
    return p


def _assembly(db, status="draft"):
    a = models.Assembly(id=uuid.uuid4(), code=f"A-{uuid.uuid4().hex[:6]}", name="asm", status=status)
    db.add(a); db.commit(); db.refresh(a)
    return a


def _bom(db, parent, child, child_type):
    db.add(models.BOMItem(
        id=uuid.uuid4(), parent_type="assembly", parent_id=parent.id,
        child_type=child_type, child_id=child.id, quantity=1,
    ))
    db.commit()


def _eco(db, creator_id, release_items, status="draft", reviewers=None):
    e = ECO(
        id=uuid.uuid4(), eco_number=f"ECO-{uuid.uuid4().hex[:6]}", title="t", reason="r",
        status=status, creator_id=creator_id, release_items=release_items,
        reviewers=reviewers or [],
    )
    db.add(e); db.commit(); db.refresh(e)
    return e


def _tree(db):
    """A(draft) → [P1(draft), C1(frozen 预先), P2(released)];  C1 → [P3(draft), P4(obsolete)]"""
    a = _assembly(db, status="draft")
    p1 = _part(db, status="draft")
    c1 = _assembly(db, status="frozen")   # 提交前就已冻结，非本次系统冻结
    p2 = _part(db, status="released")
    p3 = _part(db, status="draft")
    p4 = _part(db, status="obsolete")
    _bom(db, a, p1, "part")
    _bom(db, a, c1, "component")
    _bom(db, a, p2, "part")
    _bom(db, c1, p3, "part")
    _bom(db, c1, p4, "part")
    return a, p1, c1, p2, p3, p4


def test_freeze_on_submit_reviewing(db, engineer_user):
    a, p1, c1, p2, p3, p4 = _tree(db)
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])

    eco = crud_eco.change_eco_status(db, eco.id, "reviewing", engineer_user.id)

    for ent in (a, p1, p3):
        db.refresh(ent)
        assert ent.status == "frozen"          # 草稿 → 冻结
    db.refresh(c1); assert c1.status == "frozen"   # 预先冻结，保持
    db.refresh(p2); assert p2.status == "released" # 发布，保持
    db.refresh(p4); assert p4.status == "obsolete" # 作废，保持

    # 仅记录本次系统冻结的 3 个（a, p1, p3），不含预先冻结的 c1
    recorded = {(r["entity_type"], r["entity_id"]) for r in eco.frozen_entities}
    assert recorded == {("assembly", str(a.id)), ("part", str(p1.id)), ("part", str(p3.id))}


def test_freeze_on_submit_auto_approve(db, engineer_user):
    a = _assembly(db, status="draft")
    p1 = _part(db, status="draft")
    _bom(db, a, p1, "part")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])

    eco = crud_eco.change_eco_status(db, eco.id, "approved", engineer_user.id)  # 无审批人自动批准

    db.refresh(a); db.refresh(p1)
    assert a.status == "frozen" and p1.status == "frozen"
    assert len(eco.frozen_entities) == 2


def test_unfreeze_on_withdraw(db, engineer_user):
    a, p1, c1, p2, p3, p4 = _tree(db)
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    eco = crud_eco.change_eco_status(db, eco.id, "reviewing", engineer_user.id)

    eco = crud_eco.change_eco_status(db, eco.id, "draft", engineer_user.id)  # 撤回

    for ent in (a, p1, p3):
        db.refresh(ent)
        assert ent.status == "draft"           # 本次冻结的恢复为草稿
    db.refresh(c1); assert c1.status == "frozen"   # 预先冻结的不被误解冻
    assert eco.frozen_entities == []


def test_unfreeze_on_reject_then_draft(db, engineer_user):
    a = _assembly(db, status="draft")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    eco = crud_eco.change_eco_status(db, eco.id, "reviewing", engineer_user.id)
    db.refresh(a); assert a.status == "frozen"

    eco = crud_eco.change_eco_status(db, eco.id, "rejected", engineer_user.id)  # 驳回，仍冻结
    db.refresh(a); assert a.status == "frozen"

    eco = crud_eco.change_eco_status(db, eco.id, "draft", engineer_user.id)     # 退回草稿，解冻
    db.refresh(a); assert a.status == "draft"
    assert eco.frozen_entities == []


@pytest.mark.parametrize("status,should_block", [
    ("draft", False), ("obsolete", False), ("frozen", True), ("released", True),
])
def test_edit_lock_for_engineer(db, status, should_block):
    p = _part(db, status=status)
    if should_block:
        with pytest.raises(HTTPException) as ei:
            crud.assert_entity_editable(db, "part", p.id, "engineer")
        assert ei.value.status_code == 403
    else:
        crud.assert_entity_editable(db, "part", p.id, "engineer")  # 不抛即通过


def test_edit_lock_admin_bypass(db):
    p = _part(db, status="frozen")
    crud.assert_entity_editable(db, "part", p.id, "admin")  # 管理员可改，不抛
    a = _assembly(db, status="released")
    crud.assert_entity_editable(db, "assembly", a.id, "admin")
