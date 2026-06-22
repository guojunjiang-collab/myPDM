# backend/tests/test_office_converter.py
from pathlib import Path
import pytest
from app import office_converter
from app.office_converter import is_office_file, get_pdf_cache_path, get_pdf_path_for_attachment


@pytest.fixture(autouse=True)
def _tmp_cache_dir(tmp_path, monkeypatch):
    """把 PDF_CACHE_DIR 指向临时目录，避免依赖容器内 /app 路径"""
    monkeypatch.setattr(office_converter, "PDF_CACHE_DIR", tmp_path / "pdf_cache")


def test_is_office_file_true():
    for name in ["a.doc", "a.docx", "a.xls", "a.xlsx", "a.ppt", "a.pptx", "A.DOCX"]:
        assert is_office_file(name) is True


def test_is_office_file_false():
    for name in ["a.pdf", "a.txt", "a.stp", "a.zip", "", "noext"]:
        assert is_office_file(name) is False


def test_get_pdf_cache_path_uses_folder_and_stem():
    p = get_pdf_cache_path("att-1", "documents/test-DOC_A/spec.docx")
    assert p.name == "spec.pdf"
    assert p.parent.name == "test-DOC_A"


def test_get_pdf_path_for_attachment_missing_returns_none():
    assert get_pdf_path_for_attachment("att-x", "documents/none/none.docx") is None


def test_delete_pdf_cache_removes_existing_and_noops_on_missing():
    from app.office_converter import get_pdf_cache_path, delete_pdf_cache
    # missing → no error
    delete_pdf_cache("att-1", "documents/test-DOC_A/spec.docx")
    # create then delete
    p = get_pdf_cache_path("att-1", "documents/test-DOC_A/spec.docx")
    p.write_bytes(b"%PDF-1.4 test")
    assert p.exists()
    delete_pdf_cache("att-1", "documents/test-DOC_A/spec.docx")
    assert not p.exists()


from app.office_converter import convert_office_to_pdf


def test_convert_office_missing_source_returns_none():
    assert convert_office_to_pdf("/nonexistent/path/a.docx", "att-1", "documents/x/a.docx") is None
