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


def _att(db, iteration_id, category="production", file_name="x.STEP"):
    a = models_parts.PartAttachment(id=uuid.uuid4(), iteration_id=iteration_id,
                                    category=category, file_name=file_name,
                                    file_size=100, file_path="/tmp/x",
                                    file_hash="abc")
    db.add(a); db.commit()
    return a


def test_collect_bom_attachments_self_and_descendants(db):
    """递归收集自身+全部子孙件的附件。"""
    _, asm_r, asm_it = _mk(db, "ASM")
    _, leaf_r, leaf_it = _mk(db, "LEAF")
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                       parent_revision_id=asm_r.id, child_revision_id=leaf_r.id,
                       quantity=1, sort_order=0, cad_instances=[])
    db.add(b); db.commit()
    _att(db, asm_it.id, "production", "asm.step")
    _att(db, leaf_it.id, "production", "leaf.step")
    result = crud_parts.collect_bom_attachments(db, asm_r.id, "production")
    names = sorted(r["file_name"] for r in result)
    assert names == ["asm.step", "leaf.step"]


def test_collect_bom_attachments_empty_category_returns_empty(db):
    _, r, it = _mk(db, "P1")
    _att(db, it.id, "cad", "cad.step")
    result = crud_parts.collect_bom_attachments(db, r.id, "production")
    assert result == []


def test_collect_bom_attachments_nested(db):
    """两级嵌套：装配→子装配→叶件，收集全部附件。"""
    _, asm_r, asm_it = _mk(db, "ASM")
    _, sub_r, sub_it = _mk(db, "SUB")
    _, leaf_r, leaf_it = _mk(db, "LEAF")
    b1 = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                        parent_revision_id=asm_r.id, child_revision_id=sub_r.id,
                        quantity=1, sort_order=0, cad_instances=[])
    b2 = models.BOMItem(id=uuid.uuid4(), iteration_id=sub_it.id,
                        parent_revision_id=sub_r.id, child_revision_id=leaf_r.id,
                        quantity=1, sort_order=0, cad_instances=[])
    db.add_all([b1, b2]); db.commit()
    _att(db, asm_it.id, "production", "asm.rar")
    _att(db, sub_it.id, "production", "sub.rar")
    _att(db, leaf_it.id, "production", "leaf.rar")
    result = crud_parts.collect_bom_attachments(db, asm_r.id, "production")
    names = sorted(r["file_name"] for r in result)
    assert len(names) == 3
    assert names == ["asm.rar", "leaf.rar", "sub.rar"]


def test_bom_attachments_route(db, engineer_user):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db as _get_db
    from app.routers.auth import get_current_active_user

    _, r, it = _mk(db, "ASMR")
    _att(db, it.id, "production", "a.step")
    app.dependency_overrides[_get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    try:
        client = TestClient(app)
        resp = client.get(f"/api/parts/revisions/{r.id}/bom-attachments?category=production")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["items"][0]["file_name"] == "a.step"
        # 无该类别附件 → 404
        resp2 = client.get(f"/api/parts/revisions/{r.id}/bom-attachments?category=cad")
        assert resp2.status_code == 404
        # 非法 category → 400
        resp3 = client.get(f"/api/parts/revisions/{r.id}/bom-attachments?category=foo")
        assert resp3.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_download_part_attachment_endpoint(db, engineer_user, tmp_path):
    """按 attachment_id 直接下载：file_path 直读（不经 v2 base_dir 拼接）。"""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db as _get_db
    from app.routers.auth import get_current_active_user

    _, r, it = _mk(db, "DL")
    f = tmp_path / "real.step"
    f.write_text("ISO-10303-21;")
    a = models_parts.PartAttachment(id=uuid.uuid4(), iteration_id=it.id, category="production",
                                    file_name="real.step", file_size=13, file_path=str(f), file_hash="h")
    db.add(a); db.commit()

    app.dependency_overrides[_get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    try:
        client = TestClient(app)
        resp = client.get(f"/api/parts/attachments/{a.id}/download")
        assert resp.status_code == 200
        assert resp.content == b"ISO-10303-21;"
        # 不存在的附件 → 404
        resp2 = client.get(f"/api/parts/attachments/{uuid.uuid4()}/download")
        assert resp2.status_code == 404
    finally:
        app.dependency_overrides.clear()
