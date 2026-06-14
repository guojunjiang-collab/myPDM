# PDM 智能助手：声明式技能（Skill）运行时 — 设计

- **日期**: 2026-06-11
- **状态**: 已评审，待实现计划
- **关联**: [全量只读网关+数据字典](2026-06-10-assistant-read-gateway-knowledge-design.md)、[角色感知](2026-06-10-assistant-role-aware-design.md)、`system_prompt.md` 外置

## 目标

为 PDM 智能助手增加**声明式技能**机制：把常用多步工作流固化为"技能文件"，模型识别意图后按技能"剧本"编排**现有工具**完成任务。技能以文件形式放入目录、重启后端即生效（与 `system_prompt.md` 同理），可拷贝下载/分享。

**声明式 = 纯配置**：技能只是"提示词剧本 + 调用现有工具的步骤说明"，**不含、也不执行任何外部代码**——天然安全，适合制造业内网。

## 范围（首期）

- 技能运行时：格式、加载、按角色/启停过滤、`use_skill` 工具、系统提示注入技能目录。
- 随附 4 个示例技能（既是模板也立即可用）：`project_summary_report`、`bom_change_impact`、`bom_compare_report`、`part_where_used`。
- 安装/配置 = 文件式：放入 `skills/` 目录 + 编辑 frontmatter + 重启后端。

## 非目标（二期）

- 管理界面（上传/启停/配置 UI）、技能包导出/内网共享库。
- 代码式技能、技能参数化输入表单。
- 自动把 `system_prompt.md` 的「全面检索」段收敛进技能——**本期不动用户已手编的 `system_prompt.md`**，避免破坏其改动；技能与该段共存（轻微冗余无害），用户可日后自行精简。

---

## ① 技能文件格式

目录 `backend/app/assistant/skills/`，一个技能一个 `.md`，Markdown + YAML 风格 frontmatter：

```markdown
---
name: project_summary_report
description: 当用户要对某型号/项目做总结或生成报告时使用
enabled: true
roles: [admin, engineer]
---
（技能正文：给模型的多步剧本，自然语言描述按什么顺序、调用哪些现有工具）
```

- `name`：唯一标识（英文 slug）。
- `description`：触发说明（注入目录，模型据此判断何时用）。
- `enabled`：`true`/`false`，缺省 `true`。
- `roles`：可选，限定可用角色列表；缺省=全角色。
- 正文（frontmatter 之后全部）：技能剧本。

## ② 加载与解析 `skills_loader.py`

- `_parse_skill(text) -> dict | None`：解析 frontmatter（`---` 围栏间的 `key: value`；`roles` 解析 `[a, b]`；`enabled` 解析布尔）+ 正文。缺 `name` 则返回 None（无效跳过）。**自实现极简解析，不引入 PyYAML 依赖。**
- `load_skills(skills_dir=SKILLS_DIR) -> list[dict]`：扫描 `*.md`，解析，跳过无效；模块级缓存（重启刷新）。
- `list_skills(role, skills=None) -> list[dict]`：保留 `enabled` 且（`roles` 为空或 `role in roles`）的技能。
- `get_skill(name, role, skills=None) -> dict | None`：按 name 命中且通过 enabled+角色校验则返回，否则 None。
- `SKILLS_DIR = os.path.join(os.path.dirname(__file__), "skills")`。

## ③ 工具 `use_skill`

`use_skill(db, user, name) -> dict`（注册到 `REGISTRY`）：
- `skill = skills_loader.get_skill(name, user.role)`。
- 未命中/停用/越权 → `{"error": "技能不可用：<name>（不存在、已停用或当前角色无权）"}`。
- 命中 → `{"skill": name, "instructions": skill["body"]}`，模型据此用现有工具执行。
- schema：入参 `name`（string，required），描述说明用于获取并执行某个命名技能的步骤。

## ④ 系统提示注入技能目录

`agent.py` 的 `run_agent` 装配系统消息时（在角色行附近）追加**按当前用户角色过滤**的技能清单（仅 name + description，紧凑）：

```
可用技能（当用户意图匹配某技能时，先调用 use_skill 获取其步骤再执行）：
- project_summary_report：当用户要对某型号/项目做总结或生成报告时使用
- bom_change_impact：当用户问改动某零件/部件会影响什么、谁用了它时使用
- ...
```

无可用技能时省略该段。技能目录在运行时按 `list_skills(user.role)` 生成。

## ⑤ 随附 4 个示例技能（剧本仅编排现有工具）

| 文件 | name | 剧本要点 | roles |
|---|---|---|---|
| `project_summary_report.md` | project_summary_report | 跨零件/部件/构型/图文档/ECR/ECO 检索关键词 → 列附件(`/api/v2/attachments/`)按文件名匹配 → `read_attachment_content` 读相关附件 → `create_document` 出 MD 报告 | admin, engineer |
| `bom_change_impact.md` | bom_change_impact | `search_entity` 定位 → `trace_bom` 递归反查所有上层父件 → 取受影响父件详情 → 汇总影响面与层级 | （全角色） |
| `bom_compare_report.md` | bom_compare_report | `search_entity` 解析两侧 → `diff_bom` → 整理增/删/改量 → 可 `create_document` 出对比报告 | （全角色） |
| `part_where_used.md` | part_where_used | `trace_bom` 列所有父装配 + 查关联图文档 | （全角色） |

> `project_summary_report` 限 admin/engineer（与附件正文读取权限一致，因其要读附件）。其余只读类全角色可用。

## ⑥ 影响文件

- 新增 `backend/app/assistant/skills_loader.py`
- 新增 `backend/app/assistant/skills/{project_summary_report,bom_change_impact,bom_compare_report,part_where_used}.md`
- 改 `backend/app/assistant/tools.py`（注册 `use_skill`）
- 改 `backend/app/assistant/agent.py`（系统消息注入技能目录）
- 测试 `backend/tests/test_skills_loader.py`、补 `test_tools.py`、`test_agent.py`

## ⑦ 测试策略（pytest）

- `_parse_skill`：解析含/不含 `roles`、`enabled: false` 的 frontmatter + 正文；缺 `name` 返回 None。
- `load_skills`：从内置 `skills/` 目录加载，能找到 `project_summary_report`。
- `list_skills` 角色过滤：`roles=[admin]` 的技能对 engineer 不可见；`enabled: false` 被排除。
- `get_skill`：合法返回正文；停用/越权/未知返回 None。
- `use_skill` 工具：合法返回 instructions；未知/停用返回 error。
- `agent`：用 fake LLM 捕获系统消息，断言含某技能 name（按角色）。

## ⑧ 部署

无新依赖，`docker restart bom_backend` 即生效。新增/编辑技能 `.md` 后同样重启即装上。

## ⑨ 落地顺序

1. `skills_loader.py`（解析/加载/过滤）+ 测试。
2. 4 个示例技能 `.md`。
3. `use_skill` 工具 + 注册。
4. `agent.py` 系统消息注入技能目录。
5. 部署 + 浏览器实测（触发各技能）。
