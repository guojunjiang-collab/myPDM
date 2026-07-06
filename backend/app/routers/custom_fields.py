from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/custom-fields", tags=["自定义字段管理"])


def _def_response(field_def):
    """将字段定义模型转为响应 dict"""
    return {
        "id": field_def.id,
        "name": field_def.name,
        "field_key": field_def.field_key,
        "field_type": field_def.field_type,
        "options": field_def.options or [],
        "is_required": bool(field_def.is_required),
        "applies_to": field_def.applies_to,
        "sort_order": field_def.sort_order,
        "created_at": field_def.created_at,
        "updated_at": field_def.updated_at,
    }


def _value_response(val, field_def=None):
    """将字段值模型转为响应 dict"""
    # 根据字段类型提取值
    value = None
    if field_def:
        if field_def.field_type == 'text' or field_def.field_type == 'select':
            value = val.value_text
        elif field_def.field_type == 'number':
            value = float(val.value_number) if val.value_number is not None else None
        elif field_def.field_type == 'multiselect':
            value = val.value_json
    else:
        # 回退：按非空优先级取值
        value = val.value_text or (float(val.value_number) if val.value_number is not None else None) or val.value_json

    return {
        "field_id": val.field_id,
        "field_key": field_def.field_key if field_def else None,
        "field_name": field_def.name if field_def else None,
        "field_type": field_def.field_type if field_def else None,
        "value": value,
    }


# ===== 字段定义 CRUD =====

@router.get("/definitions/", response_model=list[schemas.CustomFieldDefinitionResponse])
async def list_definitions(
    applies_to: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.def:read"))
):
    definitions = crud.get_custom_field_definitions(db, applies_to=applies_to)
    return [_def_response(d) for d in definitions]


@router.post("/definitions/", response_model=schemas.CustomFieldDefinitionResponse)
async def create_definition(
    field_def: schemas.CustomFieldDefinitionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.def:write"))
):
    # 检查 field_key 唯一性
    existing = crud.get_custom_field_definition_by_key(db, field_def.field_key)
    if existing:
        raise HTTPException(status_code=400, detail=f"字段标识 '{field_def.field_key}' 已存在")
    db_field = crud.create_custom_field_definition(db, field_def)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建自定义字段", "custom_field", str(db_field.id), f"名称:{field_def.name} 标识:{field_def.field_key}", ip)
    return _def_response(db_field)


@router.put("/definitions/{field_id}", response_model=schemas.CustomFieldDefinitionResponse)
async def update_definition(
    field_id: uuid.UUID,
    field_update: schemas.CustomFieldDefinitionUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.def:write"))
):
    old_name = crud.get_custom_field_definition(db, field_id).name if crud.get_custom_field_definition(db, field_id) else None
    db_field = crud.update_custom_field_definition(db, field_id, field_update)
    if not db_field:
        raise HTTPException(status_code=404, detail="字段定义不存在")
    # 如果字段名称变更，迁移 PartIteration.custom_fields 中的键名
    new_name = db_field.name
    if old_name and old_name != new_name:
        from .. import models_parts
        iterations = db.query(models_parts.PartIteration).filter(
            models_parts.PartIteration.custom_fields.has_key(old_name)
        ).all()
        for it in iterations:
            cf = dict(it.custom_fields or {})
            if old_name in cf:
                cf[new_name] = cf.pop(old_name)
                it.custom_fields = cf
        db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新自定义字段", "custom_field", str(field_id), None, ip)
    return _def_response(db_field)


@router.delete("/definitions/{field_id}")
async def delete_definition(
    field_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.def:write"))
):
    db_field = crud.get_custom_field_definition(db, field_id)
    if not db_field:
        raise HTTPException(status_code=404, detail="字段定义不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除自定义字段", "custom_field", str(field_id), f"名称:{db_field.name}", ip)
    crud.delete_custom_field_definition(db, field_id)
    return {"message": "字段定义已删除"}


@router.put("/definitions/reorder")
async def reorder_definitions(
    reorder: schemas.ReorderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.def:sort"))
):
    crud.reorder_custom_field_definitions(db, reorder.items)
    return {"message": "排序已更新"}


# ===== 字段值 CRUD =====

@router.get("/values/batch")
async def get_values_batch(
    type: str,
    ids: str,  # comma-separated UUIDs
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.value:read"))
):
    """批量获取多个实体的自定义字段值，替代 N+1 查询。
    
    示例: GET /api/custom-fields/values/batch?type=part&ids=id1,id2,id3
    返回: { "id1": {"field_key": "value", ...}, "id2": {...} }
    """
    if type not in ('part', 'component', 'document'):
        raise HTTPException(status_code=400, detail="type 必须为 part、component 或 document")
    
    entity_ids = [id.strip() for id in ids.split(',') if id.strip()]
    if not entity_ids:
        return {}
    
    result = crud.get_custom_field_values_batch(db, type, entity_ids)
    return result


@router.get("/values/{entity_type}/{entity_id}", response_model=list[schemas.CustomFieldValueResponse])
async def get_values(
    entity_type: str,
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.value:read"))
):
    if entity_type not in ('part', 'component', 'document'):
        raise HTTPException(status_code=400, detail="entity_type 必须为 part、component 或 document")
    results = crud.get_custom_field_values(db, entity_type, entity_id)
    return [_value_response(val, field_def) for val, field_def in results]


@router.put("/values/{entity_type}/{entity_id}")
async def set_values(
    entity_type: str,
    entity_id: uuid.UUID,
    batch: schemas.CustomFieldValuesBatch,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field.value:write"))
):
    if entity_type not in ('part', 'component', 'document'):
        raise HTTPException(status_code=400, detail="entity_type 必须为 part、component 或 document")
    crud.assert_entity_editable(db, entity_type, entity_id, current_user.role)
    crud.set_custom_field_values(db, entity_type, entity_id, batch.values)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新自定义字段值", entity_type, str(entity_id), f"{len(batch.values)}个字段", ip)
    return {"message": "字段值已更新"}


# ===== 系统重置 =====

@router.post("/reset-data")
async def reset_business_data(
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("custom_field:reset_data"))
):
    """清除所有业务数据（需验证管理员密码）"""
    password = data.get("password", "")
    if not password:
        raise HTTPException(status_code=400, detail="请输入管理员密码")

    if not crud.verify_password(password, current_user.password_hash):
        raise HTTPException(status_code=403, detail="密码错误")

    crud.reset_business_data(db)
    return {"message": "业务数据已重置"}
