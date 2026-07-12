import uuid
from app import models_notification
from app import notifications as notif_svc


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


def _mk_user(db, name):
    from app.models import User
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}", password_hash="x",
             real_name=name, role="engineer", status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_create_notifications_fan_out_and_dedup(db):
    u1 = _mk_user(db, "张三")
    u2 = _mk_user(db, "李四")
    sender = _mk_user(db, "王五")
    notif_svc.create_notifications(
        db,
        recipient_ids=[u1.id, u2.id, u1.id],
        sender_id=sender.id,
        event_type="ecr_approved",
        title="ECR-1 审批通过",
        body="已通过",
        target_type="ecr",
        target_id="ecr-1",
    )
    rows = db.query(models_notification.Notification).all()
    assert len(rows) == 2


def test_create_notifications_excludes_sender(db):
    sender = _mk_user(db, "操作者")
    other = _mk_user(db, "旁观者")
    notif_svc.create_notifications(
        db, recipient_ids=[sender.id, other.id], sender_id=sender.id,
        event_type="ecr_closed", title="t", body=None,
        target_type="ecr", target_id="x", exclude_sender=True,
    )
    rows = db.query(models_notification.Notification).all()
    assert len(rows) == 1
    assert rows[0].recipient_id == other.id


def test_list_and_unread_count(db):
    u = _mk_user(db, "甲")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t2", body=None, target_type="ecr", target_id="2")
    items, total, unread = notif_svc.list_notifications(db, u.id, page=1, page_size=10)
    assert total == 2 and unread == 2 and len(items) == 2
    assert notif_svc.unread_count(db, u.id) == 2


def test_mark_read_and_read_all_and_clear(db):
    u = _mk_user(db, "乙")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t2", body=None, target_type="ecr", target_id="2")
    first = db.query(models_notification.Notification).first()
    assert notif_svc.mark_read(db, u.id, first.id) is True
    assert notif_svc.unread_count(db, u.id) == 1
    notif_svc.mark_all_read(db, u.id)
    assert notif_svc.unread_count(db, u.id) == 0
    deleted = notif_svc.clear_read(db, u.id)
    assert deleted == 2
    assert db.query(models_notification.Notification).count() == 0


def test_mark_read_other_user_denied(db):
    owner = _mk_user(db, "主人")
    intruder = _mk_user(db, "闯入者")
    notif_svc.create_notifications(db, recipient_ids=[owner.id], sender_id=None,
        event_type="e", title="t", body=None, target_type="ecr", target_id="1")
    n = db.query(models_notification.Notification).first()
    assert notif_svc.mark_read(db, intruder.id, n.id) is False
