"""用户组查询与图文档内容访问判定助手。"""
from sqlalchemy.orm import Session

from .models import UserGroupMember, DocumentGroupLink, Document, DocumentAttachment
from .permissions import enforce_object_policy, check_object_policy


def get_user_group_ids(db: Session, user_id) -> set:
    rows = db.query(UserGroupMember.group_id).filter(UserGroupMember.user_id == user_id).all()
    return {r[0] for r in rows}


def get_document_group_ids(db: Session, document_id) -> set:
    rows = db.query(DocumentGroupLink.group_id).filter(DocumentGroupLink.document_id == document_id).all()
    return {r[0] for r in rows}


def document_is_accessible(db: Session, user, document) -> bool:
    """不抛异常，返回布尔（用于列表 accessible 标记）。"""
    return check_object_policy(
        "document_content_access", user, document,
        user_group_ids=get_user_group_ids(db, user.id),
        doc_group_ids=get_document_group_ids(db, document.id),
    )


def enforce_document_content_access(db: Session, user, document) -> None:
    """不可访问则抛 403。"""
    enforce_object_policy(
        "document_content_access", user, document,
        user_group_ids=get_user_group_ids(db, user.id),
        doc_group_ids=get_document_group_ids(db, document.id),
    )


def enforce_attachment_content_access(db: Session, user, attachment_id) -> None:
    """由附件回溯父文档后判定。附件/文档缺失或无文档归属 → 放行（404 交由端点处理）。"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att or not att.document_id:
        return
    document = db.query(Document).filter(Document.id == att.document_id).first()
    if not document:
        return
    enforce_document_content_access(db, user, document)
