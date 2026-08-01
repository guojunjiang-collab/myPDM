import uuid
import pytest
from types import SimpleNamespace
from fastapi import HTTPException
from app.permissions.policies import enforce_object_policy, check_object_policy


def _u(role, uid):
    return SimpleNamespace(role=role, id=uid)


def _doc():
    """纯占位对象：策略不再从对象上读 creator_id（v3.1.3 起该列在迭代层）。"""
    return SimpleNamespace(id=uuid.uuid4())


def test_admin_always_allowed():
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("admin", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids={g}) is True


def test_creator_always_allowed():
    """创建者放行 —— creator_id 由调用方（crud_groups 回溯迭代层）显式传入。"""
    uid = uuid.uuid4()
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("engineer", uid), _doc(),
                               user_group_ids=set(), doc_group_ids={g}, creator_id=uid) is True


def test_other_user_not_treated_as_creator():
    g = uuid.uuid4()
    assert check_object_policy("document_content_access", _u("engineer", uuid.uuid4()), _doc(),
                               user_group_ids=set(), doc_group_ids={g},
                               creator_id=uuid.uuid4()) is False


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
