from app.routers.attachments_v2 import _ACTION_PERM


def test_office_pdf_action_maps_to_preview_permission():
    assert _ACTION_PERM.get("office-pdf") == "attachments:preview"
