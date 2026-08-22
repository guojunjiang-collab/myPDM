import { Routes, Route, Navigate } from 'react-router-dom';
import MobileLayout from './MobileLayout';
import MorePage from './pages/MorePage';
import BoardPage from './pages/BoardPage';
import DashboardPage from './pages/DashboardPage';
import PartsListPage from './pages/PartsListPage';
import PartDetailPage from './pages/PartDetailPage';
import PartBomPage from './pages/PartBomPage';
import BomComparePage from './pages/BomComparePage';
import DocumentsListPage from './pages/DocumentsListPage';
import DocumentDetailPage from './pages/DocumentDetailPage';
import ProjectsPage from './pages/ProjectsPage';
import InventoryPage from './pages/InventoryPage';
import ConfigurationPage from './pages/ConfigurationPage';
import EcPage from './pages/EcPage';
import NotificationsPage from './pages/NotificationsPage';
import UsersListPage from './pages/UsersListPage';
import DesktopOnlyCard from './components/DesktopOnlyCard';

export default function MobileRoot() {
  return (
    <Routes>
      <Route element={<MobileLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="board" element={<BoardPage />} />
        <Route path="parts" element={<PartsListPage />} />
        <Route path="parts/compare" element={<BomComparePage />} />
        <Route path="parts/:id" element={<PartDetailPage />} />
        {/* BOM 逐级下钻：/parts/:id/bom（首层）与 /parts/:id/bom/:childId[/bom/:childId...]（任意深度）。
            用 splat（*）而非固定段路由：下钻路径会累积 /bom/:childId 段，固定路由无法匹配第 3 层及更深。 */}
        <Route path="parts/:id/bom/*" element={<PartBomPage />} />
        <Route path="documents" element={<DocumentsListPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="ec" element={<EcPage />} />
        <Route path="ec/ecr" element={<EcPage />} />
        <Route path="ec/eco" element={<EcPage />} />
        <Route path="ec/ecr/:id" element={<EcPage />} />
        <Route path="ec/eco/:id" element={<EcPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="configuration" element={<ConfigurationPage />} />
        <Route path="configuration/items" element={<ConfigurationPage />} />
        <Route path="configuration/profiles" element={<ConfigurationPage />} />
        {/* 项目进度：/projects 列表 → /projects/:id 详情（两级视图共用 ProjectsPage） */}
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="users" element={<UsersListPage />} />
        <Route path="settings" element={<DesktopOnlyCard feature="设置" />} />
        <Route path="more" element={<MorePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
