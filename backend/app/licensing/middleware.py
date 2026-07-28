"""许可拦截中间件。"""
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from . import state as st

WHITELIST_PREFIXES: tuple[str, ...] = (
    "/api/license",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/docs",
    "/api/redoc",
    "/api/openapi.json",
)

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

_BLOCK_MESSAGE = "许可证已过期或无效，系统处于只读模式，请联系供应商续期"


class LicenseMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path

        if path.startswith(WHITELIST_PREFIXES):
            return await call_next(request)

        info = st.load()

        denied = st.denied_module_for_path(path, info)
        if denied is not None:
            return JSONResponse(status_code=403, content={
                "detail": "该模块未授权",
                "license_state": "MODULE_DENIED",
                "module": denied,
            })

        if request.method in WRITE_METHODS and st.is_write_blocked(info):
            return JSONResponse(status_code=403, content={
                "detail": _BLOCK_MESSAGE,
                "license_state": info.state.value,
            })

        response = await call_next(request)
        if info.state is st.LicenseState.GRACE:
            safe_reason = info.reason.encode("latin-1", errors="replace").decode("latin-1")
            response.headers["X-License-Warning"] = safe_reason
        return response
