from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
import uuid

from ..database import get_db
from ..models import User, Document, DocumentGroupLink, UserGroup, Component
from .. import crud, schemas
from ..permissions import require_permission

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
