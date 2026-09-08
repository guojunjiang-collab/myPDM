import asyncio
import inspect
import json
import logging
from websockets.asyncio.server import serve

logger = logging.getLogger(__name__)


class BridgeServer:
    """CAD 桥接 WebSocket 服务端，JSON-RPC 消息路由"""

    def __init__(self, host: str = "127.0.0.1", port: int = 9527):
        self.host = host
        self.port = port
        self.handlers: dict[str, callable] = {}

    def register(self, method: str, handler: callable):
        """注册方法处理器"""
        self.handlers[method] = handler

    def _make_progress_sender(self, websocket, req_id):
        """构造线程安全的进度发送器（单飞合并，防并发 send 冲突）。

        进度消息尽力而为：发送失败静默丢弃，不影响最终响应。
        供 handler 在后台线程执行长任务时，实时回投进度到前端。"""
        loop = asyncio.get_running_loop()
        state = {"pending": None, "sending": False}

        async def _flush():
            state["sending"] = True
            while state["pending"] is not None:
                payload = state["pending"]
                state["pending"] = None
                try:
                    await websocket.send(json.dumps({
                        "event": "progress", "request_id": req_id, **payload
                    }))
                except Exception:
                    pass
            state["sending"] = False

        def send_progress(payload: dict) -> None:
            state["pending"] = payload
            if not state["sending"]:
                loop.call_soon_threadsafe(asyncio.ensure_future, _flush())

        return send_progress

    async def _handle_message(self, websocket, raw: str) -> str:
        """处理单条 JSON-RPC 消息，返回响应 JSON 字符串"""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return json.dumps({
                "id": None,
                "error": {"code": "PARSE_ERROR", "message": "无效的 JSON 格式"}
            })

        req_id = msg.get("id")
        method = msg.get("method", "")
        params = msg.get("params", {})
        token = msg.get("token", "")

        if method not in self.handlers:
            return json.dumps({
                "id": req_id,
                "error": {"code": "METHOD_NOT_FOUND", "message": f"未知方法: {method}"}
            })

        try:
            handler = self.handlers[method]
            if len(inspect.signature(handler).parameters) >= 3:
                result = await handler(params, token, self._make_progress_sender(websocket, req_id))
            else:
                result = await handler(params, token)
            return json.dumps({"id": req_id, "result": result})
        except Exception as e:
            logger.exception(f"方法 {method} 执行失败")
            return json.dumps({
                "id": req_id,
                "error": {"code": "INTERNAL_ERROR", "message": str(e)}
            })

    async def _connection_handler(self, websocket):
        """WebSocket 连接处理"""
        logger.info(f"客户端连接: {websocket.remote_address}")
        try:
            async for message in websocket:
                response = await self._handle_message(websocket, message)
                await websocket.send(response)
        except Exception as e:
            logger.error(f"连接异常: {e}")
        finally:
            logger.info("客户端断开")

    async def start(self):
        """启动服务"""
        async with serve(self._connection_handler, self.host, self.port,
                         ping_interval=20, ping_timeout=10, open_timeout=5):
            logger.info(f"桥接服务启动: ws://{self.host}:{self.port}")
            await asyncio.get_running_loop().create_future()  # 永久运行
