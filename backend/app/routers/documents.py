"""图文档管理 API（三层模型：Master → Revision → Iteration）"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import cast, String, func
from datetime import datetime, timezone
import uuid
import base64

from ..database import get_db
from ..models import User, DocumentMaster, DocumentRevision, DocumentIteration, DocumentAttachment, DocumentGroupLink, UserGroup, CustomFieldValue
from ..models_parts import PartMaster, PartRevision
from .. import crud, schemas, crud_groups, crud_documents
from ..permissions import require_permission, check_object_policy
from ..stp_converter import is_stp_file, delete_glb_cache
from ..office_converter import is_office_file, delete_pdf_cache

router = APIRouter(prefix="/documents", tags=["图文档管理"])


def _resolve_group_names(db: Session, gids: set) -> list:
    if not gids:
        return []
    gs = db.query(UserGroup).filter(UserGroup.id.in_(gids)).all()
    gname_map = {g.id: g.name for g in gs}
    return [gname_map.get(gid, str(gid)) for gid in gids]


def _checkout_user_name(db: Session, uid) -> Optional[str]:
    if not uid:
        return None
    u = db.query(User).filter(User.id == uid).first()
    return u.real_name if u else None


def _build_revision_response(db: Session, revision: DocumentRevision, iteration: Optional[DocumentIteration] = None, current_user=None) -> dict:
    """构建版本响应字典"""
    master = revision.master
    checkout_user_name = _checkout_user_name(db, revision.check_out_user_id)
    creator_name = _checkout_user_name(db, revision.creator_id)
    gids = crud_groups.get_document_group_ids(db, master.id) if master else set()
    gnames = _resolve_group_names(db, gids)

    first_att = None
    if iteration:
        first_att = iteration.attachments.first()
    elif revision.latest_iteration > 0:
        cur_iter = crud_documents._get_current_iteration(db, revision.id)
        if cur_iter:
            first_att = cur_iter.attachments.first()

    iteration_count = (
        db.query(DocumentIteration)
        .filter(DocumentIteration.revision_id == revision.id)
        .count()
    )

    result = {
        "id": str(revision.id),
        "master_id": str(revision.master_id),
        "code": master.code if master else "",
        "name": master.name if master else "",
        "version": revision.version,
        "status": revision.status,
        "remark": revision.remark,
        "check_out_user_id": str(revision.check_out_user_id) if revision.check_out_user_id else None,
        "check_out_user_name": checkout_user_name,
        "check_out_date": revision.check_out_date.isoformat() if revision.check_out_date else None,
        "latest_iteration": revision.latest_iteration,
        "iteration_count": iteration_count,
        "revision_parent_id": str(revision.revision_parent_id) if revision.revision_parent_id else None,
        "creator_id": str(revision.creator_id) if revision.creator_id else None,
        "creator_name": creator_name,
        "file_name": first_att.file_name if first_att else None,
        "file_id": str(first_att.id) if first_att else None,
        "file_size": first_att.file_size if first_att else None,
        "group_ids": list(gids),
        "group_names": gnames,
        "accessible": crud_groups.document_is_accessible(db, current_user, master) if (master and current_user) else True,
        "created_at": revision.created_at.isoformat() if revision.created_at else None,
        "updated_at": revision.created_at.isoformat() if revision.created_at else None,
        "deleted_at": revision.deleted_at.isoformat() if revision.deleted_at else None,
    }
    if iteration:
        result["current_iteration"] = {
            "id": str(iteration.id),
            "iteration": iteration.iteration,
            "check_in_date": iteration.check_in_date.isoformat() if iteration.check_in_date else None,
            "check_in_note": iteration.check_in_note,
            "created_at": iteration.created_at.isoformat() if iteration.created_at else None,
        }
    return result


# ===== 列表 =====

@router.get("/")
async def list_documents(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    check_out_user_id: Optional[uuid.UUID] = Query(None),
    show_all_versions: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    items, total = crud_documents.list_documents(
        db, search=search, status=status,
        check_out_user_id=check_out_user_id,
        show_all_versions=show_all_versions,
        page=page, page_size=page_size,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# ===== 创建 =====

@router.post("/")
async def create_document(
    doc: schemas.DocumentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:create")),
):
    try:
        master = crud_documents.create_document(db, doc.model_dump(), current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    group_ids = doc.group_ids or []
    for gid in set(group_ids):
        db.add(DocumentGroupLink(document_id=master.id, group_id=gid))
    if group_ids:
        db.commit()

    revision = (
        db.query(DocumentRevision)
        .filter(
            DocumentRevision.master_id == master.id,
            DocumentRevision.version == "A",
            DocumentRevision.deleted_at.is_(None),
        )
        .first()
    )
    iteration = crud_documents._get_current_iteration(db, revision.id) if revision else None

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建图文档", "document", str(revision.id) if revision else str(master.id), f"编号:{master.code}", ip)
    return _build_revision_response(db, revision, iteration, current_user)


# ===== 引用检查 =====

@router.get("/{revision_id}/references")
async def get_document_references(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read_refs")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="文档版本不存在")

    doc_id_str = str(revision_id)

    from ..models import DashboardItem, DashboardFolder, UserDashboard
    from ..models_parts import PartIteration
    references = []
    for it in db.query(PartIteration).all():
        for link in (it.document_links or []):
            if link.get("document_id") != doc_id_str:
                continue
            rev = db.query(PartRevision).filter(PartRevision.id == it.revision_id).first()
            if not rev or rev.deleted_at is not None:
                break
            master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
            if not master or master.deleted_at is not None:
                break
            entity_type = "component" if master.type == "assembly" else "part"
            references.append({
                "entity_type": entity_type,
                "entity_id": str(master.id),
                "entity_code": master.code,
                "entity_name": master.name,
                "version": rev.version or "",
                "status": rev.status or "draft",
                "category": link.get("category"),
            })
            break

    dashboard_refs = db.query(DashboardItem).filter(
        DashboardItem.entity_type == 'document',
        DashboardItem.entity_id == revision.master_id,
    ).all()

    dashboard_folders = []
    for item in dashboard_refs:
        folder = db.query(DashboardFolder).filter(DashboardFolder.id == item.folder_id).first()
        if folder:
            path_parts = []
            current_folder = folder
            while current_folder:
                path_parts.insert(0, current_folder.name)
                if current_folder.parent_id:
                    current_folder = db.query(DashboardFolder).filter(DashboardFolder.id == current_folder.parent_id).first()
                else:
                    current_folder = None

            dashboard = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
            user_id = dashboard.user_id if dashboard else None
            user = db.query(User).filter(User.id == user_id).first() if user_id else None

            dashboard_folders.append({
                "folder_id": str(folder.id),
                "folder_name": folder.name,
                "folder_path": " / ".join(path_parts),
                "user_id": str(user_id) if user_id else None,
                "user_name": user.real_name if user else "未知用户",
            })

    return {
        "document_id": str(revision_id),
        "reference_count": len(references),
        "references": references,
        "dashboard_folder_count": len(dashboard_folders),
        "dashboard_folders": dashboard_folders,
    }


# ===== 详情 =====

@router.get("/{revision_id}")
async def get_document(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    result = crud_documents.get_document_revision_with_current_iteration(db, revision_id)
    if not result:
        raise HTTPException(status_code=404, detail="图文档不存在")
    revision, iteration = result
    return _build_revision_response(db, revision, iteration, current_user)


# ===== 更新 =====

@router.put("/{revision_id}")
async def update_document(
    revision_id: uuid.UUID,
    body: schemas.DocumentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:update")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="图文档不存在")
    if revision.check_out_user_id is None:
        raise HTTPException(status_code=400, detail="请先签出后再编辑")
    if str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="该文档被他人签出，无法编辑")

    update_data = body.model_dump(exclude_unset=True)
    group_ids = update_data.pop("group_ids", None)

    # 更新 master 字段
    master = revision.master
    master_data = {}
    if "code" in update_data:
        master_data["code"] = update_data.pop("code")
    if "name" in update_data:
        master_data["name"] = update_data.pop("name")
    if master_data:
        crud_documents.update_document_master(db, master.id, master_data)

    # 更新 revision 字段
    if "remark" in update_data:
        revision.remark = update_data["remark"]

    if group_ids is not None:
        db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id == master.id).delete()
        for gid in set(group_ids):
            db.add(DocumentGroupLink(document_id=master.id, group_id=gid))

    db.commit()
    db.refresh(revision)

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新图文档", "document", str(revision_id), None, ip)

    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


# ===== 删除 =====

def _find_doc_refs(db, doc_id_str):
    from ..models_parts import PartIteration
    references = []
    for it in db.query(PartIteration).all():
        for link in (it.document_links or []):
            if link.get("document_id") == doc_id_str:
                rev = db.query(PartRevision).filter(PartRevision.id == it.revision_id).first()
                if not rev or rev.deleted_at is not None:
                    break
                master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
                if not master or master.deleted_at is not None:
                    break
                entity_type = "component" if master.type == "assembly" else "part"
                references.append({
                    "entity_type": entity_type,
                    "entity_id": str(master.id),
                    "entity_code": master.code,
                    "entity_name": master.name,
                    "version": rev.version or "",
                    "status": rev.status or "draft",
                    "category": link.get("category"),
                    "id": str(master.id),
                    "code": master.code,
                    "name": master.name,
                })
                break
    return references


@router.get("/{revision_id}/can-delete")
async def check_document_can_delete(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="图文档不存在")
    refs = _find_doc_refs(db, str(revision_id))
    return {
        "can_delete": len(refs) == 0,
        "ref_count": len(refs),
        "references": refs
    }


@router.delete("/{revision_id}")
async def delete_document(
    revision_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:delete")),
):
    refs = _find_doc_refs(db, str(revision_id))
    if refs:
        labels = [f"{'零件' if r['entity_type']=='part' else '部件'} {r['code']}" for r in refs[:5]]
        raise HTTPException(status_code=400, detail=f"该图文档被 {len(refs)} 个零部件引用: {', '.join(labels)}，无法删除")

    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="图文档不存在")

    # 删除所有迭代的附件物理文件
    atts = db.query(DocumentAttachment).filter(DocumentAttachment.revision_id == revision_id).all()
    for att in atts:
        if att.file_path:
            try:
                from ..file_storage import file_storage
                file_storage.delete_file(att.file_path)
                if is_stp_file(att.file_name):
                    delete_glb_cache(str(att.id))
            except Exception as e:
                print(f"[WARNING] Failed to delete file {att.file_path}: {e}")
    db.query(DocumentAttachment).filter(DocumentAttachment.revision_id == revision_id).delete()

    ok = crud_documents.delete_document_revision(db, revision_id)
    if not ok:
        raise HTTPException(status_code=404, detail="图文档不存在")

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "软删除图文档", "document", str(revision_id), f"编号:{revision.master.code if revision.master else ''}", ip)
    return {"message": "图文档已软删除"}


# ===== 附件管理 =====

@router.post("/{revision_id}/attachments")
async def upload_document_attachment(
    revision_id: uuid.UUID,
    body: schemas.DocumentAttachmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents.attachment:upload")),
):
    from ..file_storage import file_storage
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="图文档不存在")
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="请先签出后再上传附件")

    current_iter = crud_documents._get_current_iteration(db, revision_id)

    # 图文档仅允许一个附件：删除当前迭代的已有附件
    existing_atts = db.query(DocumentAttachment).filter(
        DocumentAttachment.revision_id == revision_id,
        DocumentAttachment.iteration_id == current_iter.id,
    ).all() if current_iter else []
    for ea in existing_atts:
        if ea.file_path:
            try:
                file_storage.delete_file(ea.file_path)
                if is_stp_file(ea.file_name):
                    delete_glb_cache(str(ea.id))
                if is_office_file(ea.file_name):
                    delete_pdf_cache(str(ea.id), ea.file_path)
            except Exception:
                pass
        db.delete(ea)

    try:
        file_data_bytes = base64.b64decode(body.file_data)
        master = revision.master
        folder_name = f"{master.code}/{revision.version}/{current_iter.iteration}" if current_iter else f"{master.code}_{revision.version}"
        result = file_storage.save_file(file_data_bytes, "document", str(revision_id), body.file_name, folder_name=folder_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"附件上传失败: {e}")

    att = DocumentAttachment(
        id=body.id,
        revision_id=revision_id,
        file_name=body.file_name,
        file_size=result["file_size"],
        file_path=result["file_path"],
        iteration_id=current_iter.id if current_iter else None,
    )
    db.add(att)
    db.commit()
    db.refresh(att)

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "上传附件", "document_att", str(revision_id), f"文件:{body.file_name}", ip)
    return {"id": str(att.id), "file_name": att.file_name, "file_size": att.file_size, "created_at": att.created_at.isoformat() if att.created_at else None}


@router.get("/{revision_id}/attachments/{att_id}")
async def download_attachment(
    revision_id: uuid.UUID,
    att_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents.attachment:download")),
):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.revision_id == revision_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    revision = crud_documents.get_document_revision(db, revision_id)
    if revision:
        crud_groups.enforce_document_content_access(db, current_user, revision.master)

    file_data = None
    if att.file_path:
        try:
            data = file_storage.read_file(att.file_path)
            if data:
                file_data = base64.b64encode(data).decode('utf-8')
        except Exception as e:
            print(f"[WARNING] {e}")

    return {
        "id": str(att.id), "revision_id": str(att.revision_id),
        "file_name": att.file_name, "file_size": att.file_size,
        "file_data": file_data,
        "created_at": att.created_at.isoformat() if att.created_at else None,
    }


@router.get("/{revision_id}/attachments/")
async def list_attachments(
    revision_id: uuid.UUID,
    iteration_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents.attachment:download")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if revision:
        crud_groups.enforce_document_content_access(db, current_user, revision.master)

    query = db.query(DocumentAttachment).filter(DocumentAttachment.revision_id == revision_id)
    if iteration_id is not None:
        query = query.filter(DocumentAttachment.iteration_id == iteration_id)
    atts = query.offset(skip).limit(limit).all()
    return [{
        "id": str(a.id), "revision_id": str(a.revision_id), "iteration_id": str(a.iteration_id) if a.iteration_id else None,
        "file_name": a.file_name, "file_size": a.file_size, "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in atts]


@router.delete("/{revision_id}/attachments/{att_id}")
async def delete_attachment(
    revision_id: uuid.UUID,
    att_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents.attachment:delete")),
):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.revision_id == revision_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    revision = crud_documents.get_document_revision(db, revision_id)
    if revision:
        if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
            raise HTTPException(status_code=400, detail="请先签出后再删除附件")
        current_iter = crud_documents._get_current_iteration(db, revision_id)
        if current_iter and att.iteration_id and str(att.iteration_id) != str(current_iter.id):
            raise HTTPException(status_code=400, detail="只能删除当前迭代的附件")

    if att.file_path:
        try:
            file_storage.delete_file(att.file_path)
        except Exception as e:
            print(f"[WARNING] {e}")

    if is_stp_file(att.file_name):
        delete_glb_cache(str(att.id))
    if is_office_file(att.file_name):
        delete_pdf_cache(str(att.id), att.file_path)

    db.delete(att)
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除附件", "document_att", str(revision_id), f"文件ID:{att_id}", ip)
    return {"message": "附件已删除"}


# ===== 签出/签入 =====

@router.post("/{revision_id}/checkout")
def checkout_document(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:checkout")),
):
    revision, err = crud_documents.checkout_document(db, revision_id, current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    crud.create_log(db, current_user.id, current_user.username,
                    "图文档签出", "document", str(revision.id),
                    f"编号:{revision.master.code} 版本:{revision.version}", None)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


@router.post("/{revision_id}/checkin")
def checkin_document(
    revision_id: uuid.UUID,
    note: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:checkin")),
):
    revision, err = crud_documents.checkin_document(db, revision_id, current_user.id, note)
    if err:
        raise HTTPException(status_code=400, detail=err)
    crud.create_log(db, current_user.id, current_user.username,
                    "图文档签入", "document", str(revision.id),
                    f"编号:{revision.master.code} 版本:{revision.version} 备注:{note or ''}", None)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


@router.post("/{revision_id}/undocheckout")
def undo_checkout_document(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:undocheckout")),
):
    revision, err = crud_documents.undocheckout_document(db, revision_id, current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    crud.create_log(db, current_user.id, current_user.username,
                    "图文档撤销签出", "document", str(revision.id),
                    f"编号:{revision.master.code} 版本:{revision.version}", None)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


@router.post("/{revision_id}/force-checkin")
def force_checkin_document_endpoint(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:force_checkin")),
):
    revision, err = crud_documents.force_checkin_document(db, revision_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    crud.create_log(db, current_user.id, current_user.username,
                    "图文档强制签入", "document", str(revision.id),
                    f"编号:{revision.master.code} 版本:{revision.version}", None)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


# ===== 升版 =====

@router.post("/{revision_id}/upgrade")
async def upgrade_document_endpoint(
    revision_id: uuid.UUID,
    body: schemas.UpgradeRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:create")),
):
    new_rev, err = crud_documents.upgrade_document(db, revision_id, current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "图文档升版", "document", str(new_rev.id), f"编号:{new_rev.master.code} 版本:{new_rev.version}", ip)
    iteration = crud_documents._get_current_iteration(db, new_rev.id)
    return _build_revision_response(db, new_rev, iteration)


# ===== 状态变更 =====

@router.post("/{revision_id}/freeze")
def freeze_document(
    revision_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:update")),
):
    revision, err = crud_documents.freeze_document(db, revision_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "图文档冻结", "document", str(revision_id), f"编号:{revision.master.code}", ip)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


@router.post("/{revision_id}/release")
def release_document(
    revision_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:update")),
):
    revision, err = crud_documents.release_document(db, revision_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "图文档发布", "document", str(revision_id), f"编号:{revision.master.code}", ip)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


@router.post("/{revision_id}/obsolete")
def obsolete_document(
    revision_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:update")),
):
    revision, err = crud_documents.obsolete_document(db, revision_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "图文档作废", "document", str(revision_id), f"编号:{revision.master.code}", ip)
    iteration = crud_documents._get_current_iteration(db, revision_id)
    return _build_revision_response(db, revision, iteration)


# ===== 版本历史 =====

@router.get("/{revision_id}/versions")
async def get_document_versions_endpoint(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="文档版本不存在")
    versions = crud_documents.list_revisions_by_master(db, revision.master_id)
    master = revision.master
    return [{
        "id": str(v.id),
        "code": master.code if master else "",
        "name": master.name if master else "",
        "version": v.version,
        "status": v.status,
        "remark": v.remark,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    } for v in versions]


# ===== 迭代列表 =====

@router.get("/{revision_id}/iterations")
def get_document_iterations(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    revision = crud_documents.get_document_revision(db, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="文档版本不存在")
    return crud_documents.list_iterations(db, revision_id)


@router.delete("/{revision_id}/iterations/{iteration_id}")
def delete_document_iteration(
    revision_id: uuid.UUID,
    iteration_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:delete")),
):
    ok, err = crud_documents.delete_iteration(db, revision_id, iteration_id)
    if err:
        raise HTTPException(status_code=400 if err != "版本不存在" else 404, detail=err)
    revision = crud_documents.get_document_revision(db, revision_id)

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username,
                    "删除图文档迭代", "document_iteration", str(iteration_id),
                    f"编号:{revision.master.code if revision and revision.master else ''}", ip)
    return {"message": "迭代已删除", "latest_iteration": revision.latest_iteration if revision else 0}


# ===== 图文档反查（五段） =====

@router.get("/revisions/{revision_id}/where-used/configurations")
async def doc_where_used_configurations(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_configuration import where_used_configurations_by_document
    return where_used_configurations_by_document(db, revision_id)


@router.get("/revisions/{revision_id}/where-used/parts")
async def doc_where_used_parts(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_documents import where_used_parts_by_document
    return where_used_parts_by_document(db, revision_id)


@router.get("/revisions/{revision_id}/where-used/tasks")
async def doc_where_used_tasks(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_project import where_used_tasks_by_document
    from .projects import _task_dict
    rows = where_used_tasks_by_document(db, revision_id)
    result = []
    user_ids = set()
    for t, _p in rows:
        if t.assignee_id:
            user_ids.add(t.assignee_id)
    user_map = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        user_map = {str(u.id): u.real_name for u in users}
    for t, p in rows:
        td = _task_dict(db, t)
        td["assignee_name"] = user_map.get(td.get("assignee_id")) if td.get("assignee_id") else None
        result.append({"project_id": str(p.id), "project_name": p.name, "task": td})
    return result


@router.get("/revisions/{revision_id}/where-used/ecos")
async def doc_where_used_ecos(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_eco import where_used_by_document
    return where_used_by_document(db, revision_id)


@router.get("/revisions/{revision_id}/where-used/ecrs")
async def doc_where_used_ecrs(
    revision_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    from ..crud_ecr import where_used_by_document
    return where_used_by_document(db, revision_id)
