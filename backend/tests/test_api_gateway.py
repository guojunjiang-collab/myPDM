from app.assistant import api_gateway as gw


def test_is_allowed_business_paths():
    assert gw.is_allowed("/api/parts/")
    assert gw.is_allowed("/api/parts/abc-123")
    assert gw.is_allowed("/api/bom/tree/assembly/abc")
    assert gw.is_allowed("/api/ecrs/")
    assert gw.is_allowed("/api/v2/attachments/")


def test_is_allowed_denies_sensitive_and_binary():
    assert not gw.is_allowed("/api/users/")
    assert not gw.is_allowed("/api/logs/")
    assert not gw.is_allowed("/api/admin/soft-deleted-stats")
    assert not gw.is_allowed("/api/sync/status")
    assert not gw.is_allowed("/api/dashboard/")
    assert not gw.is_allowed("/api/bom/export/assembly/abc")
    assert not gw.is_allowed("/api/v2/attachments/abc/download")
    assert not gw.is_allowed("/api/v2/attachments/abc/preview")
    assert not gw.is_allowed("/api/v2/attachments/abc/gltf")


def test_build_catalog_filters_to_allowed_get():
    fake_openapi = {"paths": {
        "/api/parts/": {"get": {"summary": "零件列表", "parameters": [
            {"name": "search", "in": "query"}, {"name": "limit", "in": "query"}]}},
        "/api/parts/{part_id}": {"get": {"summary": "零件详情", "parameters": [
            {"name": "part_id", "in": "path"}]}},
        "/api/users/": {"get": {"summary": "用户列表"}},
        "/api/bom/export/{item_type}/{item_id}": {"get": {"summary": "导出"}},
        "/api/parts/": {"post": {"summary": "创建零件"}},  # post 不计
    }}
    cat = gw.build_catalog(fake_openapi)
    paths = {e["path"] for e in cat}
    assert "/api/parts/{part_id}" in paths
    assert "/api/users/" not in paths
    assert "/api/bom/export/{item_type}/{item_id}" not in paths
    detail = next(e for e in cat if e["path"] == "/api/parts/{part_id}")
    assert detail["method"] == "GET"
    assert detail["path_params"] == ["part_id"]
