import uuid
from app.assistant import tools
from app import models


def _make_part(db, code, name):
    p = models.Part(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_search_entity_matches_part_by_code(db, engineer_user):
    _make_part(db, "P-100", "螺钉")
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="P-100")
    assert any(r["code"] == "P-100" and r["type"] == "part" for r in out["results"])


def test_search_entity_empty_keyword_returns_empty(db, engineer_user):
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="")
    assert out["results"] == []


def test_registry_specs_have_required_openai_shape():
    for name, spec in tools.REGISTRY.items():
        s = spec["schema"]
        assert s["type"] == "function"
        assert s["function"]["name"] == name
        assert "parameters" in s["function"]


def _make_assembly(db, code, name):
    a = models.Assembly(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(a); db.commit(); db.refresh(a)
    return a


def _fake_node(code, qty, level=0):
    return {"child_code": code, "child_name": code + "名", "quantity": qty, "level": level}


def test_diff_bom_small_returns_raw_trees(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: [_fake_node("X", 1)])
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "raw"
    assert "left" in out and "right" in out


def test_diff_bom_large_returns_preprocessed_diff(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    # 阈值设小，强制走预处理；左右有增/删/改量
    monkeypatch.setenv("ASSISTANT_BOM_RAW_THRESHOLD", "1")
    left_nodes = [_fake_node("COMMON", 1), _fake_node("ONLY_LEFT", 1)]
    right_nodes = [_fake_node("COMMON", 3), _fake_node("ONLY_RIGHT", 1)]
    calls = iter([left_nodes, right_nodes])
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: next(calls))
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "preprocessed"
    codes_added = {r["code"] for r in out["diff"]["added"]}
    codes_removed = {r["code"] for r in out["diff"]["removed"]}
    codes_changed = {r["code"] for r in out["diff"]["changed"]}
    assert "ONLY_RIGHT" in codes_added
    assert "ONLY_LEFT" in codes_removed
    assert "COMMON" in codes_changed
    assert out["_card"]["card_type"] == "table"
