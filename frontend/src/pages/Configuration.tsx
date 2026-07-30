import { useState, useCallback, useRef } from 'react';
import ConfigurationList from '../components/Configuration/ConfigurationList';
import ProfileList from '../components/Configuration/ProfileList';
import ConfigItemDetailModal from '../components/Configuration/ConfigItemDetailModal';
import { useHeaderTabs } from '../hooks/useHeaderTabs';
import { usePersistedTabState } from '../hooks/usePersistedTabState';

type TabKey = 'effectivity' | 'single-config';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'effectivity', label: '构型项管理' },
  { key: 'single-config', label: '构型配置' },
];

export default function Configuration() {
  const [activeTab, setActiveTab] = usePersistedTabState<TabKey>('effectivity');
  useHeaderTabs(tabs, activeTab, setActiveTab);

  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const pendingPatchRef = useRef<{ revisionId: string; code?: string; name?: string } | null>(null);

  const handleDetailClose = useCallback((savedPatch?: Record<string, string>) => {
    if (savedPatch && selectedRevisionId) {
      pendingPatchRef.current = { revisionId: selectedRevisionId, ...savedPatch };
    }
    setSelectedRevisionId(null);
    setListKey(k => k + 1);
  }, [selectedRevisionId]);

  return (
    <div className="flex flex-col h-full">
      {activeTab === 'effectivity' && (
        <ConfigurationList refreshTrigger={listKey} pendingPatch={pendingPatchRef} onOpenDetail={setSelectedRevisionId} />
      )}
      {activeTab === 'single-config' && <ProfileList />}

      <ConfigItemDetailModal
        revisionId={selectedRevisionId || ''}
        open={!!selectedRevisionId}
        onClose={handleDetailClose}
      />
    </div>
  );
}
