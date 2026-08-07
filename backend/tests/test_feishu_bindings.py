import uuid
import pytest
from sqlalchemy.exc import IntegrityError
from app import models


def test_binding_table_created(db):
    user = models.User(id=uuid.uuid4(), username="u1", password_hash="x",
                       real_name="用户", role="guest", status="active")
    db.add(user)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="uniq1", user_id=user.id))
    db.commit()
    row = db.query(models.UserFeishuBinding).filter_by(provider="feishu", union_id="uniq1").first()
    assert row.user_id == user.id


def test_binding_provider_union_unique(db):
    user = models.User(id=uuid.uuid4(), username="u1", password_hash="x",
                       real_name="用户", role="guest", status="active")
    db.add(user)
    db.flush()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="same", user_id=user.id))
    db.commit()
    db.add(models.UserFeishuBinding(provider="feishu", union_id="same", user_id=user.id))
    with pytest.raises(IntegrityError):
        db.commit()
