"""
构型配置 - CRUD Operations
==============================
"""

from sqlalchemy.orm import Session
from sqlalchemy import or_, func as sqlfunc
from typing import Optional, List, Tuple
from datetime import datetime, timezone
from fastapi import HTTPException

from . import models_configuration as models
from . import schemas_configuration as schemas


# ============================================================
# 构型项 CRUD
# ============================================================

def get_config_items(
    db: Session, search: Optional[str] = None,
    skip: int = 0, limit: int = 50,
    exclude_ids: set | None = None,
    include_deleted: bool = False,
    updated_since: Optional[float] = None,
    top_level: bool = False,
) -> Tuple[List[models.ConfigurationItem], int]:
    """构型项列表"""
    q = db.query(models.ConfigurationItem)
    if not include_deleted:
        q = q.filter(models.ConfigurationItem.deleted_at.is_(None))
    if exclude_ids:
        q = q.filter(models.ConfigurationItem.id.notin_(exclude_ids))
    if top_level:
        # 仅顶层构型项：id 未作为任何“存活父项”的子项出现。
        # 注意软删除父项的关联边仍残留在表中，故需排除已删除父项，避免误判。
        live_parent_ids = db.query(models.ConfigurationItem.id).filter(
            models.ConfigurationItem.deleted_at.is_(None)
        )
        parented_child_ids = db.query(models.ConfigurationItemChild.child_id).filter(
            models.ConfigurationItemChild.parent_id.in_(live_parent_ids)
        )
        q = q.filter(models.ConfigurationItem.id.notin_(parented_child_ids))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationItem.code.ilike(like),
            models.ConfigurationItem.name.ilike(like),
            models.ConfigurationItem.spec.ilike(like),
        ))
    if updated_since:
        from datetime import datetime, timezone as tz
        since_dt = datetime.fromtimestamp(updated_since, tz=tz.utc)
        q = q.filter(
            (models.ConfigurationItem.updated_at >= since_dt) |
            (models.ConfigurationItem.deleted_at >= since_dt)
        )
    total = q.count()
    items = q.order_by(models.ConfigurationItem.code).offset(skip).limit(limit).all()
    return items, total


def get_config_item(db: Session, config_id: str) -> Optional[models.ConfigurationItem]:
    return db.query(models.ConfigurationItem).filter(
        models.ConfigurationItem.id == config_id,
        models.ConfigurationItem.deleted_at.is_(None)
    ).first()


def get_config_item_by_code(db: Session, code: str) -> Optional[models.ConfigurationItem]:
    return db.query(models.ConfigurationItem).filter(models.ConfigurationItem.code == code).first()


def create_config_item(db: Session, data: schemas.ConfigurationItemCreate) -> models.ConfigurationItem:
    item = models.ConfigurationItem(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def revive_config_item(
    db: Session, item: models.ConfigurationItem, data: schemas.ConfigurationItemCreate,
) -> models.ConfigurationItem:
    """复活已软删除的构型项：撤销删除、以新数据覆盖基本字段，并清空其自身旧关联（等价全新创建）。

    code 列有唯一约束，软删除行仍占用该 code，故再次创建同 code 时复用此行而非插入新行。
    """
    item.deleted_at = None
    item.name = data.name
    item.spec = data.spec
    item.remark = data.remark
    item.document_links = []
    # 清空该构型项自身的关联零部件
    db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.configuration_item_id == item.id
    ).delete()
    # 清空该构型项作为父项的子构型关联（不动其它父项对它的引用）
    db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_id == item.id
    ).delete()
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
    """Soft delete configuration item"""
    from sqlalchemy.sql import func
    item = db.query(models.ConfigurationItem).filter(
        models.ConfigurationItem.id == config_id,
        models.ConfigurationItem.deleted_at.is_(None)
    ).first()
    if not item:
        return False
    item.deleted_at = func.now()
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
    """递归展开构型项，生成配置清单 → 写入工作表"""
    from app.models import Component

    parts = db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.configuration_item_id == config_item_id
    ).order_by(models.ConfigurationItemPart.sort_order).all()

    for p in parts:
        item_code = None
        item_name = None
        entity = db.query(Component).filter(Component.id == p.part_id).first()
        if entity:
            item_code = entity.code
            item_name = entity.name

        item = models.ConfigurationWorkingItem(
            profile_id=profile_id,
            source_config_item_id=config_item_id,
            item_type=p.part_type,
            item_id=p.part_id,
            item_code=item_code,
            item_name=item_name,
            is_required=p.is_required,
            is_selected=p.is_required,
            quantity=getattr(p, "quantity", 1) or 1,
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
        reviewers=[r.model_dump() for r in (data.reviewers or [])],
        review_mode=data.review_mode or "all",
        cc_users=[c.model_dump() for c in (data.cc_users or [])],
    )
    db.add(profile)
    db.flush()

    if data.configuration_item_id:
        _generate_checklist(db, str(profile.id), str(data.configuration_item_id))
        db.flush()
        sync_working_to_formal(db, str(profile.id))

    db.commit()
    db.refresh(profile)
    return profile


def update_profile(
    db: Session, profile_id: str, data: schemas.ConfigurationProfileUpdate,
) -> Optional[models.ConfigurationProfile]:
    profile = get_profile(db, profile_id)
    if not profile:
        return None

    # 处理构型项变更（仅当值变化时才清除并重建工作表）
    new_cfg_id = str(data.configuration_item_id) if data.configuration_item_id else None
    old_cfg_id = str(profile.configuration_item_id) if profile.configuration_item_id else None
    if new_cfg_id != old_cfg_id:
        db.query(models.ConfigurationWorkingItem).filter(
            models.ConfigurationWorkingItem.profile_id == profile_id
        ).delete()
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
        if v is None and k in ("reviewers", "cc_users", "review_mode"):
            continue
        setattr(profile, k, v)

    db.flush()
    # 始终同步工作表到正式清单
    sync_working_to_formal(db, profile_id)

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


def get_working_items(db: Session, profile_id: str) -> List[models.ConfigurationWorkingItem]:
    """获取工作清单（用于配置清单展示）"""
    return db.query(models.ConfigurationWorkingItem).filter(
        models.ConfigurationWorkingItem.profile_id == profile_id
    ).order_by(models.ConfigurationWorkingItem.sort_order).all()


def get_profile_items(db: Session, profile_id: str) -> List[models.ConfigurationProfileItem]:
    """获取正式配置清单"""
    return db.query(models.ConfigurationProfileItem).filter(
        models.ConfigurationProfileItem.profile_id == profile_id
    ).order_by(models.ConfigurationProfileItem.sort_order).all()


def sync_working_to_formal(db: Session, profile_id: str):
    """将工作表同步到正式配置清单"""
    # 清除旧的正式清单
    db.query(models.ConfigurationProfileItem).filter(
        models.ConfigurationProfileItem.profile_id == profile_id
    ).delete()
    # 从工作表复制（仅复制 is_selected=True 的项）
    working_items = get_working_items(db, profile_id)
    for wi in working_items:
        if wi.is_selected or wi.is_required:
            formal_item = models.ConfigurationProfileItem(
                profile_id=wi.profile_id,
                source_config_item_id=wi.source_config_item_id,
                item_type=wi.item_type,
                item_id=wi.item_id,
                item_code=wi.item_code,
                item_name=wi.item_name,
                is_required=wi.is_required,
                is_selected=wi.is_selected,
                quantity=wi.quantity,
                source_type=wi.source_type,
                sort_order=wi.sort_order,
            )
            db.add(formal_item)


def regenerate_profile_checklist(
    db: Session, profile_id: str,
) -> Optional[models.ConfigurationProfile]:
    """强制以最新构型项内容重建工作清单 + 同步正式清单"""
    profile = get_profile(db, profile_id)
    if not profile:
        return None
    if not profile.configuration_item_id:
        return None

    # 清除旧工作表
    db.query(models.ConfigurationWorkingItem).filter(
        models.ConfigurationWorkingItem.profile_id == profile_id
    ).delete()
    # 重新生成到工作表
    _generate_checklist(db, profile_id, str(profile.configuration_item_id))
    db.flush()
    # 同步到正式清单
    sync_working_to_formal(db, profile_id)
    db.commit()
    db.refresh(profile)
    return profile


def update_working_item(
    db: Session, item_id: str, is_selected: bool, force: bool = False,
) -> Optional[models.ConfigurationWorkingItem]:
    """更新工作表单项的选中态"""
    item = db.query(models.ConfigurationWorkingItem).filter(
        models.ConfigurationWorkingItem.id == item_id
    ).first()
    if not item:
        return None
    if item.is_required and not force:
        return None
    item.is_selected = is_selected
    db.commit()
    db.refresh(item)
    return item


def update_profile_item(
    db: Session, item_id: str, is_selected: bool, force: bool = False,
) -> Optional[models.ConfigurationWorkingItem]:
    """更新工作表单项的选中态（别名，兼容旧调用）"""
    return update_working_item(db, item_id, is_selected, force)


# ════════════════════════════════════════════════════════
# 审批流（参照 ECO）
# ════════════════════════════════════════════════════════

_ALLOWED_PROFILE_TRANSITIONS = {
    "draft": {"reviewing", "active", "archived"},
    "reviewing": {"active", "rejected", "draft"},
    "active": {"archived"},
    "rejected": {"draft", "archived"},
    "archived": set(),
}


def _validate_profile_transition(current: str, target: str):
    if target not in _ALLOWED_PROFILE_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=400, detail=f"不允许从 {current} 转为 {target}")


def _add_profile_status_log(db, profile_id, from_status, to_status,
                            operator_id, operator_name, comment=""):
    db.add(models.ConfigurationStatusLog(
        profile_id=profile_id, from_status=from_status, to_status=to_status,
        operator_id=operator_id, operator_name=operator_name, comment=comment,
    ))


def _clear_profile_review_records(db, profile_id):
    db.query(models.ConfigurationReviewRecord).filter(
        models.ConfigurationReviewRecord.profile_id == profile_id
    ).delete()


def submit_profile(db, profile, user):
    """提交评审：有审批人→reviewing；无审批人→自动生效 active。"""
    reviewers = profile.reviewers or []
    _clear_profile_review_records(db, profile.id)
    if not reviewers:
        _validate_profile_transition(profile.status, "active")
        _add_profile_status_log(db, profile.id, profile.status, "active",
                                user.id, user.real_name, "无审批人自动生效")
        profile.status = "active"
        profile.submitted_at = datetime.now(timezone.utc)
        profile.reviewed_at = datetime.now(timezone.utc)
    else:
        _validate_profile_transition(profile.status, "reviewing")
        _add_profile_status_log(db, profile.id, profile.status, "reviewing",
                                user.id, user.real_name, "提交评审")
        profile.status = "reviewing"
        profile.submitted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)
    return profile


def withdraw_profile(db, profile, user, comment=""):
    """撤回评审：reviewing→draft，清空审批记录。"""
    _validate_profile_transition(profile.status, "draft")
    _clear_profile_review_records(db, profile.id)
    _add_profile_status_log(db, profile.id, profile.status, "draft",
                            user.id, user.real_name, comment or "撤回评审")
    profile.status = "draft"
    db.commit()
    db.refresh(profile)
    return profile


def reopen_profile(db, profile, user):
    """重新编辑：rejected→draft。"""
    _validate_profile_transition(profile.status, "draft")
    _clear_profile_review_records(db, profile.id)
    _add_profile_status_log(db, profile.id, profile.status, "draft",
                            user.id, user.real_name, "重新编辑")
    profile.status = "draft"
    db.commit()
    db.refresh(profile)
    return profile


def archive_profile(db, profile, user, comment=""):
    """归档：active/rejected→archived。"""
    _validate_profile_transition(profile.status, "archived")
    _add_profile_status_log(db, profile.id, profile.status, "archived",
                            user.id, user.real_name, comment or "归档")
    profile.status = "archived"
    profile.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)
    return profile


def review_profile(db, profile, reviewer, decision, comment=""):
    """审批操作：通过/驳回/退回。会签全通过或或签任一通过 → active。"""
    if profile.status != "reviewing":
        raise HTTPException(status_code=400, detail="配置不在评审中状态")

    is_admin = reviewer.role == "admin"
    is_reviewer = any(r.get("user_id") == str(reviewer.id) for r in (profile.reviewers or []))
    if not is_admin and not is_reviewer:
        raise HTTPException(status_code=403, detail="您不是该配置的指定审批人")

    db.add(models.ConfigurationReviewRecord(
        profile_id=profile.id, reviewer_id=reviewer.id,
        reviewer_name=reviewer.real_name, decision=decision, comment=comment,
    ))
    db.commit()

    if decision == "approved":
        if profile.review_mode == "all":
            all_ids = {r.get("user_id") for r in (profile.reviewers or [])}
            approved_ids = {
                str(r.reviewer_id) for r in db.query(models.ConfigurationReviewRecord).filter(
                    models.ConfigurationReviewRecord.profile_id == profile.id,
                    models.ConfigurationReviewRecord.decision == "approved",
                ).all()
            }
            if all_ids and all_ids.issubset(approved_ids):
                _add_profile_status_log(db, profile.id, profile.status, "active",
                                        reviewer.id, reviewer.real_name, "全部审批通过")
                profile.status = "active"
                profile.reviewed_at = datetime.now(timezone.utc)
        else:
            _add_profile_status_log(db, profile.id, profile.status, "active",
                                    reviewer.id, reviewer.real_name, "或签通过")
            profile.status = "active"
            profile.reviewed_at = datetime.now(timezone.utc)
    elif decision == "rejected":
        _add_profile_status_log(db, profile.id, profile.status, "rejected",
                                reviewer.id, reviewer.real_name, comment or "驳回")
        profile.status = "rejected"
        profile.reviewed_at = datetime.now(timezone.utc)
    elif decision == "returned":
        _add_profile_status_log(db, profile.id, profile.status, "draft",
                                reviewer.id, reviewer.real_name, comment or "退回修改")
        profile.status = "draft"
        _clear_profile_review_records(db, profile.id)
    else:
        raise HTTPException(status_code=400, detail="无效审批决定")

    db.commit()
    db.refresh(profile)
    return profile


def get_review_records(db, profile_id):
    return db.query(models.ConfigurationReviewRecord).filter(
        models.ConfigurationReviewRecord.profile_id == profile_id
    ).order_by(models.ConfigurationReviewRecord.created_at).all()


def get_status_logs(db, profile_id):
    return db.query(models.ConfigurationStatusLog).filter(
        models.ConfigurationStatusLog.profile_id == profile_id
    ).order_by(models.ConfigurationStatusLog.created_at).all()


def add_profile_cc(db, profile, user_id, user_name):
    cc = list(profile.cc_users or [])
    if not any(c.get("user_id") == user_id for c in cc):
        cc.append({"user_id": user_id, "user_name": user_name})
        profile.cc_users = cc
        db.commit()
        db.refresh(profile)
    return profile


def remove_profile_cc(db, profile, user_id):
    profile.cc_users = [c for c in (profile.cc_users or []) if c.get("user_id") != user_id]
    db.commit()
    db.refresh(profile)
    return profile


def get_profiles_for_user(db, user, search=None, status=None, skip=0, limit=20):
    """列表 + 权限过滤：
    - 管理员：全部
    - 非管理员：active/archived 全可见 + draft/reviewing/rejected 中 自己创建/审批人/知会 的
    """
    q = db.query(models.ConfigurationProfile)
    if status:
        q = q.filter(models.ConfigurationProfile.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationProfile.code.ilike(like),
            models.ConfigurationProfile.name.ilike(like),
        ))
    if user.role != "admin":
        uid = str(user.id)
        all_rows = q.order_by(models.ConfigurationProfile.code).all()

        def visible(p):
            if p.status in ("active", "archived"):
                return True
            if str(p.creator_id) == uid:
                return True
            if any(r.get("user_id") == uid for r in (p.reviewers or [])):
                return True
            if any(c.get("user_id") == uid for c in (p.cc_users or [])):
                return True
            return False

        rows = [p for p in all_rows if visible(p)]
        total = len(rows)
        return rows[skip:skip + limit], total
    total = q.count()
    items = q.order_by(models.ConfigurationProfile.code).offset(skip).limit(limit).all()
    return items, total
