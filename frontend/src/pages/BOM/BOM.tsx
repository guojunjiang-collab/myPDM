import { useState } from 'react';
import PartDetailModal from '../../components/PartDetailModal';
import BOMTreePanel from './BOMTreePanel';

export default function BOM() {
  const [detail, setDetail] = useState<{ masterId: string; revisionId?: string } | null>(null);

  const handleViewEntity = (masterId: string, revisionId?: string) => {
    if (!masterId) return;
    setDetail({ masterId, revisionId });
  };

  return (
    <div>
      <BOMTreePanel onViewEntity={handleViewEntity} />
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
