"""零部件签入检出 API 路由"""
from __future__ import annotations
import uuid as _uuid
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.responses import FileResponse
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, BOMItem, CustomFieldValue
from .. import crud_parts
from .. import crud
from .. import schemas_parts
from ..permissions import require_permission
import tempfile, os as _os
from ..cad.assembly_parser import parse_assembly_step
from ..stp_converter import get_lod_glb_paths, get_glb_cache_path
from ..schemas_parts import MatchReport, AssemblyInstanceDTO, AssemblyTreeNodeDTO

router = APIRouter(prefix="/parts", tags=["parts"])


# ===== PartMaster =====

@router.get("/", response_model=dict)
def list_parts(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    check_out_user_id: Optional[UUID] = Query(None),
    show_all_versions: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    items, total = crud_parts.list_part_masters(
        db, search, status, check_out_user_id, show_all_versions, page, page_size
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/", response_model=schemas_parts.PartMasterResponse)
def create_part(
    data: schemas_parts.PartMasterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:create")),
):
    try:
        master = crud_parts.create_part_master(db, data.model_dump(), current_user.id)
        return _build_master_response(db, master)
    except ValueError as e:
        raise HTTPException(400, str(e))


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


@router.delete("/revisions/{revision_id}")
def delete_revision(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete")),
):
    rev = crud_parts.get_part_revision(db, revision_id)
    if not rev:
        raise HTTPException(404, "版本不存在")
    # 检查是否为其他零部件的BOM子项（排除已软删除的父零部件）
    used_as_child = db.query(crud_parts.models.BOMItem).filter(
        crud_parts.models.BOMItem.child_revision_id == revision_id,
        crud_parts.models.BOMItem.deleted_at.is_(None),
    ).first()
    if used_as_child:
        parent_rev = crud_parts.get_part_revision(db, used_as_child.parent_revision_id)
        parent_master = crud_parts.get_part_master(db, parent_rev.master_id) if parent_rev else None
        # 父零部件未被软删除时才阻止
        if parent_rev and parent_master and parent_rev.deleted_at is None and parent_master.deleted_at is None:
            parent_info = f"{parent_master.code} {parent_master.name}" if parent_master else "其他零部件"
            raise HTTPException(400, f"该零部件是「{parent_info}」的BOM子项，请先在父部件中移除此子项后再删除")
    rev.deleted_at = datetime.now(timezone.utc)
    db.commit()
    # 如果该主数据下所有版本都已软删除，自动删除主数据
    remaining = db.query(crud_parts.models_parts.PartRevision).filter(
        crud_parts.models_parts.PartRevision.master_id == rev.master_id,
        crud_parts.models_parts.PartRevision.deleted_at.is_(None),
    ).count()
    if remaining == 0:
        crud_parts.delete_part_master(db, rev.master_id)
    return {"detail": "已删除"}


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


@router.put("/revisions/{revision_id}/iterations/current")
def update_current_iteration(
    revision_id: UUID,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    """更新当前迭代的可变数据（remark）"""
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(400, "当前迭代不存在")
    if str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(400, "请先签出后再编辑")

    updated = {}
    if "remark" in data and data["remark"] is not None:
        iteration.remark = data["remark"]
        updated["remark"] = data["remark"]
    if updated:
        db.commit()
    return {"detail": "已保存", "updated": updated}


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
        "document_links": iteration.document_links or [],
        "remark": iteration.remark,
        "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
    }


@router.delete("/revisions/{revision_id}/iterations/{iteration_id}")
def delete_iteration(
    revision_id: UUID,
    iteration_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:delete")),
):
    """管理员删除指定迭代（含物理附件文件）"""
    rev = db.query(crud_parts.models_parts.PartRevision).filter(
        crud_parts.models_parts.PartRevision.id == revision_id,
    ).first()
    if not rev:
        raise HTTPException(404, "版本不存在")
    target = db.query(crud_parts.models_parts.PartIteration).filter(
        crud_parts.models_parts.PartIteration.id == iteration_id,
        crud_parts.models_parts.PartIteration.revision_id == revision_id,
    ).first()
    if not target:
        raise HTTPException(404, "迭代不存在")

    total = db.query(crud_parts.models_parts.PartIteration).filter(
        crud_parts.models_parts.PartIteration.revision_id == revision_id,
    ).count()
    if total <= 1:
        raise HTTPException(400, "至少需保留一个迭代")

    # 删除该迭代的附件及物理文件
    atts = db.query(crud_parts.models_parts.PartAttachment).filter(
        crud_parts.models_parts.PartAttachment.iteration_id == iteration_id,
    ).all()
    for att in atts:
        if att.file_path:
            try:
                import os
                if os.path.exists(att.file_path):
                    os.remove(att.file_path)
                parent = os.path.dirname(att.file_path)
                for _ in range(3):
                    if os.path.isdir(parent) and not os.listdir(parent):
                        os.rmdir(parent)
                        parent = os.path.dirname(parent)
                    else:
                        break
            except Exception:
                pass
        db.delete(att)

    # 清理该迭代关联的 BOMItem 和自定义字段值
    db.query(BOMItem).filter(
        BOMItem.iteration_id == iteration_id,
    ).delete(synchronize_session=False)
    db.query(CustomFieldValue).filter(
        CustomFieldValue.iteration_id == iteration_id,
    ).delete(synchronize_session=False)

    # 如果删除的是当前最新迭代，回退 latest_iteration
    if target.iteration == rev.latest_iteration:
        prev = db.query(crud_parts.models_parts.PartIteration).filter(
            crud_parts.models_parts.PartIteration.revision_id == revision_id,
            crud_parts.models_parts.PartIteration.iteration < target.iteration,
        ).order_by(crud_parts.models_parts.PartIteration.iteration.desc()).first()
        rev.latest_iteration = prev.iteration if prev else 1
        if rev.check_out_user_id is not None:
            rev.check_out_user_id = None
            rev.check_out_date = None

    db.delete(target)
    db.commit()

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除零部件迭代", "part_iteration", str(iteration_id),
                    f"件号:{rev.master_id} 迭代:{target.iteration}", ip)
    return {"message": "迭代已删除", "latest_iteration": rev.latest_iteration}


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

    child_count = 0
    if latest_revision:
        child_count = db.query(crud_parts.models.BOMItem).filter(
            crud_parts.models.BOMItem.parent_revision_id == latest_revision.id,
            crud_parts.models.BOMItem.deleted_at.is_(None),
        ).count()
    dynamic_type = "assembly" if child_count > 0 else "part"

    return {
        "id": str(master.id),
        "code": master.code,
        "name": master.name,
        "spec": master.spec,
        "type": dynamic_type,
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


def _list_docs(db: Session, revision_id: UUID, iteration_id: Optional[UUID] = None):
    from ..models import Document as DocModel
    if iteration_id:
        iteration = db.query(crud_parts.models_parts.PartIteration).filter(
            crud_parts.models_parts.PartIteration.id == iteration_id
        ).first()
        if not iteration:
            return []
        links = iteration.document_links or []
    else:
        _, iteration = _get_doc_iteration(db, revision_id)
        links = iteration.document_links or []
    
    docs = []
    for link in (links or []):
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
def list_docs_alt(revision_id: UUID, iteration_id: Optional[UUID] = Query(None),
                  db: Session = Depends(get_db),
                  current_user: User = Depends(require_permission("components.doc:read"))):
    return _list_docs(db, revision_id, iteration_id)

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
def list_docs(revision_id: UUID, iteration_id: Optional[UUID] = Query(None),
              db: Session = Depends(get_db),
              current_user: User = Depends(require_permission("components.doc:read"))):
    return _list_docs(db, revision_id, iteration_id)

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


# ===== 附件管理 =====

@router.get("/revisions/{revision_id}/attachments")
def list_attachments(
    revision_id: UUID,
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:list")),
):
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    if not iteration:
        return []

    query = db.query(crud_parts.models_parts.PartAttachment).filter(
        crud_parts.models_parts.PartAttachment.iteration_id == iteration.id
    )
    if category:
        query = query.filter(crud_parts.models_parts.PartAttachment.category == category)

    return [
        {
            "id": str(att.id),
            "iteration_id": str(att.iteration_id),
            "category": att.category,
            "file_name": att.file_name,
            "file_size": att.file_size,
            "file_path": att.file_path,
            "file_hash": att.file_hash,
            "created_at": att.created_at.isoformat() if att.created_at else None,
        }
        for att in query.all()
    ]


@router.post("/revisions/{revision_id}/attachments")
async def add_attachment(
    revision_id: UUID,
    file: UploadFile = File(...),
    category: str = Form("cad"),
    db: Session = Depends(get_db),
):
    """上传附件到当前迭代"""
    import os, hashlib
    
    result = crud_parts.get_part_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(404, "版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(400, "当前迭代不存在")

    master = db.query(crud_parts.models_parts.PartMaster).filter(
        crud_parts.models_parts.PartMaster.id == revision.master_id
    ).first()
    if not master:
        raise HTTPException(404, "主数据不存在")

    upload_dir = f"./uploads/parts/{master.code}/{revision.version}/{iteration.iteration}"
    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, file.filename)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    file_hash = hashlib.sha256(content).hexdigest()

    att = crud_parts.models_parts.PartAttachment(
        iteration_id=iteration.id,
        category=category,
        file_name=file.filename,
        file_size=len(content),
        file_path=file_path,
        file_hash=file_hash,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    # STP 附件上传后自动触发 GLB 转换
    from ..stp_converter import convert_stp_to_gltf, is_stp_file
    import asyncio
    if is_stp_file(file.filename):
        try:
            loop = asyncio.get_event_loop()
            loop.run_in_executor(None, convert_stp_to_gltf, file_path, str(att.id), file_path, True)
        except Exception:
            pass
    return {"id": str(att.id), "file_name": att.file_name, "file_size": att.file_size}


@router.delete("/revisions/{revision_id}/attachments/{attachment_id}")
def delete_attachment(
    revision_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
):
    """删除附件"""
    att = db.query(crud_parts.models_parts.PartAttachment).filter(
        crud_parts.models_parts.PartAttachment.id == attachment_id
    ).first()
    if not att:
        raise HTTPException(404, "附件不存在")
    import os
    if att.file_path and os.path.exists(att.file_path):
        os.remove(att.file_path)
    # 清理对应的 GLB 缓存
    from ..stp_converter import delete_glb_cache, is_stp_file
    if is_stp_file(att.file_name):
        delete_glb_cache(str(attachment_id), att.file_path, is_part=True)
    db.delete(att)
    db.commit()
    return {"detail": "已删除"}


@router.get("/revisions/{revision_id}/bom-attachments")
def list_bom_attachments(
    revision_id: UUID,
    category: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:download")),
):
    """列出该部件及 BOM 树全部子孙件当前迭代下指定 category 的附件（供前端顺序下载）。"""
    if category not in ("cad", "production"):
        raise HTTPException(400, "category 必须为 cad 或 production")
    items = crud_parts.collect_bom_attachments(db, revision_id, category)
    if not items:
        raise HTTPException(404, "未找到该类别的附件")
    return {"revision_id": str(revision_id), "category": category,
            "count": len(items), "items": items}


@router.get("/revisions/{revision_id}/attachments/{attachment_id}/file")
def get_attachment_file(
    revision_id: UUID,
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:list")),
):
    """获取附件文件内容"""
    import os, mimetypes
    att = db.query(crud_parts.models_parts.PartAttachment).filter(
        crud_parts.models_parts.PartAttachment.id == attachment_id
    ).first()
    if not att:
        raise HTTPException(404, "附件不存在")
    if not att.file_path or not os.path.exists(att.file_path):
        raise HTTPException(404, "文件不存在")
    mime_type = mimetypes.guess_type(att.file_path)[0] or "application/octet-stream"
    return FileResponse(att.file_path, media_type=mime_type, filename=att.file_name)


@router.get("/attachments/{attachment_id}/download")
def download_part_attachment(
    attachment_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:download")),
):
    """按附件 ID 直接下载零部件附件（file_path 直读，避免 v2 的 base_dir 双重拼接问题）。"""
    import os, mimetypes
    att = db.query(crud_parts.models_parts.PartAttachment).filter(
        crud_parts.models_parts.PartAttachment.id == attachment_id
    ).first()
    if not att:
        raise HTTPException(404, "附件不存在")
    if not att.file_path or not os.path.exists(att.file_path):
        raise HTTPException(404, "文件不存在")
    mime_type = mimetypes.guess_type(att.file_path)[0] or "application/octet-stream"
    return FileResponse(att.file_path, media_type=mime_type, filename=att.file_name)


# ===== 装配 3D 预览 =====

def _glb_url_resolver_factory(db):
    from ..models_parts import PartIteration, PartAttachment

    def resolver(child_revision_id):
        rev = crud_parts.get_part_revision(db, child_revision_id)
        if not rev:
            return None
        it = (db.query(PartIteration)
              .filter(PartIteration.revision_id == rev.id,
                      PartIteration.iteration == rev.latest_iteration).first())
        if not it:
            return None
        # 优先找生产附件中的 STP 文件（CAD 附件通常是原始 CAD 格式，不可直接预览）
        from ..stp_converter import is_stp_file
        atts = (db.query(PartAttachment)
               .filter(PartAttachment.iteration_id == it.id)
               .all())
        att = next((a for a in atts if is_stp_file(a.file_name) and a.category == 'production'), None)
        if not att:
            att = next((a for a in atts if is_stp_file(a.file_name)), None)
        if not att:
            return None
        paths = get_lod_glb_paths(str(att.id), att.file_path, is_part=True)
        # 生成媒体令牌
        from ..media_token import mint_media_token
        token = mint_media_token(str(att.id), "gltf", ttl=3600)
        # 优先使用 V2 的单文件 GLB 端点（支持 token 认证）
        urls = {}
        # 检查 LOD 三级是否存在，不存在则全部指向单文件
        glb_base = get_glb_cache_path(str(att.id), att.file_path, is_part=True)
        has_lod = all(_os.path.exists(p) for p in paths.values())
        if has_lod:
            for tier, p in paths.items():
                urls[tier] = f"/api/parts/attachments/{att.id}/lod/{tier}?token={token}"
        elif _os.path.exists(glb_base):
            fallback_url = f"/api/v2/attachments/{att.id}/gltf?token={token}"
            for tier in ("coarse", "normal", "fine"):
                urls[tier] = fallback_url
        else:
            # GLB 尚未生成：仍返回 /gltf 端点地址（该端点会按需触发后台转换并在完成前返回 202）。
            # 这样叶项不会被静默跳过，前端可轮询等待转换完成后再加载。
            fallback_url = f"/api/v2/attachments/{att.id}/gltf?token={token}"
            for tier in ("coarse", "normal", "fine"):
                urls[tier] = fallback_url
        return urls

    return resolver


@router.post("/revisions/{revision_id}/import-assembly-step", response_model=MatchReport)
async def import_assembly_step(
    revision_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:update")),
):
    """上传装配 STEP：多层级矩阵回填 + 逐子项拆分为生产附件 + 装配自身也存为生产附件。"""
    content = await file.read()
    suffix = _os.path.splitext(file.filename or "a.step")[1] or ".step"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        parsed = parse_assembly_step(tmp_path)
        from ..cad.assembly_parser import build_structure_index
        text = content.decode("utf-8", errors="ignore")
        index = build_structure_index(text)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    finally:
        _os.unlink(tmp_path)

    report = crud_parts.apply_step_matrices(db, revision_id, parsed)
    split = crud_parts.generate_subitem_steps(db, revision_id, index, current_user.id)
    # 装配自身 STEP 原文也保存为其生产附件（件号.STEP，同名替换）
    crud_parts.save_assembly_step_as_attachment(db, revision_id, content, current_user.id)
    # 合并：unmatched 取并集，其余 generated/skipped_not_editable/failed 来自拆分侧
    report["unmatched"] = sorted(set(report.get("unmatched", [])) | set(split.get("unmatched", [])))
    report["generated"] = split.get("generated", [])
    report["skipped_not_editable"] = split.get("skipped_not_editable", [])
    report["failed"] = split.get("failed", [])
    return report


@router.get("/revisions/{revision_id}/assembly-instances", response_model=List[AssemblyInstanceDTO])
def assembly_instances(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    resolver = _glb_url_resolver_factory(db)
    return crud_parts.get_assembly_instances(db, revision_id, resolver)


@router.get("/revisions/{revision_id}/assembly-tree", response_model=List[AssemblyTreeNodeDTO])
def assembly_tree(
    revision_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    return crud_parts.get_assembly_tree(db, revision_id)


@router.get("/attachments/{attachment_id}/lod/{tier}")
def get_attachment_lod_glb(
    attachment_id: UUID,
    tier: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("components:read")),
):
    from ..models_parts import PartAttachment
    att = db.query(PartAttachment).filter(PartAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    if tier == "glb":
        # 单文件兜底
        glb = get_glb_cache_path(str(att.id), att.file_path, is_part=True)
        if not glb or not _os.path.exists(glb):
            raise HTTPException(status_code=404, detail="GLB 未生成")
        return FileResponse(str(glb), media_type="model/gltf-binary", filename=glb.name)
    if tier not in ("coarse", "normal", "fine"):
        raise HTTPException(status_code=400, detail="非法档位")
    paths = get_lod_glb_paths(str(att.id), att.file_path, is_part=True)
    glb = paths.get(tier)
    if not glb or not _os.path.exists(glb):
        raise HTTPException(status_code=404, detail="LOD 未生成")
    return FileResponse(str(glb), media_type="model/gltf-binary", filename=glb.name)
