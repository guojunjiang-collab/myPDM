from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import cast, String, func
from datetime import datetime, timezone
import uuid
import base64

from ..database import get_db
from ..models import User, Document, DocumentAttachment, DocumentGroupLink, UserGroup, DocumentIteration
from ..models_parts import PartMaster, PartRevision
from .. import crud, schemas, crud_groups
from ..permissions import require_permission, check_object_policy
from ..stp_converter import is_stp_file, delete_glb_cache
from ..office_converter import is_office_file, delete_pdf_cache
from .. import crud_documents

router = APIRouter(prefix="/documents", tags=["图文档管理"])


def _resolve_group_names(db: Session, gids: set) -> list:
    if not gids:
        return []
    gs = db.query(UserGroup).filter(UserGroup.id.in_(gids)).all()
    gname_map = {g.id: g.name for g in gs}
    return [gname_map.get(gid, str(gid)) for gid in gids]


def _checkout_user_name(db: Session, uid) -> Optional[str]:
    """解析签出用户的真实姓名"""
    if not uid:
        return None
    u = db.query(User).filter(User.id == uid).first()
    return u.real_name if u else None

@router.get("/")
async def list_documents(skip: int = 0, limit: int = 100, keyword: str = None, status: str = None, updated_since: float = None, brief: bool = False, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:read"))):
    query = db.query(Document)
    if not updated_since:  # 非增量模式排除已删除
        query = query.filter(Document.deleted_at.is_(None))
    if keyword:
        kw = f"%{keyword.strip().lower()}%"
        query = query.filter(
            (Document.code.ilike(kw)) | (Document.name.ilike(kw))
        )
    if status:
        query = query.filter(Document.status == status)
    if updated_since:
        from datetime import datetime, timezone
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        query = query.filter(
            (Document.updated_at >= since_dt) |
            (Document.deleted_at >= since_dt)
        )
    docs = query.offset(skip).limit(limit).all()

    user_group_ids = crud_groups.get_user_group_ids(db, current_user.id)
    doc_ids = [d.id for d in docs]
    links = db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id.in_(doc_ids)).all() if doc_ids else []
    doc_groups = {}
    for l in links:
        doc_groups.setdefault(l.document_id, set()).add(l.group_id)

    creator_ids = {d.creator_id for d in docs if d.creator_id}
    creator_map = {}
    if creator_ids:
        users = db.query(User).filter(User.id.in_(creator_ids)).all()
        creator_map = {u.id: u.real_name for u in users}

    checkout_ids = {d.check_out_user_id for d in docs if d.check_out_user_id}
    checkout_map = {}
    if checkout_ids:
        cus = db.query(User).filter(User.id.in_(checkout_ids)).all()
        checkout_map = {u.id: u.real_name for u in cus}

    all_gids = set()
    for gids in doc_groups.values():
        all_gids.update(gids)
    group_name_map = {}
    if all_gids:
        gs = db.query(UserGroup).filter(UserGroup.id.in_(all_gids)).all()
        group_name_map = {g.id: g.name for g in gs}

    def _accessible(d):
        return check_object_policy(
            "document_content_access", current_user, d,
            user_group_ids=user_group_ids,
            doc_group_ids=doc_groups.get(d.id, set()),
        )

    if brief:
        return JSONResponse(content=[{
            "id": str(d.id), "code": d.code, "name": d.name,
            "version": d.version, "status": d.status, "file_name": d.file_name,
            "file_id": str(d.file_id) if d.file_id else None,
            "remark": d.remark,
            "accessible": _accessible(d),
            "group_ids": [str(g) for g in doc_groups.get(d.id, set())],
            "group_names": [group_name_map.get(g, str(g)) for g in doc_groups.get(d.id, set())],
            "creator_id": str(d.creator_id) if d.creator_id else None,
            "creator_name": creator_map.get(d.creator_id, "") if d.creator_id else "",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            "deleted_at": d.deleted_at.isoformat() if d.deleted_at else None,
            "check_out_user_id": str(d.check_out_user_id) if d.check_out_user_id else None,
            "check_out_user_name": checkout_map.get(d.check_out_user_id) if d.check_out_user_id else None,
            "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
            "latest_iteration": d.latest_iteration,
        } for d in docs])
    return [{
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "creator_id": d.creator_id,
        "creator_name": creator_map.get(d.creator_id, "") if d.creator_id else "",
        "accessible": _accessible(d),
        "group_ids": list(doc_groups.get(d.id, set())),
        "group_names": [group_name_map.get(g, str(g)) for g in doc_groups.get(d.id, set())],
        "created_at": d.created_at, "updated_at": d.updated_at,
        "deleted_at": d.deleted_at,
        "check_out_user_id": str(d.check_out_user_id) if d.check_out_user_id else None,
        "check_out_user_name": checkout_map.get(d.check_out_user_id) if d.check_out_user_id else None,
        "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
        "latest_iteration": d.latest_iteration,
    } for d in docs]

@router.get("/{doc_id}/references")
async def get_document_references(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:read_refs"))):
    """
    获取图文档的引用信息（扫描 document_links JSONB）
    """
    from ..models import DashboardItem, DashboardFolder, User, UserDashboard
    doc_id_str = str(doc_id)

    # 扫描 document_links（字段实际在 PartIteration 上：iteration -> revision -> master）
    from ..models_parts import PartIteration
    references = []
    for it in db.query(PartIteration).all():
        for link in (it.document_links or []):
            if link.get("document_id") != doc_id_str:
                continue
            rev = db.query(PartRevision).filter(PartRevision.id == it.revision_id).first()
            if not rev:
                break
            master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
            if not master:
                break
            entity_type = "component" if master.type == "assembly" else "part"
            references.append({
                "entity_type": entity_type,
                "entity_id": str(master.id),
                "entity_code": master.code,
                "entity_name": master.name,
                "version": master.version or "",
                "status": master.status or "draft",
                "category": link.get("category"),
            })
            break

    # 查询用户看板中引用该图文档的记录
    dashboard_refs = db.query(DashboardItem).filter(
        DashboardItem.entity_type == 'document',
        DashboardItem.entity_id == doc_id
    ).all()
    
    dashboard_folders = []
    for item in dashboard_refs:
        folder = db.query(DashboardFolder).filter(DashboardFolder.id == item.folder_id).first()
        if folder:
            # 获取文件夹完整路径
            path_parts = []
            current_folder = folder
            while current_folder:
                path_parts.insert(0, current_folder.name)
                if current_folder.parent_id:
                    current_folder = db.query(DashboardFolder).filter(DashboardFolder.id == current_folder.parent_id).first()
                else:
                    current_folder = None
            
            # 获取用户信息（通过 dashboard 关系）
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
        "document_id": str(doc_id),
        "reference_count": len(references),
        "references": references,
        "dashboard_folder_count": len(dashboard_folders),
        "dashboard_folders": dashboard_folders,
    }

@router.post("/")
async def create_document(doc: schemas.DocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:create"))):
    existing = db.query(Document).filter(
        Document.code == doc.code,
        Document.version == doc.version,
        Document.deleted_at.is_(None),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该编号和版本的组合已存在")
    data = doc.model_dump()
    group_ids = data.pop("group_ids", None) or []
    d = Document(**data, creator_id=current_user.id)
    db.add(d)
    db.flush()
    # 自动建首个迭代并签出给创建者（对齐零件：创建即可编辑/传附件）
    first_iter = DocumentIteration(document_id=d.id, iteration=1)
    db.add(first_iter)
    d.latest_iteration = 1
    d.check_out_user_id = current_user.id
    d.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(d)
    for gid in set(group_ids):
        db.add(DocumentGroupLink(document_id=d.id, group_id=gid))
    if group_ids:
        db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建图文档", "document", str(d.id), f"编号:{d.code}", ip)
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "creator_id": d.creator_id,
        "creator_name": current_user.real_name,
        "group_ids": list(set(group_ids)),
        "created_at": d.created_at, "updated_at": d.updated_at,
        "check_out_user_id": str(d.check_out_user_id) if d.check_out_user_id else None,
        "check_out_user_name": current_user.real_name,
        "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
        "latest_iteration": d.latest_iteration,
    }

@router.get("/{doc_id}")
async def get_document(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:read"))):
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    creator_name = ""
    if d.creator_id:
        creator = db.query(User).filter(User.id == d.creator_id).first()
        creator_name = creator.real_name if creator else ""
    gids = crud_groups.get_document_group_ids(db, d.id)
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "creator_id": d.creator_id,
        "creator_name": creator_name,
        "accessible": crud_groups.document_is_accessible(db, current_user, d),
        "group_ids": list(gids),
        "group_names": _resolve_group_names(db, gids),
        "created_at": d.created_at, "updated_at": d.updated_at,
        "check_out_user_id": d.check_out_user_id,
        "check_out_user_name": _checkout_user_name(db, d.check_out_user_id),
        "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
        "latest_iteration": d.latest_iteration,
    }

@router.put("/{doc_id}")
async def update_document(doc_id: uuid.UUID, body: schemas.DocumentUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:update"))):
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    # 编辑门槛：仅本人已签出且草稿态可编辑（对齐零件）
    if d.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑")
    if d.check_out_user_id is None:
        raise HTTPException(status_code=400, detail="请先签出后再编辑")
    if str(d.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="该文档被他人签出，无法编辑")
    # 修改编号后须保证 (编号+版本) 仍唯一（version 不可改，按当前版本校验 code 冲突）
    if body.code and body.code != d.code:
        if d.version != 'A':
            raise HTTPException(status_code=400, detail="仅 A 版允许修改编号，升版后的版本不可修改编号")
        existing = db.query(Document).filter(
            Document.code == body.code,
            Document.version == d.version,
            Document.deleted_at.is_(None),
            Document.id != doc_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="该编号和版本的组合已存在")
    update_data = body.model_dump(exclude_unset=True)
    group_ids = update_data.pop("group_ids", None)
    if group_ids is not None:
        db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id == doc_id).delete()
        for gid in set(group_ids):
            db.add(DocumentGroupLink(document_id=doc_id, group_id=gid))
    for field, value in update_data.items():
        setattr(d, field, value)
    db.commit()
    db.refresh(d)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新图文档", "document", str(doc_id), None, ip)
    creator_name = ""
    if d.creator_id:
        c = db.query(User).filter(User.id == d.creator_id).first()
        creator_name = c.real_name if c else ""
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "creator_id": d.creator_id,
        "creator_name": creator_name,
        "group_ids": list(crud_groups.get_document_group_ids(db, d.id)),
        "created_at": d.created_at, "updated_at": d.updated_at,
        "check_out_user_id": d.check_out_user_id,
        "check_out_date": d.check_out_date.isoformat() if d.check_out_date else None,
        "latest_iteration": d.latest_iteration,
    }

def _find_doc_refs(db, doc_id_str):
    """精确扫描 document_links JSONB（字段位于 PartIteration），找出引用指定图文档的零部件"""
    from ..models_parts import PartIteration
    references = []
    # document_links 字段实际在 PartIteration 上：通过 iteration -> revision -> master 关联拿 master 信息
    for it in db.query(PartIteration).all():
        for link in (it.document_links or []):
            if link.get("document_id") == doc_id_str:
                rev = db.query(PartRevision).filter(PartRevision.id == it.revision_id).first()
                if not rev:
                    break
                master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
                if not master:
                    break
                entity_type = "component" if master.type == "assembly" else "part"
                references.append({
                    "entity_type": entity_type,
                    "entity_id": str(master.id),
                    "entity_code": master.code,
                    "entity_name": master.name,
                    "version": master.version or "",
                    "status": master.status or "draft",
                    "category": link.get("category"),
                    "id": str(master.id),
                    "code": master.code,
                    "name": master.name,
                })
                break
    return references

@router.get("/{doc_id}/can-delete")
async def check_document_can_delete(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:read"))):
    """检查图文档是否可以被删除（扫描 document_links JSONB）"""
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    refs = _find_doc_refs(db, str(doc_id))
    return {
        "can_delete": len(refs) == 0,
        "ref_count": len(refs),
        "references": refs
    }

@router.delete("/{doc_id}")
async def delete_document(doc_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:delete"))):
    # 扫描 document_links JSONB 检查引用
    refs = _find_doc_refs(db, str(doc_id))
    if refs:
        labels = [f"{'零件' if r['entity_type']=='part' else '部件'} {r['code']}" for r in refs[:5]]
        raise HTTPException(status_code=400, detail=f"该图文档被 {len(refs)} 个零部件引用: {', '.join(labels)}，无法删除")
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    
    # 删除文件系统中的附件文件
    attachments = db.query(DocumentAttachment).filter(DocumentAttachment.document_id == doc_id).all()
    for att in attachments:
        if hasattr(att, 'file_path') and att.file_path:
            try:
                from ..file_storage import file_storage
                file_storage.delete_file(att.file_path)
                # 同步删除 glb 缓存
                if is_stp_file(att.file_name):
                    delete_glb_cache(str(att.id))
            except Exception as e:
                print(f"[WARNING] Failed to delete file {att.file_path}: {e}")
    
    # 删除数据库中的附件记录
    db.query(DocumentAttachment).filter(DocumentAttachment.document_id == doc_id).delete()
    # 软删除图文档元数据（保留记录用于同步感知删除）
    d.deleted_at = func.now()
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "软删除图文档", "document", str(doc_id), f"编号:{d.code}", ip)
    return {"message": "图文档已软删除"}

@router.post("/{doc_id}/attachments")
async def upload_document_attachment(doc_id: uuid.UUID, body: schemas.DocumentAttachmentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents.attachment:upload"))):
    from ..file_storage import file_storage
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    # 签出校验
    if d.check_out_user_id is None or str(d.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=400, detail="请先签出后再上传附件")
    current_iter = crud_documents.get_current_iteration(db, d)

    # 文件校验失败（非法 base64 / 不允许的扩展名 / 文件名非法 / 超大）属于客户端数据问题，
    # 返回 400 并带上原因，而不是裸 ValueError 冒泡成 500。binascii.Error 是 ValueError 子类，一并捕获。
    try:
        file_data_bytes = base64.b64decode(body.file_data)
        folder_name = f"{d.code}_{d.version}"
        result = file_storage.save_file(file_data_bytes, "document", str(doc_id), body.file_name, folder_name=folder_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"附件上传失败: {e}")

    att = DocumentAttachment(
        id=body.id,
        document_id=doc_id,
        file_name=body.file_name,
        file_size=result["file_size"],
        file_path=result["file_path"],
        iteration_id=current_iter.id if current_iter else None,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    d.file_name = body.file_name
    d.file_id = att.id
    db.commit()

    # STP 文件不再自动转换，改为预览时按需转换（避免批量导入卡死）

    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "上传附件", "document_att", str(doc_id), f"文件:{body.file_name}", ip)
    return {"id": att.id, "file_name": att.file_name, "file_size": att.file_size, "created_at": att.created_at}

@router.get("/{doc_id}/attachments/{att_id}")
async def download_attachment(doc_id: uuid.UUID, att_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents.attachment:download"))):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if doc:
        crud_groups.enforce_document_content_access(db, current_user, doc)
    
    file_data = None
    if att.file_path:
        try:
            data = file_storage.read_file(att.file_path)
            if data:
                file_data = base64.b64encode(data).decode('utf-8')
        except Exception as e:
            print(f"[WARNING] {e}")
    
    return {
        "id": att.id, "document_id": att.document_id,
        "file_name": att.file_name, "file_size": att.file_size,
        "file_data": file_data,
        "created_at": att.created_at,
    }

@router.get("/{doc_id}/attachments/")
async def list_attachments(doc_id: uuid.UUID, iteration_id: Optional[uuid.UUID] = None, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents.attachment:download"))):
    """列出文档附件。iteration_id 可选：传入时只返回该迭代的附件。"""
    query = db.query(DocumentAttachment).filter(DocumentAttachment.document_id == doc_id)
    if iteration_id is not None:
        query = query.filter(DocumentAttachment.iteration_id == iteration_id)
    atts = query.offset(skip).limit(limit).all()
    return [{
        "id": a.id, "document_id": a.document_id, "iteration_id": str(a.iteration_id) if a.iteration_id else None,
        "file_name": a.file_name, "file_size": a.file_size, "created_at": a.created_at,
    } for a in atts]

@router.delete("/{doc_id}/attachments/{att_id}")
async def delete_attachment(doc_id: uuid.UUID, att_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents.attachment:delete"))):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    d_lock = db.query(Document).filter(Document.id == doc_id).first()
    if d_lock:
        if d_lock.check_out_user_id is None or str(d_lock.check_out_user_id) != str(current_user.id):
            raise HTTPException(status_code=400, detail="请先签出后再删除附件")
        current_iter = crud_documents.get_current_iteration(db, d_lock)
        if current_iter and att.iteration_id and str(att.iteration_id) != str(current_iter.id):
            raise HTTPException(status_code=400, detail="只能删除当前迭代的附件")

    if att.file_path:
        try:
            file_storage.delete_file(att.file_path)
        except Exception as e:
            print(f"[WARNING] {e}")
    
    # 删除对应的 glb 缓存
    if is_stp_file(att.file_name):
        delete_glb_cache(str(att.id))

    # 删除对应的 PDF 缓存（Office 预览）
    if is_office_file(att.file_name):
        delete_pdf_cache(str(att.id), att.file_path)

    d = db.query(Document).filter(Document.id == doc_id).first()
    if d and d.file_id == att.id:
        d.file_id = None
        d.file_name = None
    db.delete(att)
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除附件", "document_att", str(doc_id), f"文件ID:{att_id}", ip)
    return {"message": "附件已删除"}


# ===== 版本控制 (升版) =====

@router.post("/{doc_id}/upgrade")
async def upgrade_document_endpoint(doc_id: uuid.UUID, body: schemas.UpgradeRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:create"))):
    db_doc, err = crud.upgrade_document(db, doc_id, current_user.real_name or current_user.username)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "图文档升版", "document", str(db_doc.id), f"编号:{db_doc.code} 版本:{db_doc.version}", ip)
    return {
        "id": db_doc.id, "code": db_doc.code, "name": db_doc.name,
        "version": db_doc.version, "status": db_doc.status,
        "remark": db_doc.remark,
        "file_name": db_doc.file_name, "file_id": db_doc.file_id,
        "created_at": db_doc.created_at, "updated_at": db_doc.updated_at,
    }


@router.get("/{doc_id}/versions")
async def get_document_versions_endpoint(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("documents:read"))):
    versions = crud.get_document_versions(db, doc_id)
    return [{
        "id": v.id, "code": v.code, "name": v.name,
        "version": v.version, "status": v.status,
        "remark": v.remark,
        "file_name": v.file_name, "file_id": v.file_id,
        "created_at": v.created_at, "updated_at": v.updated_at,
    } for v in versions]


# ====== 文档签入签出 ======


@router.post("/{doc_id}/checkout")
def checkout_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:checkout")),
):
    doc, err = crud_documents.checkout_document(db, doc_id, current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    from .. import crud as crud_common
    crud_common.create_log(db, current_user.id, current_user.username,
                           "图文档签出", "document", str(doc.id),
                           f"编号:{doc.code} 版本:{doc.version}", None)
    return {
        "id": str(doc.id),
        "code": doc.code,
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "check_out_user_id": str(doc.check_out_user_id) if doc.check_out_user_id else None,
        "check_out_user_name": current_user.real_name,
        "check_out_date": doc.check_out_date.isoformat() if doc.check_out_date else None,
        "latest_iteration": doc.latest_iteration,
    }


@router.post("/{doc_id}/checkin")
def checkin_document(
    doc_id: uuid.UUID,
    note: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:checkin")),
):
    doc, err = crud_documents.checkin_document(db, doc_id, current_user.id, note)
    if err:
        raise HTTPException(status_code=400, detail=err)
    from .. import crud as crud_common
    crud_common.create_log(db, current_user.id, current_user.username,
                           "图文档签入", "document", str(doc.id),
                           f"编号:{doc.code} 版本:{doc.version} 备注:{note or ''}", None)
    return {
        "id": str(doc.id),
        "code": doc.code,
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "check_out_user_id": None,
        "check_out_user_name": None,
        "check_out_date": None,
        "latest_iteration": doc.latest_iteration,
    }


@router.post("/{doc_id}/undo-checkout")
def undo_checkout_document(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:undocheckout")),
):
    doc, err = crud_documents.undo_checkout_document(db, doc_id, current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    from .. import crud as crud_common
    crud_common.create_log(db, current_user.id, current_user.username,
                           "图文档撤销签出", "document", str(doc.id),
                           f"编号:{doc.code} 版本:{doc.version}", None)
    return {
        "id": str(doc.id),
        "code": doc.code,
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "check_out_user_id": None,
        "check_out_user_name": None,
        "check_out_date": None,
        "latest_iteration": doc.latest_iteration,
    }


@router.post("/{doc_id}/force-checkin")
def force_checkin_document_endpoint(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:force_checkin")),
):
    doc, err = crud_documents.force_checkin_document(db, doc_id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    from .. import crud as crud_common
    crud_common.create_log(db, current_user.id, current_user.username,
                           "图文档强制签入", "document", str(doc.id),
                           f"编号:{doc.code} 版本:{doc.version}", None)
    return {
        "id": str(doc.id),
        "code": doc.code,
        "name": doc.name,
        "version": doc.version,
        "status": doc.status,
        "check_out_user_id": None,
        "check_out_user_name": None,
        "check_out_date": None,
        "latest_iteration": doc.latest_iteration,
    }


@router.get("/{doc_id}/iterations")
def get_document_iterations(
    doc_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    return crud_documents.list_iterations(db, doc_id)
