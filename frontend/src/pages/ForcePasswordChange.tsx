import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function ForcePasswordChange() {
  const navigate = useNavigate();
  const { user, token, logout } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (newPassword === oldPassword) {
      setError('新密码不能与原密码相同');
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) ||
        !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('新密码至少8位，且需同时包含大写字母、小写字母和数字');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      const me = await authApi.getCurrentUser();
      useAuthStore.getState().setUser(me.data, token);
      navigate('/', { replace: true });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail) && detail[0]?.msg) {
        setError(String(detail[0].msg).replace(/^Value error, /, ''));
      } else {
        setError('修改失败，请重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          退出登录
        </button>
      </div>

      <div className="flex justify-center px-4">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
          <h1 className="text-xl font-semibold mb-2">请修改密码</h1>
          <p className="text-sm text-gray-500 mb-6">
            {user?.real_name ? `${user.real_name}，` : ''}
            你的密码需要重新设置后才能继续使用系统。这通常是因为你是首次登录，或管理员刚重置了你的密码。
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">原密码</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
              <p className="mt-1 text-xs text-gray-400">至少8位，需包含大写字母、小写字母和数字</p>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>

            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '提交中...' : '确认修改'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
