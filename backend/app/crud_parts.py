"""零部件签入检出 CRUD 操作"""
from __future__ import annotations
from typing import Optional, List, Tuple, Any, Dict
from datetime import datetime, timezone
from uuid import UUID, uuid4
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from fastapi import HTTPException

from . import models, models_parts
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
    """创建零件主数据，同时自动创建 Revision=A、Iteration=1"""
    master = models_parts.PartMaster(
        code=data["code"],
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
    new_iter.custom_fields = source_iter.custom_fields or {}
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
                    "child_code": master.code if master else "",
                    "child_name": master.name if master else "",
                    "child_version": child_rev.version,
                    "child_status": child_rev.status,
                    "child_type": "assembly" if (
                        db.query(models.BOMItem)
                        .filter(
                            models.BOMItem.parent_revision_id == child_rev.id,
                            models.BOMItem.deleted_at.is_(None),
                        )
                        .count() > 0
                    ) else "part",
                    "quantity": item.quantity,
                    "sort_order": item.sort_order,
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
    for field in ("quantity", "sort_order"):
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
