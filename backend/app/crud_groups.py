"""用户组查询与图文档内容访问判定助手。"""
import uuid as _uuid

from sqlalchemy.orm import Session

from .models import UserGroupMember, DocumentGroupLink, DocumentMaster, DocumentRevision, DocumentIteration, DocumentAttachment
from .permissions import enforce_object_policy, check_object_policy


def _as_uuid(value):
    """把可能是字符串的 id 归一成 UUID；无效值返回 None。"""
    if value is None or isinstance(value, _uuid.UUID):
        return value
    try:
        return _uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def get_user_group_ids(db: Session, user_id) -> set:
    rows = db.query(UserGroupMember.group_id).filter(UserGroupMember.user_id == user_id).all()
    return {r[0] for r in rows}


def get_document_group_ids(db: Session, document_id) -> set:
    """查询文档主数据关联的用户组（document_id FK 指向 document_masters.id）"""
    rows = db.query(DocumentGroupLink.group_id).filter(DocumentGroupLink.document_id == document_id).all()
    return {r[0] for r in rows}


def get_document_creator_id(db: Session, document_id):
    """取图文档创建者 = 最早版本最早迭代的 creator_id。

    v3.1.3 起 creator_id 从 Master/Revision 下移到 DocumentIteration，
    DocumentMaster 上不再有该列，必须回溯迭代层查询。
    """
    row = (
        db.query(DocumentIteration.creator_id)
        .join(DocumentRevision, DocumentIteration.revision_id == DocumentRevision.id)
        .filter(
            DocumentRevision.master_id == document_id,
            DocumentRevision.deleted_at.is_(None),
            DocumentIteration.deleted_at.is_(None),
            DocumentIteration.creator_id.isnot(None),
        )
        .order_by(DocumentRevision.created_at.asc(), DocumentIteration.iteration.asc())
        .first()
    )
    return row[0] if row else None


def _access_ctx(db: Session, user, document) -> dict:
    """组装策略入参。creator_id 只在"会被拒绝"的分支才去查，避免列表接口多一次 N+1。"""
    user_gids = get_user_group_ids(db, user.id)
    doc_gids = get_document_group_ids(db, document.id)
    needs_creator = bool(doc_gids) and not (set(user_gids) & set(doc_gids))
    return {
        "user_group_ids": user_gids,
        "doc_group_ids": doc_gids,
        "creator_id": get_document_creator_id(db, document.id) if needs_creator else None,
    }


def annotate_documents_access(db: Session, user, items: list, master_key: str = "master_id") -> list:
    """批量给图文档列表行补 group_ids / accessible。

    列表页 page_size 最大 10000，因此这里一律走批量查询：
    用户组 1 次 + 文档组关联 1 次；仅对"会被拒绝"的行才回溯迭代层查创建者。
    """
    if not items:
        return items
    # 列表行里的 master_id 是字符串，UUID 列查询必须转回 UUID
    master_ids = {_as_uuid(it.get(master_key)) for it in items}
    master_ids.discard(None)
    if not master_ids:
        return items

    rows = db.query(DocumentGroupLink.document_id, DocumentGroupLink.group_id).filter(
        DocumentGroupLink.document_id.in_(list(master_ids))
    ).all()
    links: dict = {}
    for did, gid in rows:
        links.setdefault(str(did), set()).add(gid)

    user_gids = get_user_group_ids(db, user.id)
    creator_cache: dict = {}
    for it in items:
        mid = str(it.get(master_key) or "")
        doc_gids = links.get(mid, set())
        it["group_ids"] = [str(g) for g in doc_gids]
        if not doc_gids or (user_gids & doc_gids):
            it["accessible"] = True
            continue
        if mid not in creator_cache:
            creator_cache[mid] = get_document_creator_id(db, _as_uuid(mid))
        it["accessible"] = check_object_policy(
            "document_content_access", user, None,
            user_group_ids=user_gids, doc_group_ids=doc_gids,
            creator_id=creator_cache[mid],
        )
    return items


def document_is_accessible(db: Session, user, document) -> bool:
    """不抛异常，返回布尔（用于列表 accessible 标记）。document 为 DocumentMaster 实例。"""
    return check_object_policy(
        "document_content_access", user, document, **_access_ctx(db, user, document)
    )


def enforce_document_content_access(db: Session, user, document) -> None:
    """不可访问则抛 403。document 为 DocumentMaster 实例。"""
    enforce_object_policy(
        "document_content_access", user, document, **_access_ctx(db, user, document)
    )


def enforce_attachment_content_access(db: Session, user, attachment_id) -> None:
    """由附件回溯父文档主数据后判定。附件/文档缺失或无文档归属 → 放行（404 交由端点处理）。"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att or not att.revision_id:
        return
    revision = db.query(DocumentRevision).filter(
        DocumentRevision.id == att.revision_id,
        DocumentRevision.deleted_at.is_(None),
    ).first()
    if not revision or not revision.master_id:
        return
    master = db.query(DocumentMaster).filter(
        DocumentMaster.id == revision.master_id,
        DocumentMaster.deleted_at.is_(None),
    ).first()
    if not master:
        return
    enforce_document_content_access(db, user, master)
