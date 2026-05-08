from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User
from .. import crud, models, schemas
from ..bom import compare
from .auth import require_role
from sqlalchemy import cast, String

router = APIRouter(prefix="/bom", tags=["BOM管理"])


@router.get("/references/{entity_type}/{entity_id}")
async def check_references(
    entity_type: str,
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production"])),
):
    """检查某个实体是否被引用（用于删除前校验）"""
    references = []

    # 1. 检查 BOM 子项引用（零件/部件作为子项被引用）
    if entity_type in ("part", "assembly"):
        # 兼容 'assembly' 和 'component' 两种 child_type 值
        child_types = [entity_type]
        if entity_type == "assembly":
            child_types.append("component")
        bom_items = db.query(models.BOMItem).filter(
            models.BOMItem.child_type.in_(child_types),
            models.BOMItem.child_id == entity_id,
        ).all()
        for item in bom_items:
            label = item.parent_type
            if label == "part":
                p = crud.get_part(db, item.parent_id)
                if p:
                    label = f"零件 {p.code}"
            elif label == "assembly":
                a = crud.get_assembly(db, item.parent_id)
                if a:
                    label = f"部件 {a.code}"
            references.append({"type": "bom_child", "parent_id": str(item.parent_id), "label": label})

    # 2. 检查 document_links 引用（图文档被关联到零件/部件）
    if entity_type == "document":
        from ..models import Part, Assembly
        doc_id_str = str(entity_id)
        # 扫描零件
        # 扫描零件的 document_links（精确匹配）
        for p in db.query(Part).all():
            for link in (p.document_links or []):
                if link.get("document_id") == doc_id_str:
                    references.append({"type": "entity_document", "parent_id": str(p.id), "label": f"零件 {p.code}"})
                    break
        # 扫描部件的 document_links（精确匹配）
        for a in db.query(Assembly).all():
            for link in (a.document_links or []):
                if link.get("document_id") == doc_id_str:
                    references.append({"type": "entity_document", "parent_id": str(a.id), "label": f"部件 {a.code}"})
                    break

    return references

@router.get("/items/all")
async def get_all_bom_items_route(db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production"]))):
    """获取所有 BOM 关系，用于前端反查"""
    items = crud.get_all_bom_items(db)
    return [
        {
            "id": str(item.id),
            "parent_type": item.parent_type,
            "parent_id": str(item.parent_id),
            "child_type": item.child_type,
            "child_id": str(item.child_id),
            "quantity": float(item.quantity) if item.quantity else 1,
        }
        for item in items
    ]


@router.get("/tree/{item_type}/{item_id}")
async def get_bom_tree(item_type: str, item_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production"]))):
    if item_type not in ["part", "assembly"]:
        raise HTTPException(status_code=400, detail="无效的类型")
    items = crud.get_bom_items(db, item_type, item_id)
    result = []
    for item in items:
        child_detail = None
        if item.child_type == "part":
            child = crud.get_part(db, item.child_id)
            if child:
                child_detail = {"id": str(child.id), "code": child.code, "name": child.name, "spec": child.spec, "type": "part"}
        else:
            child = crud.get_assembly(db, item.child_id)
            if child:
                child_detail = {"id": str(child.id), "code": child.code, "name": child.name, "spec": child.spec, "type": "assembly"}
        result.append({
            "id": str(item.id),
            "child_type": item.child_type,
            "child_id": str(item.child_id),
            "quantity": float(item.quantity),
            "child_detail": child_detail
        })
    return result

@router.post("/items", response_model=schemas.BOMItemResponse)
async def create_bom_item(item: schemas.BOMItemCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer"]))):
    db_item = crud.create_bom_item(db, item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "添加BOM项", "bom", str(db_item.id), None, ip)
    return db_item

@router.delete("/items/{item_id}")
async def delete_bom_item(item_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    if not crud.delete_bom_item(db, item_id):
        raise HTTPException(status_code=404, detail="BOM项不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除BOM项", "bom", str(item_id), None, ip)
    return {"message": "BOM项已删除"}

@router.post("/compare")
async def compare_bom_assemblies(
    request: schemas.BOMCompareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production"]))
):
    """对比两个装配体的BOM结构"""
    try:
        result = compare.compare_assemblies(
            db,
            request.left_assembly_id,
            request.right_assembly_id,
            options=request.options.model_dump()
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"对比失败: {str(e)}")

@router.post("/compare/component")
async def compare_bom_components(
    request: schemas.BOMCompareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production"]))
):
    """对比两个子部件（装配体）的BOM结构"""
    try:
        result = compare.compare_assemblies(
            db,
            request.left_assembly_id,
            request.right_assembly_id,
            options=request.options.model_dump()
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"子部件对比失败: {str(e)}")
