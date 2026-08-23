import { useEffect, useState, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import StockDetail from './StockDetail';
import DocumentDetail from './DocumentDetail';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SortableTh from '../ui/SortableTh';
import type { StockRow } from '../../types';
import { useTableSort } from '../../hooks/useTableSort';

export default function StockTab() {
  const { warehouses, loadWarehouses } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [allRows, setAllRows] = useState<StockRow[]>([]);
  const [material, setMaterial] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [detailMatId, setDetailMatId] = useState<string | null>(null);
  const [docDetailId, setDocDetailId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.listStock();
      setAllRows(res.data.items);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadWarehouses(); load(); /* eslint-disable-next-line */ }, []);

  // 客户端即时过滤（边输入边搜索）
  const rows = useMemo(() => {
    const kw = material.trim().toLowerCase();
    return allRows.filter((r) => {
      if (kw && !(r.material_code?.toLowerCase().includes(kw) || r.material_name?.toLowerCase().includes(kw))) return false;
      if (warehouseId && r.warehouse_id !== warehouseId) return false;
      if (lowOnly && !r.is_low) return false;
      return true;
    });
  }, [allRows, material, warehouseId, lowOnly]);

  // 客户端排序
  const { sortedData: sortedRows, sortField, sortDirection, handleSort } = useTableSort<StockRow>(rows);

  const whName = (id: string) => warehouses.find((w) => w.id === id)?.name || id;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input type="text" placeholder="搜索物料编码/名称..." value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="flex-1 min-w-0" />
        <Select className="!w-auto" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">全部仓库</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-[var(--ui-bg-hover)] text-sm whitespace-nowrap">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)}
            className="w-3.5 h-3.5" />
          仅看低库存
        </label>
      </div>

      {/* 表格 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <SortableTh sortKey="material_code" active={sortField === 'material_code'} direction={sortDirection} onSort={(k) => handleSort(k as keyof StockRow)} className="text-left">编码</SortableTh>
              <SortableTh sortKey="material_name" active={sortField === 'material_name'} direction={sortDirection} onSort={(k) => handleSort(k as keyof StockRow)} className="text-left">名称</SortableTh>
              <SortableTh className="text-left">仓库</SortableTh>
              <SortableTh sortKey="batch_no" active={sortField === 'batch_no'} direction={sortDirection} onSort={(k) => handleSort(k as keyof StockRow)} className="text-left">批次</SortableTh>
              <SortableTh sortKey="quantity" active={sortField === 'quantity'} direction={sortDirection} onSort={(k) => handleSort(k as keyof StockRow)} className="text-right">数量</SortableTh>
              <SortableTh sortKey="safety_stock" active={sortField === 'safety_stock'} direction={sortDirection} onSort={(k) => handleSort(k as keyof StockRow)} className="text-right">安全库存</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : allRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : sortedRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">无匹配结果</td></tr>
            ) : sortedRows.map((r, i) => (
              <tr key={i} className={`cursor-pointer ${r.is_low ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-[var(--ui-bg-hover)]'}`}
                onClick={() => setDetailMatId(r.material_id)}>
                <td className={`px-4 py-3 text-sm font-medium ${r.is_low ? 'text-red-600' : 'text-primary-600'}`}>{r.material_code}</td>
                <td className="px-4 py-3 text-sm font-medium">{r.material_name}</td>
                <td className="px-4 py-3 text-sm font-medium">{whName(r.warehouse_id)}</td>
                <td className="px-4 py-3 text-sm font-medium">{r.batch_no || '-'}</td>
                <td className={`px-4 py-3 text-sm text-right font-medium ${r.is_low ? 'text-red-600' : ''}`}>{r.quantity} {r.unit || ''}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">{r.safety_stock ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 物料库存详情 */}
      {detailMatId && (
        <StockDetail materialId={detailMatId}
          rows={allRows.filter((r) => r.material_id === detailMatId)}
          whName={whName} onClose={() => setDetailMatId(null)} onViewDoc={setDocDetailId} />
      )}

      {/* 单据详情（与库存详情同级，避免被父弹窗 transform 限制宽度） */}
      {docDetailId && (
        <DocumentDetail docId={docDetailId} onClose={() => setDocDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
