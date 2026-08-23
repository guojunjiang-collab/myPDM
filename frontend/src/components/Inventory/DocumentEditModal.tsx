import { useState, useEffect, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import { Modal } from '../Modal';
import ComboBox from './ComboBox';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import Alert from '../ui/Alert';
import type { InvDocType, InvDocLine, StockRow } from '../../types';

interface ReviewerFormItem { user_id: string; seq: number; }

const DOC_LABELS: Record<InvDocType, string> = {
  inbound: '入库单', outbound: '出库单', transfer: '调拨单',
  stocktake: '盘点单', adjustment: '库存调整单',
};

// ECR 式卡片字段样式
const cardCls = 'bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]';
const cardLabelCls = 'block text-xs text-[var(--ui-text-secondary)] mb-0.5';

export default function DocumentEditModal({ docType, onClose, onSaved }:
  { docType: InvDocType; onClose: () => void; onSaved: () => void }) {
  const { warehouses, materials, users } = useInventoryStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [bizType, setBizType] = useState('');
  const [remark, setRemark] = useState('');
  const [reviewers, setReviewers] = useState<ReviewerFormItem[]>([]);
  const [reviewMode, setReviewMode] = useState<'all' | 'any'>('all');
  const [keeperId, setKeeperId] = useState('');
  // 表单校验错误（阻塞性校验 → Alert）
  const [saveError, setSaveError] = useState<string | null>(null);

  // 审批人管理（仿 ECR）：可添加多个
  const addReviewer = () => {
    const nextSeq = reviewers.length > 0 ? Math.max(...reviewers.map((r) => r.seq)) + 1 : 1;
    setReviewers([...reviewers, { user_id: '', seq: nextSeq }]);
  };
  const removeReviewer = (index: number) => setReviewers(reviewers.filter((_, i) => i !== index));
  const updateReviewer = (index: number, field: 'user_id' | 'seq', value: string | number) =>
    setReviewers(reviewers.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  const [lines, setLines] = useState<InvDocLine[]>([{ material_id: '', batch_no: '', quantity: 0 }]);

  const isTransfer = docType === 'transfer';
  const isAdjustment = docType === 'adjustment';
  const isOutbound = docType === 'outbound';
  const isStocktake = docType === 'stocktake';
  // 调拨/出库/盘点：明细物料从「该仓有货」的库存中筛选，并展示余量
  const usesStockPicker = isTransfer || isOutbound || isStocktake;

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
    if (!warehouseId) { setSaveError('请选择仓库'); return; }
    if (isTransfer && !toWarehouseId) { setSaveError('请选择目标仓'); return; }
    setSaveError(null);
    const payload = {
      doc_type: docType, biz_type: bizType || undefined,
      warehouse_id: warehouseId, to_warehouse_id: isTransfer ? toWarehouseId : undefined,
      review_mode: reviewMode, keeper_id: keeperId || undefined, remark,
      reviewers: reviewers.filter((r) => r.user_id).map((r) => ({ user_id: r.user_id, seq: r.seq })),
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
      <div className="space-y-4 max-h-[78vh] overflow-y-auto pr-1">
        {saveError && <Alert tone="danger">{saveError}</Alert>}
        {/* 基本信息（卡片字段） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={cardCls}>
            <label className={cardLabelCls}>{isTransfer ? '源仓' : '仓库'}</label>
            <Select size="xs" value={warehouseId} onChange={(e) => onWarehouseChange(e.target.value)}>
              <option value="">请选择</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          {isTransfer && (
            <div className={cardCls}>
              <label className={cardLabelCls}>目标仓</label>
              <Select size="xs" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">请选择</option>
                {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </div>
          )}
          <div className={cardCls}>
            <label className={cardLabelCls}>业务子类</label>
            <Input size="xs" value={bizType} onChange={(e) => setBizType(e.target.value)}
              placeholder="如 采购入库/生产领料" />
          </div>
          <div className={cardCls}>
            <label className={cardLabelCls}>指定库管员</label>
            <Select size="xs" value={keeperId} onChange={(e) => setKeeperId(e.target.value)}>
              <option value="">（默认仓库库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </Select>
          </div>
          <div className={cardCls}>
            <label className={cardLabelCls}>审批模式</label>
            <Select size="xs" value={reviewMode} onChange={(e) => setReviewMode(e.target.value as 'all' | 'any')}>
              <option value="all">会签（全部通过）</option>
              <option value="any">或签（任一通过）</option>
            </Select>
          </div>
        </div>

        {/* 审批人（仿 ECR：可添加多个） */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">👤 审批人</label>
            <Button variant="ghost" size="xs" type="button" onClick={addReviewer}>
              + 添加审批人
            </Button>
          </div>

          {reviewers.length === 0 && (
            <div className="text-center text-[var(--ui-text-tertiary)] py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂无审批人，请点击上方按钮添加
            </div>
          )}

          <div className="space-y-2">
            {reviewers.map((reviewer, index) => (
              <div key={index} className="flex items-center gap-3 p-2 bg-[var(--ui-bg-subtle)] rounded-lg border border-[var(--ui-border)]">
                <span className="text-xs text-[var(--ui-text-tertiary)] w-6 text-center">{reviewer.seq}</span>
                <Select value={reviewer.user_id}
                  onChange={(e) => updateReviewer(index, 'user_id', e.target.value)}
                  className="flex-1">
                  <option value="">请选择审批人</option>
                  {users.filter((u) => u.role !== 'guest' && u.id !== currentUserId).map((u) => (
                    <option key={u.id} value={u.id}>{u.real_name}（{u.role}）</option>
                  ))}
                </Select>
                <Input size="xs" type="number" min={1} value={reviewer.seq}
                  onChange={(e) => updateReviewer(index, 'seq', parseInt(e.target.value) || 1)}
                  className="!w-16 text-center" />
                <Button variant="danger" size="xs" type="button" onClick={() => removeReviewer(index)} title="移除">✕</Button>
              </div>
            ))}
          </div>
        </div>

        {/* 明细行 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-[var(--ui-text-secondary)] font-semibold text-sm">📋 明细</label>
            <Button variant="link" size="xs" onClick={addLine}>+ 加一行</Button>
          </div>
          <div className="rounded-lg border border-[var(--ui-border)]">
            {usesStockPicker ? (
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">物料（{isTransfer ? '源仓' : '仓库'}有货）</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">批次</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">{isStocktake ? '账面量' : isTransfer ? '源仓余量' : '仓库余量'}</th>
                    {isTransfer && <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">目标仓余量</th>}
                    {!isStocktake && <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">{isTransfer ? '调拨数量' : '出库数量'}</th>}
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lines.map((l, i) => {
                    const srcBal = balanceOf(warehouseId, l.material_id, l.batch_no);
                    const tgtBal = balanceOf(toWarehouseId, l.material_id, l.batch_no);
                    const over = !isStocktake && !!l.material_id && srcBal !== null && Number(l.quantity) > srcBal;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <ComboBox
                            value={`${l.material_id}|${l.batch_no}`}
                            placeholder={warehouseId ? '选择物料' : `请先选择${isTransfer ? '源仓' : '仓库'}`}
                            options={sourceStock.map((s) => ({
                              value: `${s.material_id}|${s.batch_no}`,
                              label: `${s.material_code} · ${s.material_name} · 批次:${s.batch_no || '无'} · 余:${s.quantity}${s.unit || ''}`,
                              search: `${s.material_code} ${s.material_name} ${s.batch_no || ''}`,
                            }))}
                            onChange={(v) => { const [mid, b] = v.split('|'); updateLine(i, { material_id: mid, batch_no: b }); }}
                          />
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{l.batch_no || '-'}</td>
                        <td className="px-3 py-2 text-sm text-right text-[var(--ui-text-secondary)]">{srcBal ?? '-'}</td>
                        {isTransfer && <td className="px-3 py-2 text-sm text-right text-[var(--ui-text-secondary)]">{toWarehouseId ? tgtBal : '-'}</td>}
                        {!isStocktake && (
                          <td className="px-3 py-2">
                            <Input size="xs" type="number" value={l.quantity}
                              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                              className={`!w-24 ${over ? '!border-red-400 !text-red-600' : ''}`} />
                          </td>
                        )}
                        <td className="px-3 py-2 text-center">
                          <Button variant="danger" size="xs" onClick={() => removeLine(i)}>✕</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">物料</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">批次</th>
                    {isAdjustment && <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">方向</th>}
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">数量</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <ComboBox
                          value={l.material_id}
                          placeholder="选择物料"
                          options={materials.map((m) => ({
                            value: m.id,
                            label: `${m.code} ${m.name}`,
                            search: `${m.code} ${m.name} ${m.spec || ''}`,
                          }))}
                          onChange={(v) => updateLine(i, { material_id: v })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input size="xs" value={l.batch_no} onChange={(e) => updateLine(i, { batch_no: e.target.value })}
                          className="!w-24" />
                      </td>
                      {isAdjustment && (
                        <td className="px-3 py-2">
                          <Select size="xs" value={l.direction || 'in'} onChange={(e) => updateLine(i, { direction: e.target.value as any })}>
                            <option value="in">盘盈+</option><option value="out">报损-</option>
                          </Select>
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <Input size="xs" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                          className="!w-24" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button variant="danger" size="xs" onClick={() => removeLine(i)}>✕</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {usesStockPicker && (
            <p className="text-xs text-[var(--ui-text-tertiary)] mt-1.5">
              {isStocktake
                ? '盘点物料从「仓库有货」中选择，账面量为当前库存；实盘数在过账时由库管员填写。'
                : `${isTransfer ? '调拨' : '出库'}物料仅从「${isTransfer ? '源仓' : '仓库'}有货」的库存中选择；数量超过${isTransfer ? '源仓' : '仓库'}余量会标红。`}
            </p>
          )}
        </div>

        <div className={cardCls}>
          <label className={cardLabelCls}>备注</label>
          <Textarea size="xs" value={remark} onChange={(e) => setRemark(e.target.value)} className="resize-none" rows={2} />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={save}>保存草稿</Button>
        </div>
      </div>
    </Modal>
  );
}
