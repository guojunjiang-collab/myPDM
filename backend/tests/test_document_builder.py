import os
from app.assistant import document_builder as db_mod


def test_build_markdown_persists_and_returns_meta(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    meta = db_mod.build_document(title="变更报告", content="# 标题\n正文", fmt="md")
    assert meta["doc_id"]
    assert meta["format"] == "md"
    saved = os.path.join(str(tmp_path), "assistant_artifacts", meta["doc_id"] + ".md")
    assert os.path.exists(saved)
    with open(saved, encoding="utf-8") as f:
        assert "正文" in f.read()


def test_read_document_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    meta = db_mod.build_document(title="t", content="hello", fmt="md")
    assert db_mod.read_document(meta["doc_id"]) == "hello"


def test_read_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    assert db_mod.read_document("nope") is None
