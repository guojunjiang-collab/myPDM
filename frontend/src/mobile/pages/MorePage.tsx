import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore, can } from '../../stores/auth';
import { useNotificationStore } from '../../stores/notification';
import { MORE_ITEMS, filterVisible } from '../nav';

export default function MorePage() {
  const { user, logout } = useAuthStore();
  const items = filterVisible(MORE_ITEMS, can);
  // 未读数：显示在"通知中心"菜单右侧
  const unread = useNotificationStore((s) => s.unread);
  const fetchUnread = useNotificationStore((s) => s.fetchUnread);
  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="bg-white rounded-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center text-lg">
          {user?.real_name?.[0] ?? '?'}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">{user?.real_name ?? user?.username}</div>
          <div className="text-xs text-gray-500 truncate">{user?.role ?? ''}</div>
        </div>
      </div>
      <div className="bg-white rounded-lg divide-y divide-gray-100">
        {items.map((t) => (
          <Link key={t.key} to={t.path} className="flex items-center gap-3 px-4 py-3 min-h-12">
            <span className="text-lg">{t.icon}</span>
            <span className="text-sm">{t.label}</span>
            {t.key === 'notifications' && unread > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
        ))}
      </div>
      <button
        onClick={logout}
        className="min-h-12 bg-white rounded-lg text-red-600 text-sm font-medium"
      >
        退出登录
      </button>
    </div>
  );
}
