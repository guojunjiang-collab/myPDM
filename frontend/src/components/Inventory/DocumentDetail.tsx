import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import { BADGE_DOMAINS } from '../../constants/badges';
import { Modal } from '../Modal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import type { InvDocument, InvDocType } from '../../types';

const DOC_TYPE_LABEL: Record<InvDocType, string> = {
  inbound: '入库单', outbound: '出库单', transfer: '调拨单', stocktake: '盘点单', adjustment: '库存调整单',
};

// 时间线圆点 / 文字颜色（按目标状态）
const dotColor = (s: string) =>
  s === 'posted' ? 'bg-green-500 border-green-500'
    : s === 'approved' ? 'bg-primary-500 border-primary-500'
      : s === 'rejected' ? 'bg-red-500 border-red-500'
        : s === 'reviewing' ? 'bg-amber-500 border-amber-500'
          : 'bg-gray-400 border-gray-400';
const txtColor = (s: string) =>
  s === 'posted' ? 'text-green-600'
    : s === 'approved' ? 'text-primary-600'
      : s === 'rejected' ? 'text-red-600'
        : s === 'reviewing' ? 'text-amber-600'
          : 'text-[var(--ui-text-secondary)]';

function InfoItem({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium">
        {icon && <span className="mr-1">{icon}</span>}{value}
      </div>
    </div>
  );
}

const fmt = (s?: string) => (s ? new Date(s).toLocaleString('zh-CN') : '-');

export default function DocumentDetail({ docId, onClose, onChanged }:
  { docId: string; onClose: () => void; onChanged: () => void }) {
  const { materials, users, warehouses } = useInventoryStore();
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<InvDocument | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reassign, setReassign] = useState('');

  const reload = async () => {
    const res = await inventoryApi.getDocument(docId);
    setDoc(res.data);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [docId]);

  const matName = (id: string) => {
    const m = materials.find((x) => x.id === id);
    return m ? `${m.code} ${m.name}` : id;
  };
  const whName = (id?: string | null) => (id ? warehouses.find((w) => w.id === id)?.name || id : '-');

  const isAdmin = user?.role === 'admin';
  const isKeeper = !!doc && (doc.keeper_id === user?.id || isAdmin);

  const act = async (fn: () => Promise<any>) => { await fn(); await reload(); onChanged(); };

  const doPost = async () => {
    if (!doc) return;
    const payload = doc.doc_type === 'stocktake'
      ? { counts: (doc.lines || []).map((l) => ({ line_id: l.id!, counted_quantity: counts[l.id!] ?? 0 })) }
      : {};
    await act(() => inventoryApi.post(doc.id, payload));
  };

  return (
    <Modal open={!!doc} title={doc ? doc.doc_number : ''} onClose={onClose} width="3xl"
      headerAction={doc && <Badge status={doc.status} domain="inventoryDoc" />}>
      {doc && (
        <div className="space-y-6 max-h-[72vh] overflow-y-auto pr-1">
          {/* 基本信息卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoItem label="单据类型" value={DOC_TYPE_LABEL[doc.doc_type]} />
            <InfoItem label="业务子类" value={doc.biz_type || '-'} />
            <InfoItem label="审批模式" value={doc.review_mode === 'any' ? '或签' : '会签'} />
            <InfoItem label="库管员" value={doc.keeper_name || '未指定'} icon="📦" />
            <InfoItem label={doc.doc_type === 'transfer' ? '源仓' : '仓库'} value={whName(doc.warehouse_id)} />
            {doc.doc_type === 'transfer' && <InfoItem label="目标仓" value={whName(doc.to_warehouse_id)} />}
            <InfoItem label="创建人" value={doc.creator_name || '-'} icon="👤" />
            <InfoItem label="创建时间" value={fmt(doc.created_at)} />
          </div>

          {/* 明细 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">📋 明细</h4>
            <div className="rounded-lg border border-[var(--ui-border)] overflow-hidden">
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">物料</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">批次</th>
                    {doc.doc_type === 'adjustment' && <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">方向</th>}
                    {doc.doc_type === 'stocktake' && <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">账面</th>}
                    {doc.doc_type === 'stocktake' && <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">实盘</th>}
                    <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {(doc.lines || []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-sm">{matName(l.material_id)}</td>
                      <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{l.batch_no || '-'}</td>
                      {doc.doc_type === 'adjustment' && <td className="px-3 py-2 text-sm">{l.direction === 'out' ? '报损-' : '盘盈+'}</td>}
                      {doc.doc_type === 'stocktake' && <td className="px-3 py-2 text-sm text-right text-[var(--ui-text-secondary)]">{l.book_quantity ?? '-'}</td>}
                      {doc.doc_type === 'stocktake' && (
                        <td className="px-3 py-2 text-right">
                          {doc.status === 'approved' && isKeeper ? (
                            <Input size="xs" type="number" value={counts[l.id!] ?? ''}
                              onChange={(e) => setCounts({ ...counts, [l.id!]: Number(e.target.value) })}
                              className="!w-20 text-right" />
                          ) : <span className="text-sm">{l.counted_quantity ?? '-'}</span>}
                        </td>
                      )}
                      <td className="px-3 py-2 text-sm text-right font-medium">{l.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 审批记录 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">
              👥 审批记录
              {(doc.reviewers || []).length > 0 && (
                <span className="ml-2 text-xs font-normal text-[var(--ui-text-secondary)]">
                  （{(doc.review_records || []).filter((r: any) => r.decision === 'approved').length}/{(doc.reviewers || []).length} 已通过 · {doc.review_mode === 'any' ? '或签' : '会签'}）
                </span>
              )}
            </h4>
            {(doc.review_records || []).length === 0 ? (
              <div className="text-center text-[var(--ui-text-tertiary)] py-3 text-sm border border-dashed border-gray-300 rounded-lg">暂无审批记录</div>
            ) : (
              <div className="space-y-2">
                {(doc.review_records || []).map((r: any) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2 bg-[var(--ui-bg-subtle)] rounded-lg border border-[var(--ui-border)] text-sm">
                    <span className="font-medium text-[var(--ui-text-primary)]">{r.reviewer_name}</span>
                    <Badge status={r.decision} domain="decision" />
                    {r.comment && <span className="text-[var(--ui-text-secondary)]">{r.comment}</span>}
                    <span className="ml-auto text-xs text-[var(--ui-text-tertiary)]">{fmt(r.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 状态流转时间线 */}
          {(doc.status_logs || []).length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">🕒 状态流转</h4>
              <div className="space-y-0">
                {(doc.status_logs || []).map((log: any, i: number) => (
                  <div key={log.id} className="flex gap-3 pb-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full border-2 ${dotColor(log.to_status)}`} />
                      {i < (doc.status_logs || []).length - 1 && <div className="w-0.5 flex-1 bg-gray-200 min-h-[16px]" />}
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="text-sm text-[var(--ui-text-primary)]">
                        <span className="font-medium">{log.operator_name || '-'}</span>
                        <span className="text-[var(--ui-text-tertiary)] mx-1">·</span>
                        <span className={txtColor(log.to_status)}>{BADGE_DOMAINS.inventoryDoc[log.to_status]?.label || log.to_status}</span>
                      </div>
                      {log.comment && <div className="text-sm text-[var(--ui-text-secondary)] mt-0.5">{log.comment}</div>}
                      <div className="text-xs text-[var(--ui-text-tertiary)] mt-0.5">{fmt(log.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 备注 */}
          {doc.remark && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">📝 备注</h4>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap border border-[var(--ui-border)]">{doc.remark}</div>
            </div>
          )}

          {/* 操作（其余动作在列表「操作」列；此处保留需详情上下文的改派/过账） */}
          {doc.status === 'approved' && (
            <div className="flex flex-wrap gap-2 justify-end border-t border-[var(--ui-border)] pt-4">
              <Select value={reassign} onChange={(e) => setReassign(e.target.value)}>
                <option value="">改派库管员…</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </Select>
              {reassign && (
                <Button variant="secondary" onClick={() => act(() => inventoryApi.assignKeeper(doc.id, reassign)).then(() => setReassign(''))}>确认改派</Button>
              )}
              {isKeeper && (
                <Button variant="success" onClick={doPost}>过账</Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
