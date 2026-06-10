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
