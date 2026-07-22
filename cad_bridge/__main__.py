"""CAD 桥接服务入口
用法: python -m cad_bridge
PDM 地址由浏览器前端自动传入（无需手动指定 --pdm-url）
"""
import sys
import os
import asyncio
import logging
import argparse

from cad_bridge.server import BridgeServer
from cad_bridge.pdm_client import PDMClient
from cad_bridge.catia.client import catia_client


def _load_dotenv():
    """加载 cad_bridge 目录下的 .env 文件（系统环境变量优先级更高）"""
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.isfile(env_file):
        return
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip()
            if key:
                os.environ.setdefault(key, val)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("cad_bridge")


def register_handlers(server: BridgeServer, pdm_client: PDMClient):
    """注册所有 JSON-RPC 方法处理器"""

    async def handle_ping(params: dict, token: str) -> dict:
        return {"status": "ok"}

    async def handle_detect(params: dict, token: str) -> dict:
        return catia_client.detect()

    async def handle_read_tree(params: dict, token: str) -> dict:
        return catia_client.read_assembly_tree(params)

    async def handle_read_properties(params: dict, token: str) -> dict:
        return catia_client.read_properties(params)

    async def handle_write_property(params: dict, token: str) -> dict:
        return catia_client.write_property(params)

    async def handle_mapping_get(params: dict, token: str) -> dict:
        # 字段映射单一事实源：cad_bridge/catia/field_mapping.json（服务启动时加载）
        return catia_client.mapping

    async def handle_download(params: dict, token: str) -> dict:
        attachment_id = params["attachment_id"]
        revision_code = params.get("code", "unknown")
        revision_version = params.get("version", "A")
        save_dir = params.get("save_dir") or f"./cad_workspace/{revision_code}/{revision_version}"
        pdm_url = params.get("pdm_url")
        return await pdm_client.download_attachment(attachment_id, save_dir, token, base_url=pdm_url)

    async def handle_upload(params: dict, token: str) -> dict:
        file_path = params["file_path"]
        revision_id = params["revision_id"]
        category = params.get("category", "cad")
        overwrite = bool(params.get("overwrite", False))
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(file_path, revision_id, category, token, overwrite=overwrite, base_url=pdm_url)
        uploaded = [os.path.basename(file_path)]
        # 上传源文件时，同目录同名的 CATDrawing 工程图（若存在）一并上传
        if params.get("include_drawing"):
            base, _ = os.path.splitext(file_path)
            drawing_path = base + ".CATDrawing"
            if os.path.isfile(drawing_path):
                await pdm_client.upload_attachment(drawing_path, revision_id, category, token, overwrite=overwrite, base_url=pdm_url)
                uploaded.append(os.path.basename(drawing_path))
        return {"uploaded": uploaded, **(result or {})}

    async def handle_export_stp_upload(params: dict, token: str) -> dict:
        # 导出 CATIA 零部件为 STP 并上传为 PDM 生产附件（同名覆盖）
        export = catia_client.export_stp(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    async def handle_export_pdf_upload(params: dict, token: str) -> dict:
        # 将零部件工程图(CATDrawing)转 PDF 并上传为 PDM 生产附件（同名覆盖）
        export = catia_client.export_drawing_pdf(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    server.register("catia.ping", handle_ping)
    server.register("catia.detect", handle_detect)
    server.register("catia.assembly.read_tree", handle_read_tree)
    server.register("catia.assembly.read_properties", handle_read_properties)
    server.register("catia.property.write", handle_write_property)
    server.register("mapping.get", handle_mapping_get)
    server.register("workspace.download", handle_download)
    server.register("workspace.upload", handle_upload)
    server.register("workspace.export_stp_upload", handle_export_stp_upload)
    server.register("workspace.export_pdf_upload", handle_export_pdf_upload)


def main():
    _load_dotenv()
    parser = argparse.ArgumentParser(description="CAD 桥接服务")
    parser.add_argument("--port", type=int, default=9527, help="WebSocket 监听端口（默认 9527）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--pdm-url", type=str, default="",
                        help="PDM 后端地址（可选回退值；实际地址由浏览器前端动态提供）")
    args = parser.parse_args()

    pdm_client = PDMClient(base_url=args.pdm_url)
    server = BridgeServer(host=args.host, port=args.port)
    register_handlers(server, pdm_client)

    logger.info(f"CAD 桥接服务启动中...")
    logger.info(f"  WebSocket: ws://{args.host}:{args.port}")
    if args.pdm_url:
        logger.info(f"  PDM 后端（回退值）: {args.pdm_url}")
    else:
        logger.info(f"  PDM 地址由浏览器前端动态提供（无需手动指定）")

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("服务已停止")
    except Exception as e:
        logger.error(f"服务异常退出: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
