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


# ─────────────────────────────────────────────────────
# ECO 事件埋点测试
# ─────────────────────────────────────────────────────

from app import crud_eco
from app.models_eco import ECO


def _eco(db, creator_id, cc_users=None, status="reviewing"):
    e = ECO(id=uuid.uuid4(), eco_number=f"ECO-{uuid.uuid4().hex[:6]}", title="t",
            reason="r", status=status, creator_id=creator_id, reviewers=[],
            cc_users=cc_users or [])
    db.add(e); db.commit(); db.refresh(e)
    return e


def test_eco_approved_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    eco = _eco(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_eco.change_eco_status(db, eco.id, "approved", approver.id)
    rows = _notifs(db, eco.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients and str(cc.id) in recipients
    assert all(r.event_type == "eco_approved" for r in rows)


def test_eco_executing_notifies_cc_only(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    eco = _eco(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}], status="approved")
    crud_eco.change_eco_status(db, eco.id, "executing", creator.id)
    rows = _notifs(db, eco.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(cc.id) in recipients
    assert all(r.event_type == "eco_executing" for r in rows)
    assert str(creator.id) not in recipients


def test_eco_rejected_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    eco = _eco(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_eco.change_eco_status(db, eco.id, "rejected", approver.id)
    rows = _notifs(db, eco.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients and str(cc.id) in recipients
    assert all(r.event_type == "eco_rejected" for r in rows)


def test_eco_cc_added_notifies_new_user(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db
    from app.routers.auth import get_current_active_user
    creator = _user(db, "创建人")
    newcc = _user(db, "新知会人")
    eco = _eco(db, creator.id, status="draft")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: creator
    try:
        c = TestClient(app)
        r = c.post(f"/api/ecos/{eco.id}/cc", json={"user_ids": [str(newcc.id)]})
        assert r.status_code == 200, r.text
        rows = _notifs(db, eco.id)
        recipients = {str(x.recipient_id) for x in rows}
        assert str(newcc.id) in recipients
        assert any(x.event_type == "cc_added" for x in rows)
    finally:
        app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────
# 配置概要事件埋点测试
# ─────────────────────────────────────────────────────

from app import crud_configuration
from app.models_configuration import ConfigurationProfile


def _profile(db, creator_id, reviewers=None, cc_users=None, status="draft"):
    p = ConfigurationProfile(
        code=f"CFG-{uuid.uuid4().hex[:6]}", name="测试配置",
        creator_id=creator_id, status=status,
        reviewers=reviewers or [],
        review_mode="any",
        cc_users=cc_users or [],
    )
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_profile_approved_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    reviewer = _user(db, "审批人")
    profile = _profile(db, creator.id,
                       reviewers=[{"user_id": str(reviewer.id), "user_name": reviewer.real_name}],
                       cc_users=[{"user_id": str(cc.id), "user_name": cc.real_name}],
                       status="reviewing")
    crud_configuration.review_profile(db, profile, reviewer, decision="approved")
    rows = _notifs(db, profile.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert str(cc.id) in recipients
    assert all(r.event_type == "profile_approved" for r in rows)
    assert profile.status == "active"


def test_profile_archived_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    operator = _user(db, "操作人")
    profile = _profile(db, creator.id,
                       cc_users=[{"user_id": str(cc.id), "user_name": cc.real_name}],
                       status="active")
    crud_configuration.archive_profile(db, profile, operator)
    rows = _notifs(db, profile.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert str(cc.id) in recipients
    assert all(r.event_type == "profile_archived" for r in rows)


# ─────────────────────────────────────────────────────
# 库存单据事件埋点测试
# ─────────────────────────────────────────────────────

from app import crud_inventory
from app.models_inventory import InventoryDocument


def _inv_doc(db, creator_id, reviewers=None, status="draft"):
    d = InventoryDocument(
        doc_number=f"INV-{uuid.uuid4().hex[:6]}",
        doc_type="inbound", status=status,
        creator_id=creator_id,
        reviewers=reviewers or [],
        review_mode="all",
    )
    db.add(d); db.commit(); db.refresh(d)
    return d


def test_inv_doc_rejected_notifies_creator(db):
    creator = _user(db, "创建人")
    reviewer = _user(db, "审批人")
    doc = _inv_doc(db, creator.id,
                   reviewers=[{"user_id": str(reviewer.id), "user_name": reviewer.real_name}],
                   status="reviewing")
    crud_inventory.review_document(db, doc, reviewer, decision="rejected")
    rows = _notifs(db, doc.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert all(r.event_type == "inv_doc_rejected" for r in rows)


# ─────────────────────────────────────────────────────
# 项目任务事件埋点测试
# ─────────────────────────────────────────────────────

from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models_project import Project, ProjectMember


def test_task_assigned_notifies_assignee(db):
    owner = _user(db, "项目经理")
    owner.role = "admin"  # 简化权限门禁
    db.commit()
    assignee = _user(db, "执行人")
    project = Project(
        code=f"PRJ-{uuid.uuid4().hex[:4]}", name="测试项目",
        owner_id=owner.id, status="进行中",
    )
    db.add(project); db.commit(); db.refresh(project)
    # 负责人必须是项目成员
    db.add(ProjectMember(project_id=project.id, user_id=assignee.id, role_in_project="成员"))
    db.commit()

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: owner
    try:
        c = TestClient(app)
        r = c.post(f"/api/projects/{project.id}/tasks", json={
            "name": "测试任务",
            "assignee_id": str(assignee.id),
        })
        assert r.status_code == 200, r.text
        rows = _notifs(db, r.json()["id"])
        recipients = {str(x.recipient_id) for x in rows}
        assert str(assignee.id) in recipients
        assert any(x.event_type == "task_assigned" for x in rows)
    finally:
        app.dependency_overrides.clear()
