"""测试 unverified 角色：权限拒绝 / 通知服务逻辑。"""
from unittest.mock import MagicMock


class TestUnverifiedPermissions:
    """验证 unverified 角色在权限矩阵中无任何权限。"""

    def test_unverified_in_permissions_roles(self):
        from app.permissions._generated import ROLES
        assert "unverified" in ROLES

    def test_unverified_has_no_permissions(self):
        from app.permissions._generated import PERMISSIONS
        for perm, roles in PERMISSIONS.items():
            assert "unverified" not in roles, f"unverified 不应拥有权限 {perm}"


class TestNotificationHelpers:
    """测试通知工具函数的逻辑正确性。"""

    def test_has_pending_notification_returns_bool(self):
        from app import notifications
        db = MagicMock()

        db.query.return_value.filter.return_value.first.return_value = None
        assert notifications.has_pending_approval_notification(db, "uid") is False

        db.query.return_value.filter.return_value.first.return_value = object()
        assert notifications.has_pending_approval_notification(db, "uid") is True

    def test_resolve_approval_notifications_calls_commit(self):
        from app import notifications
        db = MagicMock()
        db.query.return_value.filter.return_value.filter.return_value.update.return_value = 5
        notifications.resolve_approval_notifications(db, "uid")
        db.commit.assert_called_once()
