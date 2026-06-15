import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { Modal } from '../Modal';
import type { StockRow } from '../../types';

export default function StockTab() {
  const { warehouses, loadWarehouses } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [material, setMaterial] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<StockRow | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.listStock({
        material: material || undefined,
        warehouse_id: warehouseId || undefined,
        low_only: lowOnly || undefined,
      });
      setRows(res.data.items);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadWarehouses(); load(); /* eslint-disable-next-line */ }, []);

  const openLedger = async (row: StockRow) => {
    setLedgerFor(row);
    const res = await inventoryApi.listLedger({ material_id: row.material_id, warehouse_id: row.warehouse_id });
    setLedger(res.data.items);
  };

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 items-center">
        <input placeholder="物料编码/名称..." value={material}
          onChange={(e) => setMaterial(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white">
          <option value="">全部仓库</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="text-sm text-gray-600 flex items-center gap-1.5">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          仅看低库存
        </label>
        <button onClick={load} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">查询</button>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">物料</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">仓库</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">批次</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">数量</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">安全库存</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className={`hover:bg-gray-50 ${r.is_low ? 'bg-red-50' : ''}`}>
                <td className={`px-4 py-3 text-sm font-medium ${r.is_low ? 'text-red-600' : ''}`}>{r.material_code} {r.material_name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{whName(r.warehouse_id)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{r.batch_no || '-'}</td>
                <td className={`px-4 py-3 text-sm text-right font-medium ${r.is_low ? 'text-red-600' : ''}`}>{r.quantity} {r.unit || ''}</td>
                <td className="px-4 py-3 text-sm text-right text-gray-500">{r.safety_stock ?? '-'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openLedger(r)} className="text-primary-600 hover:text-primary-800">流水</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 库存流水弹窗 */}
      <Modal open={!!ledgerFor} title={ledgerFor ? `${ledgerFor.material_code} ${ledgerFor.material_name} · 库存流水` : ''}
        onClose={() => setLedgerFor(null)} width="lg">
        <div className="max-h-[60vh] overflow-auto">
          {ledger.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">暂无流水</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">单据</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">增减</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">过账后余额</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">操作人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-sm text-gray-600">{l.doc_number}</td>
                    <td className={`px-3 py-2 text-sm text-right font-medium ${l.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {l.direction === 'in' ? '+' : '-'}{l.quantity}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-500">{l.balance_after}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{l.operator_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>
    </div>
  );
}
