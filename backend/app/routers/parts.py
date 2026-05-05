from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User, Document, EntityDocument
from .. import crud, schemas
from .auth import require_role

router = APIRouter(prefix="/parts", tags=["零件管理"])

def _part_response(part):
    """将零件模型转为 dict"""
    return {
        "id": part.id,
        "code": part.code,
        "name": part.name,
        "spec": part.spec,
        "version": part.version,
        "status": part.status,
        "revisions": part.revisions or [],
        "created_at": part.created_at,
        "updated_at": part.updated_at,
    }

@router.get("/", response_model=list[schemas.PartResponse])
async def list_parts(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    parts = crud.get_parts(db, skip=skip, limit=limit)
    return [_part_response(p) for p in parts]

@router.post("/", response_model=schemas.PartResponse)
async def create_part(part: schemas.PartCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    # 检查 (code, version) 联合唯一
    if crud.get_part_by_code(db, part.code, part.version):
        raise HTTPException(status_code=400, detail="该编码和版本的组合已存在")
    db_part = crud.create_part(db, part)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建零件", "part", str(db_part.id), f"编码:{part.code} 版本:{part.version}", ip)
    return _part_response(db_part)

@router.get("/{part_id}", response_model=schemas.PartResponse)
async def get_part(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    db_part = crud.get_part(db, part_id)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    return _part_response(db_part)

@router.put("/{part_id}", response_model=schemas.PartResponse)
async def update_part(part_id: uuid.UUID, part_update: schemas.PartUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    db_part = crud.update_part(db, part_id, part_update)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新零件", "part", str(part_id), None, ip)
    return _part_response(db_part)

@router.delete("/{part_id}")
async def delete_part(part_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    db_part = crud.get_part(db, part_id)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除零件", "part", str(part_id), f"编码:{db_part.code}", ip)
    crud.delete_part(db, part_id)
    return {"message": "零件已删除"}

# ===== 零件关联图文档 =====

@router.get("/{part_id}/documents")
async def get_part_documents(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    """获取零件关联的图文档列表"""
    docs = db.query(EntityDocument, Document).join(Document, EntityDocument.document_id == Document.id).filter(
        EntityDocument.entity_type == 'part',
        EntityDocument.entity_id == part_id
    ).order_by(EntityDocument.sort_order).all()
    result = []
    for ed, doc in docs:
        result.append({
            "id": ed.id,
            "entity_type": ed.entity_type,
            "entity_id": ed.entity_id,
            "document_id": ed.document_id,
            "category": ed.category,
            "sort_order": ed.sort_order,
            "created_at": ed.created_at,
            "document": {
                "id": doc.id,
                "code": doc.code,
                "name": doc.name,
                "version": doc.version,
                "status": doc.status,
                "file_name": doc.file_name,
                "file_id": doc.file_id,
            }
        })
    return result

@router.post("/{part_id}/documents")
async def add_part_document(part_id: uuid.UUID, body: schemas.EntityDocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """关联图文档到零件"""
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    ed = EntityDocument(
        entity_type='part',
        entity_id=part_id,
        document_id=body.document_id,
        category=body.category,
        sort_order=body.sort_order
    )
    if body.id:
        ed.id = body.id
    db.add(ed)
    db.commit()
    db.refresh(ed)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "关联图文档", "part_doc", str(part_id), f"文档:{doc.code}", ip)
    return {"id": ed.id, "message": "图文档关联成功"}

@router.put("/{part_id}/documents/{edoc_id}")
async def update_part_document(part_id: uuid.UUID, edoc_id: uuid.UUID, body: schemas.EntityDocumentUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """更新关联信息（类别/排序）"""
    ed = db.query(EntityDocument).filter(EntityDocument.id == edoc_id, EntityDocument.entity_id == part_id).first()
    if not ed:
        raise HTTPException(status_code=404, detail="关联不存在")
    if body.category is not None:
        ed.category = body.category
    if body.sort_order is not None:
        ed.sort_order = body.sort_order
    db.commit()
    return {"message": "关联已更新"}

@router.delete("/{part_id}/documents/{edoc_id}")
async def delete_part_document(part_id: uuid.UUID, edoc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """移除图文档关联"""
    ed = db.query(EntityDocument).filter(EntityDocument.id == edoc_id, EntityDocument.entity_id == part_id).first()
    if not ed:
        raise HTTPException(status_code=404, detail="关联不存在")
    db.delete(ed)
    db.commit()
    return {"message": "关联已移除"}