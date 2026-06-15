import { useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { InvDocType, InvDocLine } from '../../types';

const DOC_LABELS: Record<InvDocType, string> = {
  inbound: '入库单', outbound: '出库单', transfer: '调拨单',
  stocktake: '盘点单', adjustment: '库存调整单',
};

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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded w-[44rem] max-h-[88vh] overflow-auto space-y-3">
        <h3 className="font-medium">新建{DOC_LABELS[docType]}</h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">{isTransfer ? '源仓' : '仓库'}
            <select value={warehouseId} onChange={(e) => onWarehouseChange(e.target.value)}
              className="w-full border px-2 py-1 rounded mt-1">
              <option value="">请选择</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          {isTransfer && (
            <label className="text-sm">目标仓
              <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}
                className="w-full border px-2 py-1 rounded mt-1">
                <option value="">请选择</option>
                {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">业务子类
            <input value={bizType} onChange={(e) => setBizType(e.target.value)}
              placeholder="如 采购入库/生产领料" className="w-full border px-2 py-1 rounded mt-1" />
          </label>
          <label className="text-sm">指定库管员
            <select value={keeperId} onChange={(e) => setKeeperId(e.target.value)}
              className="w-full border px-2 py-1 rounded mt-1">
              <option value="">（默认仓库库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* 审批人 */}
        <div className="text-sm">
          审批人（{reviewMode === 'all' ? '会签' : '或签'}）
          <button onClick={() => setReviewMode(reviewMode === 'all' ? 'any' : 'all')}
            className="ml-2 text-blue-500 text-xs">切换</button>
          <select multiple value={reviewerIds}
            onChange={(e) => setReviewerIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            className="w-full border px-2 py-1 rounded mt-1 h-20">
            {users.filter((u) => ['admin', 'engineer'].includes(u.role)).map((u) => (
              <option key={u.id} value={u.id}>{u.real_name}（{u.role}）</option>
            ))}
          </select>
        </div>

        {/* 明细行 */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-medium">明细</span>
            <button onClick={addLine} className="text-blue-500 text-xs">+ 加一行</button>
          </div>
          <table className="w-full text-xs border">
            <thead className="bg-gray-50"><tr>
              <th className="p-1 text-left">物料</th><th className="p-1">批次</th>
              {isAdjustment && <th className="p-1">方向</th>}
              <th className="p-1">数量</th><th className="p-1"></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1">
                    <select value={l.material_id} onChange={(e) => updateLine(i, { material_id: e.target.value })}
                      className="w-full border px-1 py-0.5 rounded">
                      <option value="">选择物料</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.code} {m.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><input value={l.batch_no}
                    onChange={(e) => updateLine(i, { batch_no: e.target.value })}
                    className="w-20 border px-1 py-0.5 rounded" /></td>
                  {isAdjustment && (
                    <td className="p-1">
                      <select value={l.direction || 'in'} onChange={(e) => updateLine(i, { direction: e.target.value as any })}
                        className="border px-1 py-0.5 rounded">
                        <option value="in">盘盈+</option><option value="out">报损-</option>
                      </select>
                    </td>
                  )}
                  <td className="p-1"><input type="number" value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    className="w-20 border px-1 py-0.5 rounded" /></td>
                  <td className="p-1 text-center">
                    <button onClick={() => removeLine(i)} className="text-red-500">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {docType === 'stocktake' && (
            <p className="text-xs text-gray-400 mt-1">盘点单的实盘数在「过账」时由库管员填写。</p>
          )}
        </div>

        <textarea placeholder="备注" value={remark} onChange={(e) => setRemark(e.target.value)}
          className="w-full border px-2 py-1 rounded text-sm" rows={2} />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 text-sm">取消</button>
          <button onClick={save} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存草稿</button>
        </div>
      </div>
    </div>
  );
}
