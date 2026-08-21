import { Routes, Route, Navigate } from 'react-router-dom';
import MobileLayout from './MobileLayout';
import MorePage from './pages/MorePage';

// 后续任务逐步替换占位页为真实移动页面
function Placeholder({ name }: { name: string }) {
  return <div className="p-4 text-gray-500">{name}（待实现）</div>;
}

export default function MobileRoot() {
  return (
    <Routes>
      <Route element={<MobileLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Placeholder name="仪表盘" />} />
        <Route path="board" element={<Placeholder name="看板" />} />
        <Route path="parts" element={<Placeholder name="零部件" />} />
        <Route path="documents" element={<Placeholder name="图文档" />} />
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
