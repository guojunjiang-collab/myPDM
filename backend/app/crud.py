import uuid
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from . import models, schemas
import bcrypt

def _doc_brief(doc):
    """doc 为 DocumentRevision 实例（兼容别名 Document = DocumentRevision）"""
    master = doc.master if hasattr(doc, 'master') else None
    return {
        "id": str(doc.id), "code": master.code if master else "", "name": master.name if master else "",
        "version": doc.version, "status": doc.status,
        "file_name": None, "file_id": None,
        "remark": doc.remark,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.created_at.isoformat() if doc.created_at else None,
        "deleted_at": doc.deleted_at.isoformat() if doc.deleted_at else None,
    }

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
        department=user.department, phone=user.phone, status=user.status,
        must_change_password=True,
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

# [REMOVED: old assert_entity_editable for component system]


def get_all_bom_items(db, include_deleted=False, updated_since=None):
    """获取所有 BOM 关系，用于前端反查"""
    q = db.query(models.BOMItem)
    if not include_deleted:
        q = q.filter(models.BOMItem.deleted_at.is_(None))
    if updated_since:
        from datetime import datetime, timezone
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        q = q.filter(
            (models.BOMItem.updated_at >= since_dt) |
            (models.BOMItem.deleted_at >= since_dt)
        )
    return q.all()

# [REMOVED: old Component CRUD functions]

def get_bom_items(db, parent_type, parent_id, include_deleted=False):
    """获取 BOM 子项（兼容旧的 parent_type/parent_id 参数，使用 parent_revision_id）"""
    q = db.query(models.BOMItem).filter(
        models.BOMItem.parent_revision_id == parent_id,
    )
    if not include_deleted:
        q = q.filter(models.BOMItem.deleted_at.is_(None))
    return q.all()

def create_bom_item(db, item):
    data = item.model_dump(exclude={'parent_type', 'parent_id', 'child_type', 'child_id'}, exclude_none=True)
    db_item = models.BOMItem(**data)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def delete_bom_item(db, item_id):
    db_item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id).first()
    if db_item:
        db_item.deleted_at = sqlfunc.now()
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

def get_logs(db, skip=0, limit=100, target_type=None, target_id=None):
    q = db.query(models.OperationLog)
    if target_type:
        q = q.filter(models.OperationLog.target_type == target_type)
    if target_id:
        q = q.filter(models.OperationLog.target_id == target_id)
    total = q.count()
    items = q.order_by(models.OperationLog.created_at.desc()).offset(skip).limit(limit).all()
    return items, total

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
    """清除所有业务数据：零件、部件、BOM、图文档、附件文件、自定义字段、看板、构型管理（构型项/构型配置）、变更管理（ECR/ECO）、日志、非管理员用户；重置 admin 密码为 admin123"""
    import os
    import shutil
    from .file_storage import UPLOAD_DIR
    from . import models_configuration as mc
    from . import models_ecr as mecr
    from . import models_eco as meco

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

    # 变更管理（ECO/ECR）：子表 → 主表（均引用 users / 互相引用，须在删除用户前）
    db.query(meco.ECOExecutionItem).delete()
    db.query(meco.ECOReviewRecord).delete()
    db.query(meco.ECOStatusLog).delete()
    db.query(meco.ECO).delete()
    db.query(mecr.ECRAffectedItem).delete()
    db.query(mecr.ECRReviewRecord).delete()
    db.query(mecr.ECRStatusLog).delete()
    db.query(mecr.ECR).delete()

    # 构型管理（构型项/构型配置）：子表 → 主表
    db.query(mc.ConfigurationProfileItem).delete()
    db.query(mc.ConfigurationWorkingItem).delete()
    db.query(mc.ConfigurationProfile).delete()
    db.query(mc.ConfigurationItemPart).delete()
    db.query(mc.ConfigurationItemChild).delete()
    db.query(mc.ConfigurationItemIteration).delete()
    db.query(mc.ConfigurationItemRevision).delete()
    db.query(mc.ConfigurationItemMaster).delete()
    db.query(mc.ConfigurationItem).delete()  # 兼容旧版（配置表复用）

    db.query(models.DocumentGroupLink).delete()
    db.query(models.DocumentAttachment).delete()
    db.query(models.DocumentIteration).delete()
    db.query(models.DocumentRevision).delete()
    db.query(models.DocumentMaster).delete()
    db.query(models.CustomFieldDefinition).delete()
    db.query(models.OperationLog).delete()

    # 删除非管理员用户，保留 admin
    db.query(models.User).filter(models.User.username != "admin").delete(synchronize_session='fetch')

    # 重置 admin 密码为 admin123
    admin = db.query(models.User).filter(models.User.username == "admin").first()
    if admin:
        admin.password_hash = get_password_hash("admin123")

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

    # 清理 glb 缓存文件（STP 转换生成的 glTF 缓存）
    gltf_cache_dir = os.path.join(UPLOAD_DIR, "glb_cache")
    if os.path.exists(gltf_cache_dir):
        try:
            shutil.rmtree(gltf_cache_dir)
            os.makedirs(gltf_cache_dir, exist_ok=True)
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

def get_custom_field_values_batch(db, entity_type, entity_ids):
    """批量获取多个实体的自定义字段值，返回 {entity_id: {field_key: value}}"""
    from collections import defaultdict
    CFV = models.CustomFieldValue
    CFD = models.CustomFieldDefinition

    # 批量查询所有实体的字段值
    results = db.query(CFV, CFD).join(CFD, CFV.field_id == CFD.id).filter(
        CFV.entity_type == entity_type,
        CFV.entity_id.in_(entity_ids)
    ).all()
    
    # 构建结果: {entity_id: {field_key: value, ...}}
    output = defaultdict(dict)
    for val, field_def in results:
        entity_id_str = str(val.entity_id)
        value = None
        if field_def.field_type in ('text', 'select'):
            value = val.value_text
        elif field_def.field_type == 'number':
            value = float(val.value_number) if val.value_number is not None else None
        elif field_def.field_type == 'multiselect':
            value = val.value_json
        else:
            value = val.value_text or (float(val.value_number) if val.value_number is not None else None) or val.value_json
        output[entity_id_str][field_def.field_key] = value
    
    return dict(output)

def set_custom_field_values(db, entity_type, entity_id, values, iteration_id=None):
    """批量设置实体的自定义字段值"""
    for item in values:
        field_def = get_custom_field_definition(db, item.field_id)
        if not field_def:
            continue
        # 查找已有值（加入 iteration_id 匹配）
        query = db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.field_id == item.field_id,
            models.CustomFieldValue.entity_type == entity_type,
            models.CustomFieldValue.entity_id == entity_id
        )
        if iteration_id is not None:
            query = query.filter(models.CustomFieldValue.iteration_id == iteration_id)
        else:
            query = query.filter(models.CustomFieldValue.iteration_id.is_(None))
        existing = query.first()

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
                value_json=value_json,
                iteration_id=iteration_id,
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
    """根据同编码已有（未软删除）版本数，生成下一版本号"""
    count = db.query(model_class).filter(model_class.code == code, model_class.deleted_at.is_(None)).count()
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


def _copy_iteration_custom_fields(db, source_iteration_id, target_iteration_id, new_entity_id=None, source_entity_id=None):
    """复制迭代的自定义字段值到目标迭代
    
    签出（同版本新迭代）: entity_id 保持不变，不传 new_entity_id，传 source_entity_id
    升版（新版本新迭代）: entity_id 需更新为新的 revision_id，传 new_entity_id 和 source_entity_id
    """
    from sqlalchemy import or_
    conditions = [models.CustomFieldValue.iteration_id == source_iteration_id]
    if source_entity_id is not None:
        conditions.append(models.CustomFieldValue.entity_id == source_entity_id)
    source_values = db.query(models.CustomFieldValue).filter(or_(*conditions)).all()
    for sv in source_values:
        target_id = new_entity_id or sv.entity_id
        new_val = models.CustomFieldValue(
            field_id=sv.field_id,
            entity_type=sv.entity_type,
            entity_id=target_id,
            value_text=sv.value_text,
            value_number=sv.value_number,
            value_json=sv.value_json,
            iteration_id=target_iteration_id,
        )
        db.add(new_val)
    db.flush()


# [REMOVED: old upgrade_component function]


def upgrade_document(db, doc_id, user_id: UUID, user_name: str = None):
    """图文档升版：创建新版本 Revision + Iteration(1)，复制附件和自定义字段，自动签出"""
    now = datetime.now(timezone.utc)
    source_rev = db.query(models.DocumentRevision).filter(
        models.DocumentRevision.id == doc_id,
        models.DocumentRevision.deleted_at.is_(None),
    ).first()
    if not source_rev:
        return None, "图文档版本不存在"
    if source_rev.status not in ('released', 'obsolete'):
        return None, "仅发布或作废状态的图文档允许升版"

    from . import crud_documents
    new_version = crud_documents._get_next_version(db, source_rev.master_id)

    source_iter = crud_documents._get_current_iteration(db, source_rev.id)

    new_rev = models.DocumentRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status='draft',
        latest_iteration=1,
        revision_parent_id=source_rev.id,
        creator_id=user_id,
        check_out_user_id=user_id,
        check_out_date=now,
    )
    db.add(new_rev)
    db.flush()

    new_iter = models.DocumentIteration(
        revision_id=new_rev.id,
        iteration=1,
    )
    db.add(new_iter)
    db.flush()

    if source_iter:
        crud_documents._copy_attachments_to_iteration(db, source_iter, new_iter)
        _copy_iteration_custom_fields(db, source_iter.id, new_iter.id)

    # 更新 master 的 revisions JSONB 记录
    master = crud_documents.get_document_master(db, source_rev.master_id)
    if master:
        revs = list(master.revisions or [])
        revs.append({
            'version': new_version,
            'parent_version': source_rev.version,
            'action': 'upgraded_from',
            'user': user_name,
            'timestamp': now.isoformat(),
        })
        master.revisions = revs

    db.commit()
    db.refresh(new_rev)
    return new_rev, None


def get_document_versions(db, doc_id):
    """获取指定图文档的所有版本（通过 revision_id 反查 master → 全部版本）"""
    revision = db.query(models.DocumentRevision).filter(
        models.DocumentRevision.id == doc_id,
        models.DocumentRevision.deleted_at.is_(None),
    ).first()
    if not revision:
        return []
    return db.query(models.DocumentRevision).filter(
        models.DocumentRevision.master_id == revision.master_id,
        models.DocumentRevision.deleted_at.is_(None),
    ).order_by(models.DocumentRevision.created_at).all()
