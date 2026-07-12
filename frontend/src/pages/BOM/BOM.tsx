import { useState } from 'react';
import PartDetailModal from '../../components/PartDetailModal';
import BOMTreePanel from './BOMTreePanel';
import BOMComparePanel from './BOMComparePanel';
import BOMTracePanel from './BOMTracePanel';
import DocTracePanel from './DocTracePanel';
import { useHeaderTabs } from '../../hooks/useHeaderTabs';
import { usePersistedTabState } from '../../hooks/usePersistedTabState';

type ModeKey = 'tree' | 'compare' | 'trace' | 'doc-trace';
const modeTabs: { key: ModeKey; label: string }[] = [
  { key: 'tree', label: 'BOM 树' },
  { key: 'compare', label: 'BOM 对比' },
  { key: 'trace', label: 'BOM 反查' },
  { key: 'doc-trace', label: '图文档反查' },
];

export default function BOM() {
  const [mode, setMode] = usePersistedTabState<ModeKey>('tree');

  // 将模式 Tab 注入顶栏，替代默认的“管理工具”标题，节省一行高度、内容区更高
  useHeaderTabs(modeTabs, mode, setMode);

  // 行点击详情弹窗（统一复用零部件详情弹窗，基于 revision 模型）
  const [detail, setDetail] = useState<{ masterId: string; revisionId?: string } | null>(null);

  // 打开零部件详情：masterId 必填，revisionId 可选（缺省时弹窗自动取最新版本）
  const handleViewEntity = (masterId: string, revisionId?: string) => {
    if (!masterId) return;
    setDetail({ masterId, revisionId });
  };

  return (
    <div>
      {/* 各模式 Panel */}
      {mode === 'tree'      && <BOMTreePanel onViewEntity={handleViewEntity} />}
      {mode === 'compare'   && <BOMComparePanel onViewEntity={handleViewEntity} />}
      {mode === 'trace'     && <BOMTracePanel onViewEntity={handleViewEntity} />}
      {mode === 'doc-trace' && <DocTracePanel onViewEntity={handleViewEntity} />}

      {/* 行点击详情弹窗 */}
      {detail && (
        <PartDetailModal
          open={!!detail}
          masterId={detail.masterId}
          revisionId={detail.revisionId}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
