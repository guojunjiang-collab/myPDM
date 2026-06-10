"""AI 助手工具注册表。

每个工具：{"schema": <OpenAI function schema>, "execute": fn(db, user, **args) -> dict}
execute 必须把当前 user 作为权限边界；返回值是给大模型回灌的 JSON 可序列化 dict。
若工具产出富卡片，在返回 dict 中放 "_card": {"card_type":..., "payload":...}，
由 agent 层取出并 emit，不回灌给模型（避免重复占 token）。
"""
import uuid
from typing import Optional
from sqlalchemy.orm import Session

from .. import crud
from ..models import User

DOWNLOAD_ROLES = {"admin", "engineer", "production"}


def _entity_brief(obj, etype):
    return {
        "id": str(obj.id), "code": obj.code, "name": obj.name,
        "spec": getattr(obj, "spec", None), "type": etype,
    }


def search_entity(db: Session, user: User, keyword: str, type: Optional[str] = None):
    keyword = (keyword or "").strip()
    if not keyword:
        return {"results": []}
    results = []
    if type in (None, "part"):
        for p in crud.get_parts(db, search=keyword, limit=10):
            results.append(_entity_brief(p, "part"))
    if type in (None, "assembly"):
        for a in crud.get_assemblies(db, search=keyword, limit=10):
            results.append(_entity_brief(a, "assembly"))
    return {"results": results}


def get_part_detail(db: Session, user: User, part_id: str):
    p = crud.get_part(db, uuid.UUID(part_id))
    if not p:
        return {"error": "零件不存在"}
    return {"detail": _entity_brief(p, "part")}


def get_assembly_detail(db: Session, user: User, assembly_id: str):
    a = crud.get_assembly(db, uuid.UUID(assembly_id))
    if not a:
        return {"error": "部件不存在"}
    return {"detail": _entity_brief(a, "assembly")}


def get_bom_tree(db: Session, user: User, type: str, id: str):
    if type not in ("part", "assembly"):
        return {"error": "无效的类型，仅支持 part 或 assembly"}
    items = crud.get_bom_items(db, type, uuid.UUID(id))
    rows = []
    for it in items:
        if it.child_type == "part":
            child = crud.get_part(db, it.child_id)
        else:
            child = crud.get_assembly(db, it.child_id)
        rows.append({
            "child_type": it.child_type,
            "child_code": getattr(child, "code", None),
            "child_name": getattr(child, "name", None),
            "quantity": int(it.quantity),
        })
    card = {"card_type": "table", "payload": {"title": "BOM 树", "columns":
            ["child_type", "child_code", "child_name", "quantity"], "rows": rows}}
    return {"items": rows, "_card": card}


REGISTRY = {
    "search_entity": {
        "execute": search_entity,
        "schema": {"type": "function", "function": {
            "name": "search_entity",
            "description": "按关键词搜索零件或部件，把名称/编码解析为真实 ID。",
            "parameters": {"type": "object", "properties": {
                "keyword": {"type": "string", "description": "搜索关键词（编码或名称）"},
                "type": {"type": "string", "enum": ["part", "assembly"], "description": "可选，限定类型"},
            }, "required": ["keyword"]},
        }},
    },
    "get_part_detail": {
        "execute": get_part_detail,
        "schema": {"type": "function", "function": {
            "name": "get_part_detail",
            "description": "获取单个零件详情。",
            "parameters": {"type": "object", "properties": {
                "part_id": {"type": "string"},
            }, "required": ["part_id"]},
        }},
    },
    "get_assembly_detail": {
        "execute": get_assembly_detail,
        "schema": {"type": "function", "function": {
            "name": "get_assembly_detail",
            "description": "获取单个部件详情。",
            "parameters": {"type": "object", "properties": {
                "assembly_id": {"type": "string"},
            }, "required": ["assembly_id"]},
        }},
    },
    "get_bom_tree": {
        "execute": get_bom_tree,
        "schema": {"type": "function", "function": {
            "name": "get_bom_tree",
            "description": "获取零件或部件的 BOM 树（直接子项），返回原始数据供分析。",
            "parameters": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["part", "assembly"]},
                "id": {"type": "string"},
            }, "required": ["type", "id"]},
        }},
    },
}
