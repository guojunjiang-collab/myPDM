"""
构型配置 - API Router
========================
构型项 CRUD + 关联零部件 + 子构型项 + 构型方案
"""

import uuid
from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Document
from app.models_parts import PartMaster, PartRevision
from app import models_configuration as models
from app import schemas_configuration as schemas
from app import schemas as core_schemas
from app import crud_configuration as crud
from app import crud as core_crud
from app.models_parts import PartIteration, PartAttachment
from app.stp_converter import is_stp_file
from app.media_token import mint_media_token
import os as _os
import logging
_logger = logging.getLogger(__name__)
from ..permissions import require_permission

router = APIRouter(prefix="/configurations", tags=["构型配置"])


def _resolve_creator(db: Session, creator_id):
    if not creator_id:
        return ""
    from ..models import User as UModel
    u = db.query(UModel).filter(UModel.id == creator_id).first()
    return u.real_name if u else ""


# ════════════════════════════════════════════════════════
# 构型项 CRUD
# ════════════════════════════════════════════════════════

@router.get("/items", response_model=dict)
async def list_config_items(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=10000),
    search: str = Query(None),
    exclude_ancestors_of: str = Query(None),
    updated_since: float = Query(None),
    brief: bool = Query(False),
    top_level: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """构型项列表"""
    skip = (page - 1) * page_size
    exclude_ids: set[str] = set()
    if exclude_ancestors_of:
        exclude_ids.add(exclude_ancestors_of)  # 排除自身
        # BFS向上查找所有祖先（防止循环引用）
        from app.models_configuration import ConfigurationItemChild
        child_to_parents: dict = {}
        all_children = db.query(ConfigurationItemChild).all()
        for c in all_children:
            cid = str(c.child_id)
            if cid not in child_to_parents:
                child_to_parents[cid] = []
            child_to_parents[cid].append(str(c.parent_id))
        queue = [exclude_ancestors_of]
        while queue:
            cid = queue.pop(0)
            parents = child_to_parents.get(cid, [])
            for pid in parents:
                if pid not in exclude_ids:
                    exclude_ids.add(pid)
                    queue.append(pid)
    crud_kwargs = dict(search=search, skip=skip, limit=page_size, exclude_ids=exclude_ids, top_level=top_level)
    if updated_since is not None:
        crud_kwargs["include_deleted"] = True
        crud_kwargs["updated_since"] = updated_since
    items, total = crud.get_config_items(db, **crud_kwargs)
    if brief:
        return {
            "items": [{
                "id": str(i.id), "code": i.code, "name": i.name,
                "spec": i.spec or "",
                "creator_id": str(i.creator_id) if i.creator_id else None,
                "updated_at": i.updated_at.isoformat() if i.updated_at else None,
                "deleted_at": i.deleted_at.isoformat() if i.deleted_at else None,
            } for i in items],
            "total": total, "page": page, "page_size": page_size,
        }
    return {
        "items": [{
            "id": str(i.id), "code": i.code, "name": i.name,
            "spec": i.spec or "", "remark": i.remark or "",
            "creator_id": str(i.creator_id) if i.creator_id else None,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
        } for i in items],
        "total": total, "page": page, "page_size": page_size,
    }
    return {
        "items": [{
            "id": str(i.id), "code": i.code, "name": i.name,
            "spec": i.spec or "", "remark": i.remark or "",
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
        } for i in items],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/items/{config_id}", response_model=dict)
async def get_config_item(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """构型项详情（含关联零部件 + 子构型项 + 构型方案）"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")

    # 关联零部件
    parts_data = []
    for p in crud.get_config_parts(db, config_id):
        entity = db.query(PartMaster).filter(PartMaster.id == p.part_id).first()
        if entity:
            rev = db.query(PartRevision).filter(
                PartRevision.master_id == entity.id,
                PartRevision.deleted_at.is_(None)
            ).order_by(PartRevision.created_at.desc()).first()
            parts_data.append({
                "id": str(p.id), "part_type": p.part_type, "part_id": str(p.part_id),
                "is_required": p.is_required, "quantity": p.quantity, "sort_order": p.sort_order,
                "part_detail": {
                    "id": str(entity.id), "code": entity.code, "name": entity.name,
                    "version": rev.version if rev else "",
                    "revision_id": str(rev.id) if rev else "",
                    "spec": entity.spec or "",
                    "status": rev.status if rev else "draft",
                },
            })
        else:
            parts_data.append({
                "id": str(p.id), "part_type": p.part_type, "part_id": str(p.part_id),
                "is_required": p.is_required, "quantity": p.quantity, "sort_order": p.sort_order,
                "part_detail": {},
            })

    # 子构型项
    children_data = []
    for c in crud.get_config_children(db, config_id):
        child = db.query(models.ConfigurationItem).filter(models.ConfigurationItem.id == c.child_id).first()
        has_children = db.query(models.ConfigurationItemChild).filter(
            models.ConfigurationItemChild.parent_id == c.child_id
        ).limit(1).count() > 0 if child else False
        has_parts = db.query(models.ConfigurationItemPart).filter(
            models.ConfigurationItemPart.configuration_item_id == c.child_id
        ).limit(1).count() > 0 if child else False
        children_data.append({
            "id": str(c.id), "child_id": str(c.child_id),
            "is_required": c.is_required, "sort_order": c.sort_order,
            "quantity": c.quantity,
            "has_children": has_children,
            "has_parts": has_parts,
            "child_detail": {
                "id": str(child.id), "code": child.code, "name": child.name,
                "spec": child.spec or "", "remark": child.remark or "",
            } if child else {},
        })

    return {
        "id": str(item.id), "code": item.code, "name": item.name,
        "spec": item.spec or "", "remark": item.remark or "",
        "creator_id": str(item.creator_id) if item.creator_id else None,
        "creator_name": _resolve_creator(db, item.creator_id) if item.creator_id else "",
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "parts": parts_data, "children": children_data,
        "documents": _get_config_documents(db, item, current_user),
    }


@router.post("/items", response_model=dict)
async def create_config_item(
    data: schemas.ConfigurationItemCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:create")),
):
    """创建构型项"""
    existing = crud.get_config_item_by_code(db, data.code)
    if existing:
        if existing.deleted_at is None:
            raise HTTPException(status_code=400, detail=f"构型号 {data.code} 已存在")
        item = crud.revive_config_item(db, existing, data)
        return {"id": str(item.id), "code": item.code, "name": item.name}
    item = crud.create_config_item(db, data)
    item.creator_id = current_user.id
    db.commit()
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.put("/items/{config_id}", response_model=dict)
async def update_config_item(
    config_id: str, data: schemas.ConfigurationItemUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """更新构型项"""
    # 允许修改构型号：保存时做唯一性检查
    if data.code:
        current = crud.get_config_item(db, config_id)
        if not current:
            raise HTTPException(status_code=404, detail="构型项不存在")
        if data.code != current.code:
            existing = crud.get_config_item_by_code(db, data.code)
            if existing and str(existing.id) != str(config_id):
                raise HTTPException(status_code=400, detail=f"构型号 {data.code} 已存在")
    item = crud.update_config_item(db, config_id, data)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.delete("/items/{config_id}")
async def delete_config_item(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:delete")),
):
    """删除构型项（检查父项引用）"""
    # 检查是否被其他构型项引用为子项（仅统计未被软删除的父构型项）
    parent_refs = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.child_id == config_id
    ).all()
    if parent_refs:
        parent_ids = [str(r.parent_id) for r in parent_refs]
        parents = db.query(models.ConfigurationItem).filter(
            models.ConfigurationItem.id.in_(parent_ids),
            models.ConfigurationItem.deleted_at.is_(None),
        ).all()
        if parents:
            parent_codes = [p.code for p in parents]
            raise HTTPException(
                status_code=400,
                detail=f"该构型项被 {len(parents)} 个父构型项引用: {', '.join(parent_codes)}，无法删除"
            )

    if not crud.delete_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联零部件
# ════════════════════════════════════════════════════════

@router.post("/items/{config_id}/parts", response_model=dict)
async def add_parts(
    config_id: str, data: schemas.ConfigPartBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """批量关联零部件"""
    if not crud.get_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"added": len(crud.add_config_parts(db, config_id, data.items))}


@router.put("/items/{config_id}/parts/{part_id}", response_model=dict)
async def update_part(
    config_id: str, part_id: str, data: schemas.ConfigPartUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """更新关联零部件属性"""
    part = crud.update_config_part(db, part_id, data)
    if not part:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"id": str(part.id), "is_required": part.is_required, "quantity": part.quantity}


@router.delete("/items/{config_id}/parts/{part_id}")
async def remove_part(
    config_id: str, part_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """移除关联零部件"""
    if not crud.remove_config_part(db, part_id):
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 子构型项
# ════════════════════════════════════════════════════════

@router.post("/items/{config_id}/children", response_model=dict)
async def add_children(
    config_id: str, data: schemas.ConfigChildBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """批量添加子构型项"""
    if not crud.get_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    for c in data.items:
        if str(c.child_id) == config_id:
            raise HTTPException(status_code=400, detail="不能将构型项添加为自身的子项")
    return {"added": len(crud.add_config_children(db, config_id, data.items))}


@router.put("/items/{config_id}/children/{child_id}", response_model=dict)
async def update_child(
    config_id: str, child_id: str, data: schemas.ConfigChildUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """更新子构型项属性"""
    child = crud.update_config_child(db, child_id, data)
    if not child:
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"id": str(child.id), "is_required": child.is_required}


@router.delete("/items/{config_id}/children/{child_id}")
async def remove_child(
    config_id: str, child_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """移除子构型项"""
    if not crud.remove_config_child(db, child_id):
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联图文档
# ════════════════════════════════════════════════════════

def _get_config_documents(db: Session, item: models.ConfigurationItem, current_user=None) -> list:
    """从 document_links JSONB 读取关联图文档"""
    from .. import crud_groups
    from ..models import UserGroup, DocumentGroupLink
    links = item.document_links or []
    result = []
    doc_ids = [l.get("document_id") for l in links if l.get("document_id")]
    doc_group_links = db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id.in_(doc_ids)).all() if doc_ids else []
    doc_groups = {}
    for dgl in doc_group_links:
        doc_groups.setdefault(dgl.document_id, set()).add(dgl.group_id)
    all_gids = set()
    for gids in doc_groups.values():
        all_gids.update(gids)
    group_name_map = {}
    if all_gids:
        gs = db.query(UserGroup).filter(UserGroup.id.in_(all_gids)).all()
        group_name_map = {g.id: g.name for g in gs}
    for link in links:
        doc_id = link.get("document_id")
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            continue
        gids = doc_groups.get(doc.id, set())
        doc_data = {
            "id": str(doc.id),
            "code": doc.code,
            "name": doc.name,
            "version": doc.version,
            "status": doc.status,
            "file_name": doc.file_name,
            "file_id": str(doc.file_id) if doc.file_id else None,
        }
        if current_user:
            doc_data["accessible"] = crud_groups.document_is_accessible(db, current_user, doc)
            doc_data["group_ids"] = [str(g) for g in gids]
            doc_data["group_names"] = [group_name_map.get(g, str(g)) for g in gids]
        result.append({
            "id": link.get("id"),
            "entity_type": "configuration",
            "entity_id": str(item.id),
            "document_id": str(doc.id),
            "category": link.get("category"),
            "sort_order": link.get("sort_order", 0),
            "created_at": link.get("created_at"),
            "document": doc_data,
        })
    return result


@router.get("/items/{config_id}/documents")
async def get_config_documents(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取构型项关联的图文档列表"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    return _get_config_documents(db, item, current_user)


@router.post("/items/{config_id}/documents")
async def add_config_document(
    config_id: str, body: core_schemas.EntityDocumentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """关联图文档到构型项"""
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")

    link_id = str(body.id) if body.id else str(uuid.uuid4())
    link = {
        "id": link_id,
        "document_id": str(body.document_id),
        "category": body.category,
        "sort_order": body.sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links = item.document_links or []
    links.append(link)
    item.document_links = links
    flag_modified(item, 'document_links')
    db.commit()
    ip = request.client.host if request.client else None
    core_crud.create_log(db, current_user.id, current_user.username,
                         "关联图文档", "configuration", str(config_id),
                         f"文档:{doc.code}", ip)
    return {"id": link_id, "message": "图文档关联成功"}


@router.put("/items/{config_id}/documents/{link_id}")
async def update_config_document(
    config_id: str, link_id: str, body: core_schemas.EntityDocumentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """更新构型项关联图文档信息（类别/排序）"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    links = item.document_links or []
    found = False
    for link in links:
        if link.get("id") == link_id:
            if body.category is not None:
                link["category"] = body.category
            if body.sort_order is not None:
                link["sort_order"] = body.sort_order
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    item.document_links = links
    flag_modified(item, 'document_links')
    db.commit()
    return {"id": link_id, "message": "更新成功"}


@router.delete("/items/{config_id}/documents/{link_id}")
async def remove_config_document(
    config_id: str, link_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """移除构型项关联的图文档"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    links = item.document_links or []
    new_links = [l for l in links if l.get("id") != link_id]
    if len(new_links) == len(links):
        raise HTTPException(status_code=404, detail="关联关系不存在")
    item.document_links = new_links
    flag_modified(item, 'document_links')
    db.commit()
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 构型配置 (Configuration Profile)
# ════════════════════════════════════════════════════════

@router.get("/profiles", response_model=dict)
async def list_profiles(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    status: str = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置列表"""
    skip = (page - 1) * page_size
    profiles, total = crud.get_profiles_for_user(db, current_user, search=search, status=status, skip=skip, limit=page_size)
    return {
        "items": [{
            "id": str(p.id), "code": p.code, "name": p.name,
            "configuration_item_id": str(p.configuration_item_id) if p.configuration_item_id else "",
            "status": p.status,
            "effectivity_start": p.effectivity_start or "",
            "effectivity_end": p.effectivity_end or "",
            "remark": p.remark or "",
            "creator_id": str(p.creator_id),
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            "review_mode": p.review_mode,
            "reviewer_count": len(p.reviewers or []),
        } for p in profiles],
        "total": total, "page": page, "page_size": page_size,
    }


@router.post("/profiles", response_model=dict)
async def create_profile(
    data: schemas.ConfigurationProfileCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:create")),
):
    """创建配置"""
    existing = crud.get_profile_by_code(db, data.code)
    if existing:
        raise HTTPException(status_code=400, detail="配置编号已存在")

    if data.configuration_item_id:
        config_item = crud.get_config_item(db, str(data.configuration_item_id))
        if not config_item:
            raise HTTPException(status_code=404, detail="构型项不存在")

    profile = crud.create_profile(db, data, str(current_user.id))
    items = crud.get_working_items(db, str(profile.id))
    entity_map = _build_entity_map(db, items)

    config_item = crud.get_config_item(db, str(profile.configuration_item_id)) if profile.configuration_item_id else None
    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "configuration_item_id": str(profile.configuration_item_id) if profile.configuration_item_id else "",
        "configuration_item": {
            "id": str(config_item.id), "code": config_item.code, "name": config_item.name,
        } if config_item else None,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "creator_id": str(profile.creator_id),
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "items": [_format_profile_item(item, entity_map) for item in items],
    }


@router.get("/profiles/{profile_id}", response_model=dict)
async def get_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置详情 + 清单"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")

    config_item = crud.get_config_item(db, str(profile.configuration_item_id)) if profile.configuration_item_id else None
    working_items = crud.get_working_items(db, profile_id)
    formal_items = crud.get_profile_items(db, profile_id)
    entity_map = _build_entity_map(db, working_items)

    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "configuration_item_id": str(profile.configuration_item_id) if profile.configuration_item_id else "",
        "configuration_item": {
            "id": str(config_item.id), "code": config_item.code, "name": config_item.name,
        } if config_item else None,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "creator_id": str(profile.creator_id),
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "items": [_format_profile_item(item, entity_map) for item in working_items],
        "config_tree": _build_config_tree(db, str(profile.configuration_item_id), working_items, entity_map) if profile.configuration_item_id else None,
        "formal_items": [_format_profile_item(item) for item in formal_items],
        "reviewers": profile.reviewers or [],
        "review_mode": profile.review_mode,
        "cc_users": profile.cc_users or [],
        "review_records": [{
            "id": str(r.id), "reviewer_id": str(r.reviewer_id),
            "reviewer_name": r.reviewer_name, "decision": r.decision,
            "comment": r.comment or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in crud.get_review_records(db, profile_id)],
        "status_logs": [{
            "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
            "operator_name": l.operator_name, "comment": l.comment or "",
            "created_at": l.created_at.isoformat() if l.created_at else None,
        } for l in crud.get_status_logs(db, profile_id)],
        "submitted_at": profile.submitted_at.isoformat() if profile.submitted_at else None,
        "reviewed_at": profile.reviewed_at.isoformat() if profile.reviewed_at else None,
        "archived_at": profile.archived_at.isoformat() if profile.archived_at else None,
    }


@router.get("/profiles/{profile_id}/preview-3d", response_model=dict)
async def get_profile_3d_preview(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置清单3D预览数据：收集所有选中零部件的STP模型"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if not profile.configuration_item_id:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    working_items = crud.get_working_items(db, profile_id)
    entity_map = _build_entity_map(db, working_items)
    config_tree = _build_config_tree(db, str(profile.configuration_item_id), working_items, entity_map)

    parts = _collect_config_profile_parts(config_tree)
    if not parts:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    instances = []
    missing = []
    identity_matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    for idx, p in enumerate(parts):
        ver = (p.get("item_version") or "").strip()
        if not ver:
            from app.crud_parts import list_revisions_by_master
            revs = list_revisions_by_master(db, UUID(p["item_id"]))
            if revs:
                ver = revs[-1].version
            else:
                missing.append({
                    "part_code": p["item_code"],
                    "part_name": p["item_name"],
                    "version": "",
                })
                continue

        result = _resolve_part_stp_attachment(db, p["item_id"], ver)
        if result and result.get("glb_urls"):
            instances.append({
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
                "revision_id": result["revision_id"],
                "glb_urls": result["glb_urls"],
                "matrix": identity_matrix,
            })
        else:
            missing.append({
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
            })

    tree = []
    for idx, inst in enumerate(instances):
        tree.append({
            "bom_item_id": f"instance-{idx}",
            "part_code": inst["part_code"],
            "part_name": inst["part_name"],
            "version": inst["version"],
            "quantity": 1,
            "instance_count": 1,
            "is_leaf": True,
            "children": [],
        })

    return {
        "profile_code": profile.code,
        "profile_name": profile.name,
        "total_count": len(parts),
        "loaded_count": len(instances),
        "instances": instances,
        "missing": missing,
        "tree": tree,
    }


@router.put("/profiles/{profile_id}", response_model=dict)
async def update_profile(
    profile_id: str,
    data: schemas.ConfigurationProfileUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:update")),
):
    """编辑配置（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑")

    if data.code and data.code != profile.code:
        existing = crud.get_profile_by_code(db, data.code)
        if existing:
            raise HTTPException(status_code=400, detail="配置编号已存在")

    profile = crud.update_profile(db, profile_id, data)
    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:delete")),
):
    """删除配置（管理员可删除任意状态）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    crud.delete_profile(db, profile_id)
    return {"detail": "ok"}


@router.post("/profiles/{profile_id}/submit")
async def submit_profile_review(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """提交评审（draft→reviewing；无审批人→active）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可提交评审")
    profile = crud.submit_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/withdraw")
async def withdraw_profile_review(
    profile_id: str,
    data: schemas.ProfileWithdrawRequest = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """撤回评审（reviewing→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅评审中状态可撤回")
    profile = crud.withdraw_profile(db, profile, current_user, (data.comment if data else "") or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/review")
async def review_profile_endpoint(
    profile_id: str,
    data: schemas.ProfileReviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """审批操作（通过/驳回/退回）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.decision not in ("approved", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="无效审批决定")
    profile = crud.review_profile(db, profile, current_user, data.decision, data.comment or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/reopen")
async def reopen_profile_endpoint(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:update")),
):
    """重新编辑（rejected→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "rejected":
        raise HTTPException(status_code=400, detail="仅已驳回状态可重新编辑")
    profile = crud.reopen_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


class ProfileStatusUpdate(BaseModel):
    status: str  # "draft" | "active" | "archived"


@router.put("/profiles/{profile_id}/status")
async def update_profile_status(
    profile_id: str,
    data: ProfileStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:change_status")),
):
    """管理员直接修改状态"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.status not in ("draft", "reviewing", "active", "rejected", "archived"):
        raise HTTPException(status_code=400, detail="无效状态")
    old = profile.status
    crud._add_profile_status_log(db, profile.id, old, data.status,
                                 current_user.id, current_user.real_name, "管理员强制变更")
    crud.change_profile_status(db, profile_id, data.status)
    return {"detail": "ok", "status": data.status}


@router.post("/profiles/{profile_id}/archive")
async def archive_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """归档（active/rejected → archived）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status not in ("active", "rejected"):
        raise HTTPException(status_code=400, detail="仅生效或已驳回状态可归档")
    profile = crud.archive_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


@router.get("/profiles/{profile_id}/status-logs", response_model=dict)
async def get_profile_status_logs(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    return {"items": [{
        "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
        "operator_name": l.operator_name, "comment": l.comment or "",
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in crud.get_status_logs(db, profile_id)]}


@router.post("/profiles/{profile_id}/cc")
async def add_profile_cc_endpoint(
    profile_id: str,
    data: schemas.ProfileCcAddRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.add_profile_cc(db, profile, data.user_id, data.user_name or "")
    return {"detail": "ok", "cc_users": profile.cc_users}


@router.delete("/profiles/{profile_id}/cc/{user_id}")
async def remove_profile_cc_endpoint(
    profile_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.remove_profile_cc(db, profile, user_id)
    return {"detail": "ok", "cc_users": profile.cc_users}


class ChecklistRestoreItem(BaseModel):
    item_type: str
    item_code: str
    source_ci_code: str = ""
    is_selected: bool


class ChecklistRestoreRequest(BaseModel):
    items: list[ChecklistRestoreItem]


@router.put("/profiles/{profile_id}/restore-checklist", response_model=dict)
async def restore_profile_checklist(
    profile_id: str,
    data: ChecklistRestoreRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """按导入数据强制还原工作清单勾选（含必选件，用于导入恢复），再同步正式清单。仅 draft。

    逐项 updateItem 无法还原"被取消的可选子构型项下的必选件"（接口拦截必选件），
    故此处直接强制设置工作表项的 is_selected，完整还原整棵树（含子构型项节点的取消级联）。
    """
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可还原清单")

    working = crud.get_working_items(db, profile_id)

    # 工作表项的来源构型项 id→code
    ci_ids = {str(wi.source_config_item_id) for wi in working if wi.source_config_item_id}
    code_by_id: dict[str, str] = {}
    if ci_ids:
        for ci in db.query(models.ConfigurationItem).filter(
            models.ConfigurationItem.id.in_(ci_ids)
        ).all():
            code_by_id[str(ci.id)] = ci.code

    def _key(item_type: str, item_code: str, source_code: str) -> str:
        return f"{item_type}|{item_code}|{source_code}"

    target = {_key(it.item_type, it.item_code, it.source_ci_code): it.is_selected for it in data.items}
    matched: set[str] = set()

    for wi in working:
        src_code = code_by_id.get(str(wi.source_config_item_id), "") if wi.source_config_item_id else ""
        k = _key(wi.item_type, wi.item_code or "", src_code)
        if k in target:
            wi.is_selected = target[k]  # 强制设置，含必选件
            matched.add(k)

    db.flush()
    crud.sync_working_to_formal(db, profile_id)
    db.commit()

    unmatched = [k for k in target if k not in matched]
    return {"detail": "ok", "matched": len(matched), "unmatched": len(unmatched)}


@router.put("/profiles/{profile_id}/items/{item_id}", response_model=dict)
async def update_profile_item(
    profile_id: str,
    item_id: str,
    data: schemas.ConfigurationProfileItemUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """勾选/取消可选件（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改清单")

    item = crud.get_working_items(db, profile_id)
    found = next((i for i in item if str(i.id) == item_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="清单项不存在")
    if found.is_required:
        raise HTTPException(status_code=400, detail="必选项不可取消")

    updated = crud.update_working_item(db, item_id, data.is_selected)
    if not updated:
        raise HTTPException(status_code=400, detail="更新失败")
    return _format_profile_item(updated)


def _format_profile_item(item, entity_map: dict = None) -> dict:
    """格式化清单项响应"""
    entity = entity_map.get(str(item.item_id)) if entity_map else None
    result = {
        "id": str(item.id),
        "profile_id": str(item.profile_id),
        "source_config_item_id": str(item.source_config_item_id) if item.source_config_item_id else None,
        "item_type": item.item_type,
        "item_id": str(item.item_id),
        "item_code": item.item_code or "",
        "item_name": item.item_name or "",
        "item_version": entity.version if entity and hasattr(entity, 'version') else "",
        "item_status": entity.status if entity and hasattr(entity, 'status') else "",
        "is_required": item.is_required,
        "is_selected": item.is_selected,
        "quantity": getattr(item, "quantity", 1) or 1,
        "source_type": item.source_type,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
    return result


def _build_entity_map(db: Session, items: list) -> dict:
    """批量查找零部件版本和状态"""
    part_ids = []
    assembly_ids = []
    for item in items:
        if item.item_type == "part":
            part_ids.append(item.item_id)
        else:
            assembly_ids.append(item.item_id)
    entity_map = {}
    if part_ids:
        for p in db.query(PartMaster).filter(PartMaster.id.in_(part_ids)).all():
            entity_map[str(p.id)] = p
    if assembly_ids:
        for a in db.query(PartMaster).filter(PartMaster.id.in_(assembly_ids)).all():
            entity_map[str(a.id)] = a
    return entity_map


def _build_config_tree(db: Session, config_item_id: str, profile_items: list, entity_map: dict = None) -> dict:
    """构建构型项树形结构，含零部件和子构型项"""
    item = crud.get_config_item(db, config_item_id)
    if not item:
        return None

    # 本层级关联的零部件（含 direct 和 child 来源）
    parts = [
        _format_profile_item(pi, entity_map) for pi in profile_items
        if pi.source_config_item_id and str(pi.source_config_item_id) == config_item_id
    ]

    # 子构型项
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_id == config_item_id
    ).order_by(models.ConfigurationItemChild.sort_order).all()

    child_nodes = []
    for child in children:
        child_tree = _build_config_tree(db, str(child.child_id), profile_items, entity_map)
        if child_tree:
            child_tree["is_required"] = child.is_required
            child_tree["quantity"] = child.quantity
            # 子构型项的选中态：必选项始终选中；可选节点由子零件决定
            child_tree["is_selected"] = child.is_required or _is_config_node_selected(db, str(child.child_id), profile_items)
            child_nodes.append(child_tree)

    return {
        "id": str(item.id),
        "code": item.code,
        "name": item.name,
        "is_required": True,  # 根节点始终必选
        "is_selected": True,
        "parts": parts,
        "children": child_nodes,
    }


def _resolve_part_stp_attachment(db: Session, master_id: str, version: str) -> dict | None:
    """按 (master_id, version) 查找零部件 STP 附件，返回 glb_urls 或 None"""
    from uuid import UUID
    from app.crud_parts import get_part_revision
    from app.stp_converter import get_lod_glb_paths, get_glb_cache_path

    rev = db.query(PartRevision).filter(
        PartRevision.master_id == UUID(master_id),
        PartRevision.version == version,
        PartRevision.deleted_at.is_(None),
    ).first()
    if not rev:
        return None

    iteration = db.query(PartIteration).filter(
        PartIteration.revision_id == rev.id,
        PartIteration.iteration == rev.latest_iteration,
    ).first()
    if not iteration:
        return None

    atts = db.query(PartAttachment).filter(
        PartAttachment.iteration_id == iteration.id,
    ).all()
    att = next((a for a in atts if is_stp_file(a.file_name) and a.category == 'production'), None)
    if not att:
        att = next((a for a in atts if is_stp_file(a.file_name)), None)
    if not att:
        return None

    token = mint_media_token(str(att.id), "gltf", ttl=3600)
    paths = get_lod_glb_paths(str(att.id), att.file_path, is_part=True)
    glb_base = get_glb_cache_path(str(att.id), att.file_path, is_part=True)
    has_lod = all(_os.path.exists(p) for p in paths.values())
    urls = {}
    if has_lod:
        for tier, p in paths.items():
            urls[tier] = f"/api/parts/attachments/{att.id}/lod/{tier}?token={token}"
    elif _os.path.exists(glb_base):
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback
    else:
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback

    return {
        "revision_id": str(rev.id),
        "glb_urls": urls,
    }


def _collect_config_profile_parts(config_tree: dict) -> list[dict]:
    """递归遍历 config_tree，收集所有选中零部件（跳过构型项行）"""
    parts = []

    def walk(node: dict):
        if not node:
            return
        for p in node.get("parts", []):
            if p.get("is_selected") and p.get("item_type") != "config_item":
                parts.append({
                    "item_id": p.get("item_id"),
                    "item_code": p.get("item_code"),
                    "item_name": p.get("item_name"),
                    "item_version": p.get("item_version"),
                })
        for child in node.get("children", []):
            if child.get("is_selected"):
                walk(child)

    walk(config_tree)
    return parts


def _is_config_node_selected(db: Session, config_item_id: str, profile_items: list) -> bool:
    """判断构型项节点是否已选（其下所有非可选部件有任意选中即算选中）"""
    for pi in profile_items:
        if pi.source_config_item_id and str(pi.source_config_item_id) == config_item_id and pi.is_selected:
            return True
    # 递归检查子节点
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_id == config_item_id
    ).all()
    for child in children:
        if _is_config_node_selected(db, str(child.child_id), profile_items):
            return True
    return False


@router.put("/profiles/{profile_id}/config-items/{config_item_id}/toggle", response_model=dict)
async def toggle_config_item_node(
    profile_id: str,
    config_item_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """切换构型项节点及其下属所有零部件的勾选状态（仅 draft + 可选节点）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改")

    all_items = crud.get_working_items(db, profile_id)

    # 判断当前节点状态：如果其下所有零部件都已勾选，则视为"已选"
    node_selected = _is_config_node_selected(db, config_item_id, all_items)

    # 收集该节点及其子节点下所有零部件
    target_ids = _collect_descendant_config_item_ids(db, config_item_id)
    target_ids.add(config_item_id)

    toggled = []
    for pi in all_items:
        if pi.source_config_item_id and str(pi.source_config_item_id) in target_ids:
            crud.update_working_item(db, str(pi.id), not node_selected, force=True)
            toggled.append(str(pi.id))

    # 如果该可选节点下没有任何零部件，创建合成条目记录节点级选中态
    if len(toggled) == 0 and not node_selected:
        config_item = crud.get_config_item(db, config_item_id)
        if config_item:
            node_item = models.ConfigurationWorkingItem(
                profile_id=uuid.UUID(profile_id),
                source_config_item_id=uuid.UUID(config_item_id),
                item_type='config_item',
                item_id=uuid.UUID(config_item_id),
                item_code=config_item.code,
                item_name=config_item.name,
                is_required=False,
                is_selected=True,
                source_type='child',
                sort_order=0,
            )
            db.add(node_item)
            db.commit()
            toggled.append(str(node_item.id))

    return {"detail": "ok", "toggled": len(toggled)}


@router.post("/profiles/{profile_id}/regenerate", response_model=dict)
async def regenerate_profile_checklist(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """以最新构型项内容强制重建配置清单（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改")

    profile = crud.regenerate_profile_checklist(db, profile_id)
    if not profile:
        raise HTTPException(status_code=400, detail="重建失败，请先关联构型项")

    items = crud.get_working_items(db, profile_id)
    entity_map = _build_entity_map(db, items)
    return {
        "detail": "ok",
        "items": [_format_profile_item(item, entity_map) for item in items],
        "config_tree": _build_config_tree(db, str(profile.configuration_item_id), items, entity_map),
    }


def _collect_descendant_config_item_ids(db: Session, config_item_id: str) -> set:
    """递归收集所有子孙构型项 ID"""
    ids = set()
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_id == config_item_id
    ).all()
    for child in children:
        cid = str(child.child_id)
        ids.add(cid)
        ids.update(_collect_descendant_config_item_ids(db, cid))
    return ids
