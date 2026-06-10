"""AI 文档产物组装与落地（v1 仅 Markdown，预留 docx/xlsx/pdf）。"""
import os
import uuid
import re

SUPPORTED = {"md"}


def _artifacts_dir() -> str:
    base = os.getenv("UPLOAD_DIR", "/app/uploads")
    d = os.path.join(base, "assistant_artifacts")
    os.makedirs(d, exist_ok=True)
    return d


def _safe_doc_id(doc_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", doc_id or ""):
        raise ValueError("非法 doc_id")
    return doc_id


def build_document(title: str, content: str, fmt: str = "md") -> dict:
    if fmt not in SUPPORTED:
        raise ValueError(f"暂不支持的格式: {fmt}")
    doc_id = uuid.uuid4().hex
    body = content
    path = os.path.join(_artifacts_dir(), f"{doc_id}.{fmt}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return {"doc_id": doc_id, "title": title, "format": fmt,
            "preview": body, "download_url": f"/api/assistant/artifacts/{doc_id}/download"}


def read_document(doc_id: str) -> "str | None":
    doc_id = _safe_doc_id(doc_id)
    path = os.path.join(_artifacts_dir(), f"{doc_id}.md")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()
