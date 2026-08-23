import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore, can } from '../stores/auth';
import { useDataStore } from '../stores/data';
import { usePageHeader } from '../stores/pageHeader';
import { useNotificationStore } from '../stores/notification';
import { syncService } from '../services/syncService';
import { APP_VERSION } from '../constants';
import { ConfirmModal } from './Modal';
import Badge from './ui/Badge';
import FloatingAssistant from './assistant/FloatingAssistant';
import NotificationBell from './NotificationBell';
import type { Permission } from '../constants/permissions.generated';

type NavItem = {
  path: string;
  label: string;
  icon: string;
  /** 导航可见性权限（permissions.json 的 nav.* 项），与后端同一事实源 */
  perm: Permission;
};

type NavSeparator = {
  type: 'separator';
};

const navItems: (NavItem | NavSeparator)[] = [
  { path: '/dashboard', label: '仪表盘', icon: '📊', perm: 'nav.dashboard' },
  { path: '/board', label: '用户看板', icon: '📋', perm: 'nav.board' },
  { type: 'separator' },
  { path: '/configuration', label: '构型管理', icon: '📐', perm: 'nav.configuration' },
  { path: '/parts', label: '零部件管理', icon: '📦', perm: 'nav.parts' },
  { path: '/documents', label: '图文档管理', icon: '📄', perm: 'nav.documents' },
  { type: 'separator' },
  { path: '/ec', label: '变更管理', icon: '🔄', perm: 'nav.ec' },
  { path: '/inventory', label: '库存管理', icon: '🏬', perm: 'nav.inventory' },
  { path: '/projects', label: '项目管理', icon: '🗂️', perm: 'nav.projects' },
  { type: 'separator' },
  { path: '/users', label: '用户管理', icon: '👥', perm: 'nav.users' },
  { path: '/settings', label: '系统设置', icon: '⚙️', perm: 'nav.settings' },
  { type: 'separator' },
  { path: '/help', label: '帮助文档', icon: '❓', perm: 'nav.help' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { syncAll, isSyncing, clearCache, lastSyncTime, autoSyncEnabled, setAutoSyncEnabled, syncError } = useDataStore();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [lastSyncText, setLastSyncText] = useState<string>('--');
  const headerContent = usePageHeader((s) => s.content);
  const fetchUnread = useNotificationStore((s) => s.fetchUnread);

  // Auto-start sync on mount
  useEffect(() => {
    if (autoSyncEnabled) {
      syncService.start();
    }
    return () => {
      syncService.stop();
    };
  }, [autoSyncEnabled]);

  // Update sync time display
  useEffect(() => {
    if (!lastSyncTime) { setLastSyncText('--'); return; }
    const update = () => {
      const seconds = Math.floor((Date.now() / 1000) - lastSyncTime);
      if (seconds < 60) setLastSyncText(`${seconds}秒前`);
      else if (seconds < 3600) setLastSyncText(`${Math.floor(seconds/60)}分钟前`);
      else setLastSyncText(new Date(lastSyncTime * 1000).toLocaleTimeString());
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastSyncTime]);

  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, 10000);
    return () => clearInterval(t);
  }, [fetchUnread]);

  const isSeparator = (item: NavItem | NavSeparator): item is NavSeparator =>
    'type' in item && item.type === 'separator';

  const visibleNavItems = navItems.filter((item) =>
    isSeparator(item) || can(item.perm)
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
    <div className="flex h-screen bg-[var(--ui-bg-subtle)]">
      {/* 侧边栏 */}
      <aside className="w-56 min-w-56 bg-[var(--ui-bg-surface)] border-r border-[var(--ui-border)] flex flex-col">
        <div className="h-14 bg-[var(--ui-bg-surface)] border-b border-[var(--ui-border)] flex items-center px-4">
          <h1 className="text-lg font-semibold">🏗️ {import.meta.env.VITE_APP_TITLE || 'PDM系统'}</h1>
        </div>
        <nav className="flex-1 p-2">
          {visibleNavItems.map((item, idx) =>
            isSeparator(item) ? (
              <div key={`sep-${idx}`} className="mx-2 my-2 border-t border-gray-300" />
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-hover)]'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          )}
        </nav>
        <div className="p-2 border-t border-[var(--ui-border)]">
          {syncMsg && (
            <div className={`text-xs px-2 py-1 rounded text-center mb-1 ${syncMsg.includes('成功') || syncMsg.includes('已清除') ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
              {syncMsg}
            </div>
          )}
          <div className="text-xs text-[var(--ui-text-tertiary)] text-center">{APP_VERSION} · {import.meta.env.VITE_APP_TITLE || 'PDM系统'}</div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-14 bg-[var(--ui-bg-surface)] border-b border-[var(--ui-border)] flex items-center justify-between px-4">
          <div className="left">
            {headerContent ?? (
              <span className="text-lg font-semibold text-gray-800">
                {(navItems.filter((item): item is NavItem => !isSeparator(item)).find((item) => item.path === location.pathname))?.label || ''}
              </span>
            )}
          </div>
          <div className="right flex items-center gap-3">
            {/* 同步状态指示器 */}
            <div className="flex items-center gap-1 text-xs" title={`上次同步: ${lastSyncText}${syncError ? ' | 错误: ' + syncError : ''}`}>
              <span className={`inline-block w-2 h-2 rounded-full ${
                syncError ? 'bg-red-500' : isSyncing ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'
              }`}></span>
              <span className="text-[var(--ui-text-tertiary)]">
                {syncError ? '同步失败' : isSyncing ? '同步中' : `已同步 (${lastSyncText})`}
              </span>
              {syncError && (
                <button onClick={() => {
                  syncService.stop();
                  syncService.start();
                }} className="text-blue-400 hover:text-blue-300 ml-1" title="重试">↻</button>
              )}
            </div>
            <NotificationBell />
            <span className="text-sm text-gray-700">{user?.real_name}</span>
            <Badge status={user?.role ?? 'guest'} domain="role" />
            <span className="text-gray-300">|</span>
            {/* 自动同步已启用，手动检出改为小图标 */}
            <button
              onClick={() => setConfirmSyncOpen(true)}
              disabled={isSyncing}
              className="text-gray-300 hover:text-blue-500 disabled:opacity-30 text-sm"
              title="手动强制同步"
            >
              {isSyncing ? '⟳' : '↻'}
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-[var(--ui-bg-hover)]"
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
      <FloatingAssistant />
    </div>
  );
}