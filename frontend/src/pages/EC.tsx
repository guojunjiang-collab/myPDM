import { useState } from 'react';
import { ECRList } from '../components/ECR/ECRList';

type TabKey = 'ecr' | 'eco' | 'ecn';

const tabs: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'ecr', label: '变更请求 (ECR)', enabled: true },
  { key: 'eco', label: '变更单 (ECO)', enabled: false },
  { key: 'ecn', label: '变更通知 (ECN)', enabled: false },
];

export default function EC() {
  const [activeTab, setActiveTab] = useState<TabKey>('ecr');

  return (
    <div className="flex flex-col h-full">
      {/* TAB 导航 */}
      <div className="flex border-b border-gray-200 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => tab.enabled && setActiveTab(tab.key)}
            disabled={!tab.enabled}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            } ${!tab.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 内容 */}
      {activeTab === 'ecr' && <ECRList />}
      {activeTab === 'eco' && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-sm text-gray-400">功能开发中，敬请期待</p>
        </div>
      )}
      {activeTab === 'ecn' && (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-sm text-gray-400">功能开发中，敬请期待</p>
        </div>
      )}
    </div>
  );
}
