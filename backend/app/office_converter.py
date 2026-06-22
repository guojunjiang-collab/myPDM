# backend/app/office_converter.py
"""
Office 文档转 PDF 服务（用于浏览器内嵌预览）
- doc/docx/xls/xlsx/ppt/pptx 经 LibreOffice(soffice) 转 PDF
- PDF 缓存到 uploads/pdf_cache/{图文档文件夹}/{stem}.pdf（随 uploads 卷持久化）
- 删除 Office 附件时同步清理对应 PDF
- 使用 Semaphore 限制并发 soffice 进程
结构对齐 stp_converter.py。
"""
import logging
import shutil
import subprocess
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


def convert_office_to_pdf(src_path: str, attachment_id: str, file_path: str = None) -> Optional[str]:
    """
    将 Office 文件转换为 PDF。
    使用 _office_semaphore 限制并发 soffice 进程数（最多 2 个）。
    Returns: PDF 路径，失败返回 None。
    """
    src_file = Path(src_path)
    if not src_file.exists():
        logger.error(f"Office 源文件不存在: {src_path}")
        return None

    pdf_path = get_pdf_cache_path(attachment_id, file_path)
    if pdf_path.exists():
        logger.info(f"PDF 缓存已存在: {pdf_path}")
        return str(pdf_path)

    logger.info(f"等待 Office 转换槽位: {src_path}")
    with _office_semaphore:
        # 排队期间可能已由其它任务生成
        if pdf_path.exists():
            logger.info(f"PDF 缓存已存在（排队期间生成）: {pdf_path}")
            return str(pdf_path)

        logger.info(f"开始转换 Office → PDF: {src_path}")
        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                result = subprocess.run(
                    ["soffice", "--headless", "--convert-to", "pdf",
                     "--outdir", tmpdir, str(src_file)],
                    capture_output=True, text=True, timeout=120,
                )
                if result.returncode != 0:
                    logger.error(f"Office 转换失败 (exit={result.returncode}): {result.stderr}")
                    return None

                # soffice 输出文件名为 {源stem}.pdf
                out_pdf = Path(tmpdir) / (src_file.stem + ".pdf")
                if not out_pdf.exists():
                    logger.error("Office 转换完成但输出 PDF 不存在")
                    return None

                pdf_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(out_pdf), str(pdf_path))
                size_mb = pdf_path.stat().st_size / 1024 / 1024
                logger.info(f"Office 转换成功: {pdf_path} ({size_mb:.2f} MB)")
                return str(pdf_path)
            except subprocess.TimeoutExpired:
                logger.error(f"Office 转换超时 (120s): {src_path}")
                return None
            except Exception as e:
                logger.error(f"Office 转换异常: {e}")
                return None
