import os
import re
import httpx
import logging

logger = logging.getLogger(__name__)

DEFAULT_PDM_URL = "https://localhost:8080/api"
DEFAULT_WORKSPACE = os.path.join(os.getcwd(), "cad_workspace")


class PDMClient:
    """PDM API 代理，透传 JWT，处理附件上传/下载"""

    def __init__(self, base_url: str = DEFAULT_PDM_URL):
        self.base_url = base_url.rstrip("/")
        # 使用不验证 SSL 证书（本地自签名证书）
        self._client_kwargs = {"verify": False, "timeout": 30.0}

    async def download_attachment(self, attachment_id: str, save_dir: str, token: str,
                                  base_url: str = None) -> dict:
        """下载附件到本地目录"""
        effective_url = (base_url or self.base_url).rstrip("/")
        os.makedirs(save_dir, exist_ok=True)
        async with httpx.AsyncClient(**self._client_kwargs) as client:
            # 获取媒体令牌
            token_resp = await client.get(
                f"{effective_url}/v2/attachments/{attachment_id}/media-token",
                params={"action": "direct-download"},
                headers={"Authorization": f"Bearer {token}"}
            )
            token_resp.raise_for_status()
            media_token = token_resp.json().get("token")

            # 流式下载
            resp = await client.get(
                f"{effective_url}/v2/attachments/{attachment_id}/stream",
                params={"token": media_token},
                headers={"Authorization": f"Bearer {token}"}
            )
            resp.raise_for_status()

            # 从 Content-Disposition 获取文件名
            filename = self._extract_filename(resp.headers)
            filepath = os.path.join(save_dir, filename)
            with open(filepath, "wb") as f:
                f.write(resp.content)

            return {"file_name": filename, "file_path": filepath, "file_size": len(resp.content)}

    async def upload_attachment(self, file_path: str, revision_id: str, category: str, token: str,
                                overwrite: bool = False, base_url: str = None) -> dict:
        """上传本地文件到 PDM 零部件附件。
        契约与后端一致：init/complete 为 Form 参数（filename/file_size/category、upload_id/overwrite），
        分块本身走通用端点 POST /v2/attachments/chunk/upload。
        overwrite=True 时后端删除当前迭代下同名同类旧附件（覆盖模式）。
        """
        if not file_path or not os.path.isfile(file_path):
            raise FileNotFoundError(f"本地文件不存在: {file_path}")
        filename = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)
        effective_url = (base_url or self.base_url).rstrip("/")

        async with httpx.AsyncClient(**self._client_kwargs) as client:
            # 初始化分块上传
            init_resp = await client.post(
                f"{effective_url}/parts/revisions/{revision_id}/attachments/chunk/init",
                data={
                    "filename": filename,
                    "file_size": str(file_size),
                    "category": category,
                },
                headers={"Authorization": f"Bearer {token}"}
            )
            init_resp.raise_for_status()
            upload_info = init_resp.json()
            upload_id = upload_info["upload_id"]
            chunk_size = upload_info.get("chunk_size", 5 * 1024 * 1024)

            # 分块上传（通用 v2 端点）
            with open(file_path, "rb") as f:
                chunk_index = 0
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    resp = await client.post(
                        f"{effective_url}/v2/attachments/chunk/upload",
                        data={"upload_id": upload_id, "chunk_index": str(chunk_index)},
                        files={"chunk": (filename, chunk)},
                        headers={"Authorization": f"Bearer {token}"}
                    )
                    resp.raise_for_status()
                    chunk_index += 1

            # 完成上传
            complete_resp = await client.post(
                f"{effective_url}/parts/revisions/{revision_id}/attachments/chunk/complete",
                data={"upload_id": upload_id, "overwrite": "true" if overwrite else "false"},
                headers={"Authorization": f"Bearer {token}"}
            )
            complete_resp.raise_for_status()
            return complete_resp.json()

    def _extract_filename(self, headers) -> str:
        """从 Content-Disposition 提取文件名"""
        cd = headers.get("content-disposition", "")
        if "filename=" in cd:
            match = re.search(r'filename[^;=\n]*=["\']?([^"\'\n;]*)', cd)
            if match:
                return match.group(1).strip()
        return "download"
