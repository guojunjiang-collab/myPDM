"""零部件签入检出 API 路由"""
from __future__ import annotations
import uuid as _uuid
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from .. import crud_parts
from .. import schemas_parts
from ..permissions import require_permission

router = APIRouter(prefix="/parts", tags=["parts"])


# ===== PartMaster =====

@router.get("/", response_model=dict)
def list_parts(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    type: Optional[str] = Query(None, alias="type"),
    check_out_user_id: Optional[UUID] = Query(None),
    show_all_versions: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    items, total = crud_parts.list_part_masters(
        db, search, status, type, check_out_user_id, show_all_versions, page, page_size
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/", response_model=schemas_parts.PartMasterResponse)
def create_part(
    data: schemas_parts.PartMasterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:create")),
):
    master = crud_parts.create_part_master(db, data.model_dump(), current_user.id)
    return _build_master_response(db, master)


@router.get("/{master_id}", response_model=schemas_parts.PartMasterResponse)
def get_part(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    master = crud_parts.get_part_master(db, master_id)
    if not master:
        raise HTTPException(404, "零件不存在")
    return _build_master_response(db, master)


@router.put("/{master_id}", response_model=schemas_parts.PartMasterResponse)
def update_part(
    master_id: UUID,
    data: schemas_parts.PartMasterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    master = crud_parts.update_part_master(db, master_id, data.model_dump(exclude_none=True))
    if not master:
        raise HTTPException(404, "零件不存在")
    return _build_master_response(db, master)


@router.delete("/{master_id}")
def delete_part(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete")),
):
    ok = crud_parts.delete_part_master(db, master_id)
    if not ok:
        raise HTTPException(404, "零件不存在")
    return {"detail": "已删除"}


# ===== PartRevision =====

@router.get("/{master_id}/revisions")
def list_revisions(
    master_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    revisions = crud_parts.list_revisions_by_master(db, master_id)
    result = []
    for rev in revisions:
        checkout_user_name = None
        if rev.check_out_user_id:
            user = db.query(User).filter(User.id == rev.check_out_user_id).first()
            if user:
                checkout_user_name = user.real_name
        result.append(
            {
                "id": str(rev.id),
                "version": rev.version,
                "status": rev.status,
                "revision_note": rev.revision_note,
                "check_out_user_id": str(rev.check_out_user_id) if rev.check_out_user_id else None,
                "check_out_user_name": checkout_user_name,
                "check_out_date": rev.check_out_date.isoformat() if rev.check_out_date else None,
                "latest_iteration": rev.latest_iteration,
                "revision_parent_id": str(rev.revision_parent_id) if rev.revision_parent_id else None,
                "created_at": rev.created_at.isoformat() if rev.created_at else None,
            }
        )
    return result


@router.get("/revisions/{revision_id}")
def get_revision(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    return _build_revision_response(db, revision, iteration)


# ===== 签出/签入 =====

@router.post("/revisions/{revision_id}/checkout")
def checkout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:checkout")),
):
    revision, err = crud_parts.checkout_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/checkin")
def checkin(
    revision_id: UUID,
    body: schemas_parts.CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:checkin")),
):
    revision, err = crud_parts.checkin_part(db, revision_id, current_user.id, body.check_in_note)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/undocheckout")
def undocheckout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:undocheckout")),
):
    revision, err = crud_parts.undocheckout_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/force-checkin")
def force_checkin(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:force_checkin")),
):
    revision, err = crud_parts.force_checkin_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


# ===== 状态变更 =====

@router.post("/revisions/{revision_id}/release")
def release(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:release")),
):
    revision, err = crud_parts.release_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/freeze")
def freeze(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:freeze")),
):
    revision, err = crud_parts.freeze_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/unfreeze")
def unfreeze(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:unfreeze")),
):
    revision, err = crud_parts.unfreeze_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/obsolete")
def obsolete(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:obsolete")),
):
    revision, err = crud_parts.obsolete_part(db, revision_id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    return _build_revision_response(db, result[0], result[1])


@router.post("/revisions/{revision_id}/upgrade")
def upgrade(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:upgrade")),
):
    revision, err = crud_parts.upgrade_part(db, revision_id, current_user.id)
    if err:
        raise HTTPException(400, err)
    result = crud_parts.get_part_revision_with_current_iteration(db, revision.id)
    return _build_revision_response(db, result[0], result[1])


# ===== 迭代历史 =====

@router.get("/revisions/{revision_id}/iterations")
def list_iterations(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    iterations = crud_parts.list_iterations_by_revision(db, revision_id)
    return [
        {
            "id": str(it.id),
            "revision_id": str(it.revision_id),
            "iteration": it.iteration,
            "check_in_date": it.check_in_date.isoformat() if it.check_in_date else None,
            "check_in_note": it.check_in_note,
            "remark": it.remark,
            "created_at": it.created_at.isoformat() if it.created_at else None,
        }
        for it in iterations
    ]


@router.get("/revisions/{revision_id}/iterations/{iteration_id}")
def get_iteration(
    revision_id: UUID,
    iteration_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    iteration = crud_parts.get_part_iteration(db, iteration_id)
    if not iteration or str(iteration.revision_id) != str(revision_id):
        raise HTTPException(404, "迭代不存在")
    return {
        "id": str(iteration.id),
        "revision_id": str(iteration.revision_id),
        "iteration": iteration.iteration,
        "check_in_date": iteration.check_in_date.isoformat() if iteration.check_in_date else None,
        "check_in_note": iteration.check_in_note,
        "custom_fields": iteration.custom_fields or {},
        "document_links": iteration.document_links or [],
        "remark": iteration.remark,
        "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
    }


# ===== 级联操作 =====

@router.post("/revisions/{revision_id}/cascade-checkout")
def cascade_checkout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_checkout")),
):
    result = crud_parts.cascade_checkout(db, revision_id, current_user.id)
    return result


@router.post("/revisions/{revision_id}/cascade-checkin")
def cascade_checkin(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_checkin")),
):
    result = crud_parts.cascade_checkin(db, revision_id, current_user.id)
    return result


@router.post("/revisions/{revision_id}/cascade-undocheckout")
def cascade_undocheckout(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:cascade_undocheckout")),
):
    result = crud_parts.cascade_undocheckout(db, revision_id, current_user.id)
    return result


# ===== BOM 管理 =====

@router.get("/revisions/{revision_id}/bom")
def get_bom(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:tree")),
):
    return crud_parts.get_bom_tree(db, revision_id)


@router.post("/revisions/{revision_id}/bom/items")
def add_bom_item(
    revision_id: UUID,
    data: schemas_parts.BOMItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:create_relation")),
):
    item, err = crud_parts.add_bom_item(db, revision_id, data.model_dump())
    if err:
        raise HTTPException(400, err)
    return {"id": str(item.id), "detail": "已添加"}


@router.put("/revisions/{revision_id}/bom/items/{item_id}")
def update_bom_item(
    revision_id: UUID,
    item_id: UUID,
    data: schemas_parts.BOMItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:create_relation")),
):
    item, err = crud_parts.update_bom_item(db, item_id, data.model_dump(exclude_none=True))
    if err:
        raise HTTPException(400, err)
    return {"id": str(item.id), "detail": "已更新"}


@router.delete("/revisions/{revision_id}/bom/items/{item_id}")
def delete_bom_item(
    revision_id: UUID,
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:delete_relation")),
):
    ok = crud_parts.delete_bom_item(db, item_id)
    if not ok:
        raise HTTPException(404, "BOM项不存在")
    return {"detail": "已删除"}


# ===== 辅助函数 =====

def _build_master_response(db: Session, master) -> dict:
    """构建 PartMasterResponse，含最新版本摘要"""
    latest_revision = (
        db.query(crud_parts.models_parts.PartRevision)
        .filter(
            crud_parts.models_parts.PartRevision.master_id == master.id,
            crud_parts.models_parts.PartRevision.deleted_at.is_(None),
        )
        .order_by(crud_parts.models_parts.PartRevision.created_at.desc())
        .first()
    )

    checkout_user_name = None
    if latest_revision and latest_revision.check_out_user_id:
        user = db.query(User).filter(User.id == latest_revision.check_out_user_id).first()
        if user:
            checkout_user_name = user.real_name

    return {
        "id": str(master.id),
        "code": master.code,
        "name": master.name,
        "spec": master.spec,
        "type": master.type,
        "creator_id": str(master.creator_id) if master.creator_id else None,
        "created_at": master.created_at.isoformat() if master.created_at else None,
        "updated_at": master.updated_at.isoformat() if master.updated_at else None,
        "latest_revision": {
            "id": str(latest_revision.id) if latest_revision else None,
            "version": latest_revision.version if latest_revision else None,
            "status": latest_revision.status if latest_revision else None,
            "latest_iteration": latest_revision.latest_iteration if latest_revision else 0,
            "check_out_user_id": str(latest_revision.check_out_user_id) if (latest_revision and latest_revision.check_out_user_id) else None,
            "check_out_user_name": checkout_user_name,
            "check_out_date": latest_revision.check_out_date.isoformat() if (latest_revision and latest_revision.check_out_date) else None,
            "created_at": latest_revision.created_at.isoformat() if (latest_revision and latest_revision.created_at) else None,
        } if latest_revision else None,
    }


def _build_revision_response(db: Session, revision, iteration) -> dict:
    checkout_user_name = None
    if revision.check_out_user_id:
        user = db.query(User).filter(User.id == revision.check_out_user_id).first()
        if user:
            checkout_user_name = user.real_name

    resp = {
        "id": str(revision.id),
        "master_id": str(revision.master_id),
        "version": revision.version,
        "status": revision.status,
        "revision_note": revision.revision_note,
        "check_out_user_id": str(revision.check_out_user_id) if revision.check_out_user_id else None,
        "check_out_user_name": checkout_user_name,
        "check_out_date": revision.check_out_date.isoformat() if revision.check_out_date else None,
        "latest_iteration": revision.latest_iteration,
        "revision_parent_id": str(revision.revision_parent_id) if revision.revision_parent_id else None,
        "creator_id": str(revision.creator_id) if revision.creator_id else None,
        "created_at": revision.created_at.isoformat() if revision.created_at else None,
        "updated_at": revision.updated_at.isoformat() if revision.updated_at else None,
        "current_iteration": None,
    }
    if iteration:
        resp["current_iteration"] = {
            "id": str(iteration.id),
            "revision_id": str(iteration.revision_id),
            "iteration": iteration.iteration,
            "check_in_date": iteration.check_in_date.isoformat() if iteration.check_in_date else None,
            "check_in_note": iteration.check_in_note,
            "custom_fields": iteration.custom_fields or {},
            "document_links": iteration.document_links or [],
            "remark": iteration.remark,
            "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
        }
    return resp


# ===== 关联图文档 =====

def _get_doc_iteration(db: Session, revision_id: UUID):
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(400, "当前迭代不存在")
    return revision, iteration


def _list_docs(db: Session, revision_id: UUID):
    _, iteration = _get_doc_iteration(db, revision_id)
    docs = []
    for link in (iteration.document_links or []):
        doc_id = link.get("document_id")
        if not doc_id:
            continue
        try:
            doc_uuid = _uuid.UUID(str(doc_id))
        except (ValueError, AttributeError):
            continue
        from ..models import Document as DocModel
        doc = db.query(DocModel).filter(DocModel.id == doc_uuid).first()
        docs.append({
            "id": link.get("id", str(uuid4())),
            "document_id": str(doc_id),
            "category": link.get("category"),
            "sort_order": link.get("sort_order", 0),
            "created_at": link.get("created_at"),
            "document": {
                "id": str(doc.id) if doc else str(doc_id),
                "code": doc.code if doc else "未知",
                "name": doc.name if doc else "未知文档",
                "version": doc.version if doc else "",
                "status": doc.status if doc else "draft",
                "file_id": str(doc.file_id) if doc and doc.file_id else None,
                "file_name": doc.file_name if doc else None,
            } if doc else None,
        })
    return docs


def _add_doc(db: Session, revision_id: UUID, data: dict):
    _, iteration = _get_doc_iteration(db, revision_id)
    links = list(iteration.document_links or [])
    new_link = {
        "id": str(uuid4()),
        "document_id": data.get("document_id"),
        "category": data.get("category"),
        "sort_order": data.get("sort_order", 0),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links.append(new_link)
    iteration.document_links = links
    db.commit()
    return new_link


def _update_doc(db: Session, revision_id: UUID, link_id: str, data: dict):
    _, iteration = _get_doc_iteration(db, revision_id)
    links = list(iteration.document_links or [])
    for link in links:
        if link.get("id") == link_id:
            if "category" in data:
                link["category"] = data["category"]
            if "sort_order" in data:
                link["sort_order"] = data["sort_order"]
            iteration.document_links = links
            db.commit()
            return link
    raise HTTPException(404, "关联文档不存在")


def _remove_doc(db: Session, revision_id: UUID, link_id: str):
    _, iteration = _get_doc_iteration(db, revision_id)
    links = list(iteration.document_links or [])
    new_links = [l for l in links if l.get("id") != link_id]
    if len(new_links) == len(links):
        raise HTTPException(404, "关联文档不存在")
    iteration.document_links = new_links
    db.commit()
    return {"detail": "已移除"}


# EntityDocumentSection 调用路径: /parts/{id}/documents
@router.get("/{revision_id}/documents")
def list_docs_alt(revision_id: UUID, db: Session = Depends(get_db),
                  current_user: User = Depends(require_permission("components.doc:read"))):
    return _list_docs(db, revision_id)

@router.post("/{revision_id}/documents")
def add_doc_alt(revision_id: UUID, data: dict, db: Session = Depends(get_db),
                current_user: User = Depends(require_permission("components.doc:link"))):
    return _add_doc(db, revision_id, data)

@router.put("/{revision_id}/documents/{link_id}")
def update_doc_alt(revision_id: UUID, link_id: str, data: dict, db: Session = Depends(get_db),
                   current_user: User = Depends(require_permission("components.doc:link"))):
    return _update_doc(db, revision_id, link_id, data)

@router.delete("/{revision_id}/documents/{link_id}")
def remove_doc_alt(revision_id: UUID, link_id: str, db: Session = Depends(get_db),
                   current_user: User = Depends(require_permission("components.doc:unlink"))):
    return _remove_doc(db, revision_id, link_id)


# 旧路径: /parts/revisions/{id}/documents（兼容）
@router.get("/revisions/{revision_id}/documents")
def list_docs(revision_id: UUID, db: Session = Depends(get_db),
              current_user: User = Depends(require_permission("components.doc:read"))):
    return _list_docs(db, revision_id)

@router.post("/revisions/{revision_id}/documents")
def add_doc(revision_id: UUID, data: dict, db: Session = Depends(get_db),
            current_user: User = Depends(require_permission("components.doc:link"))):
    return _add_doc(db, revision_id, data)

@router.put("/revisions/{revision_id}/documents/{link_id}")
def update_doc(revision_id: UUID, link_id: str, data: dict, db: Session = Depends(get_db),
               current_user: User = Depends(require_permission("components.doc:link"))):
    return _update_doc(db, revision_id, link_id, data)

@router.delete("/revisions/{revision_id}/documents/{link_id}")
def remove_doc(revision_id: UUID, link_id: str, db: Session = Depends(get_db),
               current_user: User = Depends(require_permission("components.doc:unlink"))):
    return _remove_doc(db, revision_id, link_id)
