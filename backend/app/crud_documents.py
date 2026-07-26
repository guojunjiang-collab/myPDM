"""图文档签入检出 CRUD（三层模型：Master → Revision → Iteration）"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Tuple, List, Dict, Any
from uuid import UUID
import os
import shutil

from sqlalchemy.orm import Session

from . import models
from . import crud as crud_common
from .file_storage import file_storage


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
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.master_id == master_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .count()
    )
    return _to_version_string(count)


# ====== 迭代辅助 ======

def _get_current_iteration(db: Session, revision_id: UUID) -> Optional[models.DocumentIteration]:
    """获取版本的最新迭代"""
    revision = (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.id == revision_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .first()
    )
    if not revision or revision.latest_iteration == 0:
        return None
    return (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.revision_id == revision_id,
            models.DocumentIteration.iteration == revision.latest_iteration,
        )
        .first()
    )


# ====== 迭代数据复制（签出/升版时调用） ======

def _copy_attachments_to_iteration(
    db: Session,
    source_iter: models.DocumentIteration,
    target_iter: models.DocumentIteration,
):
    """复制上一迭代的附件引用和物理文件到新迭代"""
    source_atts = source_iter.attachments.all()
    for att in source_atts:
        new_path = att.file_path
        if att.file_path:
            try:
                old_full = file_storage._safe_resolve(att.file_path)
                if old_full.exists():
                    revision = target_iter.revision
                    master = revision.master
                    new_rel_path = (
                        f"document/{master.code}/{revision.version}"
                        f"/{target_iter.iteration}/{att.file_name}"
                    )
                    new_full = file_storage._safe_resolve(new_rel_path)
                    new_full.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(old_full), str(new_full))
                    new_path = new_rel_path
            except Exception:
                pass

        new_att = models.DocumentAttachment(
            revision_id=target_iter.revision_id,
            iteration_id=target_iter.id,
            file_name=att.file_name,
            file_size=att.file_size,
            file_path=new_path,
            file_hash=att.file_hash,
        )
        db.add(new_att)


# ====== DocumentMaster CRUD ======

def create_document(
    db: Session, data: dict, user_id: UUID
) -> models.DocumentMaster:
    """创建文档：同时创建 Master + Revision(A=draft) + Iteration(1)，自动签出"""
    code = data["code"]
    existing = (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.code == code,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        has_rev = (
            db.query(models.DocumentRevision)
            .filter(
                models.DocumentRevision.master_id == existing.id,
                models.DocumentRevision.deleted_at.is_(None),
            )
            .count()
        )
        if has_rev > 0:
            raise ValueError(f"文档编码「{code}」已存在")

    master = models.DocumentMaster(
        code=code,
        name=data["name"],
        creator_id=user_id,
    )
    db.add(master)
    db.flush()

    revision = models.DocumentRevision(
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

    iteration = models.DocumentIteration(
        revision_id=revision.id,
        iteration=1,
    )
    db.add(iteration)
    db.commit()
    db.refresh(master)
    return master


def get_document_master(db: Session, master_id: UUID) -> Optional[models.DocumentMaster]:
    return (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.id == master_id,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )


def get_document_master_by_code(db: Session, code: str) -> Optional[models.DocumentMaster]:
    return (
        db.query(models.DocumentMaster)
        .filter(
            models.DocumentMaster.code == code,
            models.DocumentMaster.deleted_at.is_(None),
        )
        .first()
    )


def update_document_master(
    db: Session, master_id: UUID, data: dict
) -> Optional[models.DocumentMaster]:
    """更新主数据字段（code / name）"""
    master = get_document_master(db, master_id)
    if not master:
        return None
    for field in ("code", "name"):
        if field in data and data[field] is not None:
            setattr(master, field, data[field])
    db.commit()
    db.refresh(master)
    return master


# ====== DocumentRevision CRUD ======

def get_document_revision(
    db: Session, revision_id: UUID
) -> Optional[models.DocumentRevision]:
    return (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.id == revision_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .first()
    )


def get_document_revision_with_current_iteration(
    db: Session, revision_id: UUID
) -> Optional[Tuple[models.DocumentRevision, Optional[models.DocumentIteration]]]:
    """获取版本 + 当前最新迭代"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None
    iteration = _get_current_iteration(db, revision_id)
    return revision, iteration


def list_revisions_by_master(
    db: Session, master_id: UUID
) -> List[models.DocumentRevision]:
    return (
        db.query(models.DocumentRevision)
        .filter(
            models.DocumentRevision.master_id == master_id,
            models.DocumentRevision.deleted_at.is_(None),
        )
        .order_by(models.DocumentRevision.created_at)
        .all()
    )


# ====== 签出 ======

def checkout_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """签出文档：创建新迭代(+1)，复制上一迭代附件和自定义字段，设置签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status not in ("draft",):
        return None, "仅草稿状态可签出"
    if revision.check_out_user_id is not None:
        return None, "该版本已被他人签出"

    prev_iter = _get_current_iteration(db, revision_id)
    new_iter_num = revision.latest_iteration + 1
    new_iter = models.DocumentIteration(
        revision_id=revision_id,
        iteration=new_iter_num,
    )
    db.add(new_iter)
    db.flush()

    if prev_iter:
        _copy_attachments_to_iteration(db, prev_iter, new_iter)
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id)

    revision.latest_iteration = new_iter_num
    revision.check_out_user_id = user_id
    revision.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 签入 ======

def checkin_document(
    db: Session, revision_id: UUID, user_id: UUID, note: Optional[str] = None
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """签入文档：记录签入说明，清除签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    iteration = _get_current_iteration(db, revision_id)
    if iteration:
        iteration.check_in_date = datetime.now(timezone.utc)
        iteration.check_in_note = note

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 撤销签出 ======

def undocheckout_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """撤销签出：删除最新迭代及附件，回退 latest_iteration，清除签出锁"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"
    if str(revision.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能撤销签出"
    if revision.latest_iteration <= 1:
        return None, "至少需保留一个迭代"

    latest_iter = (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.revision_id == revision_id,
            models.DocumentIteration.iteration == revision.latest_iteration,
        )
        .first()
    )
    if latest_iter:
        atts = latest_iter.attachments.all()
        for att in atts:
            if att.file_path:
                try:
                    file_storage.delete_file(att.file_path)
                except Exception:
                    pass
            db.delete(att)
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

def force_checkin_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.check_out_user_id is None:
        return None, "该版本未被签出"

    revision.check_out_user_id = None
    revision.check_out_date = None
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 升版 ======

def upgrade_document(
    db: Session, revision_id: UUID, user_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """升版：创建新版本（B/C/...），复制附件和自定义字段，自动签出"""
    source_rev = get_document_revision(db, revision_id)
    if not source_rev:
        return None, "源版本不存在"
    if source_rev.status not in ("released", "obsolete"):
        return None, "仅已发布或已作废版本可升版"

    source_iter = _get_current_iteration(db, revision_id)

    new_version = _get_next_version(db, source_rev.master_id)
    new_rev = models.DocumentRevision(
        master_id=source_rev.master_id,
        version=new_version,
        status="draft",
        latest_iteration=1,
        revision_parent_id=source_rev.id,
        creator_id=user_id,
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
        _copy_attachments_to_iteration(db, source_iter, new_iter)

    new_rev.check_out_user_id = user_id
    new_rev.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(new_rev)
    return new_rev, None


# ====== 状态变更 ======

def freeze_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """冻结文档版本：draft → frozen"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "draft":
        return None, "仅草稿状态可冻结"
    if revision.check_out_user_id is not None:
        return None, "版本被签出，请先签入后再冻结"
    revision.status = "frozen"
    db.commit()
    db.refresh(revision)
    return revision, None


def release_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """发布文档版本：draft / frozen → released"""
    revision = get_document_revision(db, revision_id)
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


def obsolete_document(
    db: Session, revision_id: UUID
) -> Tuple[Optional[models.DocumentRevision], Optional[str]]:
    """作废文档版本：released → obsolete"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return None, "版本不存在"
    if revision.status != "released":
        return None, "仅已发布状态可作废"
    revision.status = "obsolete"
    db.commit()
    db.refresh(revision)
    return revision, None


# ====== 删除版本 ======

def delete_document_revision(db: Session, revision_id: UUID) -> bool:
    """软删除版本"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return False
    revision.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return True


# ====== 列表查询 ======

def list_documents(
    db: Session,
    search: Optional[str] = None,
    status: Optional[str] = None,
    check_out_user_id: Optional[UUID] = None,
    show_all_versions: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict], int]:
    """查询文档列表（按 master 聚合，含最新版本摘要和附件信息），返回 (items, total)"""
    query = (
        db.query(models.DocumentMaster)
        .filter(models.DocumentMaster.deleted_at.is_(None))
    )
    if search:
        query = query.filter(
            models.DocumentMaster.code.ilike(f"%{search}%")
            | models.DocumentMaster.name.ilike(f"%{search}%")
        )

    total = query.count()
    masters = query.offset((page - 1) * page_size).limit(page_size).all()

    items = []
    for master in masters:
        revisions_query = (
            db.query(models.DocumentRevision)
            .filter(
                models.DocumentRevision.master_id == master.id,
                models.DocumentRevision.deleted_at.is_(None),
            )
            .order_by(models.DocumentRevision.created_at.desc())
        )
        if status:
            revisions_query = revisions_query.filter(
                models.DocumentRevision.status == status
            )
        if check_out_user_id:
            revisions_query = revisions_query.filter(
                models.DocumentRevision.check_out_user_id == check_out_user_id
            )

        revisions = revisions_query.all()
        for rev in revisions:
            if not show_all_versions and rev != revisions[0]:
                break

            checkout_user_name = None
            if rev.check_out_user_id:
                user = (
                    db.query(models.User)
                    .filter(models.User.id == rev.check_out_user_id)
                    .first()
                )
                if user:
                    checkout_user_name = user.real_name

            iteration_count = (
                db.query(models.DocumentIteration)
                .filter(models.DocumentIteration.revision_id == rev.id)
                .count()
            )

            latest_iter = _get_current_iteration(db, rev.id)
            first_att = latest_iter.attachments.first() if latest_iter else None

            items.append(
                {
                    "id": str(rev.id),
                    "revision_id": str(rev.id),
                    "master_id": str(master.id),
                    "code": master.code,
                    "name": master.name,
                    "revision_id": str(rev.id),
                    "version": rev.version,
                    "status": rev.status,
                    "check_out_user_id": str(rev.check_out_user_id)
                    if rev.check_out_user_id
                    else None,
                    "check_out_user_name": checkout_user_name,
                    "check_out_date": rev.check_out_date.isoformat()
                    if rev.check_out_date
                    else None,
                    "latest_iteration": rev.latest_iteration,
                    "iteration_count": iteration_count,
                    "file_name": first_att.file_name if first_att else None,
                    "file_id": str(first_att.id) if first_att else None,
                    "file_size": first_att.file_size if first_att else None,
                    "remark": rev.remark,
                    "creator_id": str(rev.creator_id) if rev.creator_id else None,
                    "created_at": rev.created_at.isoformat()
                    if rev.created_at
                    else None,
                    "updated_at": master.updated_at.isoformat()
                    if master.updated_at
                    else None,
                }
            )
    return items, total


# ====== 迭代列表和详情 ======

def list_iterations(db: Session, revision_id: UUID) -> list:
    """获取某版本下全部迭代（含各自附件清单）"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return []
    iterations = (
        db.query(models.DocumentIteration)
        .filter(models.DocumentIteration.revision_id == revision_id)
        .order_by(models.DocumentIteration.iteration.desc())
        .all()
    )
    result = []
    for it in iterations:
        atts = it.attachments.all()
        result.append(
            {
                "id": str(it.id),
                "iteration": it.iteration,
                "check_in_date": it.check_in_date.isoformat()
                if it.check_in_date
                else None,
                "check_in_note": it.check_in_note,
                "created_at": it.created_at.isoformat()
                if it.created_at
                else None,
                "attachments": [
                    {
                        "id": str(a.id),
                        "file_name": a.file_name,
                        "file_size": a.file_size,
                        "file_path": a.file_path,
                        "created_at": a.created_at.isoformat()
                        if a.created_at
                        else None,
                    }
                    for a in atts
                ],
            }
        )
    return result


def get_iteration_detail(
    db: Session, iteration_id: UUID
) -> Optional[models.DocumentIteration]:
    return (
        db.query(models.DocumentIteration)
        .filter(models.DocumentIteration.id == iteration_id)
        .first()
    )


def delete_iteration(
    db: Session, revision_id: UUID, iteration_id: UUID
) -> Tuple[bool, Optional[str]]:
    """删除指定迭代（管理员操作，不能删除唯一迭代）"""
    revision = get_document_revision(db, revision_id)
    if not revision:
        return False, "版本不存在"
    if revision.latest_iteration <= 1:
        return False, "至少需保留一个迭代"

    iteration = (
        db.query(models.DocumentIteration)
        .filter(
            models.DocumentIteration.id == iteration_id,
            models.DocumentIteration.revision_id == revision_id,
        )
        .first()
    )
    if not iteration:
        return False, "迭代不存在"

    atts = iteration.attachments.all()
    for att in atts:
        if att.file_path:
            try:
                file_storage.delete_file(att.file_path)
            except Exception:
                pass
        db.delete(att)

    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.iteration_id == iteration.id
    ).delete(synchronize_session=False)

    db.delete(iteration)

    if iteration.iteration == revision.latest_iteration:
        remaining = (
            db.query(models.DocumentIteration)
            .filter(models.DocumentIteration.revision_id == revision_id)
            .order_by(models.DocumentIteration.iteration.desc())
            .first()
        )
        revision.latest_iteration = remaining.iteration if remaining else 0

    db.commit()
    return True, None


# ====== 向后兼容别名 ======

def get_document(
    db: Session, doc_id: UUID
) -> Optional[models.DocumentRevision]:
    """向后兼容：按 revision_id 获取版本"""
    return get_document_revision(db, doc_id)


def get_current_iteration(
    db: Session, revision
) -> Optional[models.DocumentIteration]:
    """向后兼容：传入 DocumentRevision 实例获取最新迭代"""
    if isinstance(revision, models.DocumentRevision):
        if revision.latest_iteration == 0:
            return None
        return (
            db.query(models.DocumentIteration)
            .filter(
                models.DocumentIteration.revision_id == revision.id,
                models.DocumentIteration.iteration == revision.latest_iteration,
            )
            .first()
        )
    return None


def where_used_parts_by_document(db, doc_revision_id) -> list:
    """反查：迭代 document_links 引用了该图文档版本的零部件（按零件 master 去重）。"""
    from app.models_parts import PartIteration, PartRevision, PartMaster
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for it in db.query(PartIteration).all():
        if not any(l.get("document_id") == rev_str for l in (it.document_links or [])):
            continue
        pr = db.query(PartRevision).filter(
            PartRevision.id == it.revision_id, PartRevision.deleted_at.is_(None)).first()
        if not pr:
            continue
        pm = db.query(PartMaster).filter(
            PartMaster.id == pr.master_id, PartMaster.deleted_at.is_(None)).first()
        if not pm or str(pm.id) in seen:
            continue
        seen.add(str(pm.id))
        out.append({"master_id": str(pm.id), "revision_id": str(pr.id),
                    "code": pm.code, "name": pm.name, "type": pm.type})
    return out
