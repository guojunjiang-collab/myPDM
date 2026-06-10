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
