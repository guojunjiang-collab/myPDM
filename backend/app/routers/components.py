from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
import uuid

from ..database import get_db
from ..models import User, Document, DocumentGroupLink, UserGroup, Component, ComponentAttachment
from .. import crud, schemas
from ..permissions import require_permission
from ..file_storage import file_storage
from ..stp_converter import is_stp_file, delete_glb_cache
from ..office_converter import is_office_file, delete_pdf_cache

router = APIRouter(prefix="/components", tags=["零部件管理"])


def _creator_name(db, creator_id):
    if not creator_id:
        return ""
    u = db.query(User).filter(User.id == creator_id).first()
    return u.real_name if u else ""


def _comp_brief(comp, creator_name_map=None):
    d = {
        "id": str(comp.id),
        "code": comp.code,
        "name": comp.name,
        "spec": comp.spec,
        "version": comp.version,
        "status": comp.status,
        "remark": comp.remark,
        "creator_id": str(comp.creator_id) if comp.creator_id else None,
        "created_at": comp.created_at.isoformat() if comp.created_at else None,
        "updated_at": comp.updated_at.isoformat() if comp.updated_at else None,
        "deleted_at": comp.deleted_at.isoformat() if comp.deleted_at else None,
    }
    if creator_name_map is not None and comp.creator_id:
        d["creator_name"] = creator_name_map.get(comp.creator_id, "")
    return d


def _comp_response(comp, creator_name_map=None):
    d = {
        "id": comp.id,
        "code": comp.code,
        "name": comp.name,
        "spec": comp.spec,
        "version": comp.version,
        "status": comp.status,
        "remark": comp.remark,
        "revisions": comp.revisions or [],
        "creator_id": comp.creator_id,
        "created_at": comp.created_at,
        "updated_at": comp.updated_at,
        "deleted_at": comp.deleted_at,
    }
    if creator_name_map is not None and comp.creator_id:
        d["creator_name"] = creator_name_map.get(comp.creator_id, "")
    return d


@router.get("/")
async def list_components(
    skip: int = 0, limit: int = 100, search: str = None,
    updated_since: float = None, brief: bool = False, top_level: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    include_deleted = bool(updated_since)
    comps = crud.get_components(db, skip=skip, limit=limit, search=search,
                                updated_since=updated_since,
                                include_deleted=include_deleted, top_level=top_level)
    creator_ids = {c.creator_id for c in comps if c.creator_id}
    creator_name_map = {}
    if creator_ids:
        users = db.query(User).filter(User.id.in_(creator_ids)).all()
        creator_name_map = {u.id: u.real_name for u in users}
    if brief:
        return JSONResponse(content=[_comp_brief(c, creator_name_map) for c in comps])
    return [_comp_response(c, creator_name_map) for c in comps]


@router.post("/", response_model=schemas.ComponentResponse)
async def create_component(
    component: schemas.ComponentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:create"))
):
    if crud.get_component_by_code_version(db, component.code, component.version):
        raise HTTPException(status_code=400, detail="零部件编码+版本已存在")
    data = component.model_dump()
    data["creator_id"] = current_user.id
    db_comp = Component(**data)
    db.add(db_comp)
    db.commit()
    db.refresh(db_comp)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "创建零部件", "component", str(db_comp.id),
                    f"编码:{db_comp.code} 版本:{db_comp.version}", ip)
    return _comp_response(db_comp)


@router.get("/{component_id}")
async def get_component(
    component_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    return _comp_response(comp, {comp.creator_id: _creator_name(db, comp.creator_id)})


@router.put("/{component_id}", response_model=schemas.ComponentResponse)
async def update_component(
    component_id: uuid.UUID, component: schemas.ComponentUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update"))
):
    db_comp = crud.get_component(db, component_id)
    if not db_comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.assert_entity_editable(db, "component", component_id, current_user.role)
    updated = crud.update_component(db, component_id, component)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "更新零部件", "component", str(component_id), None, ip)
    return _comp_response(updated)


@router.delete("/{component_id}")
async def delete_component(
    component_id: uuid.UUID, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete"))
):
    db_comp = crud.get_component(db, component_id)
    if not db_comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.delete_component(db, component_id)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除零部件", "component", str(component_id),
                    f"编码:{db_comp.code}", ip)
    return {"ok": True}


@router.post("/{component_id}/document-links")
async def update_document_links(
    component_id: uuid.UUID, body: dict, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:link"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    comp.document_links = body.get("document_links", [])
    flag_modified(comp, "document_links")
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "更新图文档关联", "component", str(component_id), None, ip)
    return {"ok": True, "document_links": comp.document_links}


# ===== BOM 子项管理 =====

@router.get("/{component_id}/parts")
async def get_component_children(
    component_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.bom:manage"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    return crud.get_component_children(db, component_id)


@router.post("/{component_id}/parts")
async def add_component_child(
    component_id: uuid.UUID, item: schemas.BOMItemCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.bom:manage"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.assert_entity_editable(db, "component", component_id, current_user.role)
    item.parent_type = "component"
    item.parent_id = component_id
    db_item = crud.create_bom_item(db, item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "添加子项", "component", str(component_id),
                    f"子项:{item.child_type}:{item.child_id}", ip)
    return db_item


@router.put("/{component_id}/parts/{item_id}")
async def update_component_child(
    component_id: uuid.UUID, item_id: uuid.UUID, item_update: schemas.BOMItemUpdate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.bom:manage"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.assert_entity_editable(db, "component", component_id, current_user.role)
    db_item = crud.get_bom_item(db, item_id)
    if not db_item:
        raise HTTPException(status_code=404, detail="子项不存在")
    if item_update.quantity is not None:
        db_item.quantity = item_update.quantity
    db.commit()
    db.refresh(db_item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "更新子项", "component", str(component_id),
                    f"子项ID:{item_id}, 数量:{item_update.quantity}", ip)
    return db_item


@router.delete("/{component_id}/parts/{item_id}")
async def remove_component_child(
    component_id: uuid.UUID, item_id: uuid.UUID, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.bom:manage"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    crud.assert_entity_editable(db, "component", component_id, current_user.role)
    crud.delete_bom_item(db, item_id)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除子项", "component", str(component_id),
                    f"子项ID:{item_id}", ip)
    return {"message": "子项已删除"}


# ===== 文档关联 =====

@router.get("/{component_id}/documents")
async def get_component_documents(
    component_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:read"))
):
    from .. import crud_groups
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    links = comp.document_links or []
    result = []
    doc_ids = [l.get("document_id") for l in links if l.get("document_id")]
    user_group_ids = crud_groups.get_user_group_ids(db, current_user.id)
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
        doc = db.query(Document).filter(Document.id == link.get("document_id")).first()
        if not doc:
            continue
        gids = doc_groups.get(doc.id, set())
        result.append({
            "id": link.get("id"),
            "entity_type": "component",
            "entity_id": str(comp.id),
            "document_id": doc.id,
            "category": link.get("category"),
            "sort_order": link.get("sort_order", 0),
            "created_at": link.get("created_at"),
            "document": {
                "id": doc.id,
                "code": doc.code,
                "name": doc.name,
                "version": doc.version,
                "status": doc.status,
                "file_name": doc.file_name,
                "file_id": doc.file_id,
                "accessible": crud_groups.document_is_accessible(db, current_user, doc),
                "group_ids": [str(g) for g in gids],
                "group_names": [group_name_map.get(g, str(g)) for g in gids],
            }
        })
    return result


@router.post("/{component_id}/documents")
async def add_component_document(
    component_id: uuid.UUID, body: schemas.EntityDocumentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:link"))
):
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    from datetime import datetime, timezone
    link_id = str(body.id) if body.id else str(uuid.uuid4())
    link = {
        "id": link_id,
        "document_id": str(body.document_id),
        "category": body.category,
        "sort_order": body.sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links = comp.document_links or []
    links.append(link)
    comp.document_links = links
    flag_modified(comp, 'document_links')
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "关联图文档", "component", str(component_id),
                    f"文档:{doc.code}", ip)
    return {"id": link_id, "message": "图文档关联成功"}


@router.put("/{component_id}/documents/{link_id}")
async def update_component_document(
    component_id: uuid.UUID, link_id: uuid.UUID, body: schemas.EntityDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:link"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    links = comp.document_links or []
    link_id_str = str(link_id)
    found = False
    for link in links:
        if link.get("id") == link_id_str:
            if body.category is not None:
                link["category"] = body.category
            if body.sort_order is not None:
                link["sort_order"] = body.sort_order
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="关联不存在")
    comp.document_links = links
    flag_modified(comp, 'document_links')
    db.commit()
    return {"message": "关联已更新"}


@router.delete("/{component_id}/documents/{link_id}")
async def delete_component_document(
    component_id: uuid.UUID, link_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components.doc:unlink"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    links = comp.document_links or []
    link_id_str = str(link_id)
    new_links = [l for l in links if l.get("id") != link_id_str]
    if len(new_links) == len(links):
        raise HTTPException(status_code=404, detail="关联不存在")
    comp.document_links = new_links
    flag_modified(comp, 'document_links')
    db.commit()
    return {"message": "关联已移除"}


# ===== 零部件附件（CAD / 生产）=====

def _comp_att_response(att):
    return {
        "id": str(att.id),
        "component_id": str(att.component_id),
        "category": att.category,
        "file_name": att.file_name,
        "file_size": att.file_size,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/{component_id}/attachments")
async def list_component_attachments(
    component_id: uuid.UUID, category: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read"))
):
    comp = crud.get_component(db, component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="零部件不存在")
    q = db.query(ComponentAttachment).filter(ComponentAttachment.component_id == component_id)
    if category:
        q = q.filter(ComponentAttachment.category == category)
    rows = q.order_by(ComponentAttachment.created_at.asc()).all()
    return [_comp_att_response(a) for a in rows]


@router.delete("/{component_id}/attachments/{attachment_id}")
async def delete_component_attachment(
    component_id: uuid.UUID, attachment_id: uuid.UUID, request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:delete"))
):
    att = db.query(ComponentAttachment).filter(
        ComponentAttachment.id == attachment_id,
        ComponentAttachment.component_id == component_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    if att.file_path:
        file_storage.delete_file(att.file_path)
    if att.file_name and is_stp_file(att.file_name):
        delete_glb_cache(str(attachment_id), att.file_path)
    if att.file_name and is_office_file(att.file_name):
        delete_pdf_cache(str(attachment_id), att.file_path)
    db.delete(att)
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除零部件附件", "component", str(component_id),
                    f"附件:{att.file_name} 分类:{att.category}", ip)
    return {"message": "附件已删除"}
