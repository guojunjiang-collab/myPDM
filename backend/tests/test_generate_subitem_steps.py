import uuid
from app.schemas_parts import MatchReport
from app import models, models_parts, crud_parts


def test_match_report_has_split_fields():
    r = MatchReport(matched=[], unmatched=[], multi_instance=[],
                    generated=["A"], skipped_not_editable=["B"], failed=["C"])
    assert r.generated == ["A"]
    assert r.skipped_not_editable == ["B"]
    assert r.failed == ["C"]


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


def test_import_route_returns_split_report(db, engineer_user, monkeypatch, tmp_path):
    import io
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db as _get_db
    from app.routers.auth import get_current_active_user

    _, asm_r, _ = _mk(db, "ASMR", status="draft", checkout=engineer_user.id)
    app.dependency_overrides[_get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
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
