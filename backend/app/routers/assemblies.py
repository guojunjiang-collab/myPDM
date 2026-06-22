from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
import uuid

from ..database import get_db
from ..models import User, Document
from .. import crud, schemas
from ..permissions import require_permission

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
        "deleted_at": asm.deleted_at,
    }

@router.get("/")
async def list_assemblies(skip: int = 0, limit: int = 100, search: str = None, updated_since: float = None, brief: bool = False, top_level: bool = False, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:read"))):
    include_deleted = bool(updated_since)  # 增量模式可能包含已删除记录
    asms = crud.get_assemblies(db, skip=skip, limit=limit, search=search, updated_since=updated_since, include_deleted=include_deleted, top_level=top_level)
    if brief:
        from ..crud import _assembly_brief
        return JSONResponse(content=[_assembly_brief(a) for a in asms])
    return [_assembly_response(a) for a in asms]

@router.post("/", response_model=schemas.AssemblyResponse)
async def create_assembly(assembly: schemas.AssemblyCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:create"))):
    if crud.get_assembly_by_code_version(db, assembly.code, assembly.version):
        raise HTTPException(status_code=400, detail="部件编码+版本已存在")
    db_assembly = crud.create_assembly(db, assembly)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建部件", "assembly", str(db_assembly.id), f"编码:{assembly.code}", ip)
    return _assembly_response(db_assembly)

@router.get("/{assembly_id}", response_model=schemas.AssemblyResponse)
async def get_assembly(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:read"))):
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    return _assembly_response(db_assembly)

@router.put("/{assembly_id}", response_model=schemas.AssemblyResponse)
async def update_assembly(assembly_id: uuid.UUID, assembly_update: schemas.AssemblyUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:update"))):
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    # 修改件号后须保证 (件号+版本) 仍唯一（version 不可改，按当前版本校验 code 冲突）
    if assembly_update.code and assembly_update.code != db_assembly.code:
        # 仅 A 版允许改件号：升版后的版本按编码归集，改件号会丢失版本升级关联
        if db_assembly.version != 'A':
            raise HTTPException(status_code=400, detail="仅 A 版允许修改件号，升版后的版本不可修改件号")
        dup = crud.get_assembly_by_code_version(db, assembly_update.code, db_assembly.version)
        if dup and dup.id != assembly_id:
            raise HTTPException(status_code=400, detail="部件编码+版本已存在")
    db_assembly = crud.update_assembly(db, assembly_id, assembly_update)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新部件", "assembly", str(assembly_id), None, ip)
    return _assembly_response(db_assembly)

@router.get("/{assembly_id}/can-delete")
async def check_assembly_can_delete(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:read"))):
    """检查部件是否可以被删除（是否有父项引用）"""
    from ..models import BOMItem, Assembly
    
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    
    # 检查是否被其他部件引用为子项（排除已软删除的）
    ref_count = db.query(BOMItem).filter(
        BOMItem.child_type == 'component',
        BOMItem.child_id == assembly_id,
        BOMItem.deleted_at.is_(None),
    ).count()
    
    references = []
    if ref_count > 0:
        refs = db.query(BOMItem, Assembly).join(
            Assembly, BOMItem.parent_id == Assembly.id
        ).filter(
            BOMItem.child_type == 'component',
            BOMItem.child_id == assembly_id
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

@router.delete("/{assembly_id}")
async def delete_assembly(assembly_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:delete"))):
    from ..models import BOMItem, Assembly
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    # 检查是否被其他部件引用为子项（排除已软删除的 BOM 关系和部件）
    ref_count = db.query(BOMItem).filter(
        BOMItem.child_type == 'component',
        BOMItem.child_id == assembly_id,
        BOMItem.deleted_at.is_(None),
    ).count()
    if ref_count > 0:
        # 获取引用该部件的其他部件信息（仅未删除的）
        refs = db.query(BOMItem, Assembly).join(
            Assembly, BOMItem.parent_id == Assembly.id
        ).filter(
            BOMItem.child_type == 'component',
            BOMItem.child_id == assembly_id,
            BOMItem.deleted_at.is_(None),
            Assembly.deleted_at.is_(None),
        ).all()
        ref_codes = [f"{r[1].code}({r[1].version})" for r in refs[:5]]
        msg = f"该部件被 {ref_count} 个部件引用: {', '.join(ref_codes)}"
        if ref_count > 5:
            msg += f" 等"
        raise HTTPException(status_code=400, detail=msg)
    
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除部件", "assembly", str(assembly_id), f"编码:{db_assembly.code}", ip)
    crud.delete_assembly(db, assembly_id)
    return {"message": "部件已删除"}

@router.get("/{assembly_id}/parts")
async def get_assembly_parts(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:read"))):
    """获取部件的子项列表"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    return crud.get_assembly_parts(db, assembly_id)

@router.post("/{assembly_id}/parts")
async def add_assembly_part(assembly_id: uuid.UUID, item: schemas.BOMItemCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.bom:manage"))):
    """添加子项到部件"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    crud.assert_entity_editable(db, "assembly", assembly_id, current_user.role)
    # 设置 parent 为当前 assembly
    item.parent_type = "assembly"
    item.parent_id = assembly_id
    db_item = crud.create_bom_item(db, item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "添加子项", "assembly_part", str(assembly_id), f"子项:{item.child_type}:{item.child_id}", ip)
    return db_item

@router.delete("/{assembly_id}/parts/{item_id}")
async def remove_assembly_part(assembly_id: uuid.UUID, item_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.bom:manage"))):
    """删除部件的子项"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    crud.assert_entity_editable(db, "assembly", assembly_id, current_user.role)
    crud.delete_bom_item(db, item_id)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除子项", "assembly_part", str(assembly_id), f"子项ID:{item_id}", ip)
    return {"message": "子项已删除"}

@router.put("/{assembly_id}/parts/{item_id}")
async def update_assembly_part(assembly_id: uuid.UUID, item_id: uuid.UUID, item_update: schemas.BOMItemUpdate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.bom:manage"))):
    """更新部件的子项（数量等）"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    crud.assert_entity_editable(db, "assembly", assembly_id, current_user.role)
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
async def get_assembly_documents(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.doc:read"))):
    """获取部件关联的图文档列表（从 document_links JSONB 读取）"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    links = db_assembly.document_links or []
    result = []
    for link in links:
        doc = db.query(Document).filter(Document.id == link.get("document_id")).first()
        if not doc:
            continue
        result.append({
            "id": link.get("id"),
            "entity_type": "component",
            "entity_id": str(db_assembly.id),
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

@router.post("/{assembly_id}/documents")
async def add_assembly_document(assembly_id: uuid.UUID, body: schemas.EntityDocumentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.doc:link"))):
    """关联图文档到部件（写入 document_links JSONB）"""
    doc = db.query(Document).filter(Document.id == body.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="图文档不存在")
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    from datetime import datetime, timezone
    link_id = str(body.id) if body.id else str(uuid.uuid4())
    link = {
        "id": link_id,
        "document_id": str(body.document_id),
        "category": body.category,
        "sort_order": body.sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links = db_assembly.document_links or []
    links.append(link)
    db_assembly.document_links = links
    flag_modified(db_assembly, 'document_links')
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "关联图文档", "assembly_doc", str(assembly_id), f"文档:{doc.code}", ip)
    return {"id": link_id, "message": "图文档关联成功"}

@router.put("/{assembly_id}/documents/{link_id}")
async def update_assembly_document(assembly_id: uuid.UUID, link_id: uuid.UUID, body: schemas.EntityDocumentUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.doc:link"))):
    """更新关联信息（类别/排序）"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    links = db_assembly.document_links or []
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
    db_assembly.document_links = links
    flag_modified(db_assembly, 'document_links')
    db.commit()
    return {"message": "关联已更新"}

@router.delete("/{assembly_id}/documents/{link_id}")
async def delete_assembly_document(assembly_id: uuid.UUID, link_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies.doc:unlink"))):
    """移除图文档关联"""
    db_assembly = crud.get_assembly(db, assembly_id)
    if not db_assembly:
        raise HTTPException(status_code=404, detail="部件不存在")
    links = db_assembly.document_links or []
    link_id_str = str(link_id)
    new_links = [l for l in links if l.get("id") != link_id_str]
    if len(new_links) == len(links):
        raise HTTPException(status_code=404, detail="关联不存在")
    db_assembly.document_links = new_links
    flag_modified(db_assembly, 'document_links')
    db.commit()
    return {"message": "关联已移除"}


# ===== 版本控制 (升版) =====

@router.post("/{assembly_id}/upgrade")
async def upgrade_assembly_endpoint(assembly_id: uuid.UUID, body: schemas.UpgradeRequest, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:update"))):
    db_assembly, err = crud.upgrade_assembly(db, assembly_id, current_user.real_name or current_user.username)
    if err:
        raise HTTPException(status_code=400, detail=err)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "部件升版", "assembly", str(db_assembly.id), f"编码:{db_assembly.code} 版本:{db_assembly.version}", ip)
    return _assembly_response(db_assembly)


@router.get("/{assembly_id}/versions")
async def get_assembly_versions_endpoint(assembly_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("assemblies:read"))):
    versions = crud.get_assembly_versions(db, assembly_id)
    return [_assembly_response(v) for v in versions]
