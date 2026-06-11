# AI 读取附件正文并分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `read_attachment_content` 工具，让 AI 能读取 PDF/Word/Excel/纯文本附件的正文并总结分析（仅 admin/engineer，单附件截断 20000 字符）。

**Architecture:** 纯函数提取模块 `attachment_reader.extract_text(data, file_name, max_chars)` 按扩展名分派到 pypdf/python-docx/openpyxl/内置解码；工具层查 `DocumentAttachment` → `file_storage.read_file` 取字节 → 提取 → 回灌模型。权限新增 `CONTENT_READ_ROLES = {"admin","engineer"}`。

**Tech Stack:** pypdf + python-docx + openpyxl（新增）+ FastAPI + pytest。

**关联 spec:** [docs/superpowers/specs/2026-06-11-assistant-attachment-content-design.md](../specs/2026-06-11-assistant-attachment-content-design.md)

## 已核对的代码事实

- `app.file_storage` 模块底部有单例 `file_storage = FileStorage()`，`file_storage.read_file(相对路径) -> bytes`，文件不存在抛 `FileNotFoundError`。
- `DocumentAttachment` 字段：`id, document_id, file_name, file_size, file_path, file_hash`（`app.models`）。
- `tools.py` 已 import：`os, uuid, Session, crud, compare, User, DocumentAttachment, document_builder, api_gateway, knowledge`；已有 `DOWNLOAD_ROLES`。
- `agent.py` 的 `SYSTEM_PROMPT` 为模块级元组拼接字符串，末句为"…下载入口由按钮提供。"，其后有 `SYSTEM_PROMPT = SYSTEM_PROMPT + "\n\n" + knowledge.build_overview()`。
- conftest fixtures：`engineer_user`（engineer）、`guest_user`（guest），含 `real_name`。**没有** production/admin fixture——权限测试用 engineer（通过）+ guest（拒绝）即可覆盖门控逻辑。
- **测试用 `python -m pytest`**，在 `backend/` 下运行，本地 Python 3.11。PowerShell 用 `;` 不用 `&&`。
- 每个 commit 追加 trailer：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。分支 `dev`。
- 当前全量 46 passed。

## 文件结构

- 新增 `backend/app/assistant/attachment_reader.py` — 纯函数 `extract_text`
- 改 `backend/app/assistant/tools.py` — `CONTENT_READ_ROLES`、`read_attachment_content`、REGISTRY 注册
- 改 `backend/app/assistant/agent.py` — SYSTEM_PROMPT 追加一句
- 改 `backend/requirements.txt`、`docker-compose.yml`（`.env` 本地手动补）
- 测试：新增 `backend/tests/test_attachment_reader.py`、补 `backend/tests/test_tools.py`、补 `backend/tests/test_agent.py`

---

## Phase 1：依赖 + 提取模块

### Task 1.1：新增依赖并本地安装

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: 追加依赖**

在 `backend/requirements.txt` 末尾（`pytest==8.3.4` 之后）追加三行：
```
pypdf==5.1.0
python-docx==1.1.2
openpyxl==3.1.5
```

- [ ] **Step 2: 本地安装（供 pytest 用）**

Run: `cd backend; python -m pip install pypdf==5.1.0 python-docx==1.1.2 openpyxl==3.1.5 --quiet`
Expected: 安装成功无报错。验证：`python -c "import pypdf, docx, openpyxl; print('ok')"` 打印 ok。

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore(assistant): 引入 pypdf/python-docx/openpyxl 依赖"
```

---

### Task 1.2：extract_text — 文本类 + 不支持格式 + 截断

**Files:**
- Create: `backend/app/assistant/attachment_reader.py`
- Test: `backend/tests/test_attachment_reader.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_attachment_reader.py`：
```python
from app.assistant.attachment_reader import extract_text


def test_extract_md_text():
    out = extract_text("# 标题\n正文内容".encode("utf-8"), "说明.md", 20000)
    assert "正文内容" in out["text"]
    assert out["truncated"] is False
    assert out["file_name"] == "说明.md"


def test_extract_csv_text():
    out = extract_text("a,b\n1,2".encode("utf-8"), "data.CSV", 20000)
    assert "1,2" in out["text"]


def test_unsupported_format_returns_error():
    out = extract_text(b"\x89PNG....", "图片.png", 20000)
    assert "error" in out
    assert out["file_name"] == "图片.png"


def test_truncation():
    out = extract_text(("x" * 100).encode(), "big.txt", 10)
    assert out["truncated"] is True
    assert len(out["text"]) == 10
    assert out["chars"] == 100
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_attachment_reader.py -v`
Expected: FAIL（`ModuleNotFoundError: app.assistant.attachment_reader`）。

- [ ] **Step 3: 实现 attachment_reader.py（文本类分支）**

`backend/app/assistant/attachment_reader.py`：
```python
"""附件正文提取：按扩展名分派（pdf/docx/xlsx/文本），供 AI 分析。

依赖（pypdf/python-docx/openpyxl）在分支内按需 import，避免导入期硬依赖。
"""
import io
import os

TEXT_EXTS = {".md", ".txt", ".csv", ".json"}


def _ext(file_name: str) -> str:
    return os.path.splitext(file_name or "")[1].lower()


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _extract_docx(data: bytes) -> str:
    import docx
    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append("\t".join(c.text for c in row.cells))
    return "\n".join(parts)


def _extract_xlsx(data: bytes) -> str:
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts = []
    for ws in wb.worksheets:
        parts.append(f"[sheet] {ws.title}")
        for row in ws.iter_rows(values_only=True):
            parts.append("\t".join("" if v is None else str(v) for v in row))
    return "\n".join(parts)


_EXTRACTORS = {".pdf": _extract_pdf, ".docx": _extract_docx, ".xlsx": _extract_xlsx}


def extract_text(data: bytes, file_name: str, max_chars: int) -> dict:
    """提取附件正文。返回 {file_name, text, truncated, chars} 或 {file_name, error}。"""
    ext = _ext(file_name)
    try:
        if ext in TEXT_EXTS:
            text = data.decode("utf-8", errors="replace")
        elif ext in _EXTRACTORS:
            text = _EXTRACTORS[ext](data)
        else:
            return {"file_name": file_name,
                    "error": f"该格式（{ext or '未知'}）暂不支持提取正文，"
                             "支持 pdf/docx/xlsx/md/txt/csv/json"}
    except Exception as exc:
        return {"file_name": file_name, "error": f"提取失败: {exc}"}
    chars = len(text)
    truncated = chars > max_chars
    return {"file_name": file_name, "text": text[:max_chars],
            "truncated": truncated, "chars": chars}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_attachment_reader.py -v`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/attachment_reader.py backend/tests/test_attachment_reader.py
git commit -m "feat(assistant): 附件正文提取（文本类/截断/不支持格式）"
```

---

### Task 1.3：extract_text — docx / xlsx 分支测试

> 实现已在 Task 1.2 一并写入（`_extract_docx`/`_extract_xlsx`/`_extract_pdf`），本任务补 docx/xlsx 的真实构造测试。PDF 不便在单测内构造含文本页的文件，走 Phase 4 部署实测。

**Files:**
- Test: `backend/tests/test_attachment_reader.py`（追加）

- [ ] **Step 1: 追加失败（或直接通过）的测试**

在 `backend/tests/test_attachment_reader.py` 末尾追加：
```python
import io


def _make_docx_bytes():
    import docx
    d = docx.Document()
    d.add_paragraph("会议纪要正文")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "零件号"
    t.rows[0].cells[1].text = "P-100"
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _make_xlsx_bytes():
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "清单"
    ws.append(["编码", "数量"])
    ws.append(["P-100", 3])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_extract_docx_paragraph_and_table():
    out = extract_text(_make_docx_bytes(), "纪要.docx", 20000)
    assert "会议纪要正文" in out["text"]
    assert "P-100" in out["text"]


def test_extract_xlsx_cells():
    out = extract_text(_make_xlsx_bytes(), "清单.xlsx", 20000)
    assert "清单" in out["text"]
    assert "P-100" in out["text"]


def test_corrupted_docx_returns_error():
    out = extract_text(b"not a real docx", "bad.docx", 20000)
    assert "error" in out
```

- [ ] **Step 2: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_attachment_reader.py -v`
Expected: PASS（7 个用例；实现已含分支，应直接绿。若失败则按报错修 `_extract_docx`/`_extract_xlsx`）。

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_attachment_reader.py
git commit -m "test(assistant): docx/xlsx 提取与损坏文件用例"
```

---

## Phase 2：工具注册与权限

### Task 2.1：read_attachment_content 工具

**Files:**
- Modify: `backend/app/assistant/tools.py`
- Test: `backend/tests/test_tools.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_tools.py` 末尾追加：
```python
def _make_attachment(db, file_name, file_path="doc/x/file.md"):
    att = models.DocumentAttachment(id=uuid.uuid4(), document_id=uuid.uuid4(),
                                    file_name=file_name, file_path=file_path)
    db.add(att); db.commit(); db.refresh(att)
    return att


def test_read_attachment_content_for_engineer(db, engineer_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    monkeypatch.setattr(tools.file_storage, "read_file",
                        lambda p: "# 标题\n附件正文".encode("utf-8"))
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(att.id))
    assert "附件正文" in out["text"]


def test_read_attachment_content_denied_for_guest(db, guest_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    monkeypatch.setattr(tools.file_storage, "read_file",
                        lambda p: b"secret")
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, guest_user, attachment_id=str(att.id))
    assert "error" in out and "text" not in out


def test_read_attachment_content_missing_attachment(db, engineer_user):
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(uuid.uuid4()))
    assert "error" in out


def test_read_attachment_content_missing_file(db, engineer_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    def boom(p):
        raise FileNotFoundError("文件不存在")
    monkeypatch.setattr(tools.file_storage, "read_file", boom)
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(att.id))
    assert "error" in out
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_tools.py -k read_attachment_content -v`
Expected: FAIL（`AttributeError: tools.file_storage` 或 `KeyError`）。

- [ ] **Step 3: 实现**

在 `backend/app/assistant/tools.py`：

1. import 区追加（紧跟 `from ..models import User, DocumentAttachment` 之后）：
```python
from ..file_storage import file_storage
from . import attachment_reader
```

2. 在 `DOWNLOAD_ROLES = {...}` 行之后追加：
```python
CONTENT_READ_ROLES = {"admin", "engineer"}
```

3. 追加工具函数（放在 `download_document` 附近）：
```python
def read_attachment_content(db: Session, user: User, attachment_id: str):
    if user.role not in CONTENT_READ_ROLES:
        return {"error": "当前账号无附件内容读取权限（仅管理员/工程师）"}
    try:
        att = db.query(DocumentAttachment).filter(
            DocumentAttachment.id == uuid.UUID(attachment_id)).first()
    except (ValueError, TypeError):
        att = None
    if not att:
        return {"error": "附件不存在"}
    if not att.file_path:
        return {"error": "附件文件不存在"}
    try:
        data = file_storage.read_file(att.file_path)
    except FileNotFoundError:
        return {"error": "附件文件不存在"}
    max_chars = int(os.getenv("ASSISTANT_ATTACHMENT_MAX_CHARS", "20000"))
    return attachment_reader.extract_text(data, att.file_name or "", max_chars)
```

4. `REGISTRY` 追加：
```python
    "read_attachment_content": {
        "execute": read_attachment_content,
        "schema": {"type": "function", "function": {
            "name": "read_attachment_content",
            "description": ("读取附件正文供你总结分析，支持 pdf/docx/xlsx/md/txt/csv/json。"
                            "先通过文档接口拿到 attachment_id 再调用。超长正文会被截断。"),
            "parameters": {"type": "object", "properties": {
                "attachment_id": {"type": "string"},
            }, "required": ["attachment_id"]},
        }},
    },
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend; python -m pytest tests/test_tools.py -k read_attachment_content -v`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/assistant/tools.py backend/tests/test_tools.py
git commit -m "feat(assistant): read_attachment_content 工具（仅admin/engineer）"
```

---

## Phase 3：系统提示 + 配置

### Task 3.1：系统提示与配置项

**Files:**
- Modify: `backend/app/assistant/agent.py`
- Modify: `docker-compose.yml`
- Modify: `.env`（本地，gitignore 不入库）
- Test: `backend/tests/test_agent.py`（追加）

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_agent.py` 末尾追加：
```python
def test_system_prompt_mentions_attachment_content_reading():
    from app.assistant import agent as agent_mod
    assert "read_attachment_content" in agent_mod.SYSTEM_PROMPT
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend; python -m pytest tests/test_agent.py -k attachment_content_reading -v`
Expected: FAIL。

- [ ] **Step 3: 实现系统提示**

在 `backend/app/assistant/agent.py` 的 `SYSTEM_PROMPT = (...)` 内，将末句
```python
    "正文可按文件名列出清单，下载入口由按钮提供。"
```
替换为：
```python
    "正文可按文件名列出清单，下载入口由按钮提供。"
    "需要分析附件内容（pdf/word/excel/文本）时，先经文档接口取得 attachment_id，"
    "再调用 read_attachment_content 读取正文后总结分析。"
```

- [ ] **Step 4: 配置项**

1. 本地 `.env` 的「AI 助手配置」段追加（不入库，手动）：
```
ASSISTANT_ATTACHMENT_MAX_CHARS=20000
```
2. `docker-compose.yml` 的 backend `environment:`（`ASSISTANT_API_TIMEOUT` 行之后）追加：
```yaml
      - ASSISTANT_ATTACHMENT_MAX_CHARS=${ASSISTANT_ATTACHMENT_MAX_CHARS:-20000}
```

- [ ] **Step 5: 运行确认通过 + 全量回归**

Run: `cd backend; python -m pytest -v`
Expected: 全部 PASS（约 58 个）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/assistant/agent.py docker-compose.yml backend/tests/test_agent.py
git commit -m "feat(assistant): 系统提示告知附件正文读取能力并透传配置"
```

---

## Phase 4：部署与实测

### Task 4.1：重建镜像与浏览器/HTTP 实测

> 无单测，由控制者/用户执行。新增了 pip 依赖，**必须重建镜像**。

- [ ] **Step 1: 重建后端**

Run: `docker-compose up -d --build backend`
Expected: Started；`docker logs bom_backend --tail 5` 无 import 错误。

- [ ] **Step 2: 容器内提取自测（用真实已上传的 PDF 附件）**

Run:
```
docker exec bom_backend python -c "
from app.database import SessionLocal
from app.models import DocumentAttachment
from app.file_storage import file_storage
from app.assistant.attachment_reader import extract_text
db = SessionLocal()
att = db.query(DocumentAttachment).first()
print('attachment:', att.file_name)
data = file_storage.read_file(att.file_path)
out = extract_text(data, att.file_name, 20000)
print('keys:', sorted(out.keys()))
print('preview:', (out.get('text') or out.get('error'))[:200])
db.close()
"
```
Expected: 打印附件名与正文前 200 字（PDF 提取生效）。

- [ ] **Step 3: 真实对话实测（admin/admin123）**

对话输入「读取 DOC-1 和 DOC-2 的附件内容，并进行总结分析」：
- 模型应链路：查文档→列附件→对每个附件调 `read_attachment_content`→输出两份内容的总结分析。
- 验证要点：总结内容确实来自 PDF 正文（如出现文内关键词）；超长被截断时模型有说明。

- [ ] **Step 4: 无需 commit**

---

## 验收清单

- [ ] `cd backend; python -m pytest -v` 全绿（含 attachment_reader 7 用例、tools 4 用例、agent 1 用例）
- [ ] 镜像重建后启动无错；容器内对真实 PDF 提取出正文
- [ ] 对话「读取 DOC-1 和 DOC-2 的附件内容并总结分析」得到基于正文的分析
- [ ] guest/production 调用被拒；不支持格式有友好提示；超长截断

## 备注（二期）

- 旧版 .doc/.xls、图片 OCR、STP 摘要。
- 提取结果缓存（同附件重复分析省时）。
- 复杂版式 PDF 提取不全时可换 pdfplumber。
