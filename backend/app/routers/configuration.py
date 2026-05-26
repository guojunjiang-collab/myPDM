"""
构型配置 - API Router
========================
构型项 CRUD + 关联零部件 + 子构型项 + 构型方案
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Part, Assembly
from app import models_configuration as models
from app import schemas_configuration as schemas
from app import crud_configuration as crud
from app.routers.auth import require_role

router = APIRouter(prefix="/configurations", tags=["构型配置"])


# ════════════════════════════════════════════════════════
# 构型项 CRUD
# ════════════════════════════════════════════════════════

@router.get("/items", response_model=dict)
async def list_config_items(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    exclude_ancestors_of: str = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """构型项列表"""
    skip = (page - 1) * page_size
    exclude_ids: set[str] = set()
    if exclude_ancestors_of:
        exclude_ids.add(exclude_ancestors_of)  # 排除自身
        # BFS向上查找所有祖先（防止循环引用）
        from app.models_configuration import ConfigurationItemChild
        child_to_parents: dict = {}
        all_children = db.query(ConfigurationItemChild).all()
        for c in all_children:
            cid = str(c.child_id)
            if cid not in child_to_parents:
                child_to_parents[cid] = []
            child_to_parents[cid].append(str(c.parent_id))
        queue = [exclude_ancestors_of]
        while queue:
            cid = queue.pop(0)
            parents = child_to_parents.get(cid, [])
            for pid in parents:
                if pid not in exclude_ids:
                    exclude_ids.add(pid)
                    queue.append(pid)
    items, total = crud.get_config_items(db, search=search, skip=skip, limit=page_size,
                                          exclude_ids=exclude_ids)
    return {
        "items": [{
            "id": str(i.id), "code": i.code, "name": i.name,
            "spec": i.spec or "", "remark": i.remark or "",
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
        } for i in items],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/items/{config_id}", response_model=dict)
async def get_config_item(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer", "production", "guest"])),
):
    """构型项详情（含关联零部件 + 子构型项 + 构型方案）"""
    item = crud.get_config_item(db, config_id)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")

    # 关联零部件
    parts_data = []
    for p in crud.get_config_parts(db, config_id):
        entity = db.query(Part).filter(Part.id == p.part_id).first() if p.part_type == "part" \
            else db.query(Assembly).filter(Assembly.id == p.part_id).first()
        parts_data.append({
            "id": str(p.id), "part_type": p.part_type, "part_id": str(p.part_id),
            "is_required": p.is_required, "sort_order": p.sort_order,
            "part_detail": {
                "id": str(entity.id), "code": entity.code, "name": entity.name,
                "version": entity.version, "spec": entity.spec or "", "status": entity.status,
            } if entity else {},
        })

    # 子构型项
    children_data = []
    for c in crud.get_config_children(db, config_id):
        child = db.query(models.ConfigurationItem).filter(models.ConfigurationItem.id == c.child_id).first()
        children_data.append({
            "id": str(c.id), "child_id": str(c.child_id),
            "is_required": c.is_required, "sort_order": c.sort_order,
            "child_detail": {
                "id": str(child.id), "code": child.code, "name": child.name,
                "spec": child.spec or "",
            } if child else {},
        })

    return {
        "id": str(item.id), "code": item.code, "name": item.name,
        "spec": item.spec or "", "remark": item.remark or "",
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "parts": parts_data, "children": children_data,
    }


@router.post("/items", response_model=dict)
async def create_config_item(
    data: schemas.ConfigurationItemCreate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """创建构型项"""
    if crud.get_config_item_by_code(db, data.code):
        raise HTTPException(status_code=400, detail=f"构型号 {data.code} 已存在")
    item = crud.create_config_item(db, data)
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.put("/items/{config_id}", response_model=dict)
async def update_config_item(
    config_id: str, data: schemas.ConfigurationItemUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新构型项"""
    item = crud.update_config_item(db, config_id, data)
    if not item:
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"id": str(item.id), "code": item.code, "name": item.name}


@router.delete("/items/{config_id}")
async def delete_config_item(
    config_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """删除构型项"""
    if not crud.delete_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联零部件
# ════════════════════════════════════════════════════════

@router.post("/items/{config_id}/parts", response_model=dict)
async def add_parts(
    config_id: str, data: schemas.ConfigPartBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """批量关联零部件"""
    if not crud.get_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    return {"added": len(crud.add_config_parts(db, config_id, data.items))}


@router.put("/items/{config_id}/parts/{part_id}", response_model=dict)
async def update_part(
    config_id: str, part_id: str, data: schemas.ConfigPartUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新关联零部件属性"""
    part = crud.update_config_part(db, part_id, data)
    if not part:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"id": str(part.id), "is_required": part.is_required}


@router.delete("/items/{config_id}/parts/{part_id}")
async def remove_part(
    config_id: str, part_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """移除关联零部件"""
    if not crud.remove_config_part(db, part_id):
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 子构型项
# ════════════════════════════════════════════════════════

@router.post("/items/{config_id}/children", response_model=dict)
async def add_children(
    config_id: str, data: schemas.ConfigChildBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """批量添加子构型项"""
    if not crud.get_config_item(db, config_id):
        raise HTTPException(status_code=404, detail="构型项不存在")
    for c in data.items:
        if str(c.child_id) == config_id:
            raise HTTPException(status_code=400, detail="不能将构型项添加为自身的子项")
    return {"added": len(crud.add_config_children(db, config_id, data.items))}


@router.put("/items/{config_id}/children/{child_id}", response_model=dict)
async def update_child(
    config_id: str, child_id: str, data: schemas.ConfigChildUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """更新子构型项属性"""
    child = crud.update_config_child(db, child_id, data)
    if not child:
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"id": str(child.id), "is_required": child.is_required}


@router.delete("/items/{config_id}/children/{child_id}")
async def remove_child(
    config_id: str, child_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "engineer"])),
):
    """移除子构型项"""
    if not crud.remove_config_child(db, child_id):
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"detail": "ok"}
