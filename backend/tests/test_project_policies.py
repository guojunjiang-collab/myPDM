import uuid
from app.permissions.policies import _POLICY_FUNCS


class _FakeUser:
    def __init__(self, role, uid=None):
        self.role = role
        self.id = uid or uuid.uuid4()


class _FakeProject:
    def __init__(self, owner_id):
        self.owner_id = owner_id


def test_project_manager_or_admin_policy_registered():
    assert "project_manager_or_admin" in _POLICY_FUNCS


def test_owner_passes_admin_passes_others_fail():
    fn = _POLICY_FUNCS["project_manager_or_admin"]
    owner = _FakeUser("engineer")
    proj = _FakeProject(owner_id=owner.id)
    assert fn(owner, proj) is True
    assert fn(_FakeUser("admin"), proj) is True
    assert fn(_FakeUser("engineer"), proj) is False
