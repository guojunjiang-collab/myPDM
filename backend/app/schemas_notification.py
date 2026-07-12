"""通知 Pydantic Schema。"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: UUID
    event_type: str
    title: str
    body: Optional[str] = None
    target_type: str
    target_id: str
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    sender_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    unread: int
