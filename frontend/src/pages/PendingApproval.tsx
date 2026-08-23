import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function PendingApproval() {
  const navigate = useNavigate();
  const [notified, setNotified] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNotify = async () => {
    setLoading(true);
    try {
      const res = await authApi.requestApproval();
      if (res.already_notified) {
        setNotified(true);
      } else if (res.notified_count > 0) {
        setNotified(true);
      }
    } catch {
      /* 静默处理 */
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    useAuthStore.getState().logout();
    localStorage.removeItem('refresh_token');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[var(--ui-bg-subtle)] flex items-center justify-center">
      <div className="bg-[var(--ui-bg-surface)] rounded-xl shadow-sm p-10 max-w-md w-full text-center border border-gray-100">
        <div className="text-5xl mb-4">&#x23F3;</div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">等待审批</h1>
        <p className="text-[var(--ui-text-secondary)] text-sm leading-relaxed mb-8">
          您的账号正在等待管理员审批，
          <br />
          审批通过后即可正常使用系统功能。
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleNotify}
            disabled={notified || loading}
            className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
              notified
                ? 'bg-gray-100 text-[var(--ui-text-tertiary)] cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {loading ? '发送中...' : notified ? '已通知' : '通知管理员'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full py-2.5 rounded-lg font-medium text-[var(--ui-text-secondary)] hover:text-gray-700 hover:bg-[var(--ui-bg-hover)] transition-colors"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
