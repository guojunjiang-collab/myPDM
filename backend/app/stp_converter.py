"""
STP 三维模型转换服务
- 上传 STP 后自动转换为 glTF (.glb)
- glb 文件存放到 glb 缓存目录（uploads/glb_cache/{图文档编号_版本}/）
- 删除 STP 附件时同步清理对应的 glb 文件
- 使用 Semaphore 限制并发 Mayo 进程，防止 CPU/内存过载
- 转换失败后写入 .failed 标记文件，避免无限重试
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

# GLB 文件最小有效大小（字节），低于此值视为转换失败
MIN_GLB_SIZE = 200


def is_stp_file(filename: str) -> bool:
    """判断是否为 STP/STEP 文件"""
    if not filename:
        return False
    ext = Path(filename).suffix.lower()
    return ext in ('.stp', '.step')


def get_glb_cache_path(attachment_id: str, file_path: str = None, is_part: bool = False) -> Path:
    """
    获取附件对应的 glb 文件路径（以附件 UUID 为唯一键）。

    零部件附件（is_part=True）存放到 parts/ 子目录；图文档附件直接以
    {attachment_id}.glb 命名。统一按 UUID 键避免不同图文档/版本的同名 STP
    落到同一缓存路径造成误命中与误删（历史曾用 file_path 父目录+stem 命名，
    图文档上传目录末级为迭代号，产生 glb_cache/1/xxx.glb 这类目录）。
    file_path 参数保留仅为兼容历史调用方，不再参与路径计算。

    Args:
        attachment_id: 附件 UUID
        file_path: 历史参数（不再使用）
        is_part: 是否为零部件附件（PartAttachment）

    Returns:
        glb 文件路径
    """
    if is_part:
        target_dir = GLTF_CACHE_DIR / "parts"
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / f"{attachment_id}.glb"
    GLTF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return GLTF_CACHE_DIR / f"{attachment_id}.glb"


def _get_failed_path(glb_path: Path) -> Path:
    """获取转换失败标记文件路径"""
    return glb_path.with_suffix(".failed")


def _write_failed_marker(glb_path: Path):
    """写入转换失败标记文件"""
    failed_path = _get_failed_path(glb_path)
    failed_path.parent.mkdir(parents=True, exist_ok=True)
    failed_path.touch()
    logger.info(f"已写入转换失败标记: {failed_path}")


def is_conversion_failed(attachment_id: str, file_path: str = None, is_part: bool = False) -> bool:
    """检查附件对应的 STP 转换是否已标记为失败"""
    glb_path = get_glb_cache_path(attachment_id, file_path, is_part)
    return _get_failed_path(glb_path).exists()


def clear_failed_marker(attachment_id: str, file_path: str = None, is_part: bool = False):
    """清除转换失败标记（用于手动重试）"""
    glb_path = get_glb_cache_path(attachment_id, file_path, is_part)
    failed_path = _get_failed_path(glb_path)
    if failed_path.exists():
        failed_path.unlink()
        logger.info(f"已清除转换失败标记: {failed_path}")


def convert_stp_to_gltf(stp_path: str, attachment_id: str, file_path: str = None, is_part: bool = False) -> Optional[str]:
    """
    将 STP 文件转换为 glTF (.glb)
    使用 _stp_semaphore 限制并发 Mayo 进程数（最多 2 个）
    转换失败后写入 .failed 标记，避免无限重试

    Args:
        stp_path: STP 文件绝对路径
        attachment_id: 附件 UUID
        file_path: 可选的 STP 文件相对路径（如 document/test-STP-GD40_A/file.stp）
        is_part: 是否为零部件附件

    Returns:
        glb 文件路径，失败返回 None
    """
    stp_file = Path(stp_path)
    if not stp_file.exists():
        logger.error(f"STP 文件不存在: {stp_path}")
        return None

    glb_path = get_glb_cache_path(attachment_id, file_path, is_part)

    # 已有转换结果 → 跳过
    if glb_path.exists():
        logger.info(f"glTF 缓存已存在: {glb_path}")
        return str(glb_path)

    # 已有的失败标记 → 跳过（避免重复尝试注定失败的转换）
    if is_conversion_failed(attachment_id, file_path, is_part):
        logger.info(f"转换已标记为失败，跳过: {stp_path}")
        return None

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
                _write_failed_marker(glb_path)
                return None

            if not tmp_glb.exists():
                logger.error(f"转换完成但输出文件不存在")
                _write_failed_marker(glb_path)
                return None

            # 校验输出文件大小，空模型（无几何元素）的 GLB 文件极小，视为失败
            tmp_size = tmp_glb.stat().st_size
            if tmp_size < MIN_GLB_SIZE:
                logger.error(f"转换结果异常（文件过小 {tmp_size}B，可能无几何元素）: {stp_path}")
                tmp_glb.unlink()
                _write_failed_marker(glb_path)
                return None

            GLTF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            shutil.move(str(tmp_glb), str(glb_path))
            size_mb = glb_path.stat().st_size / 1024 / 1024
            logger.info(f"转换成功: {glb_path} ({size_mb:.2f} MB)")
            return str(glb_path)

        except subprocess.TimeoutExpired:
            logger.error(f"转换超时 (120s): {stp_path}")
            if tmp_glb.exists():
                tmp_glb.unlink()
            _write_failed_marker(glb_path)
            return None
        except Exception as e:
            logger.error(f"转换异常: {e}")
            if tmp_glb.exists():
                tmp_glb.unlink()
            _write_failed_marker(glb_path)
            return None


def get_gltf_path_for_attachment(attachment_id: str, file_path: str = None, is_part: bool = False) -> Optional[str]:
    """获取附件对应的 glb 文件路径（不触发转换）"""
    glb_path = get_glb_cache_path(attachment_id, file_path, is_part)
    return str(glb_path) if glb_path.exists() else None


def delete_glb_cache(attachment_id: str, file_path: str = None, is_part: bool = False):
    """删除附件对应的 glb 文件（base + 三档 LOD）及失败标记"""
    glb_path = get_glb_cache_path(attachment_id, file_path, is_part)
    targets = [glb_path, *get_lod_glb_paths(attachment_id, file_path, is_part).values()]
    for p in targets:
        if p.exists():
            p.unlink()
            logger.info(f"已删除 glb 缓存: {p}")
    failed_path = _get_failed_path(glb_path)
    if failed_path.exists():
        failed_path.unlink()
        logger.info(f"已删除转换失败标记: {failed_path}")


import json as _json

LOD_QUALITIES = {"coarse": "Coarse", "normal": "Normal", "fine": "Fine"}


def get_lod_glb_paths(attachment_id: str, file_path: str = None, is_part: bool = False) -> dict:
    """返回三档 LOD 的 glb 路径 {coarse, normal, fine}。"""
    base = get_glb_cache_path(attachment_id, file_path, is_part)
    stem = base.stem
    out = {}
    for tier in ("coarse", "normal", "fine"):
        out[tier] = base.with_name(f"{stem}_{tier}.glb")
    return out


def read_gltf_bbox(gltf_or_glb_path: str) -> dict | None:
    """从 glTF(.gltf JSON) 读取所有 POSITION accessor 的整体 bbox。"""
    p = Path(gltf_or_glb_path)
    if p.suffix.lower() != ".gltf":
        return None
    try:
        data = _json.loads(p.read_text())
    except Exception:
        return None
    mins, maxs = None, None
    for acc in data.get("accessors", []):
        if acc.get("type") == "VEC3" and "min" in acc and "max" in acc and len(acc["min"]) == 3:
            amin, amax = acc["min"], acc["max"]
            mins = amin if mins is None else [min(a, b) for a, b in zip(mins, amin)]
            maxs = amax if maxs is None else [max(a, b) for a, b in zip(maxs, amax)]
    if mins is None:
        return None
    return {"min": mins, "max": maxs}
