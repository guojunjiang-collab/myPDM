import pytest
from pydantic import ValidationError
from app import schemas


def test_user_create_rejects_bad_role():
    with pytest.raises(ValidationError):
        schemas.UserCreate(username="abc", real_name="x", role="superuser", password="123456")


def test_user_create_accepts_valid_role():
    schemas.UserCreate(username="abc", real_name="x", role="engineer", password="123456")


def test_user_update_rejects_bad_role():
    with pytest.raises(ValidationError):
        schemas.UserUpdate(role="superuser")


def test_user_update_accepts_none_role():
    schemas.UserUpdate(role=None)


def test_user_update_accepts_valid_role():
    schemas.UserUpdate(role="admin")
