import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePageHeader } from '../stores/pageHeader';
import { can, useAuthStore } from '../stores/auth';
import NotificationBell from '../components/NotificationBell';
import { MOBILE_TABS, MORE_ITEMS, filterVisible } from './nav';

export default function MobileLayout() {
  const user = useAuthStore((s) => s.user); // 订阅登录态：登录/角色变化时触发重渲染
  const tabs = filterVisible(MOBILE_TABS, can); // 组件体内重算，随 user 变化
  const moreTabs = filterVisible(MORE_ITEMS, can);
  const headerContent = usePageHeader((s) => s.content);
  const location = useLocation();
  // 标题匹配：底部 Tab + "更多"子页面（/dashboard /ec /inventory /configuration /notifications /settings）
  const current = [...tabs, ...moreTabs].find((t) => location.pathname.startsWith(t.path));
  const title = headerContent ?? current?.label ?? 'myPDM';
  return (
    <div className="h-full flex flex-col bg-gray-50">
      <header className="h-12 shrink-0 flex items-center px-3 bg-white border-b border-gray-200">
        {/* 主界面标题居中（铃铛左侧区域），各主界面共用 */}
        <span className="flex-1 min-w-0 text-center text-base font-medium truncate">{title}</span>
        <NotificationBell />
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
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="text-xs">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
