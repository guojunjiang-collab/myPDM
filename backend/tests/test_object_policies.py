import pytest
import uuid
from types import SimpleNamespace
from fastapi import HTTPException
from app.permissions.policies import enforce_object_policy


def _u(role, uid):
    return SimpleNamespace(role=role, id=uid)


def test_ecr_owner_or_admin():
    owner = uuid.uuid4()
    ecr = SimpleNamespace(creator_id=owner)
    enforce_object_policy("ecr_owner_or_admin", _u("engineer", owner), ecr)
    enforce_object_policy("ecr_owner_or_admin", _u("admin", uuid.uuid4()), ecr)
    with pytest.raises(HTTPException):
        enforce_object_policy("ecr_owner_or_admin", _u("engineer", uuid.uuid4()), ecr)


def test_eco_owner_or_admin():
    owner = uuid.uuid4()
    eco = SimpleNamespace(creator_id=owner)
    enforce_object_policy("eco_owner_or_admin", _u("engineer", owner), eco)
    enforce_object_policy("eco_owner_or_admin", _u("admin", uuid.uuid4()), eco)
    with pytest.raises(HTTPException):
        enforce_object_policy("eco_owner_or_admin", _u("engineer", uuid.uuid4()), eco)


def test_ecr_approver_or_admin():
    approver = uuid.uuid4()
    ecr = SimpleNamespace()
    # admin always passes
    enforce_object_policy("ecr_approver_or_admin", _u("admin", uuid.uuid4()), ecr, reviewer_ids={approver})
    # appointed approver passes
    enforce_object_policy("ecr_approver_or_admin", _u("engineer", approver), ecr, reviewer_ids={approver})
    # non-approver engineer fails
    with pytest.raises(HTTPException):
        enforce_object_policy("ecr_approver_or_admin", _u("engineer", uuid.uuid4()), ecr, reviewer_ids={approver})


def test_inventory_keeper_or_admin():
    keeper = uuid.uuid4()
    doc = SimpleNamespace(keeper_id=keeper)
    enforce_object_policy("inventory_keeper_or_admin", _u("production", keeper), doc)
    enforce_object_policy("inventory_keeper_or_admin", _u("admin", uuid.uuid4()), doc)
    with pytest.raises(HTTPException):
        enforce_object_policy("inventory_keeper_or_admin", _u("production", uuid.uuid4()), doc)


def test_dashboard_folder_editor_owner_and_share():
    """owner_user_id / editor_user_ids 一律由调用方显式传入。

    DashboardFolder 模型既无 owner 列、也无法表达"祖先继承共享"，
    策略不得从对象属性推断（审计问题 #12）。
    """
    owner = uuid.uuid4()
    ancestor_editor = uuid.uuid4()
    folder = SimpleNamespace(id=uuid.uuid4())
    ctx = {"owner_user_id": owner, "editor_user_ids": {ancestor_editor}}
    enforce_object_policy("dashboard_folder_editor", _u("guest", owner), folder, **ctx)
    enforce_object_policy("dashboard_folder_editor", _u("guest", ancestor_editor), folder, **ctx)
    enforce_object_policy("dashboard_folder_editor", _u("admin", uuid.uuid4()), folder, **ctx)
    with pytest.raises(HTTPException):
        enforce_object_policy("dashboard_folder_editor", _u("guest", uuid.uuid4()), folder, **ctx)


def test_dashboard_folder_editor_ignores_object_attributes():
    """挂了同名属性也不生效 —— 防止有人退回"给 ORM 对象临时挂 owner_user_id"的老写法。"""
    owner = uuid.uuid4()
    folder = SimpleNamespace(id=uuid.uuid4(), owner_user_id=owner,
                             shares=[SimpleNamespace(shared_with_user_id=owner, permission="edit")])
    with pytest.raises(HTTPException):
        enforce_object_policy("dashboard_folder_editor", _u("guest", owner), folder)


def test_inventory_doc_participant_or_admin():
    creator, keeper, reviewer = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    doc = SimpleNamespace(creator_id=creator, keeper_id=keeper,
                          reviewers=[{"user_id": str(reviewer)}])
    for uid in (creator, keeper, reviewer):
        enforce_object_policy("inventory_doc_participant_or_admin", _u("production", uid), doc)
    enforce_object_policy("inventory_doc_participant_or_admin", _u("admin", uuid.uuid4()), doc)
    with pytest.raises(HTTPException):
        enforce_object_policy("inventory_doc_participant_or_admin", _u("production", uuid.uuid4()), doc)


def test_profile_approver_or_admin():
    approver = uuid.uuid4()
    profile = SimpleNamespace(reviewers=[{"user_id": str(approver)}])
    enforce_object_policy("profile_approver_or_admin", _u("production", approver), profile)
    enforce_object_policy("profile_approver_or_admin", _u("admin", uuid.uuid4()), profile)
    with pytest.raises(HTTPException):
        enforce_object_policy("profile_approver_or_admin", _u("engineer", uuid.uuid4()), profile)


def test_document_content_access_requires_explicit_creator_id():
    """creator_id 必须显式传入；对象上挂同名属性不算（审计问题 #5）。"""
    creator = uuid.uuid4()
    gid = uuid.uuid4()
    doc = SimpleNamespace(id=uuid.uuid4(), creator_id=creator)  # 故意挂属性
    enforce_object_policy("document_content_access", _u("engineer", creator), doc,
                          user_group_ids=set(), doc_group_ids={gid}, creator_id=creator)
    with pytest.raises(HTTPException):
        enforce_object_policy("document_content_access", _u("engineer", creator), doc,
                              user_group_ids=set(), doc_group_ids={gid})


def test_unregistered_policy_raises():
    with pytest.raises(KeyError):
        enforce_object_policy("nonexistent_policy", _u("admin", uuid.uuid4()), None)
