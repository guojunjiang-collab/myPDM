import { useState } from 'react';
import { ECRList } from '../components/ECR/ECRList';
import { ECOList } from '../components/ECO/ECOList';

type TabKey = 'ecr' | 'eco' | 'ecn';

const tabs: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'ecr', label: '工程变更请求(ECR)', enabled: true },
  { key: 'eco', label: '工程变更指令(ECO)', enabled: true },
  { key: 'ecn', label: '工程变更通知(ECN)', enabled: false },
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
            className={`px-4 py-2 text-lg font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            } ${!tab.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 内容 */}
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
