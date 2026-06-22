from app.routers.attachments_v2 import _ACTION_PERM, _preview_media_type


def test_office_pdf_action_maps_to_preview_permission():
    assert _ACTION_PERM.get("office-pdf") == "attachments:preview"


def test_preview_media_type_text_family_is_utf8_plain():
    for name in ["a.txt", "a.md", "a.csv", "a.log", "a.json", "a.xml", "A.MD"]:
        assert _preview_media_type(name) == "text/plain; charset=utf-8"


def test_preview_media_type_image_uses_guess():
    assert _preview_media_type("a.png") == "image/png"


def test_preview_media_type_pdf():
    assert _preview_media_type("a.pdf") == "application/pdf"


def test_preview_media_type_unknown_octet_stream():
    assert _preview_media_type("a.unknownext") == "application/octet-stream"
