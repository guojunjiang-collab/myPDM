import pytest
from fastapi import HTTPException
from types import SimpleNamespace


def _user(role):
    return SimpleNamespace(role=role, status="active")


def test_has_permission_true_false():
    from app.permissions import has_permission, PERMISSIONS

    assert has_permission(_user("admin"), "parts:delete") is True
    assert has_permission(_user("engineer"), "parts:delete") is False


def test_has_permission_unknown_raises():
    from app.permissions import has_permission

    with pytest.raises(KeyError):
        has_permission(_user("admin"), "parts:nope")


@pytest.mark.asyncio
async def test_require_permission_allows_and_denies():
    from app.permissions import require_permission

    checker = require_permission("parts:create")
    assert (await checker(current_user=_user("engineer"))).role == "engineer"
    with pytest.raises(HTTPException) as exc:
        await checker(current_user=_user("guest"))
    assert exc.value.status_code == 403


def test_require_permission_unknown_perm_raises_at_build():
    from app.permissions import require_permission

    with pytest.raises(KeyError):
        require_permission("totally:fake")
