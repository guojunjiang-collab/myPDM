"""图文档签入检出 CRUD"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional, Tuple
from uuid import UUID
import shutil
import os

from sqlalchemy.orm import Session

from . import models
from . import models as doc_models  # Document, DocumentAttachment, DocumentIteration
from .file_storage import file_storage


# ====== 辅助 ======

def get_document(db: Session, doc_id: UUID) -> Optional[models.Document]:
    return db.query(models.Document).filter(
        models.Document.id == doc_id,
        models.Document.deleted_at.is_(None),
    ).first()


def get_current_iteration(db: Session, doc: models.Document) -> Optional[models.DocumentIteration]:
    if doc.latest_iteration == 0:
        return None
    return db.query(models.DocumentIteration).filter(
        models.DocumentIteration.document_id == doc.id,
        models.DocumentIteration.iteration == doc.latest_iteration,
    ).first()


# ====== 签出 ======

def checkout_document(db: Session, doc_id: UUID, user_id: UUID) -> Tuple[Optional[models.Document], Optional[str]]:
    doc = get_document(db, doc_id)
    if not doc:
        return None, "文档不存在"
    if doc.status not in ("draft",):
        return None, "仅草稿状态可签出"
    if doc.check_out_user_id is not None:
        return None, "该文档已被他人签出"

    prev_iter = get_current_iteration(db, doc)
    new_iter_num = doc.latest_iteration + 1
    new_iter = models.DocumentIteration(
        document_id=doc_id,
        iteration=new_iter_num,
    )
    db.add(new_iter)
    db.flush()

    # 复制上一迭代的附件到新迭代
    if prev_iter:
        prev_atts = db.query(models.DocumentAttachment).filter(
            models.DocumentAttachment.iteration_id == prev_iter.id
        ).all()
        for att in prev_atts:
            new_att = models.DocumentAttachment(
                document_id=doc_id,
                iteration_id=new_iter.id,
                file_name=att.file_name,
                file_size=att.file_size,
                file_path=att.file_path,
                file_hash=att.file_hash,
            )
            db.add(new_att)
        # 复制上一迭代的自定义字段值到新迭代（对齐零件）
        from . import crud as crud_common
        crud_common._copy_iteration_custom_fields(db, prev_iter.id, new_iter.id)

    doc.latest_iteration = new_iter_num
    doc.check_out_user_id = user_id
    doc.check_out_date = datetime.now(timezone.utc)
    db.commit()
    db.refresh(doc)
    return doc, None


# ====== 签入 ======

def checkin_document(db: Session, doc_id: UUID, user_id: UUID, note: Optional[str] = None) -> Tuple[Optional[models.Document], Optional[str]]:
    doc = get_document(db, doc_id)
    if not doc:
        return None, "文档不存在"
    if doc.check_out_user_id is None:
        return None, "该文档未被签出"
    if str(doc.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能签入"

    iteration = get_current_iteration(db, doc)
    if iteration:
        iteration.check_in_date = datetime.now(timezone.utc)
        iteration.check_in_note = note
        # 更新文档的主文件名和附件引用
        first_att = db.query(models.DocumentAttachment).filter(
            models.DocumentAttachment.iteration_id == iteration.id
        ).order_by(models.DocumentAttachment.created_at).first()
        if first_att:
            doc.file_name = first_att.file_name
            doc.file_id = first_att.id

    doc.check_out_user_id = None
    doc.check_out_date = None
    db.commit()
    db.refresh(doc)
    return doc, None


# ====== 放弃签出 ======

def undo_checkout_document(db: Session, doc_id: UUID, user_id: UUID) -> Tuple[Optional[models.Document], Optional[str]]:
    doc = get_document(db, doc_id)
    if not doc:
        return None, "文档不存在"
    if doc.check_out_user_id is None:
        return None, "该文档未被签出"
    if str(doc.check_out_user_id) != str(user_id):
        return None, "只有签出者本人才能放弃签出"

    iteration = get_current_iteration(db, doc)
    if iteration and iteration.iteration > 1:
        # 删除当前迭代的附件文件
        atts = db.query(models.DocumentAttachment).filter(
            models.DocumentAttachment.iteration_id == iteration.id
        ).all()
        for att in atts:
            if att.file_path:
                try:
                    file_storage.delete_file(att.file_path)
                except Exception:
                    pass
            db.delete(att)
        # 清理当前迭代复制的自定义字段值
        db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.iteration_id == iteration.id
        ).delete(synchronize_session=False)
        # 删除迭代
        db.delete(iteration)
        doc.latest_iteration = doc.latest_iteration - 1

    doc.check_out_user_id = None
    doc.check_out_date = None
    db.commit()
    db.refresh(doc)
    return doc, None


# ====== 强制签入（管理员） ======

def force_checkin_document(db: Session, doc_id: UUID) -> Tuple[Optional[models.Document], Optional[str]]:
    """管理员强制签入：清除签出锁，保留当前迭代"""
    doc = get_document(db, doc_id)
    if not doc:
        return None, "文档不存在"
    if doc.check_out_user_id is None:
        return None, "该文档未被签出"
    doc.check_out_user_id = None
    doc.check_out_date = None
    db.commit()
    db.refresh(doc)
    return doc, None


# ====== 迭代列表 ======

def list_iterations(db: Session, doc_id: UUID) -> list:
    doc = get_document(db, doc_id)
    if not doc:
        return []
    iterations = db.query(models.DocumentIteration).filter(
        models.DocumentIteration.document_id == doc_id
    ).order_by(models.DocumentIteration.iteration.desc()).all()
    result = []
    for it in iterations:
        atts = db.query(models.DocumentAttachment).filter(
            models.DocumentAttachment.iteration_id == it.id
        ).all()
        result.append({
            "id": str(it.id),
            "iteration": it.iteration,
            "check_in_date": it.check_in_date.isoformat() if it.check_in_date else None,
            "check_in_note": it.check_in_note,
            "created_at": it.created_at.isoformat() if it.created_at else None,
            "attachments": [{
                "id": str(a.id),
                "file_name": a.file_name,
                "file_size": a.file_size,
                "file_path": a.file_path,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            } for a in atts],
        })
    return result
