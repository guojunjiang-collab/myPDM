import { useState, useEffect } from 'react';
import { useInventoryStore } from '../stores/inventory';
import StockTab from '../components/Inventory/StockTab';
import DocumentTab from '../components/Inventory/DocumentTab';
import MaterialTab from '../components/Inventory/MaterialTab';
import WarehouseTab from '../components/Inventory/WarehouseTab';

const TABS = [
  { key: 'stock', label: '库存查询' },
  { key: 'documents', label: '单据' },
  { key: 'materials', label: '物料主数据' },
  { key: 'warehouses', label: '仓库' },
] as const;

export default function Inventory() {
  const [tab, setTab] = useState<string>('stock');
  const { loadWarehouses, loadUsers } = useInventoryStore();

  useEffect(() => { loadWarehouses(); loadUsers(); }, [loadWarehouses, loadUsers]);

  return (
    <div className="p-4">
      <div className="flex gap-2 border-b mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm ${tab === t.key
              ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
              : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'stock' && <StockTab />}
      {tab === 'documents' && <DocumentTab />}
      {tab === 'materials' && <MaterialTab />}
      {tab === 'warehouses' && <WarehouseTab />}
    </div>
  );
}
