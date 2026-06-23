import { useState } from 'react';
import { ECRList } from '../components/ECR/ECRList';
import { ECOList } from '../components/ECO/ECOList';
import { useHeaderTabs } from '../hooks/useHeaderTabs';

type TabKey = 'ecr' | 'eco' | 'ecn';

const tabs: { key: TabKey; label: string; enabled?: boolean }[] = [
  { key: 'ecr', label: '工程变更请求(ECR)' },
  { key: 'eco', label: '工程变更指令(ECO)' },
  { key: 'ecn', label: '工程变更通知(ECN)', enabled: false },
];

export default function EC() {
  const [activeTab, setActiveTab] = useState<TabKey>('ecr');
  useHeaderTabs(tabs, activeTab, setActiveTab);

  return (
    <div className="flex flex-col h-full">
      {activeTab === 'ecr' && <ECRList />}
      {activeTab === 'eco' && <ECOList />}
      {activeTab === 'ecn' && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-sm text-gray-400">功能开发中，敬请期待</p>
        </div>
      )}
    </div>
  );
}
