"""一键发布：递归遍历 BOM 树，将所有层级零部件置为 released（跳过作废）。"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

from app import models
from app.models_eco import ECO
from app.routers.ecos import publish_all_release_items, get_release_items_publish_status


def _part(db, status="draft"):
    p = models.Component(id=uuid.uuid4(), code=f"P-{uuid.uuid4().hex[:6]}", name="part", status=status)
    db.add(p); db.commit(); db.refresh(p)
    return p


def _assembly(db, status="draft"):
    a = models.Component(id=uuid.uuid4(), code=f"A-{uuid.uuid4().hex[:6]}", name="asm", status=status)
    db.add(a); db.commit(); db.refresh(a)
    return a


def _bom(db, parent, child, child_type):
    db.add(models.BOMItem(
        id=uuid.uuid4(), parent_type="assembly", parent_id=parent.id,
        child_type=child_type, child_id=child.id, quantity=1,
    ))
    db.commit()


def _eco(db, creator_id, release_items, status="executing"):
    e = ECO(
        id=uuid.uuid4(), eco_number=f"ECO-{uuid.uuid4().hex[:6]}", title="t", reason="r",
        status=status, creator_id=creator_id, release_items=release_items,
    )
    db.add(e); db.commit(); db.refresh(e)
    return e


def _call(eco_id, db, user):
    return asyncio.run(publish_all_release_items(eco_id, db=db, current_user=user))


def _status(eco_id, db, user):
    return asyncio.run(get_release_items_publish_status(eco_id, db=db, current_user=user))


def test_recurses_all_levels_and_skips_obsolete(db, engineer_user):
    # A → [P1(草稿), C1(冻结)];  C1 → [P2(作废), P3(已发布)]
    a = _assembly(db, status="draft")
    p1 = _part(db, status="draft")
    c1 = _assembly(db, status="frozen")
    p2 = _part(db, status="obsolete")
    p3 = _part(db, status="released")
    _bom(db, a, p1, "part")
    _bom(db, a, c1, "component")
    _bom(db, c1, p2, "part")
    _bom(db, c1, p3, "part")

    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    result = _call(eco.id, db, engineer_user)

    for ent in (a, p1, c1, p3):
        db.refresh(ent)
        assert ent.status == "released"
    db.refresh(p2)
    assert p2.status == "obsolete"          # 作废跳过
    assert result["published_count"] == 3   # 仅统计实际改变：a, p1, c1（p3 本已 released 不计）

    # 幂等再调用：无状态变化，published_count 应为 0
    again = _call(eco.id, db, engineer_user)
    assert again["published_count"] == 0


def test_handles_cycles(db, engineer_user):
    a = _assembly(db, status="draft")
    b = _assembly(db, status="draft")
    _bom(db, a, b, "component")
    _bom(db, b, a, "component")             # 循环引用，不应死循环
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    result = _call(eco.id, db, engineer_user)
    db.refresh(a); db.refresh(b)
    assert a.status == "released" and b.status == "released"
    assert result["published_count"] == 2


def test_rejects_non_executing(db, engineer_user):
    a = _assembly(db, status="draft")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}], status="approved")
    with pytest.raises(HTTPException) as ei:
        _call(eco.id, db, engineer_user)
    assert ei.value.status_code == 400


def test_rejects_empty_release_items(db, engineer_user):
    eco = _eco(db, engineer_user.id, [], status="executing")
    with pytest.raises(HTTPException) as ei:
        _call(eco.id, db, engineer_user)
    assert ei.value.status_code == 400


# ── 发布状态校验（用于激活/置灰"一键发布"按钮） ──

def test_status_pending_when_deep_subitem_reverted(db, engineer_user):
    # 顶层全部已发布，但深层子项被临时退改为草稿 → 仍应可发布（has_pending=True）
    a = _assembly(db, status="released")
    c1 = _assembly(db, status="released")
    p_deep = _part(db, status="draft")          # 用户临时退改的子项
    _bom(db, a, c1, "component")
    _bom(db, c1, p_deep, "part")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    res = _status(eco.id, db, engineer_user)
    assert res["has_pending"] is True
    assert res["pending_count"] == 1


def test_status_no_pending_when_all_released_or_obsolete(db, engineer_user):
    a = _assembly(db, status="released")
    p1 = _part(db, status="released")
    p2 = _part(db, status="obsolete")           # 作废不计为待发布
    _bom(db, a, p1, "part")
    _bom(db, a, p2, "part")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    res = _status(eco.id, db, engineer_user)
    assert res["has_pending"] is False
    assert res["pending_count"] == 0


def test_status_frozen_counts_as_pending(db, engineer_user):
    a = _assembly(db, status="frozen")
    eco = _eco(db, engineer_user.id, [{"entity_type": "assembly", "entity_id": str(a.id)}])
    res = _status(eco.id, db, engineer_user)
    assert res["has_pending"] is True
    assert res["pending_count"] == 1


def test_status_empty_release_items_no_pending(db, engineer_user):
    eco = _eco(db, engineer_user.id, [], status="executing")
    res = _status(eco.id, db, engineer_user)
    assert res["has_pending"] is False
    assert res["total"] == 0
