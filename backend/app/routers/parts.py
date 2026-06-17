from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
import uuid

from ..database import get_db
from ..models import User, Document
from .. import crud, schemas
from ..permissions import require_permission

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
        "remark": part.remark,
        "revisions": part.revisions or [],
        "created_at": part.created_at,
        "updated_at": part.updated_at,
        "deleted_at": part.deleted_at,
    }

@router.get("/")
async def list_parts(skip: int = 0, limit: int = 100, search: str = None, updated_since: float = None, brief: bool = False, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:read"))):
    include_deleted = bool(updated_since)  # 增量模式可能包含已删除记录
    parts = crud.get_parts(db, skip=skip, limit=limit, search=search, updated_since=updated_since, include_deleted=include_deleted)
    if brief:
        from ..crud import _part_brief
        return JSONResponse(content=[_part_brief(p) for p in parts])
    return [_part_response(p) for p in parts]

@router.post("/", response_model=schemas.PartResponse)
async def create_part(part: schemas.PartCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:create"))):
    # 检查 (code, version) 联合唯一
    if crud.get_part_by_code(db, part.code, part.version):
        raise HTTPException(status_code=400, detail="该编码和版本的组合已存在")
    db_part = crud.create_part(db, part)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建零件", "part", str(db_part.id), f"编码:{part.code} 版本:{part.version}", ip)
    return _part_response(db_part)

@router.get("/{part_id}", response_model=schemas.PartResponse)
async def get_part(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:read"))):
    db_part = crud.get_part(db, part_id)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    return _part_response(db_part)

@router.put("/{part_id}", response_model=schemas.PartResponse)
async def update_part(part_id: uuid.UUID, part_update: schemas.PartUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:update"))):
    crud.assert_entity_editable(db, "part", part_id, current_user.role)
    db_part = crud.update_part(db, part_id, part_update)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新零件", "part", str(part_id), None, ip)
    return _part_response(db_part)

@router.get("/{part_id}/can-delete")
async def check_part_can_delete(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:read"))):
    """检查零件是否可以被删除（是否有父项引用）"""
    from ..models import BOMItem, Assembly
    
    db_part = crud.get_part(db, part_id)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    
    # 检查是否被部件引用为子项（排除已软删除的）
    ref_count = db.query(BOMItem).filter(
        BOMItem.child_type == 'part',
        BOMItem.child_id == part_id,
        BOMItem.deleted_at.is_(None),
    ).count()
    
    references = []
    if ref_count > 0:
        refs = db.query(BOMItem, Assembly).join(
            Assembly, BOMItem.parent_id == Assembly.id
        ).filter(
            BOMItem.child_type == 'part',
            BOMItem.child_id == part_id
        ).all()
        for r in refs[:10]:
            references.append({
                "id": str(r[1].id),
                "code": r[1].code,
                "name": r[1].name,
                "version": r[1].version or "A"
            })
    
    return {
        "can_delete": ref_count == 0,
        "ref_count": ref_count,
        "references": references
    }

@router.delete("/{part_id}")
async def delete_part(part_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:delete"))):
    from ..models import BOMItem, Assembly
    db_part = crud.get_part(db, part_id)
    if not db_part:
        raise HTTPException(status_code=404, detail="零件不存在")
    
    # 检查是否被部件引用为子项（排除已软删除的 BOM 关系和部件）
    ref_count = db.query(BOMItem).filter(
        BOMItem.child_type == 'part',
        BOMItem.child_id == part_id,
        BOMItem.deleted_at.is_(None),
    ).count()
    if ref_count > 0:
        # 获取引用该零件的部件信息（仅未删除的）
        refs = db.query(BOMItem, Assembly).join(
            Assembly, BOMItem.parent_id == Assembly.id
        ).filter(
            BOMItem.child_type == 'part',
            BOMItem.child_id == part_id,
            BOMItem.deleted_at.is_(None),
            Assembly.deleted_at.is_(None),
        ).all()
        ref_codes = [f"{r[1].code}({r[1].version})" for r in refs[:5]]
        msg = f"该零件被 {ref_count} 个部件引用: {', '.join(ref_codes)}"
        if ref_count > 5:
            msg += f" 等"
        raise HTTPException(status_code=400, detail=msg)
    
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除零件", "part", str(part_id), f"编码:{db_part.code}", ip)
    crud.delete_part(db, part_id)
    return {"message": "零件已删除"}

# ===== 零件关联图文档 =====

@router.get("/{part_id}/documents")
async def get_part_documents(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts.doc:read"))):
    """获取零件关联的图文档列表（从 document_links JSONB 读取）"""
    from ..models import Part
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    links = part.document_links or []
    result = []
    for link in links:
        doc = db.query(Document).filter(Document.id == link.get("document_id")).first()
        if not doc:
            continue
        result.append({
            "id": link.get("id"),
            "entity_type": "part",
            "entity_id": str(part.id),
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
            }
        })
    return result

@router.post("/{part_id}/documents")
async def add_part_document(part_id: uuid.UUID, body: schemas.EntityDocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts.doc:link"))):
    """关联图文档到零件（写入 document_links JSONB）"""
    from ..models import Part
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    from datetime import datetime, timezone
    link_id = str(body.id) if body.id else str(uuid.uuid4())
    link = {
        "id": link_id,
        "document_id": str(body.document_id),
        "category": body.category,
        "sort_order": body.sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links = part.document_links or []
    links.append(link)
    part.document_links = links
    flag_modified(part, 'document_links')
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "关联图文档", "part_doc", str(part_id), f"文档:{doc.code}", ip)
    return {"id": link_id, "message": "图文档关联成功"}

@router.put("/{part_id}/documents/{link_id}")
async def update_part_document(part_id: uuid.UUID, link_id: uuid.UUID, body: schemas.EntityDocumentUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts.doc:unlink"))):
    """更新关联信息（类别/排序）"""
    from ..models import Part
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    links = part.document_links or []
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
    part.document_links = links
    flag_modified(part, 'document_links')
    db.commit()
    return {"message": "关联已更新"}

@router.delete("/{part_id}/documents/{link_id}")
async def delete_part_document(part_id: uuid.UUID, link_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts.doc:unlink"))):
    """移除图文档关联"""
    from ..models import Part
    part = db.query(Part).filter(Part.id == part_id).first()
    if not part:
        raise HTTPException(status_code=404, detail="零件不存在")
    links = part.document_links or []
    link_id_str = str(link_id)
    new_links = [l for l in links if l.get("id") != link_id_str]
    if len(new_links) == len(links):
        raise HTTPException(status_code=404, detail="关联不存在")
    part.document_links = new_links
    flag_modified(part, 'document_links')
    db.commit()
    return {"message": "关联已移除"}


# ===== 版本控制 (升版) =====

@router.post("/{part_id}/upgrade")
async def upgrade_part_endpoint(part_id: uuid.UUID, body: schemas.UpgradeRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:update"))):
    db_part, err = crud.upgrade_part(db, part_id, current_user.real_name or current_user.username)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "零件升版", "part", str(db_part.id), f"编码:{db_part.code} 版本:{db_part.version}", ip)
    return _part_response(db_part)


@router.get("/{part_id}/versions")
async def get_part_versions_endpoint(part_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("parts:read"))):
    versions = crud.get_part_versions(db, part_id)
    return [_part_response(v) for v in versions]