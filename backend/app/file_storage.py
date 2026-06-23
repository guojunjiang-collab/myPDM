"""
文件存储服务 - 支持文件系统存储和分块上传
"""
import os
import uuid
import hashlib
import json
from datetime import datetime
from typing import Optional, Dict, Any
from pathlib import Path

# 配置
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
CHUNK_DIR = os.getenv("CHUNK_DIR", "./uploads/chunks")
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 100 * 1024 * 1024))  # 默认 100MB
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", 5 * 1024 * 1024))  # 默认 5MB 每块

# 安全白名单
ALLOWED_ENTITY_TYPES = {"document", "part", "assembly"}
# 历史代码中实体类型存在单复数混用（如 "documents"），统一归一到单数规范，
# 避免白名单校验把合法上传判为“无效的实体类型”而返回 500。
ENTITY_TYPE_ALIASES = {"documents": "document", "parts": "part", "assemblies": "assembly"}
ALLOWED_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.dwg', '.dxf', '.stp', '.step', '.igs', '.iges',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz',
    '.glb', '.gltf', '.obj',
    '.txt', '.csv', '.md', '.log', '.json', '.xml',
}


class FileStorage:
    """文件系统存储服务"""
    
    def __init__(self, base_dir: str = UPLOAD_DIR):
        self.base_dir = Path(base_dir)
        self.chunk_dir = Path(CHUNK_DIR)
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        """确保目录存在"""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.chunk_dir.mkdir(parents=True, exist_ok=True)
    
    def _validate_filename(self, filename: str):
        """验证文件名合法性"""
        if not filename:
            raise ValueError("文件名不能为空")
        ext = filename.lower().rsplit('.', maxsplit=1)[-1]
        if f'.{ext}' not in ALLOWED_EXTENSIONS:
            raise ValueError(f"不允许的文件类型: .{ext}")
        if '..' in filename or '/' in filename or '\\' in filename or '\x00' in filename:
            raise ValueError("文件名包含非法字符")

    def _safe_resolve(self, relative_path: str) -> Path:
        """安全解析路径，防止路径遍历"""
        full_path = (self.base_dir / relative_path).resolve()
        if not full_path.is_relative_to(self.base_dir.resolve()):
            raise ValueError("非法文件路径")
        return full_path

    def _get_file_path(self, entity_type: str, entity_id: str, filename: str, folder_name: str = None) -> Path:
        """获取文件存储路径"""
        entity_type = ENTITY_TYPE_ALIASES.get(entity_type, entity_type)
        if entity_type not in ALLOWED_ENTITY_TYPES:
            raise ValueError(f"无效的实体类型: {entity_type}")

        dir_name = str(entity_id)
        if folder_name:
            sanitized = folder_name.strip().strip('.')
            illegal_chars = r'\/:*?"<>|' + '\x00'
            for ch in illegal_chars:
                sanitized = sanitized.replace(ch, '_')
            dir_name = sanitized if sanitized else str(entity_id)

        entity_dir = (self.base_dir / entity_type / dir_name).resolve()
        if not entity_dir.is_relative_to(self.base_dir.resolve()):
            raise ValueError("非法文件路径")
        entity_dir.mkdir(parents=True, exist_ok=True)

        file_path = (entity_dir / filename).resolve()
        if not file_path.is_relative_to(self.base_dir.resolve()):
            raise ValueError("非法文件路径")
        return file_path
    
    def save_file(self, file_data: bytes, entity_type: str, entity_id: str, 
                  filename: str, folder_name: str = None) -> Dict[str, Any]:
        """
        保存文件到文件系统
        
        Args:
            file_data: 文件二进制数据
            entity_type: 实体类型 (document, part, assembly)
            entity_id: 实体ID
            filename: 文件名
            folder_name: 可选的目录名称，若提供则替代 entity_id 作为文件夹名
            
        Returns:
            包含文件信息的字典
        """
        # 检查文件大小
        file_size = len(file_data)
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"文件大小 {file_size} 超过限制 {MAX_FILE_SIZE}")

        # 验证文件名
        self._validate_filename(filename)

        # 计算文件哈希
        file_hash = hashlib.sha256(file_data).hexdigest()
        
        # 获取存储路径
        file_path = self._get_file_path(entity_type, entity_id, filename, folder_name)
        
        # 如果文件已存在，添加时间戳
        if file_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            name, ext = os.path.splitext(filename)
            filename = f"{name}_{timestamp}{ext}"
            file_path = self._get_file_path(entity_type, entity_id, filename, folder_name)
        
        # 保存文件
        with open(file_path, 'wb') as f:
            f.write(file_data)
        
        return {
            "filename": filename,
            "file_path": str(file_path.relative_to(self.base_dir)),
            "file_size": file_size,
            "file_hash": file_hash,
            "entity_type": entity_type,
            "entity_id": entity_id,
        }
    
    def read_file(self, file_path: str) -> bytes:
        """读取文件"""
        full_path = self._safe_resolve(file_path)
        if not full_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        with open(full_path, 'rb') as f:
            return f.read()

    def delete_file(self, file_path: str) -> bool:
        """删除文件"""
        full_path = self._safe_resolve(file_path)
        if full_path.exists():
            full_path.unlink()

            # 删除空目录
            self._remove_empty_parent_dirs(full_path)

            return True
        return False
    
    def _remove_empty_parent_dirs(self, file_path: Path):
        """
        删除空的父目录
        
        Args:
            file_path: 文件路径（已删除）
        """
        try:
            # 获取父目录
            parent = file_path.parent
            
            # 如果父目录存在且为空，且不是 base_dir
            while parent.exists() and parent != self.base_dir:
                if not any(parent.iterdir()):  # 目录为空
                    parent.rmdir()
                    parent = parent.parent
                else:
                    break
        except Exception as e:
            print(f"[WARNING] Failed to remove empty parent dirs: {e}")
    
    def get_file_info(self, file_path: str) -> Dict[str, Any]:
        """获取文件信息"""
        full_path = self._safe_resolve(file_path)
        if not full_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")
        
        stat = full_path.stat()
        return {
            "filename": full_path.name,
            "file_path": file_path,
            "file_size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        }


class ChunkedUploader:
    """分块上传管理器"""
    
    def __init__(self, storage: FileStorage):
        self.storage = storage
        self.chunk_dir = storage.chunk_dir
    
    def _get_upload_meta_path(self, upload_id: str) -> Path:
        """获取上传元数据路径"""
        return self.chunk_dir / f"{upload_id}.meta"
    
    def _get_chunk_path(self, upload_id: str, chunk_index: int) -> Path:
        """获取分块文件路径"""
        return self.chunk_dir / f"{upload_id}_{chunk_index}.chunk"
    
    def init_upload(self, filename: str, file_size: int, entity_type: str, 
                    entity_id: str, total_chunks: int, folder_name: str = None) -> Dict[str, Any]:
        """
        初始化分块上传
        
        Args:
            filename: 文件名
            file_size: 文件总大小
            entity_type: 实体类型
            entity_id: 实体ID
            total_chunks: 总分块数
            folder_name: 可选的文件夹名，若提供则替代 entity_id 作为目录名
            
        Returns:
            上传信息字典
        """
        # 检查文件大小
        if file_size > MAX_FILE_SIZE:
            raise ValueError(f"文件大小 {file_size} 超过限制 {MAX_FILE_SIZE}")
        
        # 生成上传ID
        upload_id = str(uuid.uuid4())
        
        # 创建上传元数据
        meta = {
            "upload_id": upload_id,
            "filename": filename,
            "file_size": file_size,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "folder_name": folder_name,
            "total_chunks": total_chunks,
            "uploaded_chunks": [],
            "created_at": datetime.now().isoformat(),
            "status": "pending",
        }
        
        # 保存元数据
        meta_path = self._get_upload_meta_path(upload_id)
        with open(meta_path, 'w') as f:
            json.dump(meta, f)
        
        return meta
    
    def upload_chunk(self, upload_id: str, chunk_index: int, 
                     chunk_data: bytes) -> Dict[str, Any]:
        """
        上传分块
        
        Args:
            upload_id: 上传ID
            chunk_index: 分块索引（从0开始）
            chunk_data: 分块数据
            
        Returns:
            更新后的上传信息
        """
        # 读取元数据
        meta_path = self._get_upload_meta_path(upload_id)
        if not meta_path.exists():
            raise FileNotFoundError(f"上传不存在: {upload_id}")
        
        with open(meta_path, 'r') as f:
            meta = json.load(f)
        
        # 检查分块索引
        if chunk_index < 0 or chunk_index >= meta["total_chunks"]:
            raise ValueError(f"无效的分块索引: {chunk_index}")
        
        # 保存分块
        chunk_path = self._get_chunk_path(upload_id, chunk_index)
        with open(chunk_path, 'wb') as f:
            f.write(chunk_data)
        
        # 更新元数据
        if chunk_index not in meta["uploaded_chunks"]:
            meta["uploaded_chunks"].append(chunk_index)
            meta["uploaded_chunks"].sort()
        
        with open(meta_path, 'w') as f:
            json.dump(meta, f)
        
        return {
            "upload_id": upload_id,
            "chunk_index": chunk_index,
            "uploaded_chunks": meta["uploaded_chunks"],
            "total_chunks": meta["total_chunks"],
            "is_complete": len(meta["uploaded_chunks"]) == meta["total_chunks"],
        }
    
    def complete_upload(self, upload_id: str) -> Dict[str, Any]:
        """
        完成分块上传，合并所有分块
        
        Args:
            upload_id: 上传ID
            
        Returns:
            最终文件信息
        """
        # 读取元数据
        meta_path = self._get_upload_meta_path(upload_id)
        if not meta_path.exists():
            raise FileNotFoundError(f"上传不存在: {upload_id}")
        
        with open(meta_path, 'r') as f:
            meta = json.load(f)
        
        # 检查是否所有分块都已上传
        if len(meta["uploaded_chunks"]) != meta["total_chunks"]:
            missing = set(range(meta["total_chunks"])) - set(meta["uploaded_chunks"])
            raise ValueError(f"缺少分块: {missing}")
        
        # 合并分块
        file_data = bytearray()
        for i in range(meta["total_chunks"]):
            chunk_path = self._get_chunk_path(upload_id, i)
            with open(chunk_path, 'rb') as f:
                file_data.extend(f.read())
        
        # 保存文件
        result = self.storage.save_file(
            bytes(file_data),
            meta["entity_type"],
            meta["entity_id"],
            meta["filename"],
            folder_name=meta.get("folder_name"),
        )
        
        # 清理临时文件
        for i in range(meta["total_chunks"]):
            chunk_path = self._get_chunk_path(upload_id, i)
            if chunk_path.exists():
                chunk_path.unlink()
        
        meta_path.unlink()
        
        # 更新元数据状态
        meta["status"] = "completed"
        meta["result"] = result
        
        return {
            "upload_id": upload_id,
            "status": "completed",
            "file_info": result,
        }
    
    def get_upload_status(self, upload_id: str) -> Dict[str, Any]:
        """
        获取上传状态
        
        Args:
            upload_id: 上传ID
            
        Returns:
            上传状态信息
        """
        meta_path = self._get_upload_meta_path(upload_id)
        if not meta_path.exists():
            raise FileNotFoundError(f"上传不存在: {upload_id}")
        
        with open(meta_path, 'r') as f:
            meta = json.load(f)
        
        return {
            "upload_id": upload_id,
            "filename": meta["filename"],
            "file_size": meta["file_size"],
            "total_chunks": meta["total_chunks"],
            "uploaded_chunks": meta["uploaded_chunks"],
            "progress": len(meta["uploaded_chunks"]) / meta["total_chunks"] * 100,
            "status": meta["status"],
        }
    
    def cancel_upload(self, upload_id: str) -> bool:
        """
        取消上传，清理临时文件
        
        Args:
            upload_id: 上传ID
            
        Returns:
            是否取消成功
        """
        meta_path = self._get_upload_meta_path(upload_id)
        if not meta_path.exists():
            return False
        
        # 读取元数据获取分块数
        with open(meta_path, 'r') as f:
            meta = json.load(f)
        
        # 删除所有分块
        for i in range(meta["total_chunks"]):
            chunk_path = self._get_chunk_path(upload_id, i)
            if chunk_path.exists():
                chunk_path.unlink()
        
        # 删除元数据
        meta_path.unlink()
        
        return True


# 创建全局实例
file_storage = FileStorage()
chunked_uploader = ChunkedUploader(file_storage)
