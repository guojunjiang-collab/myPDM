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
from .schemas_parts import MatchedFileItem
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
        # 同时删除物理文件。
        copied_atts = db.query(models_parts.PartAttachment).filter(
            models_parts.PartAttachment.iteration_id == latest_iter.id
        ).all()
        for att in copied_atts:
            if att.file_path:
                try:
                    import os
                    if os.path.exists(att.file_path):
                        os.remove(att.file_path)
                    # 同时清理空目录
                    parent = os.path.dirname(att.file_path)
                    for _ in range(3):  # 最多往上清 3 层
                        if os.path.isdir(parent) and not os.listdir(parent):
                            os.rmdir(parent)
                            parent = os.path.dirname(parent)
                        else:
                            break
                except Exception:
                    pass
            db.delete(att)
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


def collect_bom_attachments(db: Session, revision_id: UUID, category: str) -> List[Dict[str, Any]]:
    """递归收集 BOM 树自身+全部子孙件当前迭代下指定 category 的附件清单。"""
    rev_ids: List[UUID] = []
    seen = set()

    def _walk(rev_id):
        if rev_id in seen:
            return
        seen.add(rev_id)
        rev_ids.append(rev_id)
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
            if child_rev and child_rev.id not in seen:
                _walk(child_rev.id)

    _walk(revision_id)

    items: List[Dict[str, Any]] = []
    for rid in rev_ids:
        rev = get_part_revision(db, rid)
        if not rev:
            continue
        it = _current_iteration(db, rid)
        if not it:
            continue
        master = get_part_master(db, rev.master_id)
        part_code = f"{master.code}_{rev.version}" if master else str(rid)
        atts = (
            db.query(models_parts.PartAttachment)
            .filter(
                models_parts.PartAttachment.iteration_id == it.id,
                models_parts.PartAttachment.category == category,
            )
            .all()
        )
        for a in atts:
            items.append({
                "attachment_id": str(a.id),
                "file_name": a.file_name,
                "part_code": part_code,
            })
    return items


def get_bom_descendants(db: Session, revision_id: UUID) -> List[Dict[str, Any]]:
    """广度优先遍历BOM树，返回所有子孙零部件的展开清单（按revision_id去重）"""
    result: List[Dict[str, Any]] = []
    seen: set = set()
    queue = [revision_id]

    while queue:
        rid = queue.pop(0)
        if rid in seen:
            continue
        seen.add(rid)
        rev = get_part_revision(db, rid)
        if not rev:
            continue
        master = get_part_master(db, rev.master_id)
        if not master:
            continue
        it = _current_iteration(db, rid)
        result.append({
            "code": master.code,
            "name": master.name,
            "revision_id": str(rev.id),
            "revision_version": rev.version,
            "iteration_id": str(it.id) if it else None,
            "check_out_user_id": str(rev.check_out_user_id) if rev.check_out_user_id else None,
        })
        # 查询子项并入队
        bom_items = (
            db.query(models.BOMItem)
            .filter(
                models.BOMItem.parent_revision_id == rid,
                models.BOMItem.deleted_at.is_(None),
            )
            .all()
        )
        for bom in bom_items:
            if bom.child_revision_id not in seen:
                queue.append(bom.child_revision_id)

    return result


def match_cad_files(
    db: Session,
    revision_id: UUID,
    file_names: List[str],
    current_user_id: UUID,
) -> Dict[str, Any]:
    """
    匹配文件夹文件名到BOM树零部件:
    1. 获取BOM子孙件列表
    2. 建立 code -> component_info 映射
    3. 遍历 file_names，去扩展名后匹配
    4. 对每个命中项检查签出状态、已有附件
    """

    descendants = get_bom_descendants(db, revision_id)
    code_map: Dict[str, dict] = {}
    for item in descendants:
        code_map[item["code"]] = item

    matched: List[dict] = []
    unmatched: List[str] = []
    will_overwrite_count = 0
    blocked_count = 0

    for fname in file_names:
        # 去扩展名获取件号
        base = fname.rsplit(".", 1)[0] if "." in fname else fname
        info = code_map.get(base)

        if info is None:
            unmatched.append(fname)
            continue

        # 检查已有附件
        existing_count = 0
        if info.get("iteration_id"):
            existing_count = (
                db.query(models_parts.PartAttachment)
                .filter(
                    models_parts.PartAttachment.iteration_id == UUID(info["iteration_id"]),
                    models_parts.PartAttachment.category == "cad",
                    models_parts.PartAttachment.file_name == fname,
                )
                .count()
            )

        # 检查签出状态
        can_upload = True
        block_reason = None
        if info.get("check_out_user_id") != str(current_user_id):
            can_upload = False
            block_reason = "未签出"

        if can_upload and existing_count > 0:
            will_overwrite_count += 1
        if not can_upload:
            blocked_count += 1

        matched.append(MatchedFileItem(
            file_name=fname,
            code=info["code"],
            name=info["name"],
            revision_id=info["revision_id"],
            revision_version=info["revision_version"],
            iteration_id=info["iteration_id"] or "",
            existing_count=existing_count,
            can_upload=can_upload,
            block_reason=block_reason,
        ))

    return {
        "matched": matched,
        "unmatched": unmatched,
        "summary": {
            "total_files": len(file_names),
            "matched_count": len(matched),
            "unmatched_count": len(unmatched),
            "will_overwrite_count": will_overwrite_count,
            "blocked_count": blocked_count,
        },
    }


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
                    "child_spec": master.spec if master else "",
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


def _write_production_step(db, revision, iteration, data: bytes) -> None:
    """把 STEP 字节写为该迭代下的生产附件，文件名固定 件号.STEP，同名替换、不转 GLB。"""
    master = get_part_master(db, revision.master_id)
    code = master.code if master else str(revision.id)
    fname = f"{code}.STEP"
    olds = (db.query(models_parts.PartAttachment)
            .filter(models_parts.PartAttachment.iteration_id == iteration.id,
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
    upload_dir = f"{_uploads_root}/parts/{code}/{revision.version}/{iteration.iteration}"
    _os_split.makedirs(upload_dir, exist_ok=True)
    fpath = _os_split.path.join(upload_dir, fname)
    with open(fpath, "wb") as f:
        f.write(data)
    att = models_parts.PartAttachment(
        iteration_id=iteration.id, category="production", file_name=fname,
        file_size=len(data), file_path=fpath,
        file_hash=_hashlib_split.sha256(data).hexdigest(),
    )
    db.add(att); db.commit()


def save_assembly_step_as_attachment(db: Session, revision_id, data: bytes, current_user_id) -> bool:
    """把上传的装配 STEP 原文保存为该装配自身的生产附件(件号.STEP)。
    门槛与子项一致：草稿 + 当前用户已检出；同名替换、不转 GLB。返回是否已写入。"""
    rev = get_part_revision(db, revision_id)
    if not rev:
        return False
    if not (rev.status == "draft"
            and str(rev.check_out_user_id or "") == str(current_user_id)):
        return False
    it = _current_iteration(db, revision_id)
    if not it:
        return False
    _write_production_step(db, rev, it, data)
    return True


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
        _write_production_step(db, child_rev, child_it, text.encode("utf-8"))
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


def match_cad_bom_items(db: Session, items: List[dict], current_user_id: Optional[UUID]) -> List[dict]:
    """
    按 件号+版本 批量匹配 PDM 零部件（CAD 工作台自动匹配）。
    - 件号不存在 → new
    - 版本为空 → 匹配最新版本（created_at 最新）→ matched
    - 版本命中（trim 后不区分大小写）→ matched
    - 版本未命中 → conflict（latest_version 返回 PDM 已有最新版本号）
    - 件号存在但无未删除版本 → conflict（latest_version=None，master_id 返回，与"有版本但未命中"区分）
    matched 时返回相对当前用户的签出状态。

    批量预取策略：先收集所有去重后的件号，批量查询 master 与 revisions，
    再逐条从索引回填结果，避免同一件号重复查库。
    """
    # 1. 收集去重件号，构建 entry 雏形（保持输入顺序）
    entries: list = []
    codes: list = []  # 需要查询的有效件号列表（保持首次出现的顺序用于去重）
    seen_codes: set = set()
    for item in items:
        code = (item.get("code") or "").strip()
        version = (item.get("version") or "").strip()
        entry = {
            "code": code,
            "version": version or None,
            "match_status": "new",
            "master_id": None,
            "revision_id": None,
            "matched_version": None,
            "name": None,
            "checkout_status": None,
            "latest_version": None,
        }
        entries.append(entry)
        if code:
            if code not in seen_codes:
                seen_codes.add(code)
                codes.append(code)

    if not codes:
        return entries

    # 2. 批量预取 master（按去重件号），构建 code→master 索引
    masters = (
        db.query(models_parts.PartMaster)
        .filter(
            models_parts.PartMaster.code.in_(codes),
            models_parts.PartMaster.deleted_at.is_(None),
        )
        .all()
    )
    code_to_master: dict = {m.code: m for m in masters}
    found_master_ids = [m.id for m in masters]

    # 3. 批量预取 revisions（按已找到的 master_id），按 created_at DESC 排序
    master_revisions: dict = {}  # master_id → [revisions 列表，created_at DESC]
    if found_master_ids:
        all_revs = (
            db.query(models_parts.PartRevision)
            .filter(
                models_parts.PartRevision.master_id.in_(found_master_ids),
                models_parts.PartRevision.deleted_at.is_(None),
            )
            .order_by(models_parts.PartRevision.created_at.desc())
            .all()
        )
        for rev in all_revs:
            master_revisions.setdefault(str(rev.master_id), []).append(rev)

    # 4. 逐 item 从索引回填结果
    for idx, entry in enumerate(entries):
        code = entry["code"]
        if not code:
            continue

        master = code_to_master.get(code)
        if master is None:
            continue  # 件号不存在，保持 new

        revisions = master_revisions.get(str(master.id), [])
        if not revisions:
            # 件号存在但无未删除版本 → conflict（与"版本未命中"区分，latest_version=None）
            entry["match_status"] = "conflict"
            entry["master_id"] = master.id
            entry["latest_version"] = None
            continue

        latest = revisions[0]
        entry["master_id"] = master.id
        entry["latest_version"] = latest.version

        version = entry["version"]
        matched_rev = None
        if not version:
            # 版本为空 → 自动命中最新版本
            matched_rev = latest
        else:
            # 精确匹配版本（trim 后不区分大小写）
            for rev in revisions:
                if (rev.version or "").strip().upper() == version.upper():
                    matched_rev = rev
                    break

        if matched_rev is None:
            entry["match_status"] = "conflict"
        else:
            entry["match_status"] = "matched"
            entry["revision_id"] = matched_rev.id
            entry["matched_version"] = matched_rev.version
            entry["name"] = master.name
            if matched_rev.check_out_user_id is None:
                entry["checkout_status"] = "not_checked_out"
            elif matched_rev.check_out_user_id == current_user_id:
                entry["checkout_status"] = "checked_out"
            else:
                entry["checkout_status"] = "other_checked_out"

    return entries


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


def _mm_matrix_to_m(matrix: List[float]) -> List[float]:
    """CATIA 矩阵平移分量 mm → m。
    行主序 4x4，平移分量在索引 3/7/11；与装配 STEP 导入（apply_step_matrices）的
    cad_instances 存储约定保持一致。"""
    m = [float(x) for x in matrix]
    for idx in (3, 7, 11):
        m[idx] = m[idx] / 1000.0
    return m


def sync_cad_bom_children(
    db: Session, revision_id: UUID, children: List[dict], user_id: Optional[UUID]
) -> Optional[dict]:
    """
    将 CATIA 装配的直接子项结构同步到 PDM BOM（CAD 工作台属性推送附带）。
    - 子项件号在 PDM 不存在 → 自动创建零部件（版本 A 并签出给操作者）
    - 已有 BOM 关系 → 更新用量，替换 source='catia' 的实例矩阵（保留 step/manual 条目）
    - 无 BOM 关系 → 创建 BOM 项
    - PDM 中存在但 CATIA 中不存在的直接子项保留不动，仅在 extra_in_pdm 返回提示，
      删除属危险操作由用户在 PDM 中自行处理
    矩阵为 CATIA 相对父装配的 4x4 行主序（平移单位 mm），存储时平移转 m。
    """
    revision = get_part_revision(db, revision_id)
    if revision is None:
        return None

    # 现有直接子项索引：child_code → BOMItem
    existing_items = (
        db.query(models.BOMItem)
        .filter(
            models.BOMItem.parent_revision_id == revision_id,
            models.BOMItem.deleted_at.is_(None),
        )
        .all()
    )
    code_to_item: dict = {}
    for item in existing_items:
        child_rev = get_part_revision(db, item.child_revision_id)
        if child_rev:
            master = get_part_master(db, child_rev.master_id)
            if master:
                code_to_item[master.code] = item

    iteration = _current_iteration(db, revision_id)
    created_parts: List[str] = []
    created_items = 0
    updated_items = 0
    pushed_codes: set = set()

    for child in children:
        code = (child.get("code") or "").strip()
        if not code:
            continue
        pushed_codes.add(code)
        quantity = int(child.get("quantity") or 1)
        # 构造 catia 来源的实例矩阵条目（矩阵不可用的实例跳过）
        cad_entries = []
        for inst in child.get("instances") or []:
            matrix = inst.get("matrix")
            if not matrix or len(matrix) != 16:
                continue
            cad_entries.append({
                "matrix": _mm_matrix_to_m(matrix),
                "source": "catia",
                "label": inst.get("label") or "",
            })

        if code in code_to_item:
            item = code_to_item[code]
            item.quantity = quantity
            kept = [c for c in (item.cad_instances or []) if c.get("source") != "catia"]
            item.cad_instances = kept + cad_entries
            updated_items += 1
        else:
            master = (
                db.query(models_parts.PartMaster)
                .filter(
                    models_parts.PartMaster.code == code,
                    models_parts.PartMaster.deleted_at.is_(None),
                )
                .first()
            )
            if master is None:
                master = create_part_master(
                    db,
                    {"code": code, "name": child.get("name") or code, "spec": child.get("spec")},
                    user_id,
                )
                created_parts.append(code)
            child_rev = (
                db.query(models_parts.PartRevision)
                .filter(
                    models_parts.PartRevision.master_id == master.id,
                    models_parts.PartRevision.deleted_at.is_(None),
                )
                .order_by(models_parts.PartRevision.created_at.desc())
                .first()
            )
            if child_rev is None:
                continue
            item = models.BOMItem(
                iteration_id=iteration.id if iteration else None,
                parent_revision_id=revision_id,
                child_revision_id=child_rev.id,
                quantity=quantity,
                cad_instances=cad_entries,
            )
            db.add(item)
            created_items += 1

    db.commit()
    extra_in_pdm = sorted(c for c in code_to_item.keys() if c not in pushed_codes)
    return {
        "created_parts": created_parts,
        "created_items": created_items,
        "updated_items": updated_items,
        "extra_in_pdm": extra_in_pdm,
    }
