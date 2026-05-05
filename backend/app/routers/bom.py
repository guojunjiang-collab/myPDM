from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User
from .. import crud, schemas
from ..bom import compare
from .auth import require_role

router = APIRouter(prefix="/bom", tags=["BOM管理"])

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
