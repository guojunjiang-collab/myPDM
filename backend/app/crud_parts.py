"""零部件签入检出 CRUD 操作"""
from __future__ import annotations
from typing import Optional, List, Tuple, Any, Dict
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from fastapi import HTTPException

from . import models, models_parts
from .cad import matrix_utils as _mu
from .database import SessionLocal


# ====== 版本号工具 ======

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
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.master_id == master_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .count()
    )
    return _to_version_string(count)


# ====== PartMaster CRUD ======

def create_part_master(db: Session, data: dict, user_id: UUID) -> models_parts.PartMaster:
    """创建零件主数据，同时自动创建 Revision=A、Iteration=1。
    如果件号已存在但无版本（孤儿数据），则复用该主数据并补建版本。
    """
    code = data["code"]
    # 预检：件号是否已存在（排除已软删除的）
    existing = db.query(models_parts.PartMaster).filter(
        models_parts.PartMaster.code == code,
        models_parts.PartMaster.deleted_at.is_(None),
    ).first()
    if existing:
        # 如果已有有效版本，报错
        has_rev = db.query(models_parts.PartRevision).filter(
            models_parts.PartRevision.master_id == existing.id,
            models_parts.PartRevision.deleted_at.is_(None),
        ).count()
        if has_rev > 0:
            raise ValueError(f"件号「{code}」已存在，请更换件号")
        # 孤儿数据：复用并更新名称/规格
        existing.name = data["name"]
        if data.get("spec"):
            existing.spec = data["spec"]
        master = existing
    else:
        master = models_parts.PartMaster(
            code=code,
            name=data["name"],
            spec=data.get("spec"),
            creator_id=user_id,
        )
        db.add(master)
        db.flush()

    revision = models_parts.PartRevision(
        master_id=master.id,
        version="A",
        status="draft",
        latest_iteration=1,
        creator_id=user_id,
        check_out_user_id=user_id,
        check_out_date=datetime.now(timezone.utc),
    )
    db.add(revision)
    db.flush()

    iteration = models_parts.PartIteration(
        revision_id=revision.id,
        iteration=1,
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    return master


def get_part_master(db: Session, master_id: UUID) -> Optional[models_parts.PartMaster]:
    return (
        db.query(models_parts.PartMaster)
        .filter(
            models_parts.PartMaster.id == master_id,
            models_parts.PartMaster.deleted_at.is_(None),
        )
        .first()
    )


def list_part_masters(
    db: Session,
    search: Optional[str] = None,
    status: Optional[str] = None,
    check_out_user_id: Optional[UUID] = None,
    show_all_versions: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict], int]:
    """查询零件列表（含最新版本摘要），返回 (items, total)"""
    query = (
        db.query(models_parts.PartMaster)
        .filter(models_parts.PartMaster.deleted_at.is_(None))
    )
    if search:
        query = query.filter(
            models_parts.PartMaster.code.ilike(f"%{search}%")
            | models_parts.PartMaster.name.ilike(f"%{search}%")
        )

    total = query.count()
    masters = query.offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for master in masters:
        revisions_query = (
            db.query(models_parts.PartRevision)
            .filter(
                models_parts.PartRevision.master_id == master.id,
                models_parts.PartRevision.deleted_at.is_(None),
            )
            .order_by(models_parts.PartRevision.created_at.desc())
        )
        if status:
            revisions_query = revisions_query.filter(models_parts.PartRevision.status == status)
        if check_out_user_id:
            revisions_query = revisions_query.filter(
                models_parts.PartRevision.check_out_user_id == check_out_user_id
            )

        revisions = revisions_query.all()
        for rev in revisions:
            if not show_all_versions and rev != revisions[0]:
                break
            checkout_user_name = None
            if rev.check_out_user_id:
                user = db.query(models.User).filter(models.User.id == rev.check_out_user_id).first()
                if user:
                    checkout_user_name = user.real_name
            child_count = (
                db.query(models.BOMItem)
                .filter(
                    models.BOMItem.parent_revision_id == rev.id,
                    models.BOMItem.deleted_at.is_(None),
                )
                .count()
            )
            item_type = "assembly" if child_count > 0 else "part"
            items.append(
                {
                    "master_id": master.id,
                    "code": master.code,
                    "name": master.name,
                    "spec": master.spec,
                    "type": item_type,
                    "revision_id": rev.id,
                    "version": rev.version,
                    "status": rev.status,
                    "check_out_user_id": rev.check_out_user_id,
                    "check_out_user_name": checkout_user_name,
                    "check_out_date": rev.check_out_date,
                    "latest_iteration": rev.latest_iteration,
                    "created_at": rev.created_at,
                }
            )
    return items, total


def update_part_master(db: Session, master_id: UUID, data: dict) -> Optional[models_parts.PartMaster]:
    master = get_part_master(db, master_id)
    if not master:
        return None
    for field in ("code", "name", "spec"):
        if field in data and data[field] is not None:
            setattr(master, field, data[field])
    db.commit()
    db.refresh(master)
    return master


def delete_part_master(db: Session, master_id: UUID) -> bool:
    """软删除主数据（级联软删除所有版本和迭代）"""
    master = get_part_master(db, master_id)
    if not master:
        return False
    master.deleted_at = datetime.now(timezone.utc)
    db.query(models_parts.PartRevision).filter(
        models_parts.PartRevision.master_id == master_id
    ).update({"deleted_at": datetime.now(timezone.utc)})
    db.commit()
    return True


# ====== PartRevision CRUD ======

def get_part_revision(db: Session, revision_id: UUID) -> Optional[models_parts.PartRevision]:
    return (
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.id == revision_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .first()
    )


def get_part_revision_with_current_iteration(
    db: Session, revision_id: UUID
) -> Optional[Tuple[models_parts.PartRevision, Optional[models_parts.PartIteration]]]:
    """获取版本 + 当前最新迭代"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None
    iteration = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    return revision, iteration


def list_revisions_by_master(db: Session, master_id: UUID) -> List[models_parts.PartRevision]:
    return (
        db.query(models_parts.PartRevision)
        .filter(
            models_parts.PartRevision.master_id == master_id,
            models_parts.PartRevision.deleted_at.is_(None),
        )
        .order_by(models_parts.PartRevision.created_at)
        .all()
    )


# ====== PartIteration CRUD ======

def get_part_iteration(db: Session, iteration_id: UUID) -> Optional[models_parts.PartIteration]:
    return db.query(models_parts.PartIteration).filter(
        models_parts.PartIteration.id == iteration_id
    ).first()


def list_iterations_by_revision(db: Session, revision_id: UUID) -> List[models_parts.PartIteration]:
    return (
        db.query(models_parts.PartIteration)
        .filter(models_parts.PartIteration.revision_id == revision_id)
        .order_by(models_parts.PartIteration.iteration.desc())
        .all()
    )


# ====== 迭代数据复制工具 ======

def _copy_iteration_data(db: Session, source_iter: models_parts.PartIteration, new_iter: models_parts.PartIteration):
    """复制上一迭代的全部数据到新迭代"""
    import os, shutil
    new_iter.document_links = source_iter.document_links or []
    new_iter.remark = source_iter.remark
    db.flush()

    # 复制附件引用，并复制文件到新迭代目录
    for att in source_iter.attachments:
        new_file_path = None
        if att.file_path:
            revision = db.query(models_parts.PartRevision).filter(
                models_parts.PartRevision.id == new_iter.revision_id
            ).first()
            if revision:
                master = db.query(models_parts.PartMaster).filter(
                    models_parts.PartMaster.id == revision.master_id
                ).first()
                if master:
                    dest_dir = os.path.join("uploads", "parts", master.code, revision.version, str(new_iter.iteration))
                    os.makedirs(dest_dir, exist_ok=True)
                    dest_path = os.path.join(dest_dir, att.file_name)
                    try:
                        shutil.copy2(att.file_path, dest_path)
                        new_file_path = dest_path
                    except Exception:
                        pass

        new_att = models_parts.PartAttachment(
            iteration_id=new_iter.id,
            category=att.category,
            file_name=att.file_name,
            file_size=att.file_size,
            file_path=new_file_path or att.file_path,
            file_hash=att.file_hash,
        )
        db.add(new_att)

    bom_rows = (
        db.query(models.BOMItem)
        .filter(
            models.BOMItem.iteration_id == source_iter.id,
            models.BOMItem.deleted_at.is_(None),
        )
        .all()
    )
    for bom in bom_rows:
        new_bom = models.BOMItem(
            iteration_id=new_iter.id,
            parent_revision_id=bom.parent_revision_id,
            child_revision_id=bom.child_revision_id,
            quantity=bom.quantity,
            sort_order=bom.sort_order,
        )
        db.add(new_bom)


# ====== 签出 ======

def checkout_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """签出零件：创建新迭代，加锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft",):
        return None, "仅草稿状态可签出"
    if revision.check_out_user_id is not None:
        return None, "该版本已被他人签出"

    prev_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )

    new_iteration_num = revision.latest_iteration + 1
    new_iter = models_parts.PartIteration(
        revision_id=revision_id,
        iteration=new_iteration_num,
    )
    db.add(new_iter)
    db.flush()

    if prev_iter:
        _copy_iteration_data(db, prev_iter, new_iter)
        # 复制自定义字段值到新迭代
        from . import crud as crud_common
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id)

    revision.latest_iteration = new_iteration_num
    revision.check_out_user_id = user_id
    revision.check_out_date = datetime.now(timezone.utc)

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 签入 ======

def checkin_part(db: Session, revision_id: UUID, user_id: UUID, note: Optional[str] = None) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """签入零件：记录签入信息，解锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    iteration = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if iteration:
        iteration.check_in_date = datetime.now(timezone.utc)
        iteration.check_in_note = note

    revision.check_out_user_id = None
    revision.check_out_date = None

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 撤销签出 ======

def undocheckout_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """撤销签出：删除最新迭代，解锁"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能撤销签出"
    if revision.latest_iteration <= 1:
        return None, "至少需保留一个迭代"

    latest_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if latest_iter:
        # 签出时 _copy_iteration_data 复制了附件和 BOMItem 到新迭代，
        # 删迭代前必须先清理这些引用行（外键 NOT NULL 无 CASCADE）。
        db.query(models_parts.PartAttachment).filter(
            models_parts.PartAttachment.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        db.query(models.BOMItem).filter(
            models.BOMItem.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        # 签出复制的自定义字段值也要清理
        db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.iteration_id == latest_iter.id
        ).delete(synchronize_session=False)
        db.delete(latest_iter)

    revision.latest_iteration -= 1
    revision.check_out_user_id = None
    revision.check_out_date = None

    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 强制签入（管理员） ======

def force_checkin_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 状态变更 ======

def release_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """发布版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft", "frozen"):
        return None, "仅草稿或冻结状态可发布"
    if revision.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再发布"
    revision.status = "released"
    db.commit()
    db.refresh(revision)
    return revision, None


def freeze_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """冻结版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "draft":
        return None, "仅草稿状态可冻结"
    revision.status = "frozen"
    db.commit()
    db.refresh(revision)
    return revision, None


def unfreeze_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """解冻版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "frozen":
        return None, "仅冻结状态可解冻"
    revision.status = "draft"
    db.commit()
    db.refresh(revision)
    return revision, None


def obsolete_part(db: Session, revision_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """作废版本"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "released":
        return None, "仅已发布状态可作废"
    revision.status = "obsolete"
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 升版 ======

def upgrade_part(db: Session, revision_id: UUID, user_id: UUID) -> Tuple[Optional[models_parts.PartRevision], Optional[str]]:
    """升版：创建新 Revision，自动签出"""
    source_rev = get_part_revision(db, revision_id)
    if not source_rev:
        return None, "源版本不存在"
    if source_rev.status not in ("released", "obsolete"):
        return None, "仅已发布或已作废版本可升版"

    source_iter = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == source_rev.latest_iteration,
        )
        .first()
    )

    new_version = _get_next_version(db, source_rev.master_id)
    new_rev = models_parts.PartRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status="draft",
        latest_iteration=1,
        revision_parent_id=source_rev.id,
        creator_id=user_id,
    )
    db.add(new_rev)
    db.flush()

    new_iter = models_parts.PartIteration(
        revision_id=new_rev.id,
        iteration=1,
    )
    db.add(new_iter)
    db.flush()

    if source_iter:
        _copy_iteration_data(db, source_iter, new_iter)

    new_rev.check_out_user_id = user_id
    new_rev.check_out_date = datetime.now(timezone.utc)

    db.commit()
    db.refresh(new_rev)
    return new_rev, None


# ====== 级联操作 ======

def cascade_checkout(db: Session, revision_id: UUID, user_id: UUID) -> Dict[str, Any]:
    """级联签出：递归签出 BOM 树下所有子孙版本"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_child_revisions(rev_id: UUID, visited: set) -> List[models_parts.PartRevision]:
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if child_rev and child_rev.id not in visited:
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_child_revisions(child_rev.id, visited))
        return children

    _, err = checkout_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    visited = {revision_id}
    child_revisions = _collect_child_revisions(revision_id, visited)
    for child_rev in child_revisions:
        _, err = checkout_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


def cascade_checkin(db: Session, revision_id: UUID, user_id: UUID) -> Dict[str, Any]:
    """级联签入"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_checked_out_children(rev_id: UUID, user_uid: UUID, visited: set) -> List[models_parts.PartRevision]:
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if (
                child_rev
                and child_rev.id not in visited
                and child_rev.check_out_user_id is not None
                and str(child_rev.check_out_user_id) == str(user_uid)
            ):
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_checked_out_children(child_rev.id, user_uid, visited))
        return children

    _, err = checkin_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    visited = {revision_id}
    child_revisions = _collect_checked_out_children(revision_id, user_id, visited)
    for child_rev in child_revisions:
        _, err = checkin_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


def cascade_undocheckout(db: Session, revision_id: UUID, user_id: UUID) -> Dict[str, Any]:
    """级联撤销签出"""
    result = {"succeed_count": 0, "failed_count": 0, "failed_items": []}

    def _collect_checked_out_children(rev_id: UUID, user_uid: UUID, visited: set) -> List[models_parts.PartRevision]:
        children = []
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rev_id,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            child_rev = get_part_revision(db, bom.child_revision_id)
            if (
                child_rev
                and child_rev.id not in visited
                and child_rev.check_out_user_id is not None
                and str(child_rev.check_out_user_id) == str(user_uid)
            ):
                visited.add(child_rev.id)
                children.append(child_rev)
                children.extend(_collect_checked_out_children(child_rev.id, user_uid, visited))
        return children

    _, err = undocheckout_part(db, revision_id, user_id)
    if err:
        result["failed_items"].append({"revision_id": str(revision_id), "reason": err})
        result["failed_count"] += 1
    else:
        result["succeed_count"] += 1

    visited = {revision_id}
    child_revisions = _collect_checked_out_children(revision_id, user_id, visited)
    for child_rev in child_revisions:
        _, err = undocheckout_part(db, child_rev.id, user_id)
        if err:
            result["failed_items"].append(
                {"revision_id": str(child_rev.id), "version": child_rev.version, "reason": err}
            )
            result["failed_count"] += 1
        else:
            result["succeed_count"] += 1

    return result


# ====== BOM 操作 ======

def get_bom_tree(db: Session, revision_id: UUID) -> List[Dict]:
    """获取版本的 BOM 树（当前迭代的 BOM 关系）"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return []

    bom_items = (
        db.query(models.BOMItem)
        .filter(
            models.BOMItem.iteration_id == (
                db.query(models_parts.PartIteration.id)
                .filter(
                    models_parts.PartIteration.revision_id == revision_id,
                    models_parts.PartIteration.iteration == revision.latest_iteration,
                )
                .scalar_subquery()
            ),
            models.BOMItem.deleted_at.is_(None),
        )
        .all()
    )

    result = []
    for item in bom_items:
        child_rev = get_part_revision(db, item.child_revision_id)
        if child_rev:
            master = get_part_master(db, child_rev.master_id)
            result.append(
                {
                    "id": str(item.id),
                    "child_revision_id": str(item.child_revision_id),
                    "child_master_id": str(child_rev.master_id) if child_rev else "",
                    "child_code": master.code if master else "",
                    "child_name": master.name if master else "",
                    "child_version": child_rev.version,
                    "child_status": child_rev.status,
                    "child_check_out_user_id": str(child_rev.check_out_user_id) if child_rev.check_out_user_id else None,
                    "child_check_out_user_name": (
                        db.query(models.User).filter(models.User.id == child_rev.check_out_user_id).first().real_name
                        if child_rev.check_out_user_id else None
                    ),
                    "child_type": "assembly" if (
                        db.query(models.BOMItem)
                        .filter(
                            models.BOMItem.parent_revision_id == child_rev.id,
                            models.BOMItem.deleted_at.is_(None),
                        )
                        .count() > 0
                    ) else "part",
                    "has_children": (
                        db.query(models.BOMItem)
                        .filter(
                            models.BOMItem.parent_revision_id == child_rev.id,
                            models.BOMItem.deleted_at.is_(None),
                        )
                        .count() > 0
                    ),
                    "quantity": item.quantity,
                    "sort_order": item.sort_order,
                    "cad_instances": item.cad_instances or [],
                }
            )
    return result


def add_bom_item(db: Session, revision_id: UUID, data: dict) -> Tuple[Optional[models.BOMItem], Optional[str]]:
    """在当前迭代中添加 BOM 子项"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"

    iteration = (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if not iteration:
        return None, "当前迭代不存在"

    item = models.BOMItem(
        iteration_id=iteration.id,
        parent_revision_id=revision_id,
        child_revision_id=data["child_revision_id"],
        quantity=data.get("quantity", 1),
        sort_order=data.get("sort_order", 0),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item, None


def update_bom_item(db: Session, item_id: UUID, data: dict) -> Tuple[Optional[models.BOMItem], Optional[str]]:
    """更新 BOM 子项"""
    item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id, models.BOMItem.deleted_at.is_(None)).first()
    if not item:
        return None, "BOM项不存在"
    for field in ("quantity", "sort_order", "child_revision_id"):
        if field in data and data[field] is not None:
            setattr(item, field, data[field])
    db.commit()
    db.refresh(item)
    return item, None


def delete_bom_item(db: Session, item_id: UUID) -> bool:
    """软删除 BOM 子项"""
    item = db.query(models.BOMItem).filter(models.BOMItem.id == item_id, models.BOMItem.deleted_at.is_(None)).first()
    if not item:
        return False
    item.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return True


# ====== CAD 矩阵匹配与展平 ======

def _current_iteration(db: Session, revision_id):
    """获取版本的最新迭代"""
    revision = get_part_revision(db, revision_id)
    if not revision:
        return None
    return (
        db.query(models_parts.PartIteration)
        .filter(
            models_parts.PartIteration.revision_id == revision_id,
            models_parts.PartIteration.iteration == revision.latest_iteration,
        )
        .first()
    )


def apply_step_matrices(db: Session, assembly_revision_id, parsed: dict) -> dict:
    """多层级：按 (父件号, 子件号) 匹配 BOM 树任意层级的 BOMItem 并回填矩阵。始终写。"""
    from sqlalchemy.orm.attributes import flag_modified

    # 递归收集 BOM 树全部 BOMItem，建 (parent_code, child_code) -> BOMItem 索引
    index = {}
    all_items = []

    def walk(rev_id, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        it = _current_iteration(db, rev_id)
        if not it:
            return
        parent_rev = get_part_revision(db, rev_id)
        parent_master = get_part_master(db, parent_rev.master_id) if parent_rev else None
        links = (db.query(models.BOMItem)
                 .filter(models.BOMItem.iteration_id == it.id,
                         models.BOMItem.deleted_at.is_(None)).all())
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            child_master = get_part_master(db, child_rev.master_id)
            if parent_master and child_master:
                index.setdefault((parent_master.code, child_master.code), link)
                index.setdefault((parent_master.name, child_master.name), link)
            all_items.append(link)
            walk(child_rev.id, visited)

    walk(assembly_revision_id, set())

    # STEP 顶层装配名可能与 myPDM 目标装配件号不一致（如 NX 导出为 "起落架-solidworks_step"）。
    # 顶层零件的父就是本次导入的目标装配，故识别 STEP 根名(只作父、从不作子)，匹配时改写为目标件号。
    root_rev = get_part_revision(db, assembly_revision_id)
    root_master = get_part_master(db, root_rev.master_id) if root_rev else None
    _occs = parsed.get("occurrences", [])
    _pnames = {o.get("parent_name") for o in _occs if o.get("parent_name")}
    _cnames = {o.get("name") for o in _occs}
    step_root_names = _pnames - _cnames

    # 幂等：先清各 BOMItem 里 source=='step' 的旧矩阵
    touched = set()
    for item in all_items:
        kept = [c for c in (item.cad_instances or []) if c.get("source") != "step"]
        if kept != (item.cad_instances or []):
            item.cad_instances = kept
            touched.add(item.id)

    matched, unmatched = [], []
    per_item_count = {}
    for occ in parsed.get("occurrences", []):
        cname = occ.get("name")
        pname = occ.get("parent_name")
        item = index.get((pname, cname)) if pname else None
        # 顶层子件：STEP 根名改写为目标装配件号/名称再匹配
        if not item and pname in step_root_names and root_master:
            item = index.get((root_master.code, cname)) or index.get((root_master.name, cname))
        if not item:
            unmatched.append(cname)
            continue
        norm = _mu.normalize_translation_mm_to_m(occ["local_matrix"])
        instances = list(item.cad_instances or [])
        instances.append({"matrix": norm, "source": "step", "label": cname})
        item.cad_instances = instances
        touched.add(item.id)
        matched.append(cname)
        per_item_count[item.id] = per_item_count.get(item.id, 0) + 1

    for item in all_items:
        if item.id in touched:
            flag_modified(item, "cad_instances")
    db.commit()

    multi_names = []
    for item in all_items:
        if per_item_count.get(item.id, 0) > 1:
            cr = get_part_revision(db, item.child_revision_id)
            m = get_part_master(db, cr.master_id) if cr else None
            if m:
                multi_names.append(m.code)

    return {"matched": matched, "unmatched": unmatched, "multi_instance": multi_names}


import os as _os_split
import hashlib as _hashlib_split

_uploads_root = "./uploads"


def _split_subitem_step_impl(index, root_pd, label):
    from .cad.step_splitter import split_subitem_step
    return split_subitem_step(index, root_pd, label)


def _trigger_glb(*args, **kwargs):
    """占位：本特性写入不转 GLB（预览时懒转）。保留以便测试断言不被调用。"""
    return None


def generate_subitem_steps(db: Session, assembly_revision_id, structure_index, current_user_id) -> dict:
    """遍历唯一子项，草稿+当前用户检出者拆出 件号.STEP 写生产附件(同名替换、不转GLB)。"""
    generated, skipped, unmatched, failed = [], [], [], []
    seen_rev = set()

    def walk(rev_id, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        it = _current_iteration(db, rev_id)
        if not it:
            return
        links = (db.query(models.BOMItem)
                 .filter(models.BOMItem.iteration_id == it.id,
                         models.BOMItem.deleted_at.is_(None)).all())
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev or child_rev.id in seen_rev:
                continue
            seen_rev.add(child_rev.id)
            _process(child_rev)
            walk(child_rev.id, visited)

    def _process(child_rev):
        master = get_part_master(db, child_rev.master_id)
        if not master:
            return
        code = master.code
        root_pd = getattr(structure_index, "root_pd_by_product_name", {}).get(code) \
            or getattr(structure_index, "root_pd_by_product_name", {}).get(master.name)
        if root_pd is None:
            unmatched.append(code)
            return
        # 门槛：草稿 且 当前用户已检出
        if not (child_rev.status == "draft"
                and str(child_rev.check_out_user_id or "") == str(current_user_id)):
            skipped.append(code)
            return
        child_it = _current_iteration(db, child_rev.id)
        if not child_it:
            skipped.append(code)
            return
        fname = f"{code}.STEP"
        try:
            text = _split_subitem_step_impl(structure_index, root_pd, fname)
        except Exception:
            failed.append(code)
            return
        # 同名替换：删旧记录 + 文件 + glb 缓存
        olds = (db.query(models_parts.PartAttachment)
                .filter(models_parts.PartAttachment.iteration_id == child_it.id,
                        models_parts.PartAttachment.category == "production",
                        models_parts.PartAttachment.file_name == fname).all())
        for old in olds:
            try:
                if old.file_path and _os_split.path.exists(old.file_path):
                    _os_split.remove(old.file_path)
            except OSError:
                pass
            try:
                from .stp_converter import delete_glb_cache
                delete_glb_cache(str(old.id), old.file_path)
            except Exception:
                pass
            db.delete(old)
        db.commit()
        # 写新文件
        upload_dir = f"{_uploads_root}/parts/{code}/{child_rev.version}/{child_it.iteration}"
        _os_split.makedirs(upload_dir, exist_ok=True)
        fpath = _os_split.path.join(upload_dir, fname)
        data = text.encode("utf-8")
        with open(fpath, "wb") as f:
            f.write(data)
        att = models_parts.PartAttachment(
            iteration_id=child_it.id, category="production", file_name=fname,
            file_size=len(data), file_path=fpath,
            file_hash=_hashlib_split.sha256(data).hexdigest(),
        )
        db.add(att); db.commit()
        # 不触发 GLB（预览时懒转）
        generated.append(code)

    walk(assembly_revision_id, set())
    return {"generated": generated, "skipped_not_editable": skipped,
            "unmatched": unmatched, "failed": failed}


def get_assembly_instances(db: Session, assembly_revision_id, glb_url_resolver) -> list:
    """递归展平装配 BOM 树，返回叶子实例清单（每个含世界矩阵）"""
    instances = []

    def children_of(rev_id, iteration_id):
        return (
            db.query(models.BOMItem)
            .filter(models.BOMItem.iteration_id == iteration_id,
                    models.BOMItem.deleted_at.is_(None))
            .all()
        )

    def walk(rev_id, world, path, bom_path, visited):
        if rev_id in visited:
            return
        visited = visited | {rev_id}
        iteration = _current_iteration(db, rev_id)
        child_links = children_of(rev_id, iteration.id) if iteration else []

        if not child_links:
            return

        for link in child_links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            master = get_part_master(db, child_rev.master_id)
            child_iter = _current_iteration(db, child_rev.id)
            grandchildren = children_of(child_rev.id, child_iter.id) if child_iter else []
            glb_urls = glb_url_resolver(child_rev.id)

            insts = link.cad_instances or [{"matrix": _mu.identity(), "source": "implicit", "label": ""}]
            for idx, ci in enumerate(insts):
                local = ci.get("matrix") or _mu.identity()
                child_world = _mu.multiply(world, local)
                child_path = path + [f"{link.id}:{idx}"]
                child_bom_path = bom_path + [f"{link.id}:{idx}" if len(insts) > 1 else str(link.id)]

                is_leaf = (not grandchildren) and glb_urls is not None
                if is_leaf:
                    instances.append({
                        "path": "/".join(child_path),
                        "bom_path": child_bom_path,
                        "part_code": master.code if master else "",
                        "revision_id": str(child_rev.id),
                        "glb_urls": glb_urls,
                        "matrix": child_world,
                        "bbox": None,
                    })
                else:
                    walk(child_rev.id, child_world, child_path, child_bom_path, visited)

    walk(assembly_revision_id, _mu.identity(), [str(assembly_revision_id)], [], set())
    return instances


def get_assembly_tree(db: Session, assembly_revision_id) -> list:
    """递归构建嵌套 BOM 树，供 AssemblyViewer 侧栏渲染"""
    def build(rev_id, visited):
        if rev_id in visited:
            return []
        visited = visited | {rev_id}
        iteration = _current_iteration(db, rev_id)
        if not iteration:
            return []
        links = (
            db.query(models.BOMItem)
            .filter(models.BOMItem.iteration_id == iteration.id,
                    models.BOMItem.deleted_at.is_(None))
            .order_by(models.BOMItem.sort_order)
            .all()
        )
        nodes = []
        for link in links:
            child_rev = get_part_revision(db, link.child_revision_id)
            if not child_rev:
                continue
            master = get_part_master(db, child_rev.master_id)
            children = build(child_rev.id, visited)
            instances = link.cad_instances or []
            if len(instances) > 1:
                for idx, ci in enumerate(instances):
                    # part_code 保持真实件号；实例序号由 instance_index 承载（前端拼 "件号#序号"）
                    nodes.append({
                        "bom_item_id": str(link.id),
                        "instance_index": idx,
                        "part_code": master.code if master else "",
                        "part_name": master.name if master else "",
                        "quantity": 1,
                        "instance_count": 1,
                        "is_leaf": len(children) == 0,
                        "children": children if idx == 0 else [],
                    })
            else:
                nodes.append({
                    "bom_item_id": str(link.id),
                    "part_code": master.code if master else "",
                    "part_name": master.name if master else "",
                    "quantity": link.quantity,
                    "instance_count": len(instances),
                    "is_leaf": len(children) == 0,
                    "children": children,
                })
        return nodes

    children = build(assembly_revision_id, set())
    # 根节点 = 当前装配体本身，显示其件号（不是第一个子件、也不是通用"装配"）
    rev = get_part_revision(db, assembly_revision_id)
    master = get_part_master(db, rev.master_id) if rev else None
    return [{
        "bom_item_id": f"root:{assembly_revision_id}",
        "part_code": master.code if master else "",
        "part_name": master.name if master else "",
        "quantity": 1,
        "instance_count": 1,
        "is_leaf": len(children) == 0,
        "children": children,
    }]
