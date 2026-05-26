"""
构型配置 - API Router
========================
构型项 CRUD + 关联零部件 + 子构型项 + 构型方案
"""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Part, Assembly, Document
from app import models_configuration as models
from app import schemas_configuration as schemas
from app import schemas as core_schemas
from app import crud_configuration as crud
from app import crud as core_crud
from app.routers.auth import require_role

router = APIRouter(prefix="/configurations", tags=["构型配置"])


# ════════════════════════════════════════════════════════
# 构型项 CRUD
# ════════════════════════════════════════════════════════

@router.get("/items", response_model=dict)
async def list_config_items(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    exclude_ancestors_of: str = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
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
    items, total = crud.get_config_items(db, search=search, skip=skip, limit=page_size,
                                          exclude_ids=exclude_ids)
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
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """构型项详情（含关联零部件 + 子构型项 + 构型方案）"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")

    # 关联零部件
    parts_data = []
    for p in crud.get_config_parts(db, config_id):
        entity = db.query(Part).filter(Part.id == p.part_id).first() if p.part_type == "part" \
            else db.query(Assembly).filter(Assembly.id == p.part_id).first()
        parts_data.append({
            "id": str(p.id), "part_type": p.part_type, "part_id": str(p.part_id),
            "is_required": p.is_required, "sort_order": p.sort_order,
            "part_detail": {
                "id": str(entity.id), "code": entity.code, "name": entity.name,
                "version": entity.version, "spec": entity.spec or "", "status": entity.status,
            } if entity else {},
        })

    # 子构型项
    children_data = []
    for c in crud.get_config_children(db, config_id):
        child = db.query(models.ConfigurationItem).filter(models.ConfigurationItem.id == c.child_id).first()
        children_data.append({
            "id": str(c.id), "child_id": str(c.child_id),
            "is_required": c.is_required, "sort_order": c.sort_order,
            "child_detail": {
                "id": str(child.id), "code": child.code, "name": child.name,
                "spec": child.spec or "",
            } if child else {},
        })

    return {
        "id": str(item.id), "code": item.code, "name": item.name,
        "spec": item.spec or "", "remark": item.remark or "",
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "parts": parts_data, "children": children_data,
        "documents": _get_config_documents(db, item),
    }


@router.post("/items", response_model=dict)
async def create_config_item(
    data: schemas.ConfigurationItemCreate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """创建构型项"""
    if crud.get_config_item_by_code(db, data.code):
        raise HTTPException(status_code=400, detail=f"构型号 {data.code} 已存在")
    item = crud.create_config_item(db, data)
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.put("/items/{config_id}", response_model=dict)
async def update_config_item(
    config_id: str, data: schemas.ConfigurationItemUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新构型项"""
    item = crud.update_config_item(db, config_id, data)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.delete("/items/{config_id}")
async def delete_config_item(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """删除构型项"""
    if not crud.delete_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联零部件
# ════════════════════════════════════════════════════════

@router.post("/items/{config_id}/parts", response_model=dict)
async def add_parts(
    config_id: str, data: schemas.ConfigPartBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """批量关联零部件"""
    if not crud.get_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"added": len(crud.add_config_parts(db, config_id, data.items))}


@router.put("/items/{config_id}/parts/{part_id}", response_model=dict)
async def update_part(
    config_id: str, part_id: str, data: schemas.ConfigPartUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新关联零部件属性"""
    part = crud.update_config_part(db, part_id, data)
    if not part:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"id": str(part.id), "is_required": part.is_required}


@router.delete("/items/{config_id}/parts/{part_id}")
async def remove_part(
    config_id: str, part_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新子构型项属性"""
    child = crud.update_config_child(db, child_id, data)
    if not child:
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"id": str(child.id), "is_required": child.is_required}


@router.delete("/items/{config_id}/children/{child_id}")
async def remove_child(
    config_id: str, child_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """移除子构型项"""
    if not crud.remove_config_child(db, child_id):
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联图文档
# ════════════════════════════════════════════════════════

def _get_config_documents(db: Session, item: models.ConfigurationItem) -> list:
    """从 document_links JSONB 读取关联图文档"""
    links = item.document_links or []
    result = []
    for link in links:
        doc_id = link.get("document_id")
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            continue
        result.append({
            "id": link.get("id"),
            "entity_type": "configuration",
            "entity_id": str(item.id),
            "document_id": str(doc.id),
            "category": link.get("category"),
            "sort_order": link.get("sort_order", 0),
            "created_at": link.get("created_at"),
            "document": {
                "id": str(doc.id),
                "code": doc.code,
                "name": doc.name,
                "version": doc.version,
                "status": doc.status,
                "file_name": doc.file_name,
                "file_id": str(doc.file_id) if doc.file_id else None,
            }
        })
    return result


@router.get("/items/{config_id}/documents")
async def get_config_documents(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """获取构型项关联的图文档列表"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    return _get_config_documents(db, item)


@router.post("/items/{config_id}/documents")
async def add_config_document(
    config_id: str, body: core_schemas.EntityDocumentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """配置列表"""
    skip = (page - 1) * page_size
    profiles, total = crud.get_profiles(db, search=search, status=status, skip=skip, limit=page_size)
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
        } for p in profiles],
        "total": total, "page": page, "page_size": page_size,
    }


@router.post("/profiles", response_model=dict)
async def create_profile(
    data: schemas.ConfigurationProfileCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
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
    items = crud.get_profile_items(db, str(profile.id))
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
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """配置详情 + 清单"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")

    config_item = crud.get_config_item(db, str(profile.configuration_item_id)) if profile.configuration_item_id else None
    items = crud.get_profile_items(db, profile_id)
    entity_map = _build_entity_map(db, items)

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
        "config_tree": _build_config_tree(db, str(profile.configuration_item_id), items, entity_map) if profile.configuration_item_id else None,
    }


@router.put("/profiles/{profile_id}", response_model=dict)
async def update_profile(
    profile_id: str,
    data: schemas.ConfigurationProfileUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
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
    current_user=Depends(require_role(["admin"])),
):
    """删除配置（管理员可删除任意状态）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    crud.delete_profile(db, profile_id)
    return {"detail": "ok"}


@router.post("/profiles/{profile_id}/activate")
async def activate_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """生效（draft → active）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可生效")
    crud.change_profile_status(db, profile_id, "active")
    return {"detail": "ok", "status": "active"}


class ProfileStatusUpdate(BaseModel):
    status: str  # "draft" | "active" | "archived"


@router.put("/profiles/{profile_id}/status")
async def update_profile_status(
    profile_id: str,
    data: ProfileStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """管理员直接修改状态"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.status not in ("draft", "active", "archived"):
        raise HTTPException(status_code=400, detail="无效状态")
    crud.change_profile_status(db, profile_id, data.status)
    return {"detail": "ok", "status": data.status}


@router.post("/profiles/{profile_id}/archive")
async def archive_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """归档（active → archived）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "active":
        raise HTTPException(status_code=400, detail="仅生效状态可归档")
    crud.change_profile_status(db, profile_id, "archived")
    return {"detail": "ok", "status": "archived"}


@router.put("/profiles/{profile_id}/items/{item_id}", response_model=dict)
async def update_profile_item(
    profile_id: str,
    item_id: str,
    data: schemas.ConfigurationProfileItemUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """勾选/取消可选件（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改清单")

    item = crud.get_profile_items(db, profile_id)
    found = next((i for i in item if str(i.id) == item_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="清单项不存在")
    if found.is_required:
        raise HTTPException(status_code=400, detail="必选项不可取消")

    updated = crud.update_profile_item(db, item_id, data.is_selected)
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
        "source_type": item.source_type,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
    return result


def _build_entity_map(db: Session, items: list) -> dict:
    """批量查找零部件版本和状态"""
    from app.models import Part, Assembly
    part_ids = []
    assembly_ids = []
    for item in items:
        if item.item_type == "part":
            part_ids.append(item.item_id)
        else:
            assembly_ids.append(item.item_id)
    entity_map = {}
    if part_ids:
        for p in db.query(Part).filter(Part.id.in_(part_ids)).all():
            entity_map[str(p.id)] = p
    if assembly_ids:
        for a in db.query(Assembly).filter(Assembly.id.in_(assembly_ids)).all():
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
            # 子构型项的选中态：如果其下有任意必选项未选中，视为未选中
            child_tree["is_selected"] = _is_config_node_selected(db, str(child.child_id), profile_items)
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
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """切换构型项节点及其下属所有零部件的勾选状态（仅 draft + 可选节点）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改")

    all_items = crud.get_profile_items(db, profile_id)

    # 判断当前节点状态：如果其下所有零部件都已勾选，则视为"已选"
    node_selected = _is_config_node_selected(db, config_item_id, all_items)

    # 收集该节点及其子节点下所有零部件
    target_ids = _collect_descendant_config_item_ids(db, config_item_id)
    target_ids.add(config_item_id)

    toggled = []
    for pi in all_items:
        if pi.source_config_item_id and str(pi.source_config_item_id) in target_ids:
            crud.update_profile_item(db, str(pi.id), not node_selected, force=True)
            toggled.append(str(pi.id))

    return {"detail": "ok", "toggled": len(toggled)}


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
