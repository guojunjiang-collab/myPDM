from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import cast, String
import uuid
import base64

from ..database import get_db
from ..models import User, Document, DocumentAttachment, Part, Assembly
from .. import crud, schemas
from .auth import require_role
from ..stp_converter import is_stp_file, delete_glb_cache

router = APIRouter(prefix="/documents", tags=["图文档管理"])

@router.get("/")
async def list_documents(skip: int = 0, limit: int = 100, keyword: str = None, status: str = None, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    query = db.query(Document)
    if keyword:
        kw = f"%{keyword.strip().lower()}%"
        query = query.filter(
            (Document.code.ilike(kw)) | (Document.name.ilike(kw))
        )
    if status:
        query = query.filter(Document.status == status)
    docs = query.offset(skip).limit(limit).all()
    return [{
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "created_at": d.created_at, "updated_at": d.updated_at,
    } for d in docs]

@router.get("/{doc_id}/references")
async def get_document_references(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    """
    获取图文档的引用信息（扫描 document_links JSONB）
    """
    from ..models import DashboardItem, DashboardFolder, User, UserDashboard
    doc_id_str = str(doc_id)

    # 扫描零件的 document_links
    parts = db.query(Part).all()
    references = []
    for p in parts:
        links = p.document_links or []
        for link in links:
            if link.get("document_id") == doc_id_str:
                references.append({
                    "entity_type": "part",
                    "entity_id": str(p.id),
                    "entity_code": p.code,
                    "entity_name": p.name,
                    "version": p.version or "",
                    "status": p.status or "draft",
                    "category": link.get("category"),
                })
                break

    # 扫描部件的 document_links
    assemblies = db.query(Assembly).all()
    for a in assemblies:
        links = a.document_links or []
        for link in links:
            if link.get("document_id") == doc_id_str:
                references.append({
                    "entity_type": "component",
                    "entity_id": str(a.id),
                    "entity_code": a.code,
                    "entity_name": a.name,
                    "version": a.version or "",
                    "status": a.status or "draft",
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
async def create_document(doc: schemas.DocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    existing = db.query(Document).filter(Document.code == doc.code, Document.version == doc.version).first()
    if existing:
        raise HTTPException(status_code=400, detail="该编号和版本的组合已存在")
    d = Document(**doc.model_dump())
    db.add(d)
    db.commit()
    db.refresh(d)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建图文档", "document", str(d.id), f"编号:{d.code}", ip)
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "created_at": d.created_at, "updated_at": d.updated_at,
    }

@router.get("/{doc_id}")
async def get_document(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "created_at": d.created_at, "updated_at": d.updated_at,
    }

@router.put("/{doc_id}")
async def update_document(doc_id: uuid.UUID, body: schemas.DocumentUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(d, field, value)
    db.commit()
    db.refresh(d)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新图文档", "document", str(doc_id), None, ip)
    return {
        "id": d.id, "code": d.code, "name": d.name,
        "version": d.version, "status": d.status,
        "remark": d.remark,
        "file_name": d.file_name, "file_id": d.file_id,
        "created_at": d.created_at, "updated_at": d.updated_at,
    }

def _find_doc_refs(db, doc_id_str):
    """精确扫描 document_links JSONB，找出引用指定图文档的零件和部件"""
    references = []
    # 扫描零件
    for p in db.query(Part).all():
        for link in (p.document_links or []):
            if link.get("document_id") == doc_id_str:
                references.append({
                    "entity_type": "part",
                    "entity_id": str(p.id),
                    "entity_code": p.code,
                    "entity_name": p.name,
                    "version": p.version or "",
                    "status": p.status or "draft",
                    "category": link.get("category"),
                    "id": str(p.id),
                    "code": p.code,
                    "name": p.name,
                })
                break
    # 扫描部件
    for a in db.query(Assembly).all():
        for link in (a.document_links or []):
            if link.get("document_id") == doc_id_str:
                references.append({
                    "entity_type": "component",
                    "entity_id": str(a.id),
                    "entity_code": a.code,
                    "entity_name": a.name,
                    "version": a.version or "",
                    "status": a.status or "draft",
                    "category": link.get("category"),
                    "id": str(a.id),
                    "code": a.code,
                    "name": a.name,
                })
                break
    return references

@router.get("/{doc_id}/can-delete")
async def check_document_can_delete(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
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
async def delete_document(doc_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
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
    db.delete(d)
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除图文档", "document", str(doc_id), f"编号:{d.code}", ip)
    return {"message": "图文档已删除"}

@router.post("/{doc_id}/attachments")
async def upload_document_attachment(doc_id: uuid.UUID, body: schemas.DocumentAttachmentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    from ..file_storage import file_storage
    d = db.query(Document).filter(Document.id == doc_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="图文档不存在")
    
    file_data_bytes = base64.b64decode(body.file_data)
    result = file_storage.save_file(file_data_bytes, "documents", str(doc_id), body.file_name)
    
    att = DocumentAttachment(
        id=body.id,
        document_id=doc_id,
        file_name=body.file_name,
        file_size=result["file_size"],
        file_path=result["file_path"],
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
async def download_attachment(doc_id: uuid.UUID, att_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
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
async def list_attachments(doc_id: uuid.UUID, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    atts = db.query(DocumentAttachment).filter(DocumentAttachment.document_id == doc_id).offset(skip).limit(limit).all()
    return [{
        "id": a.id, "document_id": a.document_id,
        "file_name": a.file_name, "file_size": a.file_size, "created_at": a.created_at,
    } for a in atts]

@router.delete("/{doc_id}/attachments/{att_id}")
async def delete_attachment(doc_id: uuid.UUID, att_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    from ..file_storage import file_storage
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == att_id, DocumentAttachment.document_id == doc_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
    if att.file_path:
        try:
            file_storage.delete_file(att.file_path)
        except Exception as e:
            print(f"[WARNING] {e}")
    
    # 删除对应的 glb 缓存
    if is_stp_file(att.file_name):
        delete_glb_cache(str(att.id))
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
async def upgrade_document_endpoint(doc_id: uuid.UUID, body: schemas.UpgradeRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
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
async def get_document_versions_endpoint(doc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    versions = crud.get_document_versions(db, doc_id)
    return [{
        "id": v.id, "code": v.code, "name": v.name,
        "version": v.version, "status": v.status,
        "remark": v.remark,
        "file_name": v.file_name, "file_id": v.file_id,
        "created_at": v.created_at, "updated_at": v.updated_at,
    } for v in versions]
