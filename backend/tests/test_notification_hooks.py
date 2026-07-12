import uuid
from app import crud_ecr, models_notification
from app.models_ecr import ECR
from app.models import User


def _user(db, name="U"):
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}", password_hash="x",
             real_name=name, role="engineer", status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _ecr(db, creator_id, reviewers=None, cc_users=None, status="reviewing"):
    e = ECR(id=uuid.uuid4(), ecr_number=f"ECR-{uuid.uuid4().hex[:6]}", title="t",
            reason="r", status=status, creator_id=creator_id,
            reviewers=reviewers or [], cc_users=cc_users or [])
    db.add(e); db.commit(); db.refresh(e)
    return e


def _notifs(db, target_id):
    return db.query(models_notification.Notification).filter(
        models_notification.Notification.target_id == str(target_id)).all()


def test_ecr_approved_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    ecr = _ecr(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_ecr.change_ecr_status(db, ecr.id, "approved", approver.id)
    rows = _notifs(db, ecr.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert str(cc.id) in recipients
    assert all(r.event_type == "ecr_approved" for r in rows)


def test_ecr_closed_notifies_cc_only(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    ecr = _ecr(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}], status="approved")
    crud_ecr.change_ecr_status(db, ecr.id, "closed", creator.id)
    rows = _notifs(db, ecr.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(cc.id) in recipients
    assert all(r.event_type == "ecr_closed" for r in rows)
    assert str(creator.id) not in recipients


def test_ecr_rejected_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    ecr = _ecr(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_ecr.change_ecr_status(db, ecr.id, "rejected", approver.id)
    rows = _notifs(db, ecr.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert str(cc.id) in recipients
    assert all(r.event_type == "ecr_rejected" for r in rows)


def test_ecr_cc_added_notifies_new_user(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    creator = _user(db, "创建人")
    newcc = _user(db, "新知会人")
    ecr = _ecr(db, creator.id, status="draft")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: creator
    try:
        c = TestClient(app)
        r = c.post(f"/api/ecrs/{ecr.id}/cc", json={"user_ids": [str(newcc.id)]})
        assert r.status_code == 200, r.text
        rows = _notifs(db, ecr.id)
        recipients = {str(x.recipient_id) for x in rows}
        assert str(newcc.id) in recipients
        assert any(x.event_type == "cc_added" for x in rows)
    finally:
        app.dependency_overrides.clear()
