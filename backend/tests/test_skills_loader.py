from app.assistant import skills_loader as sl

SAMPLE = """---
name: demo
description: 演示技能
enabled: true
roles: [admin, engineer]
---
第一步做这个。
第二步做那个。"""


def test_parse_skill_basic():
    s = sl._parse_skill(SAMPLE)
    assert s["name"] == "demo"
    assert s["description"] == "演示技能"
    assert s["enabled"] is True
    assert s["roles"] == ["admin", "engineer"]
    assert "第一步" in s["body"]


def test_parse_skill_defaults():
    s = sl._parse_skill("---\nname: x\n---\n正文")
    assert s["enabled"] is True
    assert s["roles"] is None
    assert s["body"] == "正文"


def test_parse_skill_disabled():
    s = sl._parse_skill("---\nname: x\nenabled: false\n---\n正文")
    assert s["enabled"] is False


def test_parse_skill_missing_name_returns_none():
    assert sl._parse_skill("---\ndescription: 无名\n---\n正文") is None


def test_parse_skill_no_frontmatter_returns_none():
    assert sl._parse_skill("没有 frontmatter 的纯文本") is None


def test_list_skills_role_and_enabled_filter():
    skills = [
        {"name": "a", "description": "", "enabled": True, "roles": ["admin"], "body": ""},
        {"name": "b", "description": "", "enabled": True, "roles": None, "body": ""},
        {"name": "c", "description": "", "enabled": False, "roles": None, "body": ""},
    ]
    names = {s["name"] for s in sl.list_skills("engineer", skills)}
    assert names == {"b"}


def test_get_skill():
    skills = [{"name": "a", "description": "", "enabled": True, "roles": None, "body": "步骤"}]
    assert sl.get_skill("a", "guest", skills)["body"] == "步骤"
    assert sl.get_skill("nope", "guest", skills) is None


def test_load_skills_from_custom_dir(tmp_path):
    (tmp_path / "s.md").write_text("---\nname: t1\n---\n剧本", encoding="utf-8")
    (tmp_path / "ignore.txt").write_text("不是技能", encoding="utf-8")
    out = sl.load_skills(str(tmp_path))
    assert {s["name"] for s in out} == {"t1"}
