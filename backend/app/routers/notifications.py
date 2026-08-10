"""站内通知 API：查询 / 未读数 / 标记已读 / 清除。

读用 notifications:read，写用 notifications:manage_own；
所有操作一律以 current_user.id 为作用域，只能读写自己的通知。
"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from .. import models
from ..permissions import require_permission
from .. import notifications as notif_svc
from ..routers.auth import get_current_user
from ..schemas_notification import NotificationListResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["通知中心"])


@router.get("/", response_model=NotificationListResponse)
def list_notifications(
    is_read: Optional[bool] = Query(None),
    target_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    items, total, unread = notif_svc.list_notifications(
        db, current_user.id, is_read=is_read, target_type=target_type,
        page=page, page_size=page_size,
    )
    return {
        "items": [NotificationResponse.model_validate(i) for i in items],
        "total": total,
        "unread": unread,
    }


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    return {"unread": notif_svc.unread_count(db, current_user.id)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:manage_own")),
):
    ok = notif_svc.mark_read(db, current_user.id, notification_id)
    if not ok:
        raise HTTPException(404, "通知不存在")
    return {"detail": "已读"}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:manage_own")),
):
    n = notif_svc.mark_all_read(db, current_user.id)
    return {"detail": "全部已读", "count": n}


@router.delete("/read")
def clear_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:manage_own")),
):
    n = notif_svc.clear_read(db, current_user.id)
    return {"detail": "已清除", "count": n}


@router.post("/request-approval")
def request_approval(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """未验证用户请求管理员审批。可重复调用（防重复发送）。"""
    if current_user.role != "unverified":
        raise HTTPException(400, "仅未验证用户可申请审批")

    if notif_svc.has_pending_approval_notification(db, current_user.id):
        return {"notified_count": 0, "already_notified": True}

    admin_ids = [
        row[0] for row in
        db.query(models.User.id).filter(models.User.role == "admin").all()
    ]
    if not admin_ids:
        return {"notified_count": 0, "already_notified": False, "detail": "系统暂无管理员"}

    count = notif_svc.create_notifications(
        db,
        recipient_ids=admin_ids,
        sender_id=current_user.id,
        event_type="approval_request",
        title=f"用户 {current_user.real_name or current_user.username} 申请系统访问权限",
        body=f"飞书免登用户 {current_user.real_name or current_user.username}（{current_user.username}）等待审批",
        target_type="user",
        target_id=str(current_user.id),
    )

    return {"notified_count": count}
