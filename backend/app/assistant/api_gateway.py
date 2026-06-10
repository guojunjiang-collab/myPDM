"""AI 只读网关：白名单判定、接口目录、ASGI 进程内转发。"""
import os
import json
import asyncio

# 业务数据路由前缀（均在 /api 下，附件在 /api/v2）——允许
ALLOWED_PREFIXES = (
    "/api/parts", "/api/assemblies", "/api/bom", "/api/documents",
    "/api/v2/attachments", "/api/configurations", "/api/custom-fields",
    "/api/ecos", "/api/ecrs",
)
# 二进制/文件/导出子路径——拒绝（返回文件，不该进模型上下文）
DENIED_PATTERNS = (
    "/stream", "/download", "/direct-download", "/preview", "/gltf",
    "/extract-file", "/bom/export/",
)


def is_allowed(path: str) -> bool:
    """仅放行业务前缀且不含二进制/导出模式的路径。"""
    if not any(path.startswith(p) for p in ALLOWED_PREFIXES):
        return False
    if any(pat in path for pat in DENIED_PATTERNS):
        return False
    return True


def build_catalog(openapi: dict) -> list:
    """从 OpenAPI 文档构建白名单只读接口目录。"""
    out = []
    for path, methods in openapi.get("paths", {}).items():
        if "get" not in methods:
            continue
        if not is_allowed(path):
            continue
        op = methods["get"]
        params = op.get("parameters", []) or []
        out.append({
            "path": path,
            "method": "GET",
            "summary": op.get("summary") or op.get("description") or "",
            "path_params": [p["name"] for p in params if p.get("in") == "path"],
            "query_params": [p["name"] for p in params if p.get("in") == "query"],
        })
    return out


def list_api_endpoints(db, user):
    """工具：返回白名单只读接口目录。"""
    from ..main import app  # 延迟导入避免循环
    return {"endpoints": build_catalog(app.openapi())}


async def _forward_async(app, path, query, token):
    import httpx
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    timeout = float(os.getenv("ASSISTANT_API_TIMEOUT", "15"))
    async with httpx.AsyncClient(transport=transport,
                                 base_url="http://pdm.internal") as client:
        resp = await client.get(path, params=query or {}, headers=headers,
                                timeout=timeout)
    return resp.status_code, resp.text


def real_forward(path, query, token):
    """默认转发器：进程内 ASGI 调用真实 app。"""
    from ..main import app  # 延迟导入避免循环
    return asyncio.run(_forward_async(app, path, query, token))


def call_read_api(db, user, path, query=None, _token=None, _forward=None):
    """工具：把 GET 请求转发到白名单内的真实接口。

    _forward 仅供测试注入；生产用 real_forward（带用户 token 的 ASGI 转发）。
    """
    if not is_allowed(path):
        return {"error": "该接口不在 AI 可读范围（仅业务数据只读接口）"}
    forward = _forward or real_forward
    try:
        status, text = forward(path, query, _token)
    except Exception as exc:
        return {"error": f"接口调用失败: {exc}"}
    if status >= 400:
        return {"status": status, "error": text[:500]}
    max_chars = int(os.getenv("ASSISTANT_API_MAX_CHARS", "8000"))
    if len(text) > max_chars:
        return {"status": status, "_truncated": True,
                "data_preview": text[:max_chars],
                "hint": "结果过大，请用 limit/search/skip 等查询参数缩小范围"}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = text
    return {"status": status, "data": data}
