import uuid
import pytest
from types import SimpleNamespace
from fastapi import HTTPException
from app.permissions.policies import enforce_object_policy, check_object_policy


def _u(role, uid):
    return SimpleNamespace(role=role, id=uid)


def _doc(creator_id=None):
    return SimpleNamespace(id=uuid.uuid4(), creator_id=creator_id)


def test_admin_always_allowed():
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("admin", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids={g}) is True


def test_creator_always_allowed():
    uid = uuid.uuid4()
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("engineer", uid), _doc(creator_id=uid),
                               user_group_ids=set(), doc_group_ids={g}) is True


def test_unlinked_document_allows_everyone():
    assert check_object_policy("document_content_access", _u("guest", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids=set()) is True


def test_member_allowed_nonmember_denied():
    g = uuid.uuid4()
    member = _u("engineer", uuid.uuid4())
    nonmember = _u("engineer", uuid.uuid4())
    assert check_object_policy("document_content_access", member, _doc(),
                               user_group_ids={g}, doc_group_ids={g}) is True
    assert check_object_policy("document_content_access", nonmember, _doc(),
                               user_group_ids={uuid.uuid4()}, doc_group_ids={g}) is False


def test_enforce_raises_for_nonmember():
    g = uuid.uuid4()
    with pytest.raises(HTTPException):
        enforce_object_policy("document_content_access", _u("engineer", uuid.uuid4()), _doc(),
                              user_group_ids=set(), doc_group_ids={g})
