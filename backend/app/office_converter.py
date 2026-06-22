# backend/app/office_converter.py
"""
Office 文档转 PDF 服务（用于浏览器内嵌预览）
- doc/docx/xls/xlsx/ppt/pptx 经 LibreOffice(soffice) 转 PDF
- PDF 缓存到 uploads/pdf_cache/{图文档文件夹}/{stem}.pdf（随 uploads 卷持久化）
- 删除 Office 附件时同步清理对应 PDF
- 使用 Semaphore 限制并发 soffice 进程
结构对齐 stp_converter.py。
"""
import shutil
import subprocess
import logging
import tempfile
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# PDF 缓存目录（容器内路径，对应宿主机 uploads/pdf_cache/）
PDF_CACHE_DIR = Path("/app/uploads/pdf_cache")

OFFICE_EXTS = (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")

# 并发控制：最多同时运行 2 个 soffice 进程
_office_semaphore = threading.Semaphore(2)


def is_office_file(filename: str) -> bool:
    """判断是否为受支持的 Office 文件"""
    if not filename:
        return False
    return Path(filename).suffix.lower() in OFFICE_EXTS


def get_pdf_cache_path(attachment_id: str, file_path: str = None) -> Path:
    """获取附件对应的 PDF 缓存路径（仿 get_glb_cache_path）"""
    if file_path:
        src = Path(file_path)
        folder_name = src.parent.name
        pdf_filename = src.stem + ".pdf"
        target_dir = PDF_CACHE_DIR / folder_name
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / pdf_filename
    PDF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return PDF_CACHE_DIR / f"{attachment_id}.pdf"


def get_pdf_path_for_attachment(attachment_id: str, file_path: str = None) -> Optional[str]:
    """获取附件对应 PDF 路径（不触发转换）"""
    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    return str(pdf_path) if pdf_path.exists() else None


def delete_pdf_cache(attachment_id: str, file_path: str = None):
    """删除附件对应的 PDF 缓存"""
    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    if pdf_path.exists():
        pdf_path.unlink()
        logger.info(f"已删除 PDF 缓存: {pdf_path}")
