"""
BOM 对比算法模块（基于 PartRevision 三层模型）

对比两个零部件版本（PartRevision）的完整 BOM 树，识别增/删/改。
数据来源：bom_items（parent_revision_id → child_revision_id，绑定到当前迭代）。
"""
import uuid
from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session

from .. import crud_parts


def _as_uuid(value: Any) -> Optional[uuid.UUID]:
    """把字符串/UUID 统一转成 UUID，非法值返回 None。"""
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def revision_summary(db: Session, revision_id: Any) -> Optional[Dict[str, Any]]:
    """获取某版本的摘要信息（编码/名称/规格来自 master，版本/状态来自 revision）。"""
    rev_uuid = _as_uuid(revision_id)
    if rev_uuid is None:
        return None
    rev = crud_parts.get_part_revision(db, rev_uuid)
    if not rev:
        return None
    master = crud_parts.get_part_master(db, rev.master_id)
    return {
        "id": str(rev.id),                      # id 统一为 revision id
        "revision_id": str(rev.id),
        "master_id": str(rev.master_id),
        "code": master.code if master else "",
        "name": master.name if master else "",
        "spec": (master.spec if master else "") or "",
        "version": rev.version,
        "status": rev.status,
    }


def get_bom_tree_recursive(
    db: Session,
    revision_id: Any,
    max_depth: int = 10,
) -> List[Dict[str, Any]]:
    """
    递归展开某版本的完整 BOM 树（基于每个版本的当前迭代），返回扁平节点列表。

    每个节点包含：level（0 起）、path（件号链，用于匹配与排序）、match_key、
    bom_item_id、child_type、child_revision_id、child_master_id、child_code、
    child_name、child_spec、child_version、child_status、quantity。
    """
    nodes: List[Dict[str, Any]] = []
    # 记录当前递归路径上的版本，避免自引用死循环（同一版本在不同分支下仍可重复出现）
    path_stack: set = set()

    def walk(rev_id: uuid.UUID, level: int, path: str) -> None:
        if level >= max_depth or rev_id is None or rev_id in path_stack:
            return
        path_stack.add(rev_id)
        try:
            children = crud_parts.get_bom_tree(db, rev_id)
        except Exception:
            children = []
        # 按件号排序，保证左右两侧顺序一致
        children = sorted(
            children,
            key=lambda c: ((c.get("child_code") or ""), (c.get("child_revision_id") or "")),
        )
        for c in children:
            child_key = c.get("child_code") or c.get("child_revision_id") or ""
            node_path = f"{path}/{child_key}"
            nodes.append({
                "level": level,
                "path": node_path,
                "match_key": node_path,
                "bom_item_id": c.get("id"),
                "child_type": c.get("child_type"),
                "child_revision_id": c.get("child_revision_id"),
                "child_master_id": c.get("child_master_id"),
                "child_code": c.get("child_code"),
                "child_name": c.get("child_name"),
                "child_spec": c.get("child_spec"),
                "child_version": c.get("child_version"),
                "child_status": c.get("child_status"),
                "quantity": int(c.get("quantity") or 1),
            })
            walk(_as_uuid(c.get("child_revision_id")), level + 1, node_path)
        path_stack.discard(rev_id)

    walk(_as_uuid(revision_id), 0, "")
    return nodes


def _side(node: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """构建对比结果中单侧（左/右）的数据结构。"""
    if not node:
        return None
    return {
        "id": node.get("bom_item_id"),
        "child_type": node.get("child_type"),
        # 兼容旧字段：child_id 保留为 master id，另附 revision id
        "child_id": node.get("child_master_id"),
        "child_master_id": node.get("child_master_id"),
        "child_revision_id": node.get("child_revision_id"),
        "quantity": node.get("quantity"),
        "detail": {
            "code": node.get("child_code") or "",
            "name": node.get("child_name") or "",
            "spec": node.get("child_spec") or "",
            "version": node.get("child_version") or "",
            "status": node.get("child_status") or "",
        },
    }


def compare_bom_trees(
    left_nodes: List[Dict[str, Any]],
    right_nodes: List[Dict[str, Any]],
    ignore_quantity: bool = False,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """对比两棵扁平化 BOM 树，按 match_key（件号路径）匹配，识别增/删/改/无变化。"""
    left_map = {n["match_key"]: n for n in left_nodes}
    right_map = {n["match_key"]: n for n in right_nodes}
    all_keys = set(left_map.keys()) | set(right_map.keys())

    stats = {
        "total": len(all_keys),
        "added": 0,
        "deleted": 0,
        "modified": 0,
        "internal_changes": 0,
        "unchanged": 0,
    }

    comparison: List[Dict[str, Any]] = []
    for key in all_keys:
        left_node = left_map.get(key)
        right_node = right_map.get(key)

        if left_node and not right_node:
            change_type = "delete"
            stats["deleted"] += 1
        elif right_node and not left_node:
            change_type = "add"
            stats["added"] += 1
        else:
            def _detail(n: Dict[str, Any]) -> Dict[str, Any]:
                d = {
                    "code": n.get("child_code"),
                    "name": n.get("child_name"),
                    "spec": n.get("child_spec"),
                    "version": n.get("child_version"),
                    "status": n.get("child_status"),
                    "quantity": n.get("quantity"),
                }
                if ignore_quantity:
                    d.pop("quantity", None)
                return d

            if _detail(left_node) == _detail(right_node):
                change_type = "none"
                stats["unchanged"] += 1
            else:
                change_type = "modify"
                stats["modified"] += 1

        base = left_node or right_node
        comparison.append({
            "key": key,
            "level": base["level"],
            "sort": str(base["level"]),
            "path": base["path"],
            "change_type": change_type,
            "left": _side(left_node),
            "right": _side(right_node),
        })

    # 按路径排序，保证树形层级顺序稳定
    comparison.sort(key=lambda x: x["path"])
    return comparison, stats


def compare_assemblies(
    db: Session,
    left_assembly_id: uuid.UUID,
    right_assembly_id: uuid.UUID,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    主对比函数：对比两个零部件版本（revision）的完整 BOM 结构。

    left_assembly_id / right_assembly_id 为 PartRevision 的 id。
    """
    options = options or {}
    max_depth = options.get("max_depth", 10)
    ignore_quantity = options.get("ignore_quantity", False)

    left_summary = revision_summary(db, left_assembly_id)
    right_summary = revision_summary(db, right_assembly_id)
    if not left_summary:
        raise ValueError(f"左侧零部件版本不存在: {left_assembly_id}")
    if not right_summary:
        raise ValueError(f"右侧零部件版本不存在: {right_assembly_id}")

    left_nodes = get_bom_tree_recursive(db, left_assembly_id, max_depth)
    right_nodes = get_bom_tree_recursive(db, right_assembly_id, max_depth)

    comparison, stats = compare_bom_trees(left_nodes, right_nodes, ignore_quantity)

    return {
        "left_assembly": left_summary,
        "right_assembly": right_summary,
        "comparison": comparison,
        "summary": stats,
    }
