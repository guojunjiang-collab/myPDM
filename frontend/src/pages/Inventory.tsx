import { useState, useEffect } from 'react';
import { useInventoryStore } from '../stores/inventory';
import StockTab from '../components/Inventory/StockTab';
import DocumentTab from '../components/Inventory/DocumentTab';
import MaterialTab from '../components/Inventory/MaterialTab';
import WarehouseTab from '../components/Inventory/WarehouseTab';

type TabKey = 'stock' | 'documents' | 'materials' | 'warehouses';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'stock', label: '库存查询' },
  { key: 'documents', label: '单据' },
  { key: 'materials', label: '物料主数据' },
  { key: 'warehouses', label: '仓库' },
];

export default function Inventory() {
  const [activeTab, setActiveTab] = useState<TabKey>('stock');
  const { loadWarehouses, loadUsers } = useInventoryStore();

  useEffect(() => { loadWarehouses(); loadUsers(); }, [loadWarehouses, loadUsers]);

  return (
    <div className="flex flex-col h-full">
      {/* TAB 导航 */}
      <div className="flex border-b border-gray-200 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-lg font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 内容 */}
      {activeTab === 'stock' && <StockTab />}
      {activeTab === 'documents' && <DocumentTab />}
      {activeTab === 'materials' && <MaterialTab />}
      {activeTab === 'warehouses' && <WarehouseTab />}
    </div>
  );
}
