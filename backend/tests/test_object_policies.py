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
    owner = uuid.uuid4()
    other = uuid.uuid4()
    folder = SimpleNamespace(
        owner_user_id=owner,
        shares=[SimpleNamespace(shared_with_user_id=other, permission="edit")],
    )
    enforce_object_policy("dashboard_folder_editor", _u("guest", owner), folder)
    enforce_object_policy("dashboard_folder_editor", _u("guest", other), folder)
    with pytest.raises(HTTPException):
        enforce_object_policy("dashboard_folder_editor", _u("guest", uuid.uuid4()), folder)


def test_unregistered_policy_raises():
    with pytest.raises(KeyError):
        enforce_object_policy("nonexistent_policy", _u("admin", uuid.uuid4()), None)
