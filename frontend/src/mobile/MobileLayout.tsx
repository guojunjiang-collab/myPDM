import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePageHeader } from '../stores/pageHeader';
import { useNotificationStore } from '../stores/notification';
import { can, useAuthStore } from '../stores/auth';
import { MOBILE_TABS, MORE_ITEMS, filterVisible } from './nav';
import { useHelpDrawer } from './helpDrawer';

export default function MobileLayout() {
  const user = useAuthStore((s) => s.user); // 订阅登录态：登录/角色变化时触发重渲染
  const tabs = filterVisible(MOBILE_TABS, can); // 组件体内重算，随 user 变化
  const moreTabs = filterVisible(MORE_ITEMS, can);
  const headerContent = usePageHeader((s) => s.content);
  const location = useLocation();
  const openHelpDrawer = useHelpDrawer((s) => s.setOpen);
  // 标题匹配：底部 Tab + "更多"子页面（/dashboard /ec /inventory /configuration /notifications /settings）
  const current = [...tabs, ...moreTabs].find((t) => location.pathname.startsWith(t.path));
  const title = headerContent ?? current?.label ?? 'myPDM';
  // 帮助文档页：顶部标题栏右侧显示「目录」按钮（HelpPage 不再有独立标题栏）
  const isHelpPage = location.pathname.startsWith('/help');

  // 未读数：挂载拉取 + 30s 轮询（铃铛已移除，未读数显示在"更多"Tab 与"通知中心"菜单）
  const unread = useNotificationStore((s) => s.unread);
  const fetchUnread = useNotificationStore((s) => s.fetchUnread);
  useEffect(() => {
    fetchUnread();
    const t = setInterval(fetchUnread, 30000);
    return () => clearInterval(t);
  }, [fetchUnread]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <header className="h-12 shrink-0 relative flex items-center justify-center px-3 bg-white border-b border-gray-200">
        <span className="min-w-0 text-center text-base font-medium truncate">{title}</span>
        {/* 帮助文档页：目录按钮固定在标题栏右侧 */}
        {isHelpPage && (
          <button
            type="button"
            onClick={() => openHelpDrawer(true)}
            className="absolute right-3 min-h-7 px-2.5 rounded-lg bg-primary-600 text-white text-xs flex items-center gap-1"
          >
            <span>☰</span> 目录
          </button>
        )}
      </header>
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 inset-x-0 h-14 bg-white border-t border-gray-200 flex z-20">
        {tabs.map((t) => (
          <NavLink
            key={t.key}
            to={t.path}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 ${isActive ? 'text-primary-600' : 'text-gray-500'}`
            }
          >
            <span className="relative text-lg leading-none">
              {t.icon}
              {t.key === 'more' && unread > 0 && (
                <span className="absolute -top-1 -right-2.5 bg-red-500 text-white text-[10px] rounded-full px-1 leading-4 min-w-[16px] text-center">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span className="text-xs">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
