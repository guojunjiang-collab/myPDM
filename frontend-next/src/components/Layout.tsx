import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

const navItems = [
  { path: '/dashboard', label: '仪表盘', icon: '📊', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/board', label: '用户看板', icon: '📋', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/parts', label: '零件管理', icon: '🔧', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/components', label: '部件管理', icon: '📦', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/documents', label: '图文档管理', icon: '📄', roles: ['admin', 'engineer', 'production', 'guest'] },
  { path: '/bom', label: '管理工具', icon: '📋', roles: ['admin', 'engineer', 'production'] },
  { path: '/users', label: '用户管理', icon: '👥', roles: ['admin'] },
  { path: '/logs', label: '操作日志', icon: '📝', roles: ['admin'] },
  { path: '/settings', label: '系统设置', icon: '⚙️', roles: ['admin'] },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const userRole = user?.role || 'guest';

  const visibleNavItems = navItems.filter((item) =>
    item.roles.includes(userRole)
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-semibold">🏗️ PDM系统</h1>
        </div>
        <nav className="flex-1 p-2">
          {visibleNavItems.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-200 text-sm text-gray-500">
          v1.0 · PDM系统
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
          <div className="left">
            <span className="text-gray-600">
              {navItems.find((item) => item.path === location.pathname)?.label || ''}
            </span>
          </div>
          <div className="right flex items-center gap-2">
            <span className="text-sm text-gray-500">{user?.real_name}</span>
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
    </div>
  );
}