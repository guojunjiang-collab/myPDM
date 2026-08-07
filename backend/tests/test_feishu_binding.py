import uuid

import pytest

from app import crud, models


def _mk_user(db, username="u", role="engineer", status="active"):
    user = models.User(
        id=uuid.uuid4(), username=username, password_hash="x",
        real_name=username, role=role, status=status,
    )
    db.add(user)
    db.flush()
    return user


def _mk_binding(db, provider, union_id, user_id):
    b = models.UserFeishuBinding(provider=provider, union_id=union_id, user_id=user_id)
    db.add(b)
    db.flush()
    return b


def test_bind_creates_binding(db):
    user = _mk_user(db)
    result = crud.bind_feishu_to_user(
        db, "feishu", "union_1", user.id,
        {"name": "张三", "avatar_url": "http://a", "open_id": "o1"},
    )
    assert result.id == user.id
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding is not None
    assert binding.user_id == user.id
    assert binding.name == "张三"


def test_bind_same_user_idempotent(db):
    user = _mk_user(db)
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三"})
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三新"})
    assert db.query(models.UserFeishuBinding).count() == 1
    binding = db.query(models.UserFeishuBinding).first()
    assert binding.name == "张三新"


def test_bind_takes_over_guest_and_disables_it(db):
    guest = _mk_user(db, username="guest1", role="guest")
    _mk_binding(db, "feishu", "union_1", guest.id)
    real = _mk_user(db, username="real")
    result = crud.bind_feishu_to_user(db, "feishu", "union_1", real.id, {"name": "李四"})
    assert result.id == real.id
    db.refresh(guest)
    assert guest.status == "disabled"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="union_1").first()
    assert binding.user_id == real.id


def test_bind_rejects_non_guest_conflict(db):
    other = _mk_user(db, username="other", role="engineer")
    _mk_binding(db, "feishu", "union_1", other.id)
    me = _mk_user(db, username="me")
    with pytest.raises(ValueError):
        crud.bind_feishu_to_user(db, "feishu", "union_1", me.id, {"name": "我"})


def test_bind_providers_isolated(db):
    user = _mk_user(db)
    crud.bind_feishu_to_user(db, "feishu", "union_1", user.id, {"name": "张三"})
    crud.bind_feishu_to_user(db, "feishu_eh", "union_1", user.id, {"name": "张三"})
    assert db.query(models.UserFeishuBinding).count() == 2


def test_get_user_feishu_bindings(db):
    user = _mk_user(db)
    _mk_binding(db, "feishu", "u1", user.id)
    _mk_binding(db, "feishu_eh", "u2", user.id)
    rows = crud.get_user_feishu_bindings(db, user.id)
    assert {r.provider for r in rows} == {"feishu", "feishu_eh"}
