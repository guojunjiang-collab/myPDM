from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User, Document, EntityDocument
from .. import crud, schemas
from .auth import require_role

router = APIRouter(prefix="/assemblies", tags=["部件管理"])

def _assembly_response(asm):
    """将部件模型转为 dict"""
    return {
        "id": asm.id,
        "code": asm.code,
        "name": asm.name,
        "spec": asm.spec,
        "version": asm.version,
        "status": asm.status,
        "remark": asm.remark,
        "revisions": asm.revisions or [],
        "created_at": asm.created_at,
        "updated_at": asm.updated_at,
    }

@router.get("/", response_model=list[schemas.AssemblyResponse])
async def list_assemblies(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    return [_assembly_response(a) for a in crud.get_assemblies(db, skip=skip, limit=limit)]

@router.post("/", response_model=schemas.AssemblyResponse)
async def create_assembly(assembly: schemas.AssemblyCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    if crud.get_assembly_by_code_version(db, assembly.code, assembly.version):
        raise HTTPException(status_code=400, detail="部件编码+版本已存在")
    db_assembly = crud.create_assembly(db, assembly)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建部件", "assembly", str(db_assembly.id), f"编码:{assembly.code}", ip)
    return _assembly_response(db_assembly)

@router.get("/{assembly_id}", response_model=schemas.AssemblyResponse)
async def get_assembly(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    return _assembly_response(db_assembly)

@router.put("/{assembly_id}", response_model=schemas.AssemblyResponse)
async def update_assembly(assembly_id: uuid.UUID, assembly_update: schemas.AssemblyUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    db_assembly = crud.update_assembly(db, assembly_id, assembly_update)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新部件", "assembly", str(assembly_id), None, ip)
    return _assembly_response(db_assembly)

@router.delete("/{assembly_id}")
async def delete_assembly(assembly_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除部件", "assembly", str(assembly_id), f"编码:{db_assembly.code}", ip)
    crud.delete_assembly(db, assembly_id)
    return {"message": "部件已删除"}

@router.get("/{assembly_id}/parts")
async def get_assembly_parts(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    """获取部件的子项列表"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    return crud.get_assembly_parts(db, assembly_id)

@router.post("/{assembly_id}/parts")
async def add_assembly_part(assembly_id: uuid.UUID, item: schemas.BOMItemCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """添加子项到部件"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    # 设置 parent 为当前 assembly
    item.parent_type = "assembly"
    item.parent_id = assembly_id
    # 统一 child_type：前端可能传 'assembly'，但数据库存储为 'component'
    if item.child_type == 'assembly':
        item.child_type = 'component'
    db_item = crud.create_bom_item(db, item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "添加子项", "assembly_part", str(assembly_id), f"子项:{item.child_type}:{item.child_id}", ip)
    return db_item

@router.delete("/{assembly_id}/parts/{item_id}")
async def remove_assembly_part(assembly_id: uuid.UUID, item_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """删除部件的子项"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    crud.delete_bom_item(db, item_id)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除子项", "assembly_part", str(assembly_id), f"子项ID:{item_id}", ip)
    return {"message": "子项已删除"}

@router.put("/{assembly_id}/parts/{item_id}")
async def update_assembly_part(assembly_id: uuid.UUID, item_id: uuid.UUID, item_update: schemas.BOMItemUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    """更新部件的子项（数量等）"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    db_item = crud.get_bom_item(db, item_id)
    if not db_item:
        raise HTTPException(status_code=404, detail="子项不存在")
    if item_update.quantity is not None:
        db_item.quantity = item_update.quantity
    db.commit()
    db.refresh(db_item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新子项", "assembly_part", str(assembly_id), f"子项ID:{item_id}, 数量:{item_update.quantity}", ip)
    return db_item

@router.get("/{assembly_id}/documents")
async def get_assembly_documents(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    docs = db.query(EntityDocument, Document).join(Document, EntityDocument.document_id == Document.id).filter(
        EntityDocument.entity_type == 'component',
        EntityDocument.entity_id == assembly_id
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

@router.post("/{assembly_id}/documents")
async def add_assembly_document(assembly_id: uuid.UUID, body: schemas.EntityDocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    ed = EntityDocument(
        entity_type='component',
        entity_id=assembly_id,
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
    crud.create_log(db, current_user.id, current_user.username, "关联图文档", "assembly_doc", str(assembly_id), f"文档:{doc.code}", ip)
    return {"id": ed.id, "message": "图文档关联成功"}

@router.put("/{assembly_id}/documents/{edoc_id}")
async def update_assembly_document(assembly_id: uuid.UUID, edoc_id: uuid.UUID, body: schemas.EntityDocumentUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    ed = db.query(EntityDocument).filter(EntityDocument.id == edoc_id, EntityDocument.entity_id == assembly_id).first()
    if not ed:
        raise HTTPException(status_code=404, detail="关联不存在")
    if body.category is not None:
        ed.category = body.category
    if body.sort_order is not None:
        ed.sort_order = body.sort_order
    db.commit()
    return {"message": "关联已更新"}

@router.delete("/{assembly_id}/documents/{edoc_id}")
async def delete_assembly_document(assembly_id: uuid.UUID, edoc_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    ed = db.query(EntityDocument).filter(EntityDocument.id == edoc_id, EntityDocument.entity_id == assembly_id).first()
    if not ed:
        raise HTTPException(status_code=404, detail="关联不存在")
    db.delete(ed)
    db.commit()
    return {"message": "关联已移除"}
