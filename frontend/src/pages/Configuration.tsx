import { useState } from 'react';
import ConfigurationList from '../components/Configuration/ConfigurationList';
import ProfileList from '../components/Configuration/ProfileList';
import { useHeaderTabs } from '../hooks/useHeaderTabs';

type TabKey = 'effectivity' | 'single-config';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'effectivity', label: '构型项管理' },
  { key: 'single-config', label: '构型配置' },
];

export default function Configuration() {
  const [activeTab, setActiveTab] = useState<TabKey>('effectivity');
  useHeaderTabs(tabs, activeTab, setActiveTab);

  return (
    <div className="flex flex-col h-full">
      {activeTab === 'effectivity' && <ConfigurationList />}
      {activeTab === 'single-config' && <ProfileList />}
    </div>
  );
}
