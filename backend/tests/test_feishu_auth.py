import uuid
import pytest
from app import crud, models


def test_find_or_create_creates_guest_user(db):
    user = crud.find_or_create_feishu_user(
        db, "feishu",
        {"union_id": "u1", "name": "张三", "open_id": "o1", "avatar_url": "http://a"},
    )
    assert user.role == "guest"
    assert user.must_change_password is False
    assert user.real_name == "张三"
    assert user.username == "张三"
    binding = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="u1").first()
    assert binding is not None
    assert binding.user_id == user.id


def test_find_or_create_returns_same_user(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "u1", "name": "张三"})
    assert user1.id == user2.id
    assert db.query(models.UserFeishuBinding).count() == 1


def test_username_collision_fallback(db):
    user1 = crud.find_or_create_feishu_user(db, "feishu", {"union_id": "a", "name": "张三"})
    user2 = crud.find_or_create_feishu_user(db, "feishu_eh", {"union_id": "b", "name": "张三"})
    assert user1.username == "张三"
    assert user2.username != "张三"
    assert user2.username.startswith("张三")
