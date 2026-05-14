"""
压缩包内容读取工具

支持格式: ZIP, TAR/TAR.GZ, RAR, 7Z
依赖: zipfile/tarfile (stdlib), rarfile, py7zr
"""

import zipfile
import tarfile
import tempfile
import os
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional

# 支持的扩展名
SUPPORTED_EXTENSIONS = {'.zip', '.tar', '.gz', '.tgz', '.rar', '.7z'}


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
    elif ext == '.rar':
        return _read_rar(file_path)
    elif ext == '.7z':
        return _read_7z(file_path)
    elif ext in ('.tar',) or is_tar_gz or ext in ('.tgz',):
        return _read_tar(file_path)
    else:
        raise ValueError(f"不支持的压缩格式: {ext}，仅支持 ZIP / TAR / TAR.GZ / RAR / 7Z")


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


def _read_rar(path: str) -> Dict[str, Any]:
    """读取 RAR 文件内容（需要系统安装 unrar）"""
    import rarfile
    entries: List[Dict[str, Any]] = []
    with rarfile.RarFile(path, 'r') as rf:
        for info in rf.infolist():
            entries.append({
                "path": info.filename.rstrip('/'),
                "type": "dir" if info.isdir() else "file",
                "size": info.file_size,
                "compressed_size": info.compress_size,
            })
    return _build_tree(entries)


def _read_7z(path: str) -> Dict[str, Any]:
    """读取 7Z 文件内容"""
    import py7zr
    entries: List[Dict[str, Any]] = []
    with py7zr.SevenZipFile(path, 'r') as szf:
        for info in szf.list():
            is_dir = info.is_directory if hasattr(info, 'is_directory') else False
            entries.append({
                "path": info.filename.rstrip('/'),
                "type": "dir" if is_dir else "file",
                "size": info.uncompressed_size if hasattr(info, 'uncompressed_size') else getattr(info, 'size', 0),
            })
    return _build_tree(entries)


def extract_file(archive_path: str, file_path_in_archive: str) -> str:
    """从压缩包中提取单个文件到临时目录，返回提取后文件路径"""
    archive_path_obj = Path(archive_path)
    ext = archive_path_obj.suffix.lower()
    suffixes = [s.lower() for s in archive_path_obj.suffixes]
    is_tar_gz = suffixes == ['.tar', '.gz']
    
    tmp_dir = tempfile.mkdtemp(prefix='myPDM_extract_')
    
    if ext == '.zip':
        with zipfile.ZipFile(archive_path, 'r') as zf:
            mp = _match_member(zf.namelist(), file_path_in_archive)
            if not mp: raise KeyError(f"文件不存在: {file_path_in_archive}")
            return zf.extract(mp, tmp_dir)
    elif ext == '.rar':
        import rarfile
        with rarfile.RarFile(archive_path, 'r') as rf:
            mp = _match_member(rf.namelist(), file_path_in_archive)
            if not mp: raise KeyError(f"文件不存在: {file_path_in_archive}")
            rf.extract(mp, tmp_dir)
            return os.path.join(tmp_dir, mp)
    elif ext == '.7z':
        import py7zr
        with py7zr.SevenZipFile(archive_path, 'r') as szf:
            names = [f.filename for f in szf.list()]
            mp = _match_member(names, file_path_in_archive)
            if not mp: raise KeyError(f"文件不存在: {file_path_in_archive}")
            szf.extract(tmp_dir, targets=[mp])
            return os.path.join(tmp_dir, mp)
    elif ext in ('.tar',) or is_tar_gz or ext in ('.tgz',):
        with tarfile.open(archive_path, 'r:*') as tf:
            mp = _match_member([m.name for m in tf.getmembers()], file_path_in_archive)
            if not mp: raise KeyError(f"文件不存在: {file_path_in_archive}")
            tf.extract(mp, tmp_dir)
            return os.path.join(tmp_dir, mp)
    else:
        raise ValueError(f"不支持的格式: {ext}")


def _match_member(names: List[str], target: str) -> Optional[str]:
    """在文件列表中匹配目标路径"""
    target = target.replace('\\', '/').strip('/')
    for name in names:
        if name.rstrip('/') == target:
            return name
    return None


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
                "path": entry["path"],
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
