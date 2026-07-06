import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { inventoryApi } from '../../services/inventoryApi';
import type { StockRow } from '../../types';

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium">{value}</div>
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

  return (
    <Modal open title="物料库存详情" onClose={onClose} width="3xl">
      {/* TAB 切换 */}
      <div className="flex border-b border-gray-200 mb-4">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'info' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setTab('info')}
        >
          基础信息
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'ledger' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setTab('ledger')}
        >
          库存流水
        </button>
      </div>

      {/* TAB 1: 基础信息 + 各仓库/批次库存 */}
      {tab === 'info' && (
        <div className="space-y-6">
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
            <h4 className="text-sm font-semibold text-gray-700 mb-2">各仓库 / 批次库存</h4>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">仓库</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">批次</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">数量</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">安全库存</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">暂无库存</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={i} className={r.is_low ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2 text-sm">{whName(r.warehouse_id)}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{r.batch_no || '-'}</td>
                      <td className={`px-3 py-2 text-sm text-right font-medium ${r.is_low ? 'text-red-600' : ''}`}>{r.quantity}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-500">{r.safety_stock ?? '-'}</td>
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
        <div>
          <div className="rounded-lg border border-gray-200 overflow-hidden max-h-[60vh] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">单据</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">类型</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">仓库</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">增减</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">过账后余额</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">操作人</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {ledger.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-400">暂无流水</td></tr>
                ) : ledger.map((l) => (
                  <tr key={l.id} className={l.doc_id ? 'hover:bg-gray-50 cursor-pointer' : ''}
                    onClick={() => l.doc_id && onViewDoc(l.doc_id)}>
                    <td className="px-3 py-2 text-sm text-primary-600">{l.doc_number}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{DOC_TYPE_LABEL[l.doc_type] || l.doc_type || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{whName(l.warehouse_id)}</td>
                    <td className={`px-3 py-2 text-sm text-right font-medium ${l.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {l.direction === 'in' ? '+' : '-'}{l.quantity}
                    </td>
                    <td className="px-3 py-2 text-sm text-right text-gray-500">{l.balance_after}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{l.operator_name || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{l.created_at ? new Date(l.created_at).toLocaleString('zh-CN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
