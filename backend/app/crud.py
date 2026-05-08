import uuid
from sqlalchemy.orm import Session
from . import models, schemas
import bcrypt

def verify_password(plain_password, hashed_password):
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def get_user(db, user_id):
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_user_by_username(db, username):
    return db.query(models.User).filter(models.User.username == username).first()

def get_users(db, skip=0, limit=100):
    return db.query(models.User).offset(skip).limit(limit).all()

def create_user(db, user):
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        username=user.username, password_hash=hashed_password,
        real_name=user.real_name, role=user.role,
        department=user.department, phone=user.phone, status=user.status
    )
    if user.id:
        db_user.id = user.id
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user(db, user_id, user_update):
    db_user = get_user(db, user_id)
    if not db_user:
        return None
    update_data = user_update.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["password_hash"] = get_password_hash(update_data.pop("password"))
    for field, value in update_data.items():
        setattr(db_user, field, value)
    from datetime import datetime
    db_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_user)
    return db_user

def delete_user(db, user_id):
    db_user = get_user(db, user_id)
    if db_user:
        db.delete(db_user)
        db.commit()
    return db_user

def authenticate_user(db, username, password):
    user = get_user_by_username(db, username)
    if not user:
        return False
    if not verify_password(password, user.password_hash):
        return False
    return user

def get_part(db, part_id):
    return db.query(models.Part).filter(models.Part.id == part_id).first()

def get_part_by_code(db, code, version=None):
    if version:
        return db.query(models.Part).filter(models.Part.code == code, models.Part.version == version).first()
    return db.query(models.Part).filter(models.Part.code == code).first()

def get_parts(db, skip=0, limit=100):
    return db.query(models.Part).offset(skip).limit(limit).all()

def create_part(db, part):
    db_part = models.Part(**part.model_dump())
    db.add(db_part)
    db.commit()
    db.refresh(db_part)
    return db_part

def update_part(db, part_id, part_update):
    db_part = get_part(db, part_id)
    if not db_part:
        return None
    for field, value in part_update.model_dump(exclude_unset=True).items():
        setattr(db_part, field, value)
    from datetime import datetime
    db_part.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_part)
    return db_part

def delete_part(db, part_id):
    # 删除所有引用该零件的 BOM items（该零件作为子项被引用）
    db.query(models.BOMItem).filter(
        models.BOMItem.child_type == 'part',
        models.BOMItem.child_id == part_id
    ).delete(synchronize_session=False)
    db.commit()
    # 删除零件主体
    db_part = get_part(db, part_id)
    if db_part:
        db.delete(db_part)
        db.commit()
    return db_part

def get_assembly(db, assembly_id):
    return db.query(models.Assembly).filter(models.Assembly.id == assembly_id).first()

def get_all_bom_items(db):
    """获取所有 BOM 关系，用于前端反查"""
    return db.query(models.BOMItem).all()

def get_assembly_by_code(db, code):
    return db.query(models.Assembly).filter(models.Assembly.code == code).first()

def get_assembly_by_code_version(db, code, version):
    """按编码+版本号精确查找部件（支持同编码多版本）"""
    return db.query(models.Assembly).filter(
        models.Assembly.code == code,
        models.Assembly.version == version
    ).first()

def get_assemblies(db, skip=0, limit=100):
    return db.query(models.Assembly).offset(skip).limit(limit).all()

def create_assembly(db, assembly):
    db_assembly = models.Assembly(**assembly.model_dump())
    db.add(db_assembly)
    db.commit()
    db.refresh(db_assembly)
    return db_assembly

def update_assembly(db, assembly_id, assembly_update):
    db_assembly = get_assembly(db, assembly_id)
    if not db_assembly:
        return None
    for field, value in assembly_update.model_dump(exclude_unset=True).items():
        setattr(db_assembly, field, value)
    from datetime import datetime
    db_assembly.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_assembly)
    return db_assembly

def delete_assembly(db, assembly_id):
    # 删除该部件"拥有"的 BOM items（它的子项）
    db.query(models.BOMItem).filter(
        models.BOMItem.parent_type == 'assembly',
        models.BOMItem.parent_id == assembly_id
    ).delete(synchronize_session=False)
    # 删除所有引用该部件的 BOM items（该部件作为子项被其他部件引用）
    db.query(models.BOMItem).filter(
        models.BOMItem.child_type == 'component',
        models.BOMItem.child_id == assembly_id
    ).delete(synchronize_session=False)
    db.commit()
    # 删除部件主体
    db_assembly = get_assembly(db, assembly_id)
    if db_assembly:
        db.delete(db_assembly)
        db.commit()
    return db_assembly

def get_assembly_parts(db, assembly_id):
    """获取部件的子项列表，包含零件和部件的详细信息（返回本地格式）"""
    items = db.query(models.BOMItem).filter(
        models.BOMItem.parent_type == "assembly",
        models.BOMItem.parent_id == assembly_id
    ).all()
    
    result = []
    for item in items:
        # 确定本地格式的 childType
        child_type = item.child_type
        child_type_local = "part" if child_type == "part" else "component"
        
        item_dict = {
            "id": item.id,
            "childType": child_type_local,          # 本地格式字段
            "child_type": child_type,               # 保留原字段（兼容性）
            "child_id": item.child_id,              # 保留原字段（兼容性）
            "quantity": float(item.quantity),
            "created_at": item.created_at
        }
        # 根据类型设置 componentId 或 partId（本地格式核心字段）
        if child_type != "part":  # assembly 或 component 都视为部件
            item_dict["componentId"] = item.child_id
            item_dict["partId"] = None
        else:  # part
            item_dict["componentId"] = None
            item_dict["partId"] = item.child_id
        
        # 获取子项详细信息
        if child_type == "part":
            child = get_part(db, item.child_id)
            if child:
                item_dict["child_detail"] = {
                    "id": child.id,
                    "code": child.code,
                    "name": child.name,
                    "spec": child.spec,
                    "version": child.version,
                    "status": child.status,
                }
        elif child_type != "part":  # assembly 或 component 都视为部件
            child = get_assembly(db, item.child_id)
            if child:
                item_dict["child_detail"] = {
                    "id": child.id,
                    "code": child.code,
                    "name": child.name,
                    "spec": child.spec,
                    "version": child.version,
                    "status": child.status,
                }
        result.append(item_dict)
    return result

def get_bom_items(db, parent_type, parent_id):
    return db.query(models.BOMItem).filter(
        models.BOMItem.parent_type == parent_type,
        models.BOMItem.parent_id == parent_id
    ).all()

def create_bom_item(db, item):
    db_item = models.BOMItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def delete_bom_item(db, item_id):
    db_item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id).first()
    if db_item:
        db.delete(db_item)
        db.commit()
    return db_item

def get_bom_item(db, item_id):
    return db.query(models.BOMItem).filter(models.BOMItem.id == item_id).first()

def create_log(db, user_id, username, action, target_type=None, target_id=None, detail=None, ip_address=None, id=None):
    db_log = models.OperationLog(
        user_id=user_id, username=username, action=action,
        target_type=target_type, target_id=target_id,
        detail=detail, ip_address=ip_address
    )
    if id:
        db_log.id = id
    db.add(db_log)
    db.commit()
    return db_log

def get_logs(db, skip=0, limit=100):
    return db.query(models.OperationLog).order_by(models.OperationLog.created_at.desc()).offset(skip).limit(limit).all()

# ===== Custom Field Definition CRUD =====

def get_custom_field_definitions(db, applies_to=None):
    q = db.query(models.CustomFieldDefinition)
    # 前端已经做过滤，后端直接返回全部（applies_to 为空）或按类型过滤
    if applies_to and applies_to != 'all':
        # applies_to 现在是逗号分隔的字符串，如 "part,component"
        types = [t.strip() for t in applies_to.split(',')]
        if types:
            from sqlalchemy import any_
            q = q.filter(models.CustomFieldDefinition.applies_to.overlap(types))
    return q.order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.created_at).all()

def get_custom_field_definition(db, field_id):
    return db.query(models.CustomFieldDefinition).filter(models.CustomFieldDefinition.id == field_id).first()

def get_custom_field_definition_by_key(db, field_key):
    return db.query(models.CustomFieldDefinition).filter(models.CustomFieldDefinition.field_key == field_key).first()

def create_custom_field_definition(db, field_def):
    # 确保 applies_to 是 list 类型（JSONB 字段）
    applies_to_val = field_def.applies_to
    if isinstance(applies_to_val, str):
        applies_to_val = [applies_to_val]
    kwargs = dict(
        name=field_def.name,
        field_key=field_def.field_key,
        field_type=field_def.field_type,
        options=field_def.options or [],
        is_required=1 if field_def.is_required else 0,
        applies_to=applies_to_val,
        sort_order=field_def.sort_order
    )
    if field_def.id:
        kwargs['id'] = field_def.id
    db_field = models.CustomFieldDefinition(**kwargs)
    db.add(db_field)
    db.commit()
    db.refresh(db_field)
    return db_field

def update_custom_field_definition(db, field_id, field_update):
    db_field = get_custom_field_definition(db, field_id)
    if not db_field:
        return None
    update_data = field_update.model_dump(exclude_unset=True)
    if 'is_required' in update_data:
        update_data['is_required'] = 1 if update_data['is_required'] else 0
    # 确保 applies_to 是 list 类型
    if 'applies_to' in update_data:
        if isinstance(update_data['applies_to'], str):
            update_data['applies_to'] = [update_data['applies_to']]
    for field, value in update_data.items():
        setattr(db_field, field, value)
    from datetime import datetime
    db_field.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(db_field)
    return db_field

def delete_custom_field_definition(db, field_id):
    db_field = get_custom_field_definition(db, field_id)
    if db_field:
        db.delete(db_field)
        db.commit()
    return db_field

def reorder_custom_field_definitions(db, items):
    for item in items:
        db_field = db.query(models.CustomFieldDefinition).filter(models.CustomFieldDefinition.id == item.id).first()
        if db_field:
            db_field.sort_order = item.sort_order
    db.commit()
    return True

def reset_business_data(db):
    """清除业务数据，保留用户和系统设置（字典、自定义字段定义）"""
    # 按依赖顺序删除：值 → BOM → 附件 → 零件/部件 → 日志
    db.query(models.CustomFieldValue).delete()
    db.query(models.BOMItem).delete()
    db.query(models.DocumentAttachment).delete()
    db.query(models.Document).delete()
    db.query(models.Part).delete()
    db.query(models.Assembly).delete()
    db.query(models.OperationLog).delete()
    db.commit()
    return True

# ===== Custom Field Value CRUD =====

def get_custom_field_values(db, entity_type, entity_id):
    """获取实体的所有自定义字段值，联合字段定义返回"""
    from sqlalchemy.orm import aliased
    CFD = models.CustomFieldDefinition
    CFV = models.CustomFieldValue
    results = db.query(CFV, CFD).join(CFD, CFV.field_id == CFD.id).filter(
        CFV.entity_type == entity_type,
        CFV.entity_id == entity_id
    ).all()
    return results

def set_custom_field_values(db, entity_type, entity_id, values):
    """批量设置实体的自定义字段值"""
    for item in values:
        field_def = get_custom_field_definition(db, item.field_id)
        if not field_def:
            continue
        # 查找已有值
        existing = db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.field_id == item.field_id,
            models.CustomFieldValue.entity_type == entity_type,
            models.CustomFieldValue.entity_id == entity_id
        ).first()

        # 根据字段类型确定存储列
        value_text = None
        value_number = None
        value_json = None
        if field_def.field_type == 'text':
            value_text = str(item.value) if item.value is not None else None
        elif field_def.field_type == 'number':
            try:
                value_number = float(item.value) if item.value is not None else None
            except (ValueError, TypeError):
                value_number = None
        elif field_def.field_type == 'select':
            value_text = str(item.value) if item.value is not None else None
        elif field_def.field_type == 'multiselect':
            value_json = item.value if isinstance(item.value, list) else None

        if existing:
            existing.value_text = value_text
            existing.value_number = value_number
            existing.value_json = value_json
            from datetime import datetime
            existing.updated_at = datetime.utcnow()
        else:
            new_val = models.CustomFieldValue(
                field_id=item.field_id,
                entity_type=entity_type,
                entity_id=entity_id,
                value_text=value_text,
                value_number=value_number,
                value_json=value_json
            )
            if item.id:
                new_val.id = item.id
            db.add(new_val)
    db.commit()
    return True
