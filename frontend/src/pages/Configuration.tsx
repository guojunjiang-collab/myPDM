import { useState } from 'react';
import ConfigurationList from '../components/Configuration/ConfigurationList';
import ProfileList from '../components/Configuration/ProfileList';

type TabKey = 'effectivity' | 'single-config';

const tabs: { key: TabKey; label: string; enabled: boolean }[] = [
  { key: 'effectivity', label: '构型项管理', enabled: true },
  { key: 'single-config', label: '构型配置', enabled: true },
];

export default function Configuration() {
  const [activeTab, setActiveTab] = useState<TabKey>('effectivity');

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
      {activeTab === 'effectivity' && <ConfigurationList />}
      {activeTab === 'single-config' && <ProfileList />}
    </div>
  );
}
