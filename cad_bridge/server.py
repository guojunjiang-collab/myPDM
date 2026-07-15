import asyncio
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
            result = await self.handlers[method](params, token)
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
        async with serve(self._connection_handler, self.host, self.port):
            logger.info(f"桥接服务启动: ws://{self.host}:{self.port}")
            await asyncio.get_running_loop().create_future()  # 永久运行
