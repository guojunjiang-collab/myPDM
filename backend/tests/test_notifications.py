import uuid
from app import models_notification


def test_notification_table_persists(db):
    n = models_notification.Notification(
        id=uuid.uuid4(),
        recipient_id=uuid.uuid4(),
        event_type="ecr_approved",
        title="ECR-2026-0007 审批通过",
        body="你发起的变更请求已通过全部审批",
        target_type="ecr",
        target_id="abc-123",
    )
    db.add(n); db.commit(); db.refresh(n)
    assert n.is_read is False
    assert n.created_at is not None
