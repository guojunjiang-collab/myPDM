"""
STP 三维模型转换服务
- 上传 STP 后自动转换为 glTF (.glb)
- glb 文件存放到同 STP 文件相同的文件夹（uploads/documents/{图文档编号_版本}/）
- 删除 STP 附件时同步清理对应的 glb 文件
- 使用 Semaphore 限制并发 Mayo 进程，防止 CPU/内存过载
"""
import os
import shutil
import subprocess
import logging
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# glb 缓存目录（容器内路径，对应宿主机 uploads/glb_cache/）
GLTF_CACHE_DIR = Path("/app/uploads/glb_cache")

# 转换脚本路径
CONVERTER_SCRIPT = "/app/app/stp_to_gltf.py"

# 并发控制：最多同时运行 2 个 Mayo 进程（OCC 三角剖分 CPU 密集）
_stp_semaphore = threading.Semaphore(2)

# uploads 根目录
UPLOAD_DIR = Path("/app/uploads")


def is_stp_file(filename: str) -> bool:
    """判断是否为 STP/STEP 文件"""
    if not filename:
        return False
    ext = Path(filename).suffix.lower()
    return ext in ('.stp', '.step')


def get_glb_cache_path(attachment_id: str, file_path: str = None) -> Path:
    """
    获取附件对应的 glb 文件路径
    
    Args:
        attachment_id: 附件 UUID
        file_path: 可选的 STP 文件路径（如 documents/test-STP-GD40_A/file.stp）
                   如果提供，glb 将存放到 gltf_cache/{图文档文件夹}/ 下
    
    Returns:
        glb 文件路径
    """
    if file_path:
        # 存放到 gltf_cache/{图文档文件夹}/ 目录
        stp_path = Path(file_path)
        folder_name = stp_path.parent.name  # 如 test-STP-GD40_A
        glb_filename = stp_path.stem + ".glb"
        target_dir = GLTF_CACHE_DIR / folder_name
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / glb_filename
    else:
        # 兼容旧方式：存放到 gltf_cache 目录
        GLTF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        return GLTF_CACHE_DIR / f"{attachment_id}.glb"


def convert_stp_to_gltf(stp_path: str, attachment_id: str, file_path: str = None) -> Optional[str]:
    """
    将 STP 文件转换为 glTF (.glb)
    使用 _stp_semaphore 限制并发 Mayo 进程数（最多 2 个）

    Args:
        stp_path: STP 文件绝对路径
        attachment_id: 附件 UUID
        file_path: 可选的 STP 文件相对路径（如 documents/test-STP-GD40_A/file.stp）
                   如果提供，glb 将存放到同文件夹

    Returns:
        glb 文件路径，失败返回 None
    """
    stp_file = Path(stp_path)
    if not stp_file.exists():
        logger.error(f"STP 文件不存在: {stp_path}")
        return None

    glb_path = get_glb_cache_path(attachment_id, file_path)

    # 已有转换结果 → 跳过
    if glb_path.exists():
        logger.info(f"glTF 缓存已存在: {glb_path}")
        return str(glb_path)

    # 创建临时输出文件（避免直接写入缓存）
    tmp_glb = stp_file.with_suffix('.tmp.glb')

    # 获取信号量（限制并发 Mayo 进程数）
    logger.info(f"等待转换槽位: {stp_path}")
    with _stp_semaphore:
        # 再次检查缓存（可能在排队期间已由其他任务生成）
        if glb_path.exists():
            logger.info(f"glTF 缓存已存在（排队期间生成）: {glb_path}")
            return str(glb_path)

        logger.info(f"开始转换 STP → glTF: {stp_path}")
        try:
            result = subprocess.run(
                ['python3', CONVERTER_SCRIPT, str(stp_file), str(tmp_glb)],
                capture_output=True,
                text=True,
                timeout=120,
            )

            if result.returncode != 0:
                logger.error(f"转换失败 (exit={result.returncode}): {result.stderr}")
                if tmp_glb.exists():
                    tmp_glb.unlink()
                return None

            if tmp_glb.exists():
                GLTF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                shutil.move(str(tmp_glb), str(glb_path))
                size_mb = glb_path.stat().st_size / 1024 / 1024
                logger.info(f"转换成功: {glb_path} ({size_mb:.2f} MB)")
                return str(glb_path)
            else:
                logger.error(f"转换完成但输出文件不存在")
                return None

        except subprocess.TimeoutExpired:
            logger.error(f"转换超时 (300s): {stp_path}")
            if tmp_glb.exists():
                tmp_glb.unlink()
            return None
        except Exception as e:
            logger.error(f"转换异常: {e}")
            if tmp_glb.exists():
                tmp_glb.unlink()
            return None


def get_gltf_path_for_attachment(attachment_id: str, file_path: str = None) -> Optional[str]:
    """获取附件对应的 glb 文件路径（不触发转换）"""
    glb_path = get_glb_cache_path(attachment_id, file_path)
    return str(glb_path) if glb_path.exists() else None


def delete_glb_cache(attachment_id: str, file_path: str = None):
    """删除附件对应的 glb 文件"""
    glb_path = get_glb_cache_path(attachment_id, file_path)
    if glb_path.exists():
        glb_path.unlink()
        logger.info(f"已删除 glb 缓存: {glb_path}")
