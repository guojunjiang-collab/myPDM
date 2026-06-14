"""声明式技能加载：扫描 skills/ 目录，解析 frontmatter + 正文。

技能 = 纯配置/提示（不含可执行代码），由模型按剧本编排现有工具。
自实现极简 frontmatter 解析，不引入 PyYAML 依赖。
"""
import os
import re

SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")


def _parse_skill(text):
    """解析 frontmatter(--- 围栏) + 正文；缺 name 或无 frontmatter 返回 None。"""
    m = re.match(r"\s*---\s*\n(.*?)\n---\s*\n?(.*)", text, re.DOTALL)
    if not m:
        return None
    fm_raw, body = m.group(1), m.group(2)
    meta = {}
    for line in fm_raw.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, val = line.split(":", 1)
        meta[key.strip()] = val.strip()
    name = meta.get("name")
    if not name:
        return None
    enabled = meta.get("enabled", "true").lower() != "false"
    roles = None
    if "roles" in meta:
        parts = [r.strip() for r in meta["roles"].strip().strip("[]").split(",") if r.strip()]
        roles = parts or None
    return {"name": name, "description": meta.get("description", ""),
            "enabled": enabled, "roles": roles, "body": body.strip()}


_CACHE = None


def load_skills(skills_dir=None):
    """加载技能列表。默认目录结果缓存（重启刷新）；传入自定义目录不缓存。"""
    global _CACHE
    use_default = skills_dir is None
    if use_default and _CACHE is not None:
        return _CACHE
    target = SKILLS_DIR if use_default else skills_dir
    skills = []
    if os.path.isdir(target):
        for fn in sorted(os.listdir(target)):
            if not fn.endswith(".md"):
                continue
            try:
                with open(os.path.join(target, fn), encoding="utf-8") as f:
                    s = _parse_skill(f.read())
                if s:
                    skills.append(s)
            except OSError:
                continue
    if use_default:
        _CACHE = skills
    return skills


def list_skills(role, skills=None):
    """返回 enabled 且当前角色可见的技能。"""
    skills = skills if skills is not None else load_skills()
    return [s for s in skills
            if s["enabled"] and (s["roles"] is None or role in s["roles"])]


def get_skill(name, role, skills=None):
    for s in list_skills(role, skills):
        if s["name"] == name:
            return s
    return None
