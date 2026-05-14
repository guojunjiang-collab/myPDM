#!/usr/bin/env python3
"""
STP → GLB 转换脚本（Mayo CLI 后端）

流程:
  Step 1: 根据 STP 文件大小自动选择网格精度
  Step 2: 生成/更新 Mayo 配置文件
  Step 3: 调用 Mayo CLI 子进程（OCC 原生三角剖分）
  Step 4: 输出 GLB（Mayo 原生 glTF 2.0 二进制格式）

用法: python3 stp_to_gltf.py <input.stp> <output.glb>
"""
import sys
import os
import logging
import subprocess
import tempfile
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Mayo CLI 可执行文件路径（Docker 内）
MAYO_CONV = os.environ.get("MAYO_CONV_PATH", "/usr/local/bin/MayoConv")

# Docker 无 FUSE，AppImage 需解压运行
MAYO_PREFIX = [MAYO_CONV, "--appimage-extract-and-run"]

# Mayo 配置文件模板目录
MAYO_SETTINGS_DIR = Path("/app/mayo_settings")

# 网格精度档位映射
QUALITY_MAP = {
    "VeryCoarse": "VeryCoarse",
    "Coarse": "Coarse",
    "Normal": "Normal",
    "Fine": "Fine",
    "VeryFine": "VeryFine",
}


def _get_quality_for_file(file_path: str) -> str:
    """根据 STP 文件大小自动选择网格精度"""
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if size_mb > 20:
        return "VeryCoarse"
    elif size_mb > 10:
        return "Coarse"
    elif size_mb > 5:
        return "Normal"
    else:
        return "Fine"


def _ensure_settings(quality: str) -> str:
    """确保 Mayo 配置文件存在并更新网格精度"""
    MAYO_SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    settings_path = MAYO_SETTINGS_DIR / f"mayo_{quality.lower()}.ini"

    # 检查是否需要生成/更新配置文件
    need_regenerate = not settings_path.exists()

    if need_regenerate:
        # 使用临时空输出生成默认配置
        try:
            subprocess.run(
                ["xvfb-run", "--auto-servernum"] + MAYO_PREFIX +
                ["--write-settings-cache", str(settings_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            # 如果首次生成失败（例如 Mayo 不可用），创建最小配置
            _write_minimal_settings(settings_path, quality)
            return str(settings_path)

    # 更新 meshingQuality 参数
    _update_quality_in_settings(settings_path, quality)
    return str(settings_path)


def _write_minimal_settings(settings_path: Path, quality: str):
    """创建最小 Mayo 配置文件（fallback）"""
    content = f"""[Exchange]
meshingQuality={quality}
"""
    settings_path.write_text(content)


def _update_quality_in_settings(settings_path: Path, quality: str):
    """更新配置文件中的 meshingQuality 参数"""
    content = settings_path.read_text()
    new_content = []
    for line in content.splitlines():
        if line.startswith("meshingQuality="):
            new_content.append(f"meshingQuality={quality}")
        else:
            new_content.append(line)
    settings_path.write_text("\n".join(new_content) + "\n")


def convert(input_path: str, output_path: str):
    if not os.path.exists(input_path):
        logger.error(f"输入文件不存在: {input_path}")
        sys.exit(1)

    logger.info(f"转换: {input_path} → {output_path}")

    # Step 1: 选择网格精度
    quality = _get_quality_for_file(input_path)
    logger.info(f"网格精度: {quality} (文件 {os.path.getsize(input_path)/1024:.1f} KB)")

    # Step 2: 确保配置文件
    settings_path = _ensure_settings(quality)

    # Step 3: 调用 Mayo CLI
    cmd = [
        "xvfb-run", "--auto-servernum",
    ] + MAYO_PREFIX + [
        "--use-settings", settings_path,
        input_path,
        "--export", output_path,
    ]

    logger.info(f"执行: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.error(f"Mayo 转换失败 (exit={result.returncode})")
            if result.stderr:
                logger.error(f"stderr: {result.stderr[:500]}")
            if result.stdout:
                logger.error(f"stdout: {result.stdout[:500]}")
            sys.exit(1)

        if not os.path.exists(output_path):
            logger.error("转换完成但输出文件不存在")
            sys.exit(1)

    except subprocess.TimeoutExpired:
        logger.error(f"Mayo 转换超时 (120s): {input_path}")
        sys.exit(1)
    except FileNotFoundError:
        logger.error(f"Mayo CLI 不可用: {MAYO_CONV}")
        sys.exit(1)

    size_kb = os.path.getsize(output_path) / 1024
    logger.info(f"Mayo 转换完成 ({size_kb:.1f} KB)")

    # ── Step 4: Draco 压缩（可选，进一步减小文件体积） ──
    try:
        from gltf_draco_transcoder import compress_gltf
        import tempfile as tmpmod
        # 在同目录创建临时文件，避免跨设备 os.replace 失败
        fd, tmp_draco = tmpmod.mkstemp(
            suffix='.glb', prefix='draco_',
            dir=os.path.dirname(output_path) or '.'
        )
        os.close(fd)
        try:
            compressed = compress_gltf(output_path, qp=14, qn=10, cl=9)
            with open(tmp_draco, 'wb') as f:
                f.write(compressed.getvalue())
            draco_size = os.path.getsize(tmp_draco) / 1024
            ratio = size_kb / draco_size if draco_size > 0 else 1
            logger.info(f"Draco 压缩: {size_kb:.1f} KB → {draco_size:.1f} KB ({ratio:.1f}:1)")
            os.replace(tmp_draco, output_path)
        finally:
            if os.path.exists(tmp_draco):
                os.unlink(tmp_draco)
    except ImportError:
        logger.debug("gltf-draco-transcoder 未安装，跳过 Draco 压缩")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"用法: {sys.argv[0]} <input.stp> <output.glb>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
