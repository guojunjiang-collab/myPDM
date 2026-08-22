import PartDetailPage from '../pages/PartDetailPage';
import DocumentDetailPage from '../pages/DocumentDetailPage';
import ProjectsPage from '../pages/ProjectsPage';
import EcPage from '../pages/EcPage';
import type { DetailTarget } from '../hooks/useDetailOverlay';

/**
 * 详情覆盖层栈渲染（零部件/图文档列表、看板等主界面共用）：
 * 全部层级渲染（隐藏非栈顶，状态/滚动保留），页面 ‹ 与全面屏返回手势统一走 history.back() 逐级弹出。
 */
export default function DetailOverlayStack({
  stack,
  onNavigate,
}: {
  stack: DetailTarget[];
  onNavigate: (to: string) => void;
}) {
  return (
    <>
      {stack.map((d, idx) => (
        <div
          key={idx}
          className={`fixed inset-0 z-50 bg-gray-50 overflow-y-auto ${idx === stack.length - 1 ? '' : 'hidden'}`}
        >
          {renderLayer(d, onNavigate)}
        </div>
      ))}
    </>
  );
}

function renderLayer(d: DetailTarget, onNavigate: (to: string) => void) {
  const onBack = () => window.history.back();
  switch (d.kind) {
    case 'part':
      return <PartDetailPage masterId={d.id} revisionId={d.rev} onBack={onBack} onNavigate={onNavigate} />;
    case 'document':
      return <DocumentDetailPage id={d.id} onBack={onBack} onNavigate={onNavigate} />;
    case 'project':
      return <ProjectsPage detailId={d.id} onBack={onBack} />;
    case 'ec':
      return <EcPage detail={{ kind: d.ecType, id: d.id }} onBack={onBack} />;
  }
}
