"""
构型配置 - CRUD Operations
==============================
三层模型：Master → Revision → Iteration
签入签出模式参照 crud_parts.py
"""

from sqlalchemy.orm import Session
from sqlalchemy import or_, func as sqlfunc
from typing import Optional, List, Tuple, Any, Dict
from datetime import datetime, timezone
from uuid import UUID
from fastapi import HTTPException

from . import models_configuration as models
from . import crud as crud_common
from . import schemas_configuration as schemas
from . import notifications as _notif


# ====== 版本号工具（参照 crud_parts.py） ======

VERSION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def _to_version_string(index: int) -> str:
    """将索引转为版本字符串 A=0, B=1, ...（24进制，不含I/O）"""
    if index < 0:
        index = 0
    result = ""
    num = index
    while True:
        result = VERSION_CHARS[num % 24] + result
        num = num // 24 - 1
        if num < 0:
            break
    return result


def _get_next_version(db: Session, master_id: UUID) -> str:
    """根据同一 master 下已有版本数，生成下一版本号"""
    count = (
        db.query(models.ConfigurationItemRevision)
        .filter(
            models.ConfigurationItemRevision.master_id == master_id,
            models.ConfigurationItemRevision.deleted_at.is_(None),
        )
        .count()
    )
    return _to_version_string(count)


def _get_current_iteration(db: Session, revision_id: UUID) -> Optional[models.ConfigurationItemIteration]:
    """获取版本的最新迭代"""
    revision = get_config_item_revision(db, revision_id)
    if not revision:
        return None
    return (
        db.query(models.ConfigurationItemIteration)
        .filter(
            models.ConfigurationItemIteration.revision_id == revision_id,
            models.ConfigurationItemIteration.iteration == revision.latest_iteration,
        )
        .first()
    )


# ============================================================
# 构型项 Master CRUD
# ============================================================

def get_config_item_master(db: Session, master_id: UUID) -> Optional[models.ConfigurationItemMaster]:
    """按主数据 ID 查询（排除软删除）"""
    return (
        db.query(models.ConfigurationItemMaster)
        .filter(
            models.ConfigurationItemMaster.id == master_id,
            models.ConfigurationItemMaster.deleted_at.is_(None),
        )
        .first()
    )


def get_config_item_master_by_code(db: Session, code: str) -> Optional[models.ConfigurationItemMaster]:
    """按件号查询主数据（包含软删除，用于复活检测）"""
    return db.query(models.ConfigurationItemMaster).filter(
        models.ConfigurationItemMaster.code == code
    ).first()


def update_config_item_master(db: Session, master_id: UUID, data: dict) -> Optional[models.ConfigurationItemMaster]:
    """更新主数据字段（code / name）"""
    master = get_config_item_master(db, master_id)
    if not master:
        return None
    for field in ("code", "name"):
        if field in data and data[field] is not None:
            setattr(master, field, data[field])
    db.commit()
    db.refresh(master)
    return master


# ============================================================
# 构型项 Revision CRUD
# ============================================================

def get_config_item_revision(db: Session, revision_id: UUID) -> Optional[models.ConfigurationItemRevision]:
    """按版本 ID 查询（排除软删除）"""
    return (
        db.query(models.ConfigurationItemRevision)
        .filter(
            models.ConfigurationItemRevision.id == revision_id,
            models.ConfigurationItemRevision.deleted_at.is_(None),
        )
        .first()
    )


def get_config_item_revision_with_iteration(
    db: Session, revision_id: UUID
) -> Optional[Tuple[models.ConfigurationItemRevision, Optional[models.ConfigurationItemIteration]]]:
    """获取版本 + 当前最新迭代"""
    revision = get_config_item_revision(db, revision_id)
    if not revision:
        return None
    iteration = _get_current_iteration(db, revision_id)
    return revision, iteration


def list_revisions_by_master(db: Session, master_id: UUID) -> List[models.ConfigurationItemRevision]:
    """获取某主数据下所有版本（按创建时间排序）"""
    return (
        db.query(models.ConfigurationItemRevision)
        .filter(
            models.ConfigurationItemRevision.master_id == master_id,
            models.ConfigurationItemRevision.deleted_at.is_(None),
        )
        .order_by(models.ConfigurationItemRevision.created_at)
        .all()
    )


def _get_iteration(db: Session, iteration_id: UUID) -> Optional[models.ConfigurationItemIteration]:
    """按迭代 ID 查询"""
    return db.query(models.ConfigurationItemIteration).filter(
        models.ConfigurationItemIteration.id == iteration_id
    ).first()


# ============================================================
# 列表查询（聚合到 master 层）
# ============================================================

def get_config_items(
    db: Session, search: Optional[str] = None,
    skip: int = 0, limit: int = 50,
    exclude_ids: set | None = None,
    include_deleted: bool = False,
    updated_since: Optional[float] = None,
    top_level: bool = False,
    status: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """构型项列表：按 master 聚合，返回每个 master 的最新 revision 摘要"""
    q = db.query(models.ConfigurationItemMaster)
    if not include_deleted:
        q = q.filter(models.ConfigurationItemMaster.deleted_at.is_(None))
    if exclude_ids:
        q = q.filter(models.ConfigurationItemMaster.id.notin_(exclude_ids))
    if top_level:
        # 仅顶层构型项：master.id 未作为任何存活父项的子项出现
        live_master_ids = db.query(models.ConfigurationItemMaster.id).filter(
            models.ConfigurationItemMaster.deleted_at.is_(None)
        )
        # 子项通过 parent_iteration_id 关联，需先找到所有迭代对应的 revision→master
        parented_rev_ids = (
            db.query(models.ConfigurationItemChild.child_revision_id)
            .join(
                models.ConfigurationItemIteration,
                models.ConfigurationItemIteration.id == models.ConfigurationItemChild.parent_iteration_id,
            )
            .join(
                models.ConfigurationItemRevision,
                models.ConfigurationItemRevision.id == models.ConfigurationItemIteration.revision_id,
            )
            .filter(models.ConfigurationItemRevision.deleted_at.is_(None))
        )
        parented_master_ids = db.query(models.ConfigurationItemRevision.master_id).filter(
            models.ConfigurationItemRevision.id.in_(parented_rev_ids)
        )
        q = q.filter(models.ConfigurationItemMaster.id.notin_(parented_master_ids))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationItemMaster.code.ilike(like),
            models.ConfigurationItemMaster.name.ilike(like),
        ))
    if updated_since:
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        q = q.filter(
            (models.ConfigurationItemMaster.updated_at >= since_dt) |
            (models.ConfigurationItemMaster.deleted_at >= since_dt)
        )
    total = q.count()
    masters = q.order_by(models.ConfigurationItemMaster.code).offset(skip).limit(limit).all()

    items = []
    from . import models as core_models
    for master in masters:
        revisions_query = (
            db.query(models.ConfigurationItemRevision)
            .filter(
                models.ConfigurationItemRevision.master_id == master.id,
                models.ConfigurationItemRevision.deleted_at.is_(None),
            )
            .order_by(models.ConfigurationItemRevision.created_at.desc())
        )
        if status:
            revisions_query = revisions_query.filter(models.ConfigurationItemRevision.status == status)
        revisions = revisions_query.all()

        for rev in revisions:
            checkout_user_name = None
            if rev.check_out_user_id:
                user = db.query(core_models.User).filter(
                    core_models.User.id == rev.check_out_user_id
                ).first()
                if user:
                    checkout_user_name = user.real_name

            items.append({
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "revision_id": str(rev.id),
                "version": rev.version,
                "status": rev.status,
                "check_out_user_id": str(rev.check_out_user_id) if rev.check_out_user_id else None,
                "check_out_user_name": checkout_user_name,
                "check_out_date": rev.check_out_date.isoformat() if rev.check_out_date else None,
                "latest_iteration": rev.latest_iteration,
                "creator_id": str(rev.creator_id) if rev.creator_id else None,
                "created_at": rev.created_at.isoformat() if rev.created_at else None,
                "updated_at": master.updated_at.isoformat() if master.updated_at else None,
            })
    return items, total


# ============================================================
# 创建构型项（Master + Revision A + Iteration 1，自动签出）
# ============================================================

def create_config_item(db: Session, data: dict, user_id: UUID) -> Tuple[models.ConfigurationItemMaster, models.ConfigurationItemRevision, models.ConfigurationItemIteration]:
    """创建构型项：同时创建 Master + Revision(A) + Iteration(1)，自动签出"""
    code = data["code"]

    # 预检：code 是否已被软删除的 master 占用 → 复活
    existing = db.query(models.ConfigurationItemMaster).filter(
        models.ConfigurationItemMaster.code == code,
        models.ConfigurationItemMaster.deleted_at.is_(None),
    ).first()
    if existing:
        has_rev = db.query(models.ConfigurationItemRevision).filter(
            models.ConfigurationItemRevision.master_id == existing.id,
            models.ConfigurationItemRevision.deleted_at.is_(None),
        ).count()
        if has_rev > 0:
            raise ValueError(f"构型号「{code}」已存在，请更换构型号")

    master = models.ConfigurationItemMaster(
        code=code,
        name=data["name"],
        creator_id=user_id,
    )
    db.add(master)
    db.flush()

    revision = models.ConfigurationItemRevision(
        master_id=master.id, version="A", status="draft",
        creator_id=user_id, latest_iteration=1,
        check_out_user_id=user_id,
        check_out_date=sqlfunc.now(),
    )
    db.add(revision)
    db.flush()

    iteration = models.ConfigurationItemIteration(
        revision_id=revision.id, iteration=1,
        version_name=master.name,
        document_links=[],
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    db.refresh(revision)
    db.refresh(iteration)
    return master, revision, iteration


def revive_config_item(
    db: Session, master: models.ConfigurationItemMaster, data: dict, user_id: UUID,
) -> Tuple[models.ConfigurationItemMaster, models.ConfigurationItemRevision, models.ConfigurationItemIteration]:
    """复活已软删除的构型项：撤销删除、以新数据覆盖基本字段，创建新版本 A + Iteration 1，自动签出"""
    master.deleted_at = None
    master.name = data.get("name", master.name)

    revision = models.ConfigurationItemRevision(
        master_id=master.id, version="A", status="draft",
        creator_id=user_id, latest_iteration=1,
        check_out_user_id=user_id,
        check_out_date=sqlfunc.now(),
    )
    db.add(revision)
    db.flush()

    iteration = models.ConfigurationItemIteration(
        revision_id=revision.id, iteration=1,
        version_name=master.name,
        document_links=[],
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    db.refresh(revision)
    db.refresh(iteration)
    return master, revision, iteration


# ============================================================
# 更新构型项（迭代层数据，需签出校验）
# ============================================================

def update_config_item_iteration(
    db: Session, iteration_id: UUID, data: dict,
) -> Optional[models.ConfigurationItemIteration]:
    """更新迭代层可编辑字段（version_spec / version_remark / version_name / document_links）"""
    iteration = _get_iteration(db, iteration_id)
    if not iteration:
        return None
    for field in ("version_name", "document_links"):
        if field in data and data[field] is not None:
            setattr(iteration, field, data[field])
    db.commit()
    db.refresh(iteration)
    return iteration


# ============================================================
# 删除（软删除 Revision）
# ============================================================

def delete_config_item_revision(db: Session, revision_id: UUID) -> bool:
    """软删除版本"""
    revision = get_config_item_revision(db, revision_id)
    if not revision:
        return False
    revision.deleted_at = sqlfunc.now()
    db.commit()
    return True


# ============================================================
# 签出
# ============================================================

def checkout_config_item(
    db: Session, revision_id: UUID, user_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """签出构型项：创建新迭代(+1)，复制上一迭代数据，设置签出锁"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.status not in ("draft", "frozen"):
        return None, f"当前状态 {rev.status} 不允许签出"
    if rev.check_out_user_id:
        return None, "该版本已被他人签出"

    current_iter = _get_current_iteration(db, revision_id)

    new_iter = models.ConfigurationItemIteration(
        revision_id=revision_id,
        iteration=rev.latest_iteration + 1,
        version_name=(current_iter.version_name if current_iter else ""),
        document_links=(current_iter.document_links if current_iter else []),
    )
    db.add(new_iter)
    db.flush()

    # 复制当前迭代的关联零部件到新迭代
    if current_iter:
        parts = (
            db.query(models.ConfigurationItemPart)
            .filter(models.ConfigurationItemPart.iteration_id == current_iter.id)
            .order_by(models.ConfigurationItemPart.sort_order)
            .all()
        )
        for p in parts:
            new_part = models.ConfigurationItemPart(
                iteration_id=new_iter.id,
                part_type=p.part_type,
                part_id=p.part_id,
                is_required=p.is_required,
                quantity=p.quantity,
                sort_order=p.sort_order,
            )
            db.add(new_part)

        # 复制当前迭代的子构型项关联到新迭代
        children = (
            db.query(models.ConfigurationItemChild)
            .filter(models.ConfigurationItemChild.parent_iteration_id == current_iter.id)
            .order_by(models.ConfigurationItemChild.sort_order)
            .all()
        )
        for c in children:
            new_child = models.ConfigurationItemChild(
                parent_iteration_id=new_iter.id,
                child_revision_id=c.child_revision_id,
                is_required=c.is_required,
                quantity=c.quantity,
                sort_order=c.sort_order,
            )
            db.add(new_child)

        # 复制自定义字段值（带 iteration_id，签出快照）
        crud_common._copy_iteration_custom_fields(db, current_iter.id, new_iter.id)

    rev.latest_iteration += 1
    rev.check_out_user_id = user_id
    rev.check_out_date = sqlfunc.now()
    db.commit()
    db.refresh(rev)
    return rev, None


# ============================================================
# 签入
# ============================================================

def checkin_config_item(
    db: Session, revision_id: UUID, user_id: UUID, note: Optional[str] = None,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """签入构型项：记录签入说明，清除签出锁"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(rev.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    iteration = _get_current_iteration(db, revision_id)
    if iteration:
        iteration.check_in_note = note

    rev.check_out_user_id = None
    rev.check_out_date = None
    db.commit()
    db.refresh(rev)
    return rev, None


# ============================================================
# 撤销签出
# ============================================================

def undocheckout_config_item(
    db: Session, revision_id: UUID, user_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """撤销签出：删除最新迭代，回退 latest_iteration，清除签出锁"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(rev.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能撤销签出"
    if rev.latest_iteration <= 1:
        return None, "至少需保留一个迭代"

    latest_iter = (
        db.query(models.ConfigurationItemIteration)
        .filter(
            models.ConfigurationItemIteration.revision_id == revision_id,
            models.ConfigurationItemIteration.iteration == rev.latest_iteration,
        )
        .first()
    )
    if latest_iter:
        # 删除迭代关联的零部件和子项引用
        db.query(models.ConfigurationItemPart).filter(
            models.ConfigurationItemPart.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        db.query(models.ConfigurationItemChild).filter(
            models.ConfigurationItemChild.parent_iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        # 清理自定义字段值
        from app.models import CustomFieldValue
        db.query(CustomFieldValue).filter(
            CustomFieldValue.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        db.delete(latest_iter)

    rev.latest_iteration -= 1
    rev.check_out_user_id = None
    rev.check_out_date = None
    db.commit()
    db.refresh(rev)
    return rev, None


# ============================================================
# 强制签入（管理员）
# ============================================================

def force_checkin_config_item(
    db: Session, revision_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.check_out_user_id is None:
        return None, "该版本未被签出"

    rev.check_out_user_id = None
    rev.check_out_date = None
    db.commit()
    db.refresh(rev)
    return rev, None


# ============================================================
# 升版
# ============================================================

def upgrade_config_item(
    db: Session, revision_id: UUID, user_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """升版：创建新版本（B/C/...），复制迭代数据，自动签出"""
    source_rev = get_config_item_revision(db, revision_id)
    if not source_rev:
        return None, "源版本不存在"
    if source_rev.status not in ("released", "obsolete"):
        return None, "仅已发布或已作废版本可升版"

    source_iter = _get_current_iteration(db, revision_id)

    new_version = _get_next_version(db, source_rev.master_id)
    new_rev = models.ConfigurationItemRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status="draft",
        latest_iteration=1,
        creator_id=user_id,
    )
    db.add(new_rev)
    db.flush()

    new_iter = models.ConfigurationItemIteration(
        revision_id=new_rev.id,
        iteration=1,
        version_name=(source_iter.version_name if source_iter else ""),
        document_links=(source_iter.document_links if source_iter else []),
    )
    db.add(new_iter)
    db.flush()

    # 复制源迭代的关联零部件
    if source_iter:
        parts = (
            db.query(models.ConfigurationItemPart)
            .filter(models.ConfigurationItemPart.iteration_id == source_iter.id)
            .order_by(models.ConfigurationItemPart.sort_order)
            .all()
        )
        for p in parts:
            new_part = models.ConfigurationItemPart(
                iteration_id=new_iter.id,
                part_type=p.part_type,
                part_id=p.part_id,
                is_required=p.is_required,
                quantity=p.quantity,
                sort_order=p.sort_order,
            )
            db.add(new_part)

        # 复制源迭代的子构型项关联
        children = (
            db.query(models.ConfigurationItemChild)
            .filter(models.ConfigurationItemChild.parent_iteration_id == source_iter.id)
            .order_by(models.ConfigurationItemChild.sort_order)
            .all()
        )
        for c in children:
            new_child = models.ConfigurationItemChild(
                parent_iteration_id=new_iter.id,
                child_revision_id=c.child_revision_id,
                is_required=c.is_required,
                quantity=c.quantity,
                sort_order=c.sort_order,
            )
            db.add(new_child)

    new_rev.check_out_user_id = user_id
    new_rev.check_out_date = sqlfunc.now()
    db.commit()
    db.refresh(new_rev)
    return new_rev, None


# ============================================================
# 状态变更
# ============================================================

def freeze_config_item(
    db: Session, revision_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """冻结构型项版本：draft → frozen"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.status != "draft":
        return None, "仅草稿状态可冻结"
    if rev.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再冻结"
    rev.status = "frozen"
    db.commit()
    db.refresh(rev)
    return rev, None


def release_config_item(
    db: Session, revision_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """发布构型项版本：draft / frozen → released"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.status not in ("draft", "frozen"):
        return None, "仅草稿或冻结状态可发布"
    if rev.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再发布"
    rev.status = "released"
    db.commit()
    db.refresh(rev)
    return rev, None


def obsolete_config_item(
    db: Session, revision_id: UUID,
) -> Tuple[Optional[models.ConfigurationItemRevision], Optional[str]]:
    """作废构型项版本：released / frozen → obsolete"""
    rev = get_config_item_revision(db, revision_id)
    if not rev:
        return None, "版本不存在"
    if rev.status not in ("released", "frozen"):
        return None, "仅已发布或冻结状态可作废"
    rev.status = "obsolete"
    db.commit()
    db.refresh(rev)
    return rev, None


# ============================================================
# 向后兼容别名（Task 3 完成后移除）
# ============================================================

def get_config_item(db: Session, config_id: str) -> Optional[models.ConfigurationItemRevision]:
    """向后兼容：按 revision_id 获取版本"""
    return get_config_item_revision(db, UUID(config_id) if isinstance(config_id, str) else config_id)


def get_config_item_by_code(db: Session, code: str) -> Optional[models.ConfigurationItemMaster]:
    """向后兼容：按 code 获取 master"""
    return get_config_item_master_by_code(db, code)


# ============================================================
# 关联零部件 CRUD（基于 iteration_id）
# ============================================================

def get_iteration_parts(db: Session, iteration_id: UUID) -> List[models.ConfigurationItemPart]:
    """获取某迭代关联的全部零部件"""
    return (
        db.query(models.ConfigurationItemPart)
        .filter(models.ConfigurationItemPart.iteration_id == iteration_id)
        .order_by(models.ConfigurationItemPart.sort_order)
        .all()
    )


def add_part_to_iteration(
    db: Session, iteration_id: UUID, part_type: str, part_id: UUID,
    is_required: bool = True, quantity: int = 1, sort_order: int = 0,
) -> models.ConfigurationItemPart:
    """向迭代添加关联零部件"""
    part = models.ConfigurationItemPart(
        iteration_id=iteration_id,
        part_type=part_type,
        part_id=part_id,
        is_required=is_required,
        quantity=quantity,
        sort_order=sort_order,
    )
    db.add(part)
    db.commit()
    db.refresh(part)
    return part


def update_config_part(
    db: Session, part_id: UUID, data: dict,
) -> Optional[models.ConfigurationItemPart]:
    """更新关联零部件字段"""
    part = db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.id == part_id
    ).first()
    if not part:
        return None
    for k, v in data.items():
        if v is not None:
            setattr(part, k, v)
    db.commit()
    db.refresh(part)
    return part


def remove_part_from_iteration(db: Session, link_id: UUID) -> bool:
    """从迭代中移除关联零部件"""
    part = db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.id == link_id
    ).first()
    if not part:
        return False
    db.delete(part)
    db.commit()
    return True


# 向后兼容别名
def get_config_parts(db: Session, config_id: str) -> List[models.ConfigurationItemPart]:
    """向后兼容：config_id 实际为 iteration_id"""
    return get_iteration_parts(db, UUID(config_id) if isinstance(config_id, str) else config_id)


def add_config_parts(
    db: Session, config_id: str, items: List[schemas.ConfigPartCreate],
) -> List[models.ConfigurationItemPart]:
    """向后兼容：config_id 实际为 iteration_id"""
    iteration_id = UUID(config_id) if isinstance(config_id, str) else config_id
    parts = []
    for it in items:
        part = models.ConfigurationItemPart(
            iteration_id=iteration_id,
            part_type=it.part_type,
            part_id=it.part_id,
            is_required=it.is_required,
            quantity=it.quantity,
            sort_order=it.sort_order,
        )
        db.add(part)
        parts.append(part)
    db.commit()
    for p in parts:
        db.refresh(p)
    return parts


def remove_config_part(db: Session, part_id: str) -> bool:
    """向后兼容"""
    return remove_part_from_iteration(db, UUID(part_id) if isinstance(part_id, str) else part_id)


# ============================================================
# 子构型项 CRUD（基于 iteration_id + revision_id）
# ============================================================

def get_iteration_children(db: Session, iteration_id: UUID) -> List[models.ConfigurationItemChild]:
    """获取某迭代下全部子构型项"""
    return (
        db.query(models.ConfigurationItemChild)
        .filter(models.ConfigurationItemChild.parent_iteration_id == iteration_id)
        .order_by(models.ConfigurationItemChild.sort_order)
        .all()
    )


def add_child_to_iteration(
    db: Session, parent_iteration_id: UUID, child_revision_id: UUID,
    is_required: bool = True, quantity: int = 1, sort_order: int = 0,
) -> models.ConfigurationItemChild:
    """向迭代添加子构型项"""
    child = models.ConfigurationItemChild(
        parent_iteration_id=parent_iteration_id,
        child_revision_id=child_revision_id,
        is_required=is_required,
        quantity=quantity,
        sort_order=sort_order,
    )
    db.add(child)
    db.commit()
    db.refresh(child)
    return child


def update_config_child(
    db: Session, child_id: UUID, data: dict,
) -> Optional[models.ConfigurationItemChild]:
    """更新子构型项字段"""
    child = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.id == child_id
    ).first()
    if not child:
        return None
    for k, v in data.items():
        if v is not None:
            setattr(child, k, v)
    db.commit()
    db.refresh(child)
    return child


def remove_child_from_iteration(db: Session, link_id: UUID) -> bool:
    """从迭代中移除子构型项"""
    child = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.id == link_id
    ).first()
    if not child:
        return False
    db.delete(child)
    db.commit()
    return True


# 向后兼容别名
def get_config_children(db: Session, config_id: str) -> List[models.ConfigurationItemChild]:
    """向后兼容：config_id 实际为 iteration_id"""
    return get_iteration_children(db, UUID(config_id) if isinstance(config_id, str) else config_id)


def add_config_children(
    db: Session, parent_id: str, items: List[schemas.ConfigChildCreate],
) -> List[models.ConfigurationItemChild]:
    """向后兼容：parent_id 实际为 iteration_id"""
    parent_iteration_id = UUID(parent_id) if isinstance(parent_id, str) else parent_id
    children = []
    for it in items:
        child = models.ConfigurationItemChild(
            parent_iteration_id=parent_iteration_id,
            child_revision_id=it.child_revision_id,
            is_required=it.is_required,
            quantity=it.quantity,
            sort_order=it.sort_order,
        )
        db.add(child)
        children.append(child)
    db.commit()
    for c in children:
        db.refresh(c)
    return children


def remove_config_child(db: Session, child_id: str) -> bool:
    """向后兼容"""
    return remove_child_from_iteration(db, UUID(child_id) if isinstance(child_id, str) else child_id)


# ============================================================
# 迭代文档链接操作（JSONB document_links）
# ============================================================

def add_document_to_iteration(
    db: Session, iteration_id: UUID, document_id: str, document_name: str = "",
) -> Optional[models.ConfigurationItemIteration]:
    """向迭代的 document_links JSONB 数组中追加文档引用"""
    from sqlalchemy.orm.attributes import flag_modified
    iteration = _get_iteration(db, iteration_id)
    if not iteration:
        return None
    links = list(iteration.document_links or [])
    if not any(l.get("document_id") == document_id for l in links):
        links.append({"document_id": document_id, "document_name": document_name})
        iteration.document_links = links
        flag_modified(iteration, "document_links")
        db.commit()
        db.refresh(iteration)
    return iteration


def remove_document_from_iteration(
    db: Session, iteration_id: UUID, document_id: str,
) -> Optional[models.ConfigurationItemIteration]:
    """从迭代的 document_links JSONB 数组中移除文档引用"""
    from sqlalchemy.orm.attributes import flag_modified
    iteration = _get_iteration(db, iteration_id)
    if not iteration:
        return None
    links = list(iteration.document_links or [])
    iteration.document_links = [l for l in links if l.get("document_id") != document_id]
    flag_modified(iteration, "document_links")
    db.commit()
    db.refresh(iteration)
    return iteration


# ============================================================
# 构型配置 (Configuration Profile) CRUD
# ============================================================

def _generate_checklist(db: Session, profile_id: str, revision_id: str, source_type: str = "direct"):
    """递归展开构型项（基于 revision→iteration），生成配置清单 → 写入工作表"""
    from app.models_parts import PartMaster

    rev_id = UUID(revision_id) if isinstance(revision_id, str) else revision_id
    rev = get_config_item_revision(db, rev_id)
    if not rev:
        return

    current_iter = _get_current_iteration(db, rev_id)
    if not current_iter:
        return

    # 关联零部件
    parts = db.query(models.ConfigurationItemPart).filter(
        models.ConfigurationItemPart.iteration_id == current_iter.id
    ).order_by(models.ConfigurationItemPart.sort_order).all()

    for p in parts:
        item_code = None
        item_name = None
        entity = db.query(PartMaster).filter(PartMaster.id == p.part_id).first()
        if entity:
            item_code = entity.code
            item_name = entity.name

        item = models.ConfigurationWorkingItem(
            profile_id=UUID(profile_id) if isinstance(profile_id, str) else profile_id,
            source_config_item_revision_id=rev_id,
            source_config_item_iteration_id=current_iter.id,
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

    # 子构型项
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_iteration_id == current_iter.id
    ).order_by(models.ConfigurationItemChild.sort_order).all()

    for child in children:
        _generate_checklist(db, profile_id, str(child.child_revision_id), source_type="child")


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
        configuration_item_revision_id=data.configuration_item_revision_id,
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

    if data.configuration_item_revision_id:
        _generate_checklist(db, str(profile.id), str(data.configuration_item_revision_id))
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
    new_cfg_id = str(data.configuration_item_revision_id) if data.configuration_item_revision_id else None
    old_cfg_id = str(profile.configuration_item_revision_id) if profile.configuration_item_revision_id else None
    if new_cfg_id != old_cfg_id:
        db.query(models.ConfigurationWorkingItem).filter(
            models.ConfigurationWorkingItem.profile_id == profile_id
        ).delete()
        db.query(models.ConfigurationProfileItem).filter(
            models.ConfigurationProfileItem.profile_id == profile_id
        ).delete()
        profile.configuration_item_revision_id = data.configuration_item_revision_id
        if data.configuration_item_revision_id:
            _generate_checklist(db, profile_id, str(data.configuration_item_revision_id))

    # 更新其他字段
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("configuration_item_revision_id", None)
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
                source_config_item_revision_id=wi.source_config_item_revision_id,
                source_config_item_iteration_id=wi.source_config_item_iteration_id,
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
    if not profile.configuration_item_revision_id:
        return None

    # 清除旧工作表
    db.query(models.ConfigurationWorkingItem).filter(
        models.ConfigurationWorkingItem.profile_id == profile_id
    ).delete()
    # 重新生成到工作表
    _generate_checklist(db, profile_id, str(profile.configuration_item_revision_id))
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
    if profile.status == "active":
        _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (profile.cc_users or []))
        _notif.create_notifications(
            db, recipient_ids=[profile.creator_id, *_cc_ids], sender_id=None,
            event_type="profile_approved", title=f"配置概要 {profile.code} 审批通过",
            body=None, target_type="configuration_profile", target_id=profile.id, exclude_sender=True,
        )
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

    # 站内通知：配置概要归档
    _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (profile.cc_users or []))
    _notif.create_notifications(
        db, recipient_ids=[profile.creator_id, *_cc_ids], sender_id=user.id,
        event_type="profile_archived", title=f"配置概要 {profile.code} 已归档",
        body=(comment or None), target_type="configuration_profile", target_id=profile.id,
        exclude_sender=True,
    )

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

    # 站内通知：审批结果（根据最终状态决定通知类型）
    _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (profile.cc_users or []))
    if profile.status == "active":
        _notif.create_notifications(
            db, recipient_ids=[profile.creator_id, *_cc_ids], sender_id=reviewer.id,
            event_type="profile_approved", title=f"配置概要 {profile.code} 审批通过",
            body=(comment or None), target_type="configuration_profile", target_id=profile.id,
            exclude_sender=True,
        )
    elif profile.status == "rejected":
        _notif.create_notifications(
            db, recipient_ids=[profile.creator_id, *_cc_ids], sender_id=reviewer.id,
            event_type="profile_rejected", title=f"配置概要 {profile.code} 审批驳回",
            body=(comment or None), target_type="configuration_profile", target_id=profile.id,
            exclude_sender=True,
        )

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
    if profile.status == "active":
        _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (profile.cc_users or []))
        _notif.create_notifications(
            db, recipient_ids=[profile.creator_id, *_cc_ids], sender_id=user.id,
            event_type="profile_approved", title=f"配置概要 {profile.code} 审批通过",
            body=None, target_type="configuration_profile", target_id=profile.id, exclude_sender=True,
        )
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
def list_config_item_iterations(db: Session, revision_id):
    """列出某版本的所有迭代"""
    return (
        db.query(models.ConfigurationItemIteration)
        .filter(models.ConfigurationItemIteration.revision_id == revision_id)
        .order_by(models.ConfigurationItemIteration.iteration.desc())
        .all()
    )


def get_config_item_iteration_detail(db: Session, iteration_id):
    """获取指定迭代详情"""
    return db.query(models.ConfigurationItemIteration).filter(
        models.ConfigurationItemIteration.id == iteration_id
    ).first()
