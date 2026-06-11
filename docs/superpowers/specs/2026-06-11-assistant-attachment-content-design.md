# AI 读取附件正文并分析 — 设计

- **日期**: 2026-06-11
- **状态**: 已评审，待实现计划
- **关联**: [全量只读网关+数据字典](2026-06-10-assistant-read-gateway-knowledge-design.md)、[角色感知](2026-06-10-assistant-role-aware-design.md)

## 目标

让 AI 助手能读取常规文档类附件（PDF / Word / Excel / 纯文本）的正文内容并进行总结分析。

**现状**：助手只能取附件元数据（文件名/大小等），网关刻意排除二进制/下载端点，无法读取文件内容。用户输入"读取 DOC-1 和 DOC-2 的附件内容并总结分析"时拿不到正文。

## 范围决策（已定）

- **格式**：pdf、docx、xlsx、md/txt/csv/json。旧版二进制 .doc/.xls **不支持**。
- **新增依赖**：`pypdf`、`python-docx`、`openpyxl`（需重建后端镜像）。
- **权限**：仅 **admin / engineer** 可调用（新 `CONTENT_READ_ROLES = {"admin", "engineer"}`）；production/guest 返回拒绝。正文会发往 DeepSeek，故收紧角色。
- **单附件提取上限**：`ASSISTANT_ATTACHMENT_MAX_CHARS`（默认 20000 字符），超出截断并标注——既控 token 又防滥用。
- **系统提示**：追加一句告知模型可读取附件正文做分析。

## 非目标（YAGNI）

- 不支持 .doc/.xls 等旧二进制格式、不支持图片 OCR、不支持 STP/3D。
- 不对正文做字段脱敏（自由文本不适用）。
- 不缓存提取结果（每次现读；体量受上限约束）。

---

## ① 文本提取模块 `attachment_reader.py`

纯函数 `extract_text(data: bytes, file_name: str, max_chars: int) -> dict`：
- 按 `file_name` 扩展名（小写）分派：
  | 扩展 | 库 | 提取方式 |
  |---|---|---|
  | `.pdf` | pypdf | `PdfReader` 逐页 `extract_text()` 拼接 |
  | `.docx` | python-docx (`import docx`) | 段落文本 + 表格单元格文本 |
  | `.xlsx` | openpyxl | 逐 sheet 逐行，单元格以制表符连接 |
  | `.md`/`.txt`/`.csv`/`.json` | 内置 | `data.decode("utf-8", errors="replace")` |
  | 其他 | — | 返回 `{"error": "该格式暂不支持提取正文", "file_name": ...}` |
- 返回 `{"file_name": ..., "text": <截断后文本>, "truncated": bool, "chars": <原始字符数>}`。
- 文本超 `max_chars`：截断到 `max_chars`，`truncated=True`。
- 提取异常（加密/损坏）捕获，返回 `{"error": "<原因>", "file_name": ...}`。
- 依赖在函数内按需 `import`（pypdf/docx/openpyxl），避免模块导入期硬依赖。

## ② 工具 `read_attachment_content`

`read_attachment_content(db, user, attachment_id) -> dict`（注册到 `REGISTRY`）：
1. 权限：`user.role not in CONTENT_READ_ROLES` → `{"error": "当前账号无附件内容读取权限（仅管理员/工程师）"}`。
2. 查 `DocumentAttachment`（`uuid.UUID(attachment_id)`）；不存在 → `{"error": "附件不存在"}`。
3. `att.file_path` 为空或文件缺失 → `{"error": "附件文件不存在"}`。
4. 用 `file_storage`（复用 `app.file_storage` 单例）`read_file(att.file_path)` 取字节。
5. `max = int(os.getenv("ASSISTANT_ATTACHMENT_MAX_CHARS", "20000"))`，调 `extract_text(data, att.file_name, max)`，返回其结果。
- `CONTENT_READ_ROLES = {"admin", "engineer"}` 定义在 `tools.py`。
- 工具 schema：入参 `attachment_id`（string，required），描述说明可读 pdf/word/excel/文本正文供分析。

## ③ 系统提示

`agent.py` 的 `SYSTEM_PROMPT` 追加一句：可调用 `read_attachment_content` 读取附件正文（pdf/word/excel/文本）做总结分析；先用文档/附件接口拿到 attachment_id 再读。

## ④ 配置

`.env` 与 `docker-compose.yml`（backend environment）新增：
```
ASSISTANT_ATTACHMENT_MAX_CHARS=20000
```
（`.env` 已 gitignore，仅提交 docker-compose.yml，并提醒手动补 .env。）

## ⑤ 影响文件

- 新增 `backend/app/assistant/attachment_reader.py`
- 改 `backend/app/assistant/tools.py`（`CONTENT_READ_ROLES`、`read_attachment_content`、注册）
- 改 `backend/app/assistant/agent.py`（系统提示一句）
- 改 `backend/requirements.txt`（pypdf、python-docx、openpyxl）、`docker-compose.yml`
- 测试 `backend/tests/test_attachment_reader.py`、补 `backend/tests/test_tools.py`

## ⑥ 测试策略（pytest）

- `extract_text` 文本类：`.md`/`.txt`/`.csv` 直接喂 bytes，断言正文出现。
- `extract_text` docx：用 `python-docx` 在测试内现造一个含段落的 .docx（写入 BytesIO），断言提取到段落文字。
- `extract_text` xlsx：用 `openpyxl` 现造一个含单元格的 .xlsx，断言提取到单元格值。
- `extract_text` 不支持格式（如 `.png`）→ 返回 error。
- `extract_text` 截断：构造超 `max_chars` 的 txt，断言 `truncated=True` 且 `len(text)==max_chars`。
- `read_attachment_content` 权限：admin/engineer 通过路径（用真实文件或 mock file_storage）；production、guest → error。
- PDF 提取走部署后浏览器/HTTP 实测（pytest 内造文本 PDF 不便，不纳入单测）。

## ⑦ 分阶段落地

1. 依赖 + `attachment_reader.extract_text`（文本类 + 不支持 + 截断）。
2. docx / xlsx / pdf 提取分支。
3. `read_attachment_content` 工具 + 权限 + 注册。
4. 系统提示 + 配置项。
5. 部署（重建镜像）+ 浏览器实测（读 DOC-1/DOC-2 的 pdf 附件并总结）。
