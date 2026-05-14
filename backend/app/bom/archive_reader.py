"""
压缩包内容读取工具

支持格式: ZIP (.zip), TAR (.tar, .tar.gz, .tgz)
依赖: 仅 Python 标准库 (zipfile, tarfile)

用法:
    from .bom.archive_reader import read_archive_tree, SUPPORTED_EXTENSIONS
    result = read_archive_tree("/path/to/file.zip")
    # result = { "tree": [...], "total_files": 42, "total_size": 1048576 }
"""

import zipfile
import tarfile
from pathlib import Path
from typing import Dict, List, Any

# 支持的压缩包扩展名
SUPPORTED_EXTENSIONS = {'.zip', '.tar', '.gz', '.tgz'}


def read_archive_tree(file_path: str) -> Dict[str, Any]:
    """
    读取压缩包内容，返回嵌套树结构

    Args:
        file_path: 压缩包文件路径

    Returns:
        {
            "tree": [...],       # 嵌套目录/文件节点列表
            "total_files": int,  # 文件总数
            "total_size": int    # 文件总大小（字节）
        }

    Raises:
        ValueError: 不支持的压缩格式
        zipfile.BadZipFile: ZIP 文件损坏
        tarfile.ReadError: TAR 文件损坏
    """
    file_path_obj = Path(file_path)
    ext = file_path_obj.suffix.lower()

    # 处理 .tar.gz 双扩展名
    is_tar_gz = ext == '.gz' and len(file_path_obj.suffixes) >= 2 and file_path_obj.suffixes[-2] == '.tar'

    if ext == '.zip':
        return _read_zip(file_path)
    elif ext in ('.tar',) or is_tar_gz or ext in ('.tgz',):
        return _read_tar(file_path)
    else:
        raise ValueError(f"不支持的压缩格式: {ext}，仅支持 ZIP / TAR / TAR.GZ")


def _read_zip(path: str) -> Dict[str, Any]:
    """读取 ZIP 文件，收集所有条目信息"""
    entries: List[Dict[str, Any]] = []
    with zipfile.ZipFile(path, 'r') as zf:
        for info in zf.infolist():
            # info.filename 末尾 '/' 表示目录
            is_dir = info.is_dir()
            entries.append({
                "path": info.filename.rstrip('/'),
                "type": "dir" if is_dir else "file",
                "size": info.file_size,
                "compressed_size": info.compress_size,
            })
    return _build_tree(entries)


def _read_tar(path: str) -> Dict[str, Any]:
    """读取 TAR / TAR.GZ 文件，收集所有条目信息"""
    entries: List[Dict[str, Any]] = []
    # 'r:*' 自动检测压缩类型（gz/bz2/xz 或纯 tar）
    with tarfile.open(path, 'r:*') as tf:
        for member in tf.getmembers():
            is_dir = member.isdir()
            entries.append({
                "path": member.name.rstrip('/'),
                "type": "dir" if is_dir else "file",
                "size": member.size,
            })
    return _build_tree(entries)


def _build_tree(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    将扁平路径列表转为嵌套树结构

    算法:
    1. 按路径排序（父目录在子文件前）
    2. 逐层创建目录节点，维护 dir_map[路径前缀] → 节点 的映射
    3. 文件节点挂到对应目录下

    Args:
        entries: 扁平条目列表，每项含 path, type, size

    Returns:
        { tree, total_files, total_size }
    """
    tree: List[Dict[str, Any]] = []
    # 目录映射: "aaa/bbb" → 目录节点
    dir_map: Dict[str, Dict[str, Any]] = {}

    # 按路径排序，确保父目录在子文件前
    sorted_entries = sorted(entries, key=lambda e: e["path"])

    for entry in sorted_entries:
        parts = entry["path"].split('/') if entry["path"] else []

        # 跳过根级空路径（如压缩包内根目录）
        if not parts or (len(parts) == 1 and not parts[0]):
            continue

        # --- 构建父目录链 ---
        for depth in range(len(parts) - 1):
            prefix = '/'.join(parts[:depth + 1])
            if prefix not in dir_map:
                node = {
                    "name": parts[depth],
                    "type": "dir",
                    "size": 0,
                    "children": []
                }
                dir_map[prefix] = node
                # 挂到上一级目录
                if depth == 0:
                    tree.append(node)
                else:
                    parent_key = '/'.join(parts[:depth])
                    if parent_key in dir_map:
                        dir_map[parent_key]["children"].append(node)

        # --- 添加当前节点 ---
        if entry["type"] == "file":
            filename = parts[-1]
            node: Dict[str, Any] = {
                "name": filename,
                "type": "file",
                "size": entry["size"]
            }
            if "compressed_size" in entry:
                node["compressed_size"] = entry["compressed_size"]

            if len(parts) == 1:
                tree.append(node)  # 根级文件
            else:
                parent_key = '/'.join(parts[:-1])
                if parent_key in dir_map:
                    dir_map[parent_key]["children"].append(node)
                else:
                    # 防御：父目录不存在时挂到根级
                    tree.append(node)

        elif entry["type"] == "dir":
            # ZIP 中显式声明的空目录（已在上面链构建中处理）
            prefix = '/'.join(parts)
            if prefix not in dir_map:
                node = {
                    "name": parts[-1],
                    "type": "dir",
                    "size": 0,
                    "children": []
                }
                dir_map[prefix] = node
                if len(parts) == 1:
                    tree.append(node)
                else:
                    parent_key = '/'.join(parts[:-1])
                    if parent_key in dir_map:
                        dir_map[parent_key]["children"].append(node)

    total_files = sum(1 for e in entries if e["type"] == "file")
    total_size = sum(e["size"] for e in entries)

    return {
        "tree": tree,
        "total_files": total_files,
        "total_size": total_size
    }
