from app.assistant import api_gateway as gw


def test_is_allowed_business_paths():
    assert gw.is_allowed("/api/components/")
    assert gw.is_allowed("/api/components/abc-123")
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
        "/api/components/": {"get": {"summary": "零件列表", "parameters": [
            {"name": "search", "in": "query"}, {"name": "limit", "in": "query"}]}},
        "/api/components/{part_id}": {"get": {"summary": "零件详情", "parameters": [
            {"name": "part_id", "in": "path"}]}},
        "/api/users/": {"get": {"summary": "用户列表"}},
        "/api/bom/export/{item_type}/{item_id}": {"get": {"summary": "导出"}},
        "/api/components/": {"post": {"summary": "创建零件"}},  # post 不计
    }}
    cat = gw.build_catalog(fake_openapi)
    paths = {e["path"] for e in cat}
    assert "/api/components/{part_id}" in paths
    assert "/api/users/" not in paths
    assert "/api/bom/export/{item_type}/{item_id}" not in paths
    detail = next(e for e in cat if e["path"] == "/api/components/{part_id}")
    assert detail["method"] == "GET"
    assert detail["path_params"] == ["part_id"]


def test_call_read_api_rejects_unauthorized_path_without_forwarding():
    called = []
    def fake_forward(path, query, token):
        called.append(path); return 200, "{}"
    out = gw.call_read_api(None, None, path="/api/users/", _forward=fake_forward)
    assert "error" in out
    assert called == []  # 未授权路径不应转发


def test_call_read_api_forwards_with_token_and_parses_json():
    seen = {}
    def fake_forward(path, query, token):
        seen.update(path=path, query=query, token=token)
        return 200, '{"items": [1, 2, 3]}'
    out = gw.call_read_api(None, None, path="/api/components/", query={"limit": 5},
                           _token="tok-abc", _forward=fake_forward)
    assert seen["token"] == "tok-abc"
    assert seen["query"] == {"limit": 5}
    assert out["status"] == 200
    assert out["data"] == {"items": [1, 2, 3]}


def test_call_read_api_truncates_oversized(monkeypatch):
    monkeypatch.setenv("ASSISTANT_API_MAX_CHARS", "20")
    def fake_forward(path, query, token):
        return 200, "x" * 100
    out = gw.call_read_api(None, None, path="/api/components/", _forward=fake_forward)
    assert out["_truncated"] is True
    assert "hint" in out
    assert len(out["data_preview"]) == 20


def test_call_read_api_returns_error_on_4xx():
    def fake_forward(path, query, token):
        return 403, '{"detail": "权限不足"}'
    out = gw.call_read_api(None, None, path="/api/ecrs/", _forward=fake_forward)
    assert out["status"] == 403
    assert "error" in out


def test_roles_for_route_reads_per_endpoint_roles():
    from app.main import app
    from fastapi.routing import APIRoute
    by_path = {r.path: gw.roles_for_route(r) for r in app.routes
               if isinstance(r, APIRoute) and "GET" in r.methods}
    assert "guest" in by_path["/api/components/"]
    assert "guest" not in by_path["/api/bom/tree/{item_type}/{item_id}"]


def test_filter_catalog_by_role():
    catalog = [{"path": "/api/components/"}, {"path": "/api/bom/tree/x"}, {"path": "/api/foo"}]
    roles_map = {"/api/components/": {"admin", "engineer", "production", "guest"},
                 "/api/bom/tree/x": {"admin", "engineer", "production"}}
    guest = gw.filter_catalog_by_role(catalog, "guest", roles_map)
    paths = {e["path"] for e in guest}
    assert "/api/components/" in paths
    assert "/api/bom/tree/x" not in paths   # guest 不在允许集
    assert "/api/foo" in paths               # 无角色门(None)→保留


def test_endpoint_roles_map_has_business_paths():
    m = gw.endpoint_roles_map()
    assert "guest" in m["/api/components/"]
