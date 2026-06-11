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
