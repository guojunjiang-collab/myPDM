# PDM 智能助手声明式技能(Skill)运行时 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PDM 智能助手增加声明式技能机制：技能=放在 `skills/` 目录的 `.md` 文件（frontmatter + 剧本），模型按需 `use_skill` 取步骤后用现有工具执行；含 4 个示例技能。

**Architecture:** `skills_loader.py` 启动时扫描解析技能文件（自实现极简 frontmatter 解析，无新依赖）；`use_skill` 工具按 enabled+角色返回技能正文；`agent.py` 在系统消息按角色注入技能目录。技能不含可执行代码，仅编排现有工具。

**Tech Stack:** FastAPI + 现有 assistant 框架 + pytest。无新依赖。

**关联 spec:** [docs/superpowers/specs/2026-06-11-assistant-skills-design.md](../specs/2026-06-11-assistant-skills-design.md)

## 已核对的代码事实

- `agent.py` `run_agent` 第 62-66 行：`role = getattr(user, "role", None) or "guest"` → `role_line` → `convo = [{"role": "system", "content": SYSTEM_PROMPT + role_line}] + list(messages)`。技能目录在此追加。
- `tools.py` REGISTRY 模式；已 `import os, uuid`，有 `from . import knowledge` 等。
- conftest：`engineer_user`(engineer)、`guest_user`(guest)；`FakeLLM.calls` 记录 messages；`test_agent.py` 有 `_emit_collector()`。
- **测试 `python -m pytest`**，`backend/` 下运行。PowerShell 用 `;`。commit 追加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。分支 `dev`。当前 64 passed。

## 文件结构

- 新增 `backend/app/assistant/skills_loader.py` — 解析/加载/过滤技能
- 新增 `backend/app/assistant/skills/{project_summary_report,bom_change_impact,bom_compare_report,part_where_used}.md`
- 改 `backend/app/assistant/tools.py` — 注册 `use_skill`
- 改 `backend/app/assistant/agent.py` — 系统消息注入技能目录
- 测试 `backend/tests/test_skills_loader.py`、补 `test_tools.py`、`test_agent.py`

---

## Phase 1：技能加载器

### Task 1.1：skills_loader 解析/加载/过滤

**Files:**
- Create: `backend/app/assistant/skills_loader.py`
- Test: `backend/tests/test_skills_loader.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_skills_loader.py`：
```python
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
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_skills_loader.py -v`
Expected: FAIL（`ModuleNotFoundError`）。

- [ ] **Step 3: 实现 skills_loader.py**

`backend/app/assistant/skills_loader.py`：
```python
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
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_skills_loader.py -v`
Expected: PASS（8 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/skills_loader.py backend/tests/test_skills_loader.py
git commit -m "feat(assistant): 声明式技能加载器（解析/加载/角色过滤）"
```

---

## Phase 2：示例技能文件

### Task 2.1：4 个示例技能 + 加载验证

**Files:**
- Create: `backend/app/assistant/skills/project_summary_report.md`
- Create: `backend/app/assistant/skills/bom_change_impact.md`
- Create: `backend/app/assistant/skills/bom_compare_report.md`
- Create: `backend/app/assistant/skills/part_where_used.md`
- Test: `backend/tests/test_skills_loader.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_skills_loader.py` 末尾追加：
```python
def test_load_skills_finds_examples():
    names = {s["name"] for s in sl.load_skills()}
    for n in ["project_summary_report", "bom_change_impact",
              "bom_compare_report", "part_where_used"]:
        assert n in names


def test_project_summary_limited_to_admin_engineer():
    s = sl.get_skill("project_summary_report", "guest")
    assert s is None  # guest 不可见
    assert sl.get_skill("project_summary_report", "engineer") is not None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_skills_loader.py -k "examples or admin_engineer" -v`
Expected: FAIL（技能文件尚不存在）。

> 注：若 `load_skills` 已被前面用例缓存为空，本测试在同一进程可能读到缓存。实现者可在这两个用例首行加 `sl._CACHE = None` 重置缓存，确保读到新建文件。

- [ ] **Step 3: 创建 project_summary_report.md**

`backend/app/assistant/skills/project_summary_report.md`：
```markdown
---
name: project_summary_report
description: 当用户要对某型号、项目或主题做总结、汇总或生成报告时使用
enabled: true
roles: [admin, engineer]
---
目标：基于系统内数据，为指定型号/项目生成一份结构化总结报告。

步骤：
1. 用关键词跨数据类型检索：零件、部件、构型项、图文档、ECR、ECO（用 search_entity 与 call_read_api 遍历各列表/搜索接口），找出所有相关记录。
2. 注意主题关键词可能只出现在图文档的「附件文件名」里——务必用 call_read_api 列出附件元数据（/api/v2/attachments/），按附件文件名匹配，避免漏掉相关文档。
3. 对相关记录取完整字段（详情接口），对相关图文档取得 attachment_id 后用 read_attachment_content 读取附件正文。
4. 严格遵守信息接地约束：只综合以上检索到的数据，不臆断、不引入系统外信息；缺数据如实说明。
5. 用 create_document 生成 Markdown 报告（含概要、关键数据、附件要点），返回可下载产物。
```

- [ ] **Step 4: 创建 bom_change_impact.md**

`backend/app/assistant/skills/bom_change_impact.md`：
```markdown
---
name: bom_change_impact
description: 当用户问改动某零件/部件会影响什么、它被谁使用、变更影响范围时使用
enabled: true
---
目标：评估某零件/部件变更的影响范围。

步骤：
1. 用 search_entity 把用户提到的零件/部件解析为实体与 ID。
2. 用 trace_bom 递归反查所有使用它的上层父件（直到顶层），得到受影响的部件层级。
3. 对受影响的父件用详情接口取关键字段（编码、名称、版本、状态）。
4. 汇总：列出受影响的部件清单与层级关系，并用文字说明影响面（涉及哪些上层装配/产品）。
5. 严格基于检索到的 BOM 数据，不臆断；若该零件未被任何父件使用，如实说明。
```

- [ ] **Step 5: 创建 bom_compare_report.md**

`backend/app/assistant/skills/bom_compare_report.md`：
```markdown
---
name: bom_compare_report
description: 当用户要对比两个部件（或两个版本）的 BOM 差异时使用
enabled: true
---
目标：对比两个部件的 BOM，输出差异。

步骤：
1. 用 search_entity 解析用户给出的两个部件，得到各自 ID。
2. 用 diff_bom 对比两者（左/右）。
3. 整理差异为「新增 / 删除 / 数量变更」三类，配合表格呈现。
4. 用文字概括主要差异；如用户需要，用 create_document 生成对比报告产物。
5. 仅基于 diff_bom 返回的数据，不臆断。
```

- [ ] **Step 6: 创建 part_where_used.md**

`backend/app/assistant/skills/part_where_used.md`：
```markdown
---
name: part_where_used
description: 当用户问某零件/部件用在哪些地方、被哪些装配或图文档引用时使用
enabled: true
---
目标：查询某零件/部件的使用情况（反查）。

步骤：
1. 用 search_entity 定位该零件/部件。
2. 用 trace_bom 列出所有使用它的上层父装配。
3. 用 call_read_api 查与之关联的图文档（该实体的 documents 接口）。
4. 汇总为「被哪些部件使用」「关联哪些图文档」两部分清单。
5. 仅基于检索结果，不臆断；无引用则如实说明。
```

- [ ] **Step 7: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_skills_loader.py -v`
Expected: PASS（含示例加载用例）。

- [ ] **Step 8: Commit**

```bash
git add backend/app/assistant/skills/ backend/tests/test_skills_loader.py
git commit -m "feat(assistant): 4 个示例技能（型号报告/变更影响/BOM对比/反查）"
```

---

## Phase 3：use_skill 工具

### Task 3.1：注册 use_skill 工具

**Files:**
- Modify: `backend/app/assistant/tools.py`
- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_tools.py` 末尾追加：
```python
def test_use_skill_returns_instructions(db, engineer_user):
    out = tools.REGISTRY["use_skill"]["execute"](
        db, engineer_user, name="bom_change_impact")
    assert out["skill"] == "bom_change_impact"
    assert "trace_bom" in out["instructions"]


def test_use_skill_unknown_returns_error(db, engineer_user):
    out = tools.REGISTRY["use_skill"]["execute"](
        db, engineer_user, name="不存在的技能")
    assert "error" in out


def test_use_skill_role_gated(db, guest_user):
    # project_summary_report 限 admin/engineer，guest 不可用
    out = tools.REGISTRY["use_skill"]["execute"](
        db, guest_user, name="project_summary_report")
    assert "error" in out
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_tools.py -k use_skill -v`
Expected: FAIL（`KeyError: 'use_skill'`）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/tools.py` 顶部 import 区追加：
```python
from . import skills_loader
```
追加工具函数（放在文件靠后、REGISTRY 之前的函数区）：
```python
def use_skill(db: Session, user: User, name: str):
    """取出某命名技能的步骤说明，供模型按其剧本用现有工具执行。"""
    role = getattr(user, "role", None) or "guest"
    skill = skills_loader.get_skill(name, role)
    if not skill:
        return {"error": f"技能不可用：{name}（不存在、已停用或当前角色无权）"}
    return {"skill": name, "instructions": skill["body"]}
```
在 `REGISTRY` 追加：
```python
    "use_skill": {
        "execute": use_skill,
        "schema": {"type": "function", "function": {
            "name": "use_skill",
            "description": ("获取并执行某个命名技能的步骤。当用户意图匹配系统提示中列出的"
                            "某个可用技能时调用，得到其多步剧本后用现有工具逐步执行。"),
            "parameters": {"type": "object", "properties": {
                "name": {"type": "string", "description": "技能名（见系统提示的可用技能清单）"},
            }, "required": ["name"]},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_tools.py -k use_skill -v`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): use_skill 工具（按角色返回技能剧本）"
```

---

## Phase 4：系统提示注入技能目录

### Task 4.1：agent 注入按角色技能清单

**Files:**
- Modify: `backend/app/assistant/agent.py`
- Test: `backend/tests/test_agent.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_agent.py` 末尾追加：
```python
def test_system_message_includes_skill_catalog(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "可用技能" in sys_msg
    assert "project_summary_report" in sys_msg  # engineer 可见
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_agent.py -k skill_catalog -v`
Expected: FAIL（系统消息暂无技能目录）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/agent.py`：

1. import 区追加：
```python
from . import skills_loader
```

2. 将 `run_agent` 中的 convo 组装：
```python
    convo = [{"role": "system", "content": SYSTEM_PROMPT + role_line}] + list(messages)
```
替换为：
```python
    skills = skills_loader.list_skills(role)
    skills_line = ""
    if skills:
        catalog = "\n".join(f"- {s['name']}：{s['description']}" for s in skills)
        skills_line = ("\n\n可用技能（当用户意图匹配某技能时，先调用 use_skill 获取其步骤再执行）：\n"
                       + catalog)
    convo = [{"role": "system", "content": SYSTEM_PROMPT + role_line + skills_line}] + list(messages)
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `cd backend; python -m pytest -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/agent.py backend/tests/test_agent.py
git commit -m "feat(assistant): 系统提示按角色注入可用技能目录"
```

---

## Phase 5：部署与实测

### Task 5.1：重启与浏览器/HTTP 实测

> 无单测，无新依赖，`docker restart bom_backend` 即可。

- [ ] **Step 1: 重启后端**

Run: `docker restart bom_backend`
Expected: `docker logs bom_backend --tail 5` 无 import 错误。

- [ ] **Step 2: 容器内技能加载自测**

Run:
```
docker exec bom_backend python -c "
from app.assistant import skills_loader as sl
for role in ['admin','engineer','guest']:
    print(role, '->', [s['name'] for s in sl.list_skills(role)])
"
```
Expected: admin/engineer 见 4 个技能；guest 见 3 个（无 project_summary_report）。

- [ ] **Step 3: 真实对话实测（admin/admin123）**

- 问「改动零件 PART-0-1 会影响哪些部件？」→ 模型应识别并 `use_skill("bom_change_impact")`，按剧本 trace_bom 反查后给出受影响清单。
- 问「帮我对比 ASM-1 和 ASM-2 的 BOM」→ 应 `use_skill("bom_compare_report")` → diff_bom。
- 验证要点：模型确实调用了 use_skill 并按其步骤执行（而非自行随意编排）。

- [ ] **Step 4: 无需 commit**

---

## 验收清单

- [ ] `cd backend; python -m pytest -v` 全绿（含 skills_loader 10 用例、tools 3、agent 1）
- [ ] 容器自测：各角色可见技能数正确（guest 无 project_summary_report）
- [ ] 对话能触发 use_skill 并按技能剧本执行
- [ ] 新增/编辑 `skills/*.md` + 重启后即生效（可临时加一个测试技能验证）

## 备注（二期）

- 管理界面（上传/启停/配置）、技能包导出与内网共享库。
- 把 `system_prompt.md`「全面检索」段收敛进 `project_summary_report` 技能以精简全局提示词（本期不动用户已编辑的提示词文件）。
- 技能参数化输入、代码式技能（需沙箱，谨慎）。
