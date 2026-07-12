"""站内通知服务：扇出写入 + 查询 + 已读 + 清除。

在各模块状态变更的统一函数中调用 create_notifications 生成知会类通知。
"""
from typing import Optional, Iterable, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from .models_notification import Notification


def parse_uuids(raw_ids: Iterable) -> List[UUID]:
    """把一组可能为字符串/UUID/非法值的 id 容错解析为 UUID 列表，跳过非法项。"""
    out: List[UUID] = []
    for v in raw_ids:
        if v is None:
            continue
        try:
            out.append(UUID(str(v)))
        except (ValueError, TypeError, AttributeError):
            continue
    return out


def create_notifications(
    db: Session,
    *,
    recipient_ids: Iterable,
    sender_id: Optional[UUID],
    event_type: str,
    title: str,
    body: Optional[str],
    target_type: str,
    target_id: str,
    exclude_sender: bool = False,
    commit: bool = True,
) -> int:
    """对一组收件人扇出写入通知。去重 recipient；可排除 sender 自己。返回写入条数。"""
    seen = set()
    count = 0
    for rid in recipient_ids:
        if rid is None:
            continue
        rid_str = str(rid)
        if rid_str in seen:
            continue
        if exclude_sender and sender_id is not None and rid_str == str(sender_id):
            continue
        seen.add(rid_str)
        db.add(Notification(
            recipient_id=rid, sender_id=sender_id, event_type=event_type,
            title=title, body=body, target_type=target_type, target_id=str(target_id),
        ))
        count += 1
    if commit:
        db.commit()
    return count


def list_notifications(
    db: Session, user_id: UUID, *, is_read: Optional[bool] = None,
    target_type: Optional[str] = None, page: int = 1, page_size: int = 20,
) -> Tuple[List[Notification], int, int]:
    """分页查询当前用户通知，返回 (items, total, unread_total)。"""
    base = db.query(Notification).filter(Notification.recipient_id == user_id)
    q = base
    if is_read is not None:
        q = q.filter(Notification.is_read == is_read)
    if target_type:
        q = q.filter(Notification.target_type == target_type)
    total = q.count()
    items = (
        q.order_by(Notification.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size).all()
    )
    unread = base.filter(Notification.is_read == False).count()  # noqa: E712
    return items, total, unread


def unread_count(db: Session, user_id: UUID) -> int:
    return (
        db.query(Notification)
        .filter(Notification.recipient_id == user_id, Notification.is_read == False)  # noqa: E712
        .count()
    )


def mark_read(db: Session, user_id: UUID, notification_id: UUID) -> bool:
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_id == user_id,
    ).first()
    if not n:
        return False
    if not n.is_read:
        n.is_read = True
        n.read_at = sqlfunc.now()
        db.commit()
    return True


def mark_all_read(db: Session, user_id: UUID) -> int:
    """将该用户所有未读通知置为已读，返回更新条数。"""
    n = db.query(Notification).filter(
        Notification.recipient_id == user_id,
        Notification.is_read == False,  # noqa: E712
    ).update(
        {"is_read": True, "read_at": sqlfunc.now()},
        synchronize_session=False,
    )
    db.commit()
    return n


def clear_read(db: Session, user_id: UUID) -> int:
    """删除该用户所有已读通知，返回删除条数。"""
    n = db.query(Notification).filter(
        Notification.recipient_id == user_id,
        Notification.is_read == True,  # noqa: E712
    ).delete(synchronize_session=False)
    db.commit()
    return n
