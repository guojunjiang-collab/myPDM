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
) -> Tuple[List[models.ConfigurationItem], int]:
    """构型项列表"""
    q = db.query(models.ConfigurationItem)
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
