import { useState, useEffect, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { Modal } from '../Modal';
import type { InvDocType, InvDocLine, StockRow } from '../../types';

const DOC_LABELS: Record<InvDocType, string> = {
  inbound: '入库单', outbound: '出库单', transfer: '调拨单',
  stocktake: '盘点单', adjustment: '库存调整单',
};

const fieldCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm';

export default function DocumentEditModal({ docType, onClose, onSaved }:
  { docType: InvDocType; onClose: () => void; onSaved: () => void }) {
  const { warehouses, materials, users } = useInventoryStore();
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [bizType, setBizType] = useState('');
  const [remark, setRemark] = useState('');
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [reviewMode, setReviewMode] = useState<'all' | 'any'>('all');
  const [keeperId, setKeeperId] = useState('');
  const [lines, setLines] = useState<InvDocLine[]>([{ material_id: '', batch_no: '', quantity: 0 }]);

  const isTransfer = docType === 'transfer';
  const isAdjustment = docType === 'adjustment';
  const isOutbound = docType === 'outbound';
  // 调拨/出库：明细物料从「该仓有货」的库存中筛选，并展示余量
  const usesStockPicker = isTransfer || isOutbound;

  // 加载库存余额，供「仓库有货物料」筛选与余量展示
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  useEffect(() => {
    if (usesStockPicker) inventoryApi.listStock().then((res) => setStockRows(res.data.items)).catch(() => {});
  }, [usesStockPicker]);

  // 源仓/出库仓有货的库存行（material+batch，余量>0），作为明细可选项
  const sourceStock = useMemo(
    () => stockRows.filter((s) => s.warehouse_id === warehouseId && s.quantity > 0),
    [stockRows, warehouseId],
  );
  const balanceOf = (wh: string, materialId: string, batch: string): number | null => {
    if (!wh || !materialId) return null;
    const row = stockRows.find(
      (s) => s.warehouse_id === wh && s.material_id === materialId && (s.batch_no || '') === (batch || ''),
    );
    return row ? row.quantity : 0;
  };

  const onWarehouseChange = (id: string) => {
    setWarehouseId(id);
    const wh = warehouses.find((w) => w.id === id);
    if (wh?.default_keeper_id && !keeperId) setKeeperId(wh.default_keeper_id);
  };

  const updateLine = (i: number, patch: Partial<InvDocLine>) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines([...lines, { material_id: '', batch_no: '', quantity: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!warehouseId) { alert('请选择仓库'); return; }
    if (isTransfer && !toWarehouseId) { alert('请选择目标仓'); return; }
    const payload = {
      doc_type: docType, biz_type: bizType || undefined,
      warehouse_id: warehouseId, to_warehouse_id: isTransfer ? toWarehouseId : undefined,
      review_mode: reviewMode, keeper_id: keeperId || undefined, remark,
      reviewers: reviewerIds.map((id, seq) => ({ user_id: id, seq })),
      lines: lines.filter((l) => l.material_id).map((l) => ({
        material_id: l.material_id, batch_no: l.batch_no || '',
        quantity: Number(l.quantity) || 0,
        direction: isAdjustment ? (l.direction || 'in') : undefined,
      })),
    };
    await inventoryApi.createDocument(payload);
    onSaved();
  };

  return (
    <Modal open title={`新建${DOC_LABELS[docType]}`} onClose={onClose} width="3xl">
      <div className="space-y-4">
        {/* 头部字段 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">{isTransfer ? '源仓' : '仓库'}</label>
            <select value={warehouseId} onChange={(e) => onWarehouseChange(e.target.value)} className={fieldCls}>
              <option value="">请选择</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          {isTransfer && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">目标仓</label>
              <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} className={fieldCls}>
                <option value="">请选择</option>
                {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">业务子类</label>
            <input value={bizType} onChange={(e) => setBizType(e.target.value)}
              placeholder="如 采购入库/生产领料" className={fieldCls} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">指定库管员</label>
            <select value={keeperId} onChange={(e) => setKeeperId(e.target.value)} className={fieldCls}>
              <option value="">（默认仓库库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 审批人 */}
        <div>
          <label className="block text-sm text-gray-600 mb-1">
            审批人
            <button onClick={() => setReviewMode(reviewMode === 'all' ? 'any' : 'all')}
              className="ml-2 text-primary-600 hover:text-primary-800 text-xs">
              {reviewMode === 'all' ? '会签' : '或签'}（点击切换）
            </button>
          </label>
          <select multiple value={reviewerIds}
            onChange={(e) => setReviewerIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            className={`${fieldCls} h-24`}>
            {users.filter((u) => ['admin', 'engineer'].includes(u.role)).map((u) => (
              <option key={u.id} value={u.id}>{u.real_name}（{u.role}）</option>
            ))}
          </select>
        </div>

        {/* 明细行 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-sm text-gray-600">明细</label>
            <button onClick={addLine} className="text-primary-600 hover:text-primary-800 text-sm">+ 加一行</button>
          </div>
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            {usesStockPicker ? (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">物料（{isTransfer ? '源仓' : '仓库'}有货）</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">批次</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">{isTransfer ? '源仓余量' : '仓库余量'}</th>
                    {isTransfer && <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">目标仓余量</th>}
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">{isTransfer ? '调拨数量' : '出库数量'}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lines.map((l, i) => {
                    const srcBal = balanceOf(warehouseId, l.material_id, l.batch_no);
                    const tgtBal = balanceOf(toWarehouseId, l.material_id, l.batch_no);
                    const over = !!l.material_id && srcBal !== null && Number(l.quantity) > srcBal;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <select value={`${l.material_id}|${l.batch_no}`}
                            onChange={(e) => { const [mid, b] = e.target.value.split('|'); updateLine(i, { material_id: mid, batch_no: b }); }}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
                            <option value="|">{warehouseId ? '选择物料' : `请先选择${isTransfer ? '源仓' : '仓库'}`}</option>
                            {sourceStock.map((s) => (
                              <option key={`${s.material_id}|${s.batch_no}`} value={`${s.material_id}|${s.batch_no}`}>
                                {s.material_code} {s.material_name}{s.batch_no ? ` · 批次:${s.batch_no}` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-500">{l.batch_no || '-'}</td>
                        <td className="px-3 py-2 text-sm text-right text-gray-500">{srcBal ?? '-'}</td>
                        {isTransfer && <td className="px-3 py-2 text-sm text-right text-gray-500">{toWarehouseId ? tgtBal : '-'}</td>}
                        <td className="px-3 py-2">
                          <input type="number" value={l.quantity}
                            onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                            className={`w-24 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-1 ${over ? 'border-red-400 text-red-600 focus:ring-red-400' : 'border-gray-300 focus:ring-primary-500'}`} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeLine(i)} className="text-red-500 hover:text-red-700">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">物料</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">批次</th>
                    {isAdjustment && <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">方向</th>}
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">数量</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <select value={l.material_id} onChange={(e) => updateLine(i, { material_id: e.target.value })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
                          <option value="">选择物料</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input value={l.batch_no} onChange={(e) => updateLine(i, { batch_no: e.target.value })}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
                      </td>
                      {isAdjustment && (
                        <td className="px-3 py-2">
                          <select value={l.direction || 'in'} onChange={(e) => updateLine(i, { direction: e.target.value as any })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
                            <option value="in">盘盈+</option><option value="out">报损-</option>
                          </select>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <input type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeLine(i)} className="text-red-500 hover:text-red-700">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {docType === 'stocktake' && (
            <p className="text-xs text-gray-400 mt-1.5">盘点单的实盘数在「过账」时由库管员填写。</p>
          )}
          {usesStockPicker && (
            <p className="text-xs text-gray-400 mt-1.5">
              {isTransfer ? '调拨' : '出库'}物料仅从「{isTransfer ? '源仓' : '仓库'}有货」的库存中选择；数量超过{isTransfer ? '源仓' : '仓库'}余量会标红。
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">备注</label>
          <textarea value={remark} onChange={(e) => setRemark(e.target.value)} className={fieldCls} rows={2} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
          <button onClick={save} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">保存草稿</button>
        </div>
      </div>
    </Modal>
  );
}
