import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { inventoryApi } from '../../services/inventoryApi';
import type { StockRow } from '../../types';
import SortableTh from '../ui/SortableTh';
import { useTableSort } from '../../hooks/useTableSort';

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium">{value}</div>
    </div>
  );
}

const DOC_TYPE_LABEL: Record<string, string> = {
  inbound: '入库', outbound: '出库', transfer: '调拨', stocktake: '盘点', adjustment: '调整',
};

export default function StockDetail({ materialId, rows, whName, onClose, onViewDoc }: {
  materialId: string;
  rows: StockRow[];
  whName: (id: string) => string;
  onClose: () => void;
  onViewDoc: (docId: string) => void;
}) {
  const [tab, setTab] = useState<'info' | 'ledger'>('info');
  const [ledger, setLedger] = useState<any[]>([]);
  useEffect(() => {
    inventoryApi.listLedger({ material_id: materialId }).then((r) => setLedger(r.data.items)).catch(() => {});
  }, [materialId]);

  const first = rows[0];
  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  // 各仓库库存 + 库存流水排序（仓库名需 whName 转换，仅数量/批次/流水数值列可排）
  const { sortedData: sortedRows, sortField: whSortField, sortDirection: whSortDirection, handleSort: handleWhSort } = useTableSort<StockRow>(rows);
  const { sortedData: sortedLedger, sortField: lSortField, sortDirection: lSortDirection, handleSort: handleLSort } = useTableSort<any>(ledger);

  return (
    <Modal open title="物料库存详情" onClose={onClose} width="3xl" height="75vh">
      <div className="h-full flex flex-col min-h-0">
      {/* TAB 切换 */}
      <div className="flex border-b border-[var(--ui-border)] mb-4 shrink-0">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'info' ? 'border-primary-600 text-primary-600' : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'}`}
          onClick={() => setTab('info')}
        >
          基础信息
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'ledger' ? 'border-primary-600 text-primary-600' : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'}`}
          onClick={() => setTab('ledger')}
        >
          库存流水
        </button>
      </div>

      {/* TAB 1: 基础信息 + 各仓库/批次库存 */}
      {tab === 'info' && (
        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto">
          {first && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <InfoItem label="编码" value={first.material_code} />
              <InfoItem label="名称" value={first.material_name} />
              <InfoItem label="单位" value={first.unit || '-'} />
              <InfoItem label="总库存" value={`${total}${first.unit || ''}`} />
              <InfoItem label="安全库存" value={first.safety_stock != null ? String(first.safety_stock) : '-'} />
            </div>
          )}

          <div>
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">各仓库 / 批次库存</h4>
            <div className="rounded-lg border border-[var(--ui-border)] overflow-hidden">
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                  <tr>
                    <SortableTh className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">仓库</SortableTh>
                    <SortableTh sortKey="batch_no" active={whSortField === 'batch_no'} direction={whSortDirection} onSort={(k) => handleWhSort(k as keyof StockRow)} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">批次</SortableTh>
                    <SortableTh sortKey="quantity" active={whSortField === 'quantity'} direction={whSortDirection} onSort={(k) => handleWhSort(k as keyof StockRow)} className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">数量</SortableTh>
                    <SortableTh sortKey="safety_stock" active={whSortField === 'safety_stock'} direction={whSortDirection} onSort={(k) => handleWhSort(k as keyof StockRow)} className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">安全库存</SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无库存</td></tr>
                  ) : sortedRows.map((r, i) => (
                    <tr key={i} className={r.is_low ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2 text-sm">{whName(r.warehouse_id)}</td>
                      <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{r.batch_no || '-'}</td>
                      <td className={`px-3 py-2 text-sm text-right font-medium ${r.is_low ? 'text-red-600' : ''}`}>{r.quantity}</td>
                      <td className="px-3 py-2 text-sm text-right text-[var(--ui-text-secondary)]">{r.safety_stock ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 库存流水（滚动容器） */}
      {tab === 'ledger' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="rounded-lg border border-[var(--ui-border)] overflow-hidden">
            <table className="w-full">
              <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0">
                <tr>
                  <SortableTh sortKey="doc_number" active={lSortField === 'doc_number'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">单据</SortableTh>
                  <SortableTh sortKey="doc_type" active={lSortField === 'doc_type'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">类型</SortableTh>
                  <SortableTh className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">仓库</SortableTh>
                  <SortableTh sortKey="quantity" active={lSortField === 'quantity'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">增减</SortableTh>
                  <SortableTh sortKey="balance_after" active={lSortField === 'balance_after'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">过账后余额</SortableTh>
                  <SortableTh sortKey="operator_name" active={lSortField === 'operator_name'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">操作人</SortableTh>
                  <SortableTh sortKey="created_at" active={lSortField === 'created_at'} direction={lSortDirection} onSort={(k) => handleLSort(k)} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">时间</SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ledger.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无流水</td></tr>
                ) : sortedLedger.map((l) => (
                  <tr key={l.id} className={l.doc_id ? 'hover:bg-[var(--ui-bg-hover)] cursor-pointer' : ''}
                    onClick={() => l.doc_id && onViewDoc(l.doc_id)}>
                    <td className="px-3 py-2 text-sm text-primary-600">{l.doc_number}</td>
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{DOC_TYPE_LABEL[l.doc_type] || l.doc_type || '-'}</td>
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{whName(l.warehouse_id)}</td>
                    <td className={`px-3 py-2 text-sm text-right font-medium ${l.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {l.direction === 'in' ? '+' : '-'}{l.quantity}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-[var(--ui-text-secondary)]">{l.balance_after}</td>
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{l.operator_name || '-'}</td>
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{l.created_at ? new Date(l.created_at).toLocaleString('zh-CN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </Modal>
  );
}
