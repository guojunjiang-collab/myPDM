"""
构型配置 - CRUD Operations
==============================
"""

from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List, Tuple

from . import models_configuration as models
from . import schemas_configuration as schemas


# ============================================================
# 构型项 CRUD
# ============================================================

def get_config_items(
    db: Session, search: Optional[str] = None,
    skip: int = 0, limit: int = 50,
    exclude_ids: set | None = None,
) -> Tuple[List[models.ConfigurationItem], int]:
    """构型项列表"""
    q = db.query(models.ConfigurationItem)
    if exclude_ids:
        q = q.filter(models.ConfigurationItem.id.notin_(exclude_ids))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationItem.code.ilike(like),
            models.ConfigurationItem.name.ilike(like),
            models.ConfigurationItem.spec.ilike(like),
        ))
    total = q.count()
    items = q.order_by(models.ConfigurationItem.code).offset(skip).limit(limit).all()
    return items, total


def get_config_item(db: Session, config_id: str) -> Optional[models.ConfigurationItem]:
    return db.query(models.ConfigurationItem).filter(models.ConfigurationItem.id == config_id).first()


def get_config_item_by_code(db: Session, code: str) -> Optional[models.ConfigurationItem]:
    return db.query(models.ConfigurationItem).filter(models.ConfigurationItem.code == code).first()


def create_config_item(db: Session, data: schemas.ConfigurationItemCreate) -> models.ConfigurationItem:
    item = models.ConfigurationItem(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_config_item(db: Session, config_id: str, data: schemas.ConfigurationItemUpdate) -> Optional[models.ConfigurationItem]:
    item = get_config_item(db, config_id)
    if not item:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


def delete_config_item(db: Session, config_id: str) -> bool:
    item = get_config_item(db, config_id)
    if not item:
        return False
    db.delete(item)
    db.commit()
    return True


# ============================================================
# 关联零部件 CRUD
# ============================================================

def get_config_parts(db: Session, config_id: str) -> List[models.ConfigurationItemPart]:
    return (
        db.query(models.ConfigurationItemPart)
        .filter(models.ConfigurationItemPart.configuration_item_id == config_id)
        .order_by(models.ConfigurationItemPart.sort_order).all()
    )


def add_config_parts(db: Session, config_id: str, items: List[schemas.ConfigPartCreate]) -> List[models.ConfigurationItemPart]:
    parts = []
    for it in items:
        part = models.ConfigurationItemPart(configuration_item_id=config_id, **it.model_dump())
        db.add(part)
        parts.append(part)
    db.commit()
    for p in parts:
        db.refresh(p)
    return parts


def update_config_part(db: Session, part_id: str, data: schemas.ConfigPartUpdate) -> Optional[models.ConfigurationItemPart]:
    part = db.query(models.ConfigurationItemPart).filter(models.ConfigurationItemPart.id == part_id).first()
    if not part:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(part, k, v)
    db.commit()
    db.refresh(part)
    return part


def remove_config_part(db: Session, part_id: str) -> bool:
    part = db.query(models.ConfigurationItemPart).filter(models.ConfigurationItemPart.id == part_id).first()
    if not part:
        return False
    db.delete(part)
    db.commit()
    return True


# ============================================================
# 子构型项 CRUD
# ============================================================

def get_config_children(db: Session, config_id: str) -> List[models.ConfigurationItemChild]:
    return (
        db.query(models.ConfigurationItemChild)
        .filter(models.ConfigurationItemChild.parent_id == config_id)
        .order_by(models.ConfigurationItemChild.sort_order).all()
    )


def add_config_children(db: Session, parent_id: str, items: List[schemas.ConfigChildCreate]) -> List[models.ConfigurationItemChild]:
    children = []
    for it in items:
        child = models.ConfigurationItemChild(parent_id=parent_id, **it.model_dump())
        db.add(child)
        children.append(child)
    db.commit()
    for c in children:
        db.refresh(c)
    return children


def update_config_child(db: Session, child_id: str, data: schemas.ConfigChildUpdate) -> Optional[models.ConfigurationItemChild]:
    child = db.query(models.ConfigurationItemChild).filter(models.ConfigurationItemChild.id == child_id).first()
    if not child:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(child, k, v)
    db.commit()
    db.refresh(child)
    return child


def remove_config_child(db: Session, child_id: str) -> bool:
    child = db.query(models.ConfigurationItemChild).filter(models.ConfigurationItemChild.id == child_id).first()
    if not child:
        return False
    db.delete(child)
    db.commit()
    return True


# ============================================================
# 构型配置 CRUD
# ============================================================

def _generate_checklist(db: Session, profile_id: str, config_item_id: str, source_type: str = "direct"):
    """递归展开构型项，生成配置清单"""
    from app.models import Part, Assembly

    parts = db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.configuration_item_id == config_item_id
    ).order_by(models.ConfigurationItemPart.sort_order).all()

    for p in parts:
        item_code = None
        item_name = None
        if p.part_type == "part":
            entity = db.query(Part).filter(Part.id == p.part_id).first()
        else:
            entity = db.query(Assembly).filter(Assembly.id == p.part_id).first()
        if entity:
            item_code = entity.code
            item_name = entity.name

        item = models.ConfigurationProfileItem(
            profile_id=profile_id,
            source_config_item_id=config_item_id,
            item_type=p.part_type,
            item_id=p.part_id,
            item_code=item_code,
            item_name=item_name,
            is_required=p.is_required,
            is_selected=p.is_required,
            source_type=source_type,
            sort_order=p.sort_order,
        )
        db.add(item)

    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_id == config_item_id
    ).order_by(models.ConfigurationItemChild.sort_order).all()

    for child in children:
        _generate_checklist(db, profile_id, str(child.child_id), source_type="child")


def get_profiles(
    db: Session, search: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0, limit: int = 20,
) -> Tuple[List[models.ConfigurationProfile], int]:
    q = db.query(models.ConfigurationProfile)
    if status:
        q = q.filter(models.ConfigurationProfile.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationProfile.code.ilike(like),
            models.ConfigurationProfile.name.ilike(like),
        ))
    total = q.count()
    items = q.order_by(models.ConfigurationProfile.code).offset(skip).limit(limit).all()
    return items, total


def get_profile(db: Session, profile_id: str) -> Optional[models.ConfigurationProfile]:
    return db.query(models.ConfigurationProfile).filter(
        models.ConfigurationProfile.id == profile_id
    ).first()


def get_profile_by_code(db: Session, code: str) -> Optional[models.ConfigurationProfile]:
    return db.query(models.ConfigurationProfile).filter(
        models.ConfigurationProfile.code == code
    ).first()


def create_profile(
    db: Session, data: schemas.ConfigurationProfileCreate, creator_id: str,
) -> models.ConfigurationProfile:
    profile = models.ConfigurationProfile(
        code=data.code, name=data.name,
        configuration_item_id=data.configuration_item_id,
        effectivity_start=data.effectivity_start,
        effectivity_end=data.effectivity_end,
        remark=data.remark,
        creator_id=creator_id,
    )
    db.add(profile)
    db.flush()

    if data.configuration_item_id:
        _generate_checklist(db, str(profile.id), str(data.configuration_item_id))

    db.commit()
    db.refresh(profile)
    return profile


def update_profile(
    db: Session, profile_id: str, data: schemas.ConfigurationProfileUpdate,
) -> Optional[models.ConfigurationProfile]:
    profile = get_profile(db, profile_id)
    if not profile:
        return None

    # 处理构型项变更（仅当值变化时才清除并重建清单，避免覆盖用户手动 toggle）
    new_cfg_id = str(data.configuration_item_id) if data.configuration_item_id else None
    old_cfg_id = str(profile.configuration_item_id) if profile.configuration_item_id else None
    if new_cfg_id != old_cfg_id:
        # 清除旧清单
        db.query(models.ConfigurationProfileItem).filter(
            models.ConfigurationProfileItem.profile_id == profile_id
        ).delete()
        profile.configuration_item_id = data.configuration_item_id
        if data.configuration_item_id:
            _generate_checklist(db, profile_id, str(data.configuration_item_id))

    # 更新其他字段
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("configuration_item_id", None)
    for k, v in update_data.items():
        setattr(profile, k, v)

    db.commit()
    db.refresh(profile)
    return profile


def delete_profile(db: Session, profile_id: str) -> bool:
    profile = get_profile(db, profile_id)
    if not profile:
        return False
    db.delete(profile)
    db.commit()
    return True


def change_profile_status(db: Session, profile_id: str, new_status: str) -> Optional[models.ConfigurationProfile]:
    profile = get_profile(db, profile_id)
    if not profile:
        return None
    profile.status = new_status
    db.commit()
    db.refresh(profile)
    return profile


def get_profile_items(db: Session, profile_id: str) -> List[models.ConfigurationProfileItem]:
    return db.query(models.ConfigurationProfileItem).filter(
        models.ConfigurationProfileItem.profile_id == profile_id
    ).order_by(models.ConfigurationProfileItem.sort_order).all()


def regenerate_profile_checklist(
    db: Session, profile_id: str,
) -> Optional[models.ConfigurationProfile]:
    """强制以最新构型项内容重建配置清单（保留 configuration_item_id 不变）"""
    profile = get_profile(db, profile_id)
    if not profile:
        return None
    if not profile.configuration_item_id:
        return None

    # 清除旧清单
    db.query(models.ConfigurationProfileItem).filter(
        models.ConfigurationProfileItem.profile_id == profile_id
    ).delete()
    # 重新生成
    _generate_checklist(db, profile_id, str(profile.configuration_item_id))
    db.commit()
    db.refresh(profile)
    return profile


def update_profile_item(
    db: Session, item_id: str, is_selected: bool, force: bool = False,
) -> Optional[models.ConfigurationProfileItem]:
    item = db.query(models.ConfigurationProfileItem).filter(
        models.ConfigurationProfileItem.id == item_id
    ).first()
    if not item:
        return None
    if item.is_required and not force:
        return None
    item.is_selected = is_selected
    db.commit()
    db.refresh(item)
    return item
