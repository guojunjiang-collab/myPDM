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

def get_parts(db, skip=0, limit=100, search=None):
    q = db.query(models.Part)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (models.Part.code.ilike(pattern)) |
            (models.Part.name.ilike(pattern))
        )
    return q.offset(skip).limit(limit).all()

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

def get_assemblies(db, skip=0, limit=100, search=None):
    q = db.query(models.Assembly)
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            (models.Assembly.code.ilike(pattern)) |
            (models.Assembly.name.ilike(pattern))
        )
    return q.offset(skip).limit(limit).all()

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
    """清除所有业务数据：零件、部件、BOM、图文档、附件文件、自定义字段、看板、日志"""
    import os
    from .file_storage import UPLOAD_DIR

    # 先收集所有要删除的附件文件路径
    attachments = db.query(models.DocumentAttachment).all()
    file_paths = []
    for att in attachments:
        if att.file_path:
            file_paths.append(att.file_path)

    # 按依赖顺序删除 DB 记录
    db.query(models.CustomFieldValue).delete()
    db.query(models.BOMItem).delete()
    db.query(models.DashboardItem).delete()
    db.query(models.DashboardFolderShare).delete()
    db.query(models.DashboardFolder).delete()
    db.query(models.UserDashboard).delete()
    db.query(models.DocumentAttachment).delete()
    db.query(models.Document).delete()
    db.query(models.Part).delete()
    db.query(models.Assembly).delete()
    db.query(models.CustomFieldDefinition).delete()
    db.query(models.OperationLog).delete()
    db.commit()

    # 删除附件实体文件
    for fp in file_paths:
        try:
            full_path = os.path.join(UPLOAD_DIR, fp)
            if os.path.exists(full_path):
                os.remove(full_path)
            # 尝试清理空目录
            dir_path = os.path.dirname(full_path)
            try:
                os.rmdir(dir_path)  # 仅删除空目录
            except OSError:
                pass
        except Exception:
            pass

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


# ===== 版本控制 (升版) =====

VERSION_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'


def _to_version_string(index: int) -> str:
    """将索引转为版本字符串 A=0, B=1, ..."""
    if index < 0:
        index = 0
    result = ''
    num = index
    while True:
        result = VERSION_CHARS[num % 24] + result
        num = num // 24 - 1
        if num < 0:
            break
    return result


def _get_next_version(db, model_class, code: str) -> str:
    """根据同编码已有版本数，生成下一版本号"""
    count = db.query(model_class).filter(model_class.code == code).count()
    return _to_version_string(count)


def _copy_custom_field_values(db, entity_type: str, old_entity_id, new_entity_id):
    """复制自定义字段值"""
    old_values = db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.entity_type == entity_type,
        models.CustomFieldValue.entity_id == old_entity_id
    ).all()
    for ov in old_values:
        new_val = models.CustomFieldValue(
            field_id=ov.field_id,
            entity_type=entity_type,
            entity_id=new_entity_id,
            value_text=ov.value_text,
            value_number=ov.value_number,
            value_json=ov.value_json,
        )
        db.add(new_val)
    if old_values:
        db.flush()


def upgrade_part(db, part_id, user: str = None):
    """零件升版：创建新版本零件，复制自定义字段"""
    from datetime import datetime, timezone
    source = db.query(models.Part).filter(models.Part.id == part_id).first()
    if not source:
        return None, "零件不存在"
    if source.status not in ('released', 'obsolete'):
        return None, "仅发布或作废状态的零件允许升版"

    new_version = _get_next_version(db, models.Part, source.code)
    new_part = models.Part(
        code=source.code,
        name=source.name,
        spec=source.spec,
        version=new_version,
        status='draft',
        remark=source.remark,
        document_links=source.document_links or [],
        revision_parent_id=source.id,
        revisions=[{
            'version': new_version,
            'parent_version': source.version,
            'action': 'upgraded_from',
            'user': user,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }],
    )
    db.add(new_part)
    db.flush()
    _copy_custom_field_values(db, 'part', source.id, new_part.id)
    db.commit()
    db.refresh(new_part)
    return new_part, None


def upgrade_assembly(db, assembly_id, user: str = None):
    """部件升版：创建新版本部件，复制自定义字段和BOM结构"""
    from datetime import datetime, timezone
    source = db.query(models.Assembly).filter(models.Assembly.id == assembly_id).first()
    if not source:
        return None, "部件不存在"
    if source.status not in ('released', 'obsolete'):
        return None, "仅发布或作废状态的部件允许升版"

    new_version = _get_next_version(db, models.Assembly, source.code)
    new_assembly = models.Assembly(
        code=source.code,
        name=source.name,
        spec=source.spec,
        version=new_version,
        status='draft',
        remark=source.remark,
        document_links=source.document_links or [],
        revision_parent_id=source.id,
        revisions=[{
            'version': new_version,
            'parent_version': source.version,
            'action': 'upgraded_from',
            'user': user,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }],
    )
    db.add(new_assembly)
    db.flush()
    _copy_custom_field_values(db, 'assembly', source.id, new_assembly.id)

    # 深拷贝 BOM 结构
    source_bom_items = db.query(models.BOMItem).filter(
        models.BOMItem.parent_type == 'assembly',
        models.BOMItem.parent_id == source.id
    ).all()
    for item in source_bom_items:
        new_bom_item = models.BOMItem(
            parent_type='assembly',
            parent_id=new_assembly.id,
            child_type=item.child_type,
            child_id=item.child_id,
            quantity=item.quantity,
        )
        db.add(new_bom_item)

    db.commit()
    db.refresh(new_assembly)
    return new_assembly, None


def upgrade_document(db, doc_id, user: str = None):
    """图文档升版：创建新版本图文档，复制自定义字段（不拷贝附件）"""
    from datetime import datetime, timezone
    source = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not source:
        return None, "图文档不存在"
    if source.status not in ('released', 'obsolete'):
        return None, "仅发布或作废状态的图文档允许升版"

    new_version = _get_next_version(db, models.Document, source.code)
    new_doc = models.Document(
        code=source.code,
        name=source.name,
        version=new_version,
        status='draft',
        remark=source.remark,
        revision_parent_id=source.id,
        revisions=[{
            'version': new_version,
            'parent_version': source.version,
            'action': 'upgraded_from',
            'user': user,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        }],
    )
    db.add(new_doc)
    db.flush()
    _copy_custom_field_values(db, 'document', source.id, new_doc.id)
    db.commit()
    db.refresh(new_doc)
    return new_doc, None


def get_part_versions(db, part_id):
    """获取指定零件的所有版本（同编码）"""
    part = db.query(models.Part).filter(models.Part.id == part_id).first()
    if not part:
        return []
    return db.query(models.Part).filter(
        models.Part.code == part.code
    ).order_by(models.Part.created_at).all()


def get_assembly_versions(db, assembly_id):
    """获取指定部件的所有版本（同编码）"""
    assembly = db.query(models.Assembly).filter(models.Assembly.id == assembly_id).first()
    if not assembly:
        return []
    return db.query(models.Assembly).filter(
        models.Assembly.code == assembly.code
    ).order_by(models.Assembly.created_at).all()


def get_document_versions(db, doc_id):
    """获取指定图文档的所有版本（同编码）"""
    doc = db.query(models.Document).filter(models.Document.id == doc_id).first()
    if not doc:
        return []
    return db.query(models.Document).filter(
        models.Document.code == doc.code
    ).order_by(models.Document.created_at).all()
