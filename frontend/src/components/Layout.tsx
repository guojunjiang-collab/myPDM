import { useState } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useDataStore } from '../stores/data';
import { APP_VERSION } from '../constants';
import { ConfirmModal } from './Modal';

const navItems = [
  { path: '/dashboard', label: '仪表盘', icon: '📊', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/board', label: '用户看板', icon: '📋', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/bom', label: '管理工具', icon: '🛠️', roles: ['admin', 'engineer', 'production'] },
  { path: '/parts', label: '零件管理', icon: '🔧', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/components', label: '部件管理', icon: '📦', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/documents', label: '图文档管理', icon: '📄', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/inventory', label: '库存管理', icon: '🏗️', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/ec', label: '变更管理', icon: '🔄', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/business', label: '业务管理', icon: '💼', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/users', label: '用户管理', icon: '👥', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/settings', label: '系统设置', icon: '⚙️', roles: ['admin', 'engineer', 'production', 'guest'] },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { syncAll, isSyncing, clearCache } = useDataStore();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const userRole = user?.role || 'guest';

  const visibleNavItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  );

  const handleSync = async () => {
    setConfirmSyncOpen(false);
    setSyncMsg(null);
    try {
      await syncAll();
      setSyncMsg('检出成功');
      setTimeout(() => setSyncMsg(null), 3000);
    } catch {
      setSyncMsg('检出失败');
      setTimeout(() => setSyncMsg(null), 3000);
    }
  };

  const handleClearCache = () => {
    setConfirmClearOpen(false);
    clearCache();
    localStorage.removeItem('data-storage');
    setSyncMsg('缓存已清除');
    setTimeout(() => {
      setSyncMsg(null);
      window.location.reload();
    }, 500);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="w-56 min-w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4">
          <h1 className="text-lg font-semibold">🏗️ PDM系统</h1>
        </div>
        <nav className="flex-1 p-2">
          {visibleNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-200">
          {syncMsg && (
            <div className={`text-xs px-2 py-1 rounded text-center mb-1 ${syncMsg.includes('成功') || syncMsg.includes('已清除') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
              {syncMsg}
            </div>
          )}
          <div className="text-xs text-gray-400 text-center">{APP_VERSION} · PDM系统</div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
          <div className="left">
            <span className="text-lg font-semibold text-gray-800">
              {navItems.find((item) => item.path === location.pathname)?.label || ''}
            </span>
          </div>
          <div className="right flex items-center gap-3">
            <span className="text-sm text-gray-700">{user?.real_name}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${user?.role === 'admin' ? 'bg-red-100 text-red-700' : user?.role === 'engineer' ? 'bg-blue-100 text-blue-700' : user?.role === 'production' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
              {{ admin: '管理员', engineer: '工程师', production: '生产人员', guest: '访客' }[user?.role || 'guest'] || user?.role}
            </span>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => setConfirmSyncOpen(true)}
              disabled={isSyncing}
              className="px-3 py-1 text-sm text-blue-600 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
              title="从服务器检出最新数据到本地"
            >
              {isSyncing ? '同步中...' : '检出数据'}
            </button>
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="px-3 py-1 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50"
              title="清除本地缓存数据"
            >
              清除缓存
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              退出登录
            </button>
          </div>
        </header>

        {/* 内容区 */}
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>

      <ConfirmModal
        open={confirmSyncOpen}
        title="检出数据"
        content="将从服务器检出最新数据到本地缓存，确认继续？"
        confirmText="检出"
        cancelText="取消"
        type="info"
        onConfirm={handleSync}
        onCancel={() => setConfirmSyncOpen(false)}
      />
      <ConfirmModal
        open={confirmClearOpen}
        title="清除缓存"
        content="将清除所有本地缓存数据，页面将自动刷新，确认继续？"
        confirmText="清除"
        cancelText="取消"
        type="danger"
        onConfirm={handleClearCache}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}