import { Routes, Route, Navigate } from 'react-router-dom';
import MobileLayout from './MobileLayout';
import MorePage from './pages/MorePage';
import BoardPage from './pages/BoardPage';
import DashboardPage from './pages/DashboardPage';
import PartsListPage from './pages/PartsListPage';
import PartDetailPage from './pages/PartDetailPage';
import PartBomPage from './pages/PartBomPage';
import DocumentsListPage from './pages/DocumentsListPage';
import DocumentDetailPage from './pages/DocumentDetailPage';

// 后续任务逐步替换占位页为真实移动页面
function Placeholder({ name }: { name: string }) {
  return <div className="p-4 text-gray-500">{name}（待实现）</div>;
}

export default function MobileRoot() {
  return (
    <Routes>
      <Route element={<MobileLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="parts" element={<PartsListPage />} />
        <Route path="parts/:id" element={<PartDetailPage />} />
        {/* BOM 逐级下钻：/parts/:id/bom（首层）与 /parts/:id/bom/:childId[/bom/:childId...]（任意深度）。
            用 splat（*）而非固定段路由：下钻路径会累积 /bom/:childId 段，固定路由无法匹配第 3 层及更深。 */}
        <Route path="parts/:id/bom/*" element={<PartBomPage />} />
        <Route path="documents" element={<DocumentsListPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="ec" element={<Placeholder name="变更" />} />
        <Route path="inventory" element={<Placeholder name="库存" />} />
        <Route path="configuration" element={<Placeholder name="构型" />} />
        <Route path="projects" element={<Placeholder name="项目" />} />
        <Route path="notifications" element={<Placeholder name="通知" />} />
        <Route path="settings" element={<Placeholder name="设置" />} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
