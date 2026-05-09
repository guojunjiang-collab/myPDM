"""
BOM对比算法模块

提供装配体BOM树对比功能，支持变更识别（增、删、改、内部变更）和分层对比。
"""
import uuid
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import text, and_, or_
import json

from ..models import Assembly, Part, BOMItem
from .. import schemas


def get_direct_children(
    db: Session,
    assembly_id: uuid.UUID
) -> List[Dict[str, Any]]:
    """
    获取装配体的直接子项（不递归，仅第一层）
    
    Args:
        db: 数据库会话
        assembly_id: 装配体ID
        
    Returns:
        List[Dict]: 结构化子项列表，字段与 get_bom_tree_recursive 一致
            （level 固定为 0，path 固定为 ''）
    """
    query = text("""
        SELECT 
            0 as level,
            '' as path,
            bi.id as bom_item_id,
            bi.parent_type,
            bi.parent_id,
            bi.child_type,
            bi.child_id,
            bi.quantity,
            COALESCE(p.code, a.code) as child_code,
            COALESCE(p.name, a.name) as child_name,
            COALESCE(p.spec, a.spec) as child_spec,
            COALESCE(p.version, a.version) as child_version,
            COALESCE(p.status, a.status) as child_status
        FROM bom_items bi
        LEFT JOIN parts p ON bi.child_type = 'part' AND bi.child_id = p.id
        LEFT JOIN assemblies a ON bi.child_type IN ('component', 'assembly') AND bi.child_id = a.id
        WHERE bi.parent_type = 'assembly' AND bi.parent_id = :assembly_id
        ORDER BY child_code
    """)
    
    result = db.execute(query, {"assembly_id": assembly_id}).fetchall()
    
    nodes = []
    for row in result:
        nodes.append({
            "level": 0,
            "path": "",
            "bom_item_id": row.bom_item_id,
            "parent_type": row.parent_type,
            "parent_id": row.parent_id,
            "child_type": row.child_type,
            "child_id": row.child_id,
            "quantity": float(row.quantity) if row.quantity else 1.0,
            "child_code": row.child_code,
            "child_name": row.child_name,
            "child_spec": row.child_spec,
            "child_version": row.child_version,
            "child_status": row.child_status
        })
    
    return nodes


def get_bom_tree_recursive(
    db: Session, 
    assembly_id: uuid.UUID, 
    max_depth: int = 10
) -> List[Dict[str, Any]]:
    """
    递归获取装配体的完整BOM树（包含所有子装配体和零件）
    
    使用递归CTE查询，返回扁平化但带有层级信息的节点列表。
    
    Args:
        db: 数据库会话
        assembly_id: 装配体ID
        max_depth: 最大递归深度（防止无限循环）
        
    Returns:
        List[Dict]: 每个节点包含以下字段：
            level: 层级（0表示根节点）
            path: 路径字符串（用于排序）
            bom_item_id: BOM项ID
            parent_type: 父类型（'assembly'）
            parent_id: 父ID
            child_type: 子类型（'part'或'assembly'）
            child_id: 子项ID
            quantity: 数量
            child_code: 子项编码
            child_name: 子项名称
            child_spec: 子项规格
            child_version: 子项版本（如果是装配体）
            child_status: 子项状态
    """
    # 递归CTE查询
    cte_query = f"""
    WITH RECURSIVE bom_tree AS (
        -- 锚点：第一层子项
        SELECT 
            0 as level,
            '' as path,
            bi.id as bom_item_id,
            bi.parent_type,
            bi.parent_id,
            bi.child_type,
            bi.child_id,
            bi.quantity,
            COALESCE(p.code, a.code) as child_code,
            COALESCE(p.name, a.name) as child_name,
            COALESCE(p.spec, a.spec) as child_spec,
            COALESCE(p.version, a.version) as child_version,
            COALESCE(p.status, a.status) as child_status
        FROM bom_items bi
        LEFT JOIN parts p ON bi.child_type = 'part' AND bi.child_id = p.id
        LEFT JOIN assemblies a ON bi.child_type IN ('component', 'assembly') AND bi.child_id = a.id
        WHERE bi.parent_type = 'assembly' AND bi.parent_id = :assembly_id
        
        UNION ALL
        
        -- 递归：处理子装配体
        SELECT 
            bt.level + 1 as level,
            bt.path || '-' || bt.child_id::text as path,
            bi.id as bom_item_id,
            bi.parent_type,
            bi.parent_id,
            bi.child_type,
            bi.child_id,
            bi.quantity,
            COALESCE(p.code, a.code) as child_code,
            COALESCE(p.name, a.name) as child_name,
            COALESCE(p.spec, a.spec) as child_spec,
            COALESCE(p.version, a.version) as child_version,
            COALESCE(p.status, a.status) as child_status
        FROM bom_items bi
        JOIN bom_tree bt ON bi.parent_type = bt.child_type AND bi.parent_id = bt.child_id
        LEFT JOIN parts p ON bi.child_type = 'part' AND bi.child_id = p.id
        LEFT JOIN assemblies a ON bi.child_type IN ('component', 'assembly') AND bi.child_id = a.id
        WHERE bt.level < :max_depth
          AND bi.child_type IN ('part', 'component', 'assembly')
    )
    SELECT * FROM bom_tree ORDER BY path, level
    """
    
    result = db.execute(
        text(cte_query), 
        {"assembly_id": assembly_id, "max_depth": max_depth}
    ).fetchall()
    
    # 转换为字典列表
    nodes = []
    for row in result:
        nodes.append({
            "level": row.level,
            "path": row.path,
            "bom_item_id": row.bom_item_id,
            "parent_type": row.parent_type,
            "parent_id": row.parent_id,
            "child_type": row.child_type,
            "child_id": row.child_id,
            "quantity": float(row.quantity) if row.quantity else 1.0,
            "child_code": row.child_code,
            "child_name": row.child_name,
            "child_spec": row.child_spec,
            "child_version": row.child_version,
            "child_status": row.child_status
        })
    
    return nodes


def flatten_bom_tree(
    nodes: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    将BOM树节点扁平化为列表，并为每个节点分配排序号
    
    Args:
        nodes: 来自get_bom_tree_recursive的节点列表
        
    Returns:
        扁平化节点列表，每个节点包含：
            level, path, bom_item_id, parent_type, parent_id, 
            child_type, child_id, quantity, child_code, child_name, child_spec,
            child_version, child_status, sort_key
    """
    if not nodes:
        return []
    
    # 按层级分组，然后在每个层级内按child_code排序（确保左右两侧排序一致）
    # 使用child_code作为主要排序键，如果为None则使用child_id
    nodes_by_level = {}
    for node in nodes:
        level = node["level"]
        if level not in nodes_by_level:
            nodes_by_level[level] = []
        nodes_by_level[level].append(node)
    
    # 对每个层级内的节点排序
    flattened = []
    for level in sorted(nodes_by_level.keys()):
        level_nodes = nodes_by_level[level]
        # 按child_code排序，如果code相同则按child_id排序
        level_nodes_sorted = sorted(level_nodes, key=lambda x: (
            x["child_code"] if x["child_code"] is not None else "",
            x["child_id"]
        ))
        
        # 分配排序号（001, 002, ...）
        for i, node in enumerate(level_nodes_sorted, 1):
            sort_num = str(i).zfill(3)
            # 匹配键：使用level:child_code（如果child_code为空则使用child_id）
            # 确保同一层级相同件号的节点能被匹配到，排序号变化将视为修改
            child_code_or_id = node['child_code'] if node['child_code'] is not None else str(node['child_id'])
            match_key = f"{level}:{child_code_or_id}"
            
            flattened.append({
                **node,
                "sort": sort_num,
                "match_key": match_key
            })
    
    return flattened


def compare_bom_trees(
    left_nodes: List[Dict[str, Any]],
    right_nodes: List[Dict[str, Any]],
    ignore_quantity: bool = False
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    对比两个扁平化的BOM树，识别变更
    
    Args:
        left_nodes: 左侧BOM节点列表
        right_nodes: 右侧BOM节点列表
        ignore_quantity: 是否忽略数量差异
        
    Returns:
        Tuple[对比结果列表, 变更统计字典]
    """
    # 构建匹配键到节点的映射
    left_map = {node["match_key"]: node for node in left_nodes}
    right_map = {node["match_key"]: node for node in right_nodes}
    
    # 所有匹配键的并集
    all_keys = set(left_map.keys()) | set(right_map.keys())
    
    comparison = []
    stats = {
        "total": len(all_keys),
        "added": 0,
        "deleted": 0,
        "modified": 0,
        "internal_changes": 0,
        "unchanged": 0
    }
    
    for key in sorted(all_keys):
        left_node = left_map.get(key)
        right_node = right_map.get(key)
        
        # 确定变更类型
        if left_node and not right_node:
            change_type = "delete"
            stats["deleted"] += 1
        elif not left_node and right_node:
            change_type = "add"
            stats["added"] += 1
        elif left_node and right_node:
            # 比较节点详情
            left_detail = {
                "child_code": left_node["child_code"],
                "child_name": left_node["child_name"],
                "child_spec": left_node["child_spec"],
                "child_version": left_node["child_version"],
                "child_status": left_node["child_status"],
                "quantity": left_node["quantity"],
                "sort": left_node["sort"]
            }
            
            right_detail = {
                "child_code": right_node["child_code"],
                "child_name": right_node["child_name"],
                "child_spec": right_node["child_spec"],
                "child_version": right_node["child_version"],
                "child_status": right_node["child_status"],
                "quantity": right_node["quantity"],
                "sort": right_node["sort"]
            }
            
            # 检查是否相同
            if ignore_quantity:
                left_detail.pop("quantity")
                right_detail.pop("quantity")
            
            if left_detail == right_detail:
                change_type = "none"
                stats["unchanged"] += 1
            else:
                change_type = "modify"
                stats["modified"] += 1
        else:
            # 理论上不会出现这种情况
            continue
        
        # 构建对比项
        comparison_item = {
            "key": key,
            "level": left_node["level"] if left_node else right_node["level"],
            "sort": left_node["sort"] if left_node else right_node["sort"],
            "path": left_node["path"] if left_node else right_node["path"],
            "change_type": change_type,
            "left": None,
            "right": None
        }
        
        # 填充左侧数据
        if left_node:
            comparison_item["left"] = {
                "id": left_node["bom_item_id"],
                "child_type": left_node["child_type"],
                "child_id": left_node["child_id"],
                "quantity": left_node["quantity"],
                "detail": {
                    "code": left_node["child_code"],
                    "name": left_node["child_name"],
                    "spec": left_node["child_spec"],
                    "version": left_node["child_version"],
                    "status": left_node["child_status"]
                }
            }
        
        # 填充右侧数据
        if right_node:
            comparison_item["right"] = {
                "id": right_node["bom_item_id"],
                "child_type": right_node["child_type"],
                "child_id": right_node["child_id"],
                "quantity": right_node["quantity"],
                "detail": {
                    "code": right_node["child_code"],
                    "name": right_node["child_name"],
                    "spec": right_node["child_spec"],
                    "version": right_node["child_version"],
                    "status": right_node["child_status"]
                }
            }
        
        comparison.append(comparison_item)
    
    return comparison, stats


def compare_assemblies(
    db: Session,
    left_assembly_id: uuid.UUID,
    right_assembly_id: uuid.UUID,
    options: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    主对比函数：对比两个装配体的BOM结构
    
    Args:
        db: 数据库会话
        left_assembly_id: 左侧装配体ID
        right_assembly_id: 右侧装配体ID
        options: 对比选项
        
    Returns:
        对比结果，包含装配体信息、对比列表和统计信息
    """
    # 默认选项
    if options is None:
        options = {}
    
    max_depth = options.get("max_depth", 10)
    ignore_quantity = options.get("ignore_quantity", False)
    
    # 获取装配体基本信息
    left_assembly = db.query(Assembly).filter(Assembly.id == left_assembly_id).first()
    right_assembly = db.query(Assembly).filter(Assembly.id == right_assembly_id).first()
    
    if not left_assembly:
        raise ValueError(f"左侧装配体不存在: {left_assembly_id}")
    if not right_assembly:
        raise ValueError(f"右侧装配体不存在: {right_assembly_id}")
    
    # 获取BOM树 — 仅直接子项
    left_children = get_direct_children(db, left_assembly_id)
    right_children = get_direct_children(db, right_assembly_id)
    
    # 分配排序号和匹配键
    for side in (left_children, right_children):
        for i, node in enumerate(side, 1):
            node["sort"] = str(i).zfill(3)
            child_code_or_id = node["child_code"] if node["child_code"] is not None else str(node["child_id"])
            node["match_key"] = f"0:{child_code_or_id}"
    
    # 对比
    comparison, stats = compare_bom_trees(left_children, right_children, ignore_quantity)
    
    # 构建最终结果
    result = {
        "left_assembly": {
            "id": str(left_assembly.id),
            "code": left_assembly.code,
            "name": left_assembly.name,
            "spec": left_assembly.spec,
            "version": left_assembly.version,
            "status": left_assembly.status
        },
        "right_assembly": {
            "id": str(right_assembly.id),
            "code": right_assembly.code,
            "name": right_assembly.name,
            "spec": right_assembly.spec,
            "version": right_assembly.version,
            "status": right_assembly.status
        },
        "comparison": comparison,
        "summary": stats
    }
    
    return result