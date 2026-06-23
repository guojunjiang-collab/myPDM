import { useState, useEffect } from 'react';
import { useInventoryStore } from '../stores/inventory';
import StockTab from '../components/Inventory/StockTab';
import DocumentTab from '../components/Inventory/DocumentTab';
import MaterialTab from '../components/Inventory/MaterialTab';
import WarehouseTab from '../components/Inventory/WarehouseTab';
import { useHeaderTabs } from '../hooks/useHeaderTabs';

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
  useHeaderTabs(tabs, activeTab, setActiveTab);

  useEffect(() => { loadWarehouses(); loadUsers(); }, [loadWarehouses, loadUsers]);

  return (
    <div className="flex flex-col h-full">
      {/* TAB 内容 */}
      {activeTab === 'stock' && <StockTab />}
      {activeTab === 'documents' && <DocumentTab />}
      {activeTab === 'materials' && <MaterialTab />}
      {activeTab === 'warehouses' && <WarehouseTab />}
    </div>
  );
}
