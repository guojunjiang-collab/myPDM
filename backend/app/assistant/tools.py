"""AI 助手工具注册表。

每个工具：{"schema": <OpenAI function schema>, "execute": fn(db, user, **args) -> dict}
execute 必须把当前 user 作为权限边界；返回值是给大模型回灌的 JSON 可序列化 dict。
若工具产出富卡片，在返回 dict 中放 "_card": {"card_type":..., "payload":...}，
由 agent 层取出并 emit，不回灌给模型（避免重复占 token）。
"""
import os
import uuid
from typing import Optional
from sqlalchemy.orm import Session

from .. import crud
from ..bom import compare
from ..models import User, DocumentAttachment
from ..models_parts import PartMaster
from ..file_storage import file_storage
from . import document_builder
from . import api_gateway
from . import knowledge
from . import attachment_reader
from . import skills_loader

DOWNLOAD_ROLES = {"admin", "engineer", "production"}
CONTENT_READ_ROLES = {"admin", "engineer"}


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
    if type in (None, "part", "component", "assembly"):
        q = db.query(PartMaster)
        if keyword:
            pattern = f"%{keyword}%"
            from sqlalchemy import or_
            q = q.filter(or_(PartMaster.code.ilike(pattern), PartMaster.name.ilike(pattern)))
        for p in q.limit(10).all():
            results.append(_entity_brief(p, "component"))
    return {"results": results}

def _get_part_master(db, entity_id):
    """从 part_masters 表查询实体"""
    return db.query(PartMaster).filter(PartMaster.id == entity_id).first()

def get_part_detail(db: Session, user: User, part_id: str):
    p = _get_part_master(db, uuid.UUID(part_id))
    if not p:
        return {"error": "零部件不存在"}
    return {"detail": _entity_brief(p, "component")}


def get_assembly_detail(db: Session, user: User, assembly_id: str):
    a = _get_part_master(db, uuid.UUID(assembly_id))
    if not a:
        return {"error": "零部件不存在"}
    return {"detail": _entity_brief(a, "component")}


def get_bom_tree(db: Session, user: User, type: str, id: str):
    if type not in ("part", "assembly"):
        return {"error": "无效的类型，仅支持 part 或 assembly"}
    items = crud.get_bom_items(db, type, uuid.UUID(id))
    rows = []
    for it in items:
        child = _get_part_master(db, it.child_id)
        rows.append({
            "child_type": it.child_type,
            "child_code": getattr(child, "code", None),
            "child_name": getattr(child, "name", None),
            "quantity": int(it.quantity),
        })
    card = {"card_type": "table", "payload": {"title": "BOM 树", "columns":
            ["child_type", "child_code", "child_name", "quantity"], "rows": rows}}
    return {"items": rows, "_card": card}


def _flatten_tree(db, etype, eid):
    if etype != "assembly":
        return []
    return compare.get_bom_tree_recursive(db, eid)


def diff_bom(db: Session, user: User, left_id: str, right_id: str,
             left_type: str = "assembly", right_type: str = "assembly"):
    threshold = int(os.getenv("ASSISTANT_BOM_RAW_THRESHOLD", "200"))
    left_nodes = _flatten_tree(db, left_type, uuid.UUID(left_id))
    right_nodes = _flatten_tree(db, right_type, uuid.UUID(right_id))

    def brief(nodes):
        return [{"code": n.get("child_code"), "name": n.get("child_name"),
                 "qty": int(n.get("quantity") or 0), "level": n.get("level")}
                for n in nodes]

    if len(left_nodes) + len(right_nodes) <= threshold:
        # 小 BOM：原始数据交给模型自由分析
        return {"mode": "raw", "left": brief(left_nodes), "right": brief(right_nodes)}

    # 大 BOM：服务端预处理，只回变化行
    def key(n):
        return n.get("child_code")
    lmap = {key(n): n for n in left_nodes}
    rmap = {key(n): n for n in right_nodes}
    added = [brief([rmap[k]])[0] for k in rmap.keys() - lmap.keys()]
    removed = [brief([lmap[k]])[0] for k in lmap.keys() - rmap.keys()]
    changed = []
    for k in lmap.keys() & rmap.keys():
        lq = int(lmap[k].get("quantity") or 0)
        rq = int(rmap[k].get("quantity") or 0)
        if lq != rq:
            changed.append({"code": k, "name": lmap[k].get("child_name"),
                            "left_qty": lq, "right_qty": rq})
    diff = {"added": added, "removed": removed, "changed": changed}
    card = {"card_type": "table", "payload": {
        "title": "BOM 对比（已对超大 BOM 预处理）",
        "columns": ["变化", "code", "name", "数量"],
        "rows": ([{"变化": "新增", **a} for a in added] +
                 [{"变化": "删除", **r} for r in removed] +
                 [{"变化": "改量", "code": c["code"], "name": c["name"],
                   "数量": f'{c["left_qty"]}→{c["right_qty"]}'} for c in changed])}}
    return {"mode": "preprocessed", "diff": diff, "_card": card,
            "note": "BOM 较大，已服务端预处理为差异。"}


def trace_bom(db: Session, user: User, entity_type: str, entity_id: str, max_level: int = 10):
    from ..models import BOMItem
    if entity_type not in ("component", "part", "assembly"):
        return {"error": "无效类型"}
    parents = []
    frontier = [uuid.UUID(entity_id)]
    seen = set()
    level = 0
    while frontier and level < max_level:
        level += 1
        next_frontier = []
        rows = db.query(BOMItem).filter(
            BOMItem.child_id.in_(frontier),
            BOMItem.deleted_at.is_(None),
        ).all()
        for r in rows:
            if r.parent_id in seen:
                continue
            seen.add(r.parent_id)
            pa = _get_part_master(db, r.parent_id)
            if pa:
                parents.append({"level": level, "parent_type": r.parent_type,
                                "code": pa.code, "name": pa.name})
                next_frontier.append(r.parent_id)
        frontier = next_frontier
    return {"parents": parents}


def export_bom(db: Session, user: User, type: str, id: str):
    if user.role not in DOWNLOAD_ROLES:
        return {"error": "当前账号无下载/导出权限"}
    # 复用现有 BOM 导出端点（前端用带 token 链接调用）
    url = f"/api/bom/export/{type}/{id}"
    card = {"card_type": "download", "payload": {"label": "下载 BOM 导出", "url": url}}
    return {"url": url, "_card": card}


def download_document(db: Session, user: User, attachment_id: str):
    if user.role not in DOWNLOAD_ROLES:
        return {"error": "当前账号无下载权限"}
    try:
        att = db.query(DocumentAttachment).filter(
            DocumentAttachment.id == uuid.UUID(attachment_id)).first()
    except (ValueError, TypeError):
        att = None
    file_name = att.file_name if att and att.file_name else None
    label = f"下载 {file_name}" if file_name else "下载文档"
    url = f"/api/v2/attachments/{attachment_id}/direct-download"
    card = {"card_type": "download", "payload": {"label": label, "url": url}}
    return {"url": url, "file_name": file_name, "_card": card}


def read_attachment_content(db: Session, user: User, attachment_id: str):
    if user.role not in CONTENT_READ_ROLES:
        return {"error": "当前账号无附件内容读取权限（仅管理员/工程师）"}
    try:
        att = db.query(DocumentAttachment).filter(
            DocumentAttachment.id == uuid.UUID(attachment_id)).first()
    except (ValueError, TypeError):
        att = None
    if not att:
        return {"error": "附件不存在"}
    if not att.file_path:
        return {"error": "附件文件不存在"}
    try:
        data = file_storage.read_file(att.file_path)
    except FileNotFoundError:
        return {"error": "附件文件不存在"}
    max_chars = int(os.getenv("ASSISTANT_ATTACHMENT_MAX_CHARS", "20000"))
    return attachment_reader.extract_text(data, att.file_name or "", max_chars)


def create_document(db: Session, user: User, title: str, content: str, format: str = "md"):
    meta = document_builder.build_document(title=title, content=content, fmt=format)
    card = {"card_type": "markdown_doc", "payload": {
        "title": meta["title"], "preview": meta["preview"],
        "download_url": meta["download_url"]}}
    # 不把全文回灌模型（节省 token），只回执行结果
    return {"doc_id": meta["doc_id"], "title": meta["title"], "_card": card}


def use_skill(db: Session, user: User, name: str):
    """取出某命名技能的步骤说明，供模型按其剧本用现有工具执行。"""
    role = getattr(user, "role", None) or "guest"
    skill = skills_loader.get_skill(name, role)
    if not skill:
        return {"error": f"技能不可用：{name}（不存在、已停用或当前角色无权）"}
    return {"skill": name, "instructions": skill["body"]}


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
    "diff_bom": {
        "execute": diff_bom,
        "schema": {"type": "function", "function": {
            "name": "diff_bom",
            "description": ("对比两个部件的 BOM。小 BOM 返回两棵原始树供你自行分析差异；"
                            "大 BOM 自动返回服务端预处理的增/删/改量。"),
            "parameters": {"type": "object", "properties": {
                "left_id": {"type": "string"},
                "right_id": {"type": "string"},
                "left_type": {"type": "string", "enum": ["assembly"], "default": "assembly"},
                "right_type": {"type": "string", "enum": ["assembly"], "default": "assembly"},
            }, "required": ["left_id", "right_id"]},
        }},
    },
    "trace_bom": {
        "execute": trace_bom,
        "schema": {"type": "function", "function": {
            "name": "trace_bom",
            "description": "BOM 反查：查找使用了某零件/部件的所有上层部件。",
            "parameters": {"type": "object", "properties": {
                "entity_type": {"type": "string", "enum": ["part", "assembly"]},
                "entity_id": {"type": "string"},
            }, "required": ["entity_type", "entity_id"]},
        }},
    },
    "export_bom": {
        "execute": export_bom,
        "schema": {"type": "function", "function": {
            "name": "export_bom",
            "description": "导出零件/部件的 BOM，返回下载链接。需下载权限。",
            "parameters": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["part", "assembly"]},
                "id": {"type": "string"},
            }, "required": ["type", "id"]},
        }},
    },
    "download_document": {
        "execute": download_document,
        "schema": {"type": "function", "function": {
            "name": "download_document",
            "description": "返回某附件的下载链接。需下载权限。",
            "parameters": {"type": "object", "properties": {
                "attachment_id": {"type": "string"},
            }, "required": ["attachment_id"]},
        }},
    },
    "read_attachment_content": {
        "execute": read_attachment_content,
        "schema": {"type": "function", "function": {
            "name": "read_attachment_content",
            "description": ("读取附件正文供你总结分析，支持 pdf/docx/xlsx/md/txt/csv/json。"
                            "先通过文档接口拿到 attachment_id 再调用。超长正文会被截断。"),
            "parameters": {"type": "object", "properties": {
                "attachment_id": {"type": "string"},
            }, "required": ["attachment_id"]},
        }},
    },
    "create_document": {
        "execute": create_document,
        "schema": {"type": "function", "function": {
            "name": "create_document",
            "description": ("把你撰写好的文档内容交给后端生成成品（Markdown），"
                            "返回可预览/下载的产物。content 为完整 Markdown 正文。"),
            "parameters": {"type": "object", "properties": {
                "title": {"type": "string"},
                "content": {"type": "string", "description": "完整 Markdown 正文"},
                "format": {"type": "string", "enum": ["md"], "default": "md"},
            }, "required": ["title", "content"]},
        }},
    },
    "list_api_endpoints": {
        "execute": api_gateway.list_api_endpoints,
        "schema": {"type": "function", "function": {
            "name": "list_api_endpoints",
            "description": "列出 AI 可读的全部只读接口目录（路径/说明/参数）。需要某类数据时先调它发现接口。",
            "parameters": {"type": "object", "properties": {}},
        }},
    },
    "call_read_api": {
        "execute": api_gateway.call_read_api,
        "needs_token": True,
        "schema": {"type": "function", "function": {
            "name": "call_read_api",
            "description": ("调用 list_api_endpoints 目录里的某个只读接口取数。"
                            "path 用实际路径（路径参数已填入，如 /api/parts/<id>）；"
                            "query 为查询参数对象（如 {\"search\":\"电机\",\"limit\":20}）。"),
            "parameters": {"type": "object", "properties": {
                "path": {"type": "string", "description": "接口路径，含已填好的路径参数"},
                "query": {"type": "object", "description": "查询参数（可选）"},
            }, "required": ["path"]},
        }},
    },
    "get_data_dictionary": {
        "execute": knowledge.get_data_dictionary,
        "schema": {"type": "function", "function": {
            "name": "get_data_dictionary",
            "description": ("查询 PDM 数据字典：不带参返回所有实体清单与词汇表；"
                            "带 entity（如 part/assembly/bom_item/document/ecr/eco/configuration_item）"
                            "返回该实体的字段含义。"),
            "parameters": {"type": "object", "properties": {
                "entity": {"type": "string", "description": "实体名（可选）"},
            }},
        }},
    },
    "use_skill": {
        "execute": use_skill,
        "schema": {"type": "function", "function": {
            "name": "use_skill",
            "description": ("获取并执行某个命名技能的步骤。当用户意图匹配系统提示中列出的"
                            "某个可用技能时调用，得到其多步剧本后用现有工具逐步执行。"),
            "parameters": {"type": "object", "properties": {
                "name": {"type": "string", "description": "技能名（见系统提示的可用技能清单）"},
            }, "required": ["name"]},
        }},
    },
}
