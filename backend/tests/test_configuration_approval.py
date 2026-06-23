"""构型配置审批流：状态机 / 会签或签 / 列表权限过滤。"""
import uuid
import pytest
from fastapi import HTTPException

from app import crud_configuration as crud
from app.models_configuration import ConfigurationProfile, ConfigurationReviewRecord


def _profile(db, creator, status="draft", reviewers=None, review_mode="all", cc_users=None):
    p = ConfigurationProfile(
        id=uuid.uuid4(), code=f"CFG-{uuid.uuid4().hex[:6]}", name="cfg",
        status=status, creator_id=creator.id,
        reviewers=reviewers or [], review_mode=review_mode, cc_users=cc_users or [],
    )
    db.add(p); db.commit(); db.refresh(p)
    return p


def _rv(user, seq=0):
    return {"user_id": str(user.id), "user_name": user.real_name, "role": user.role, "seq": seq}


def test_submit_with_reviewers_goes_reviewing(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    db.refresh(p)
    assert p.status == "reviewing"
    assert p.submitted_at is not None


def test_submit_without_reviewers_auto_active(db, engineer_user):
    p = _profile(db, engineer_user, reviewers=[])
    crud.submit_profile(db, p, engineer_user)
    db.refresh(p)
    assert p.status == "active"


def test_review_all_mode_needs_everyone(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest_user)], review_mode="all")
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "approved", "ok")
    db.refresh(p); assert p.status == "reviewing"
    crud.review_profile(db, p, guest_user, "approved", "ok")
    db.refresh(p); assert p.status == "active"


def test_review_any_mode_one_approve(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest_user)], review_mode="any")
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "approved", "ok")
    db.refresh(p); assert p.status == "active"


def test_review_rejected(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "rejected", "不行")
    db.refresh(p); assert p.status == "rejected"


def test_returned_clears_records_and_back_to_draft(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "returned", "改一下")
    db.refresh(p); assert p.status == "draft"
    recs = db.query(ConfigurationReviewRecord).filter(
        ConfigurationReviewRecord.profile_id == p.id).count()
    assert recs == 0


def test_withdraw_clears_records(db, engineer_user, admin_user, guest_user):
    p2 = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest_user)])
    crud.submit_profile(db, p2, engineer_user)
    crud.review_profile(db, p2, admin_user, "approved", "ok")  # all 模式还差一人 → 仍 reviewing
    db.refresh(p2); assert p2.status == "reviewing"
    crud.withdraw_profile(db, p2, engineer_user)
    db.refresh(p2); assert p2.status == "draft"
    recs = db.query(ConfigurationReviewRecord).filter(
        ConfigurationReviewRecord.profile_id == p2.id).count()
    assert recs == 0


def test_non_reviewer_cannot_review(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    with pytest.raises(HTTPException) as ei:
        crud.review_profile(db, p, guest_user, "approved", "")
    assert ei.value.status_code == 403


def test_list_filter_hides_others_draft(db, engineer_user, guest_user):
    _profile(db, engineer_user, status="draft")
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 0


def test_list_filter_shows_active_to_everyone(db, engineer_user, guest_user):
    _profile(db, engineer_user, status="active")
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 1


def test_list_filter_shows_own_and_reviewer_and_cc(db, engineer_user, guest_user, admin_user):
    _profile(db, engineer_user, status="draft")
    _profile(db, guest_user, status="draft")
    _profile(db, engineer_user, status="reviewing", reviewers=[_rv(guest_user)])
    _profile(db, engineer_user, status="draft", cc_users=[{"user_id": str(guest_user.id), "user_name": guest_user.real_name}])
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 3


def test_admin_sees_all(db, engineer_user, admin_user):
    _profile(db, engineer_user, status="draft")
    _profile(db, engineer_user, status="reviewing")
    items, total = crud.get_profiles_for_user(db, admin_user)
    assert total == 2
