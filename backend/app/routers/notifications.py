"""站内通知 API：查询 / 未读数 / 标记已读 / 清除。"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..permissions import require_permission
from .. import notifications as notif_svc
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
    current_user: User = Depends(require_permission("notifications:read")),
):
    ok = notif_svc.mark_read(db, current_user.id, notification_id)
    if not ok:
        raise HTTPException(404, "通知不存在")
    return {"detail": "已读"}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    n = notif_svc.mark_all_read(db, current_user.id)
    return {"detail": "全部已读", "count": n}


@router.delete("/read")
def clear_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    n = notif_svc.clear_read(db, current_user.id)
    return {"detail": "已清除", "count": n}
