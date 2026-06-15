import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { StockRow } from '../../types';

export default function StockTab() {
  const { warehouses, loadWarehouses } = useInventoryStore();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [material, setMaterial] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<StockRow | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);

  const load = async () => {
    const res = await inventoryApi.listStock({
      material: material || undefined,
      warehouse_id: warehouseId || undefined,
      low_only: lowOnly || undefined,
    });
    setRows(res.data.items);
  };

  useEffect(() => { loadWarehouses(); load(); /* eslint-disable-next-line */ }, []);

  const openLedger = async (row: StockRow) => {
    setLedgerFor(row);
    const res = await inventoryApi.listLedger({ material_id: row.material_id, warehouse_id: row.warehouse_id });
    setLedger(res.data.items);
  };

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="flex gap-2 mb-3 items-center">
          <input placeholder="物料编码/名称" value={material}
            onChange={(e) => setMaterial(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="border px-2 py-1 rounded text-sm" />
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="border px-2 py-1 rounded text-sm">
            <option value="">全部仓库</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <label className="text-sm flex items-center gap-1">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            仅看低库存
          </label>
          <button onClick={load} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">查询</button>
        </div>
        <table className="w-full text-sm border">
          <thead className="bg-gray-50"><tr>
            <th className="p-2 text-left">物料</th><th className="p-2 text-left">仓库</th>
            <th className="p-2 text-left">批次</th><th className="p-2 text-right">数量</th>
            <th className="p-2 text-right">安全库存</th><th className="p-2"></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t ${r.is_low ? 'bg-red-50 text-red-600' : ''}`}>
                <td className="p-2">{r.material_code} {r.material_name}</td>
                <td className="p-2">{whName(r.warehouse_id)}</td>
                <td className="p-2">{r.batch_no || '-'}</td>
                <td className="p-2 text-right">{r.quantity} {r.unit || ''}</td>
                <td className="p-2 text-right">{r.safety_stock ?? '-'}</td>
                <td className="p-2 text-center">
                  <button onClick={() => openLedger(r)} className="text-blue-500">流水</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ledgerFor && (
        <div className="w-80 border-l pl-4">
          <div className="flex justify-between mb-2">
            <h3 className="font-medium text-sm">{ledgerFor.material_name} · 库存流水</h3>
            <button onClick={() => setLedgerFor(null)} className="text-gray-400">✕</button>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-auto">
            {ledger.map((l) => (
              <div key={l.id} className="text-xs border rounded p-2">
                <div className="flex justify-between">
                  <span className={l.direction === 'in' ? 'text-green-600' : 'text-red-600'}>
                    {l.direction === 'in' ? '+' : '-'}{l.quantity}
                  </span>
                  <span className="text-gray-400">余 {l.balance_after}</span>
                </div>
                <div className="text-gray-500">{l.doc_number} · {l.operator_name}</div>
              </div>
            ))}
            {ledger.length === 0 && <div className="text-xs text-gray-400">暂无流水</div>}
          </div>
        </div>
      )}
    </div>
  );
}
