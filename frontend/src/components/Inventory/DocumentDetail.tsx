import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import { Modal } from '../Modal';
import type { InvDocument, InvDocStatus } from '../../types';

const STATUS_LABEL: Record<InvDocStatus, string> = {
  draft: '草稿', reviewing: '审批中', approved: '已审批', posted: '已过账',
  rejected: '已拒绝', cancelled: '已取消',
};
const STATUS_COLOR: Record<InvDocStatus, string> = {
  draft: 'bg-gray-100 text-gray-600', reviewing: 'bg-amber-100 text-amber-700',
  approved: 'bg-primary-100 text-primary-700', posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400',
};

const thCls = 'text-left px-3 py-2 text-xs font-medium text-gray-500';

export default function DocumentDetail({ docId, onClose, onChanged }:
  { docId: string; onClose: () => void; onChanged: () => void }) {
  const { materials, users } = useInventoryStore();
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
  const isAdmin = user?.role === 'admin';
  const isKeeper = !!doc && (doc.keeper_id === user?.id || isAdmin);
  const isCreator = !!doc && (doc.creator_id === user?.id || isAdmin);
  const isReviewer = !!doc && (doc.reviewers || []).some((r) => r.user_id === user?.id);

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
      headerAction={doc && (
        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[doc.status]}`}>{STATUS_LABEL[doc.status]}</span>
      )}>
      {doc && (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            库管员：<span className="text-gray-700">{doc.keeper_name || '未指定'}</span>
            <span className="mx-2">·</span>
            创建人：<span className="text-gray-700">{doc.creator_name}</span>
          </div>

          {/* 明细 */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className={thCls}>物料</th>
                  <th className={thCls}>批次</th>
                  {doc.doc_type === 'adjustment' && <th className={thCls}>方向</th>}
                  {doc.doc_type === 'stocktake' && <th className={thCls}>账面</th>}
                  {doc.doc_type === 'stocktake' && <th className={thCls}>实盘</th>}
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">数量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {(doc.lines || []).map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-sm">{matName(l.material_id)}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{l.batch_no || '-'}</td>
                    {doc.doc_type === 'adjustment' && <td className="px-3 py-2 text-sm">{l.direction === 'out' ? '报损-' : '盘盈+'}</td>}
                    {doc.doc_type === 'stocktake' && <td className="px-3 py-2 text-sm text-gray-500">{l.book_quantity ?? '-'}</td>}
                    {doc.doc_type === 'stocktake' && (
                      <td className="px-3 py-2 text-sm">
                        {doc.status === 'approved' && isKeeper ? (
                          <input type="number" value={counts[l.id!] ?? ''}
                            onChange={(e) => setCounts({ ...counts, [l.id!]: Number(e.target.value) })}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
                        ) : (l.counted_quantity ?? '-')}
                      </td>
                    )}
                    <td className="px-3 py-2 text-sm text-right font-medium">{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 审批记录 + 状态日志 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1.5">审批记录</div>
              <div className="text-sm space-y-1">
                {(doc.review_records || []).map((r: any) => (
                  <div key={r.id} className="text-gray-600">
                    {r.reviewer_name}：<span className={r.decision === 'approved' ? 'text-green-600' : 'text-red-600'}>{r.decision}</span>
                    {r.comment ? ` ${r.comment}` : ''}
                  </div>
                ))}
                {(doc.review_records || []).length === 0 && <div className="text-gray-400">暂无</div>}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-1.5">状态流转</div>
              <div className="text-sm space-y-1">
                {(doc.status_logs || []).map((s: any) => (
                  <div key={s.id} className="text-gray-600">{s.from_status || '—'} → {s.to_status} · {s.operator_name}</div>
                ))}
                {(doc.status_logs || []).length === 0 && <div className="text-gray-400">暂无</div>}
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2 justify-end border-t border-gray-200 pt-4">
            {doc.status === 'draft' && isCreator && (
              <>
                <button onClick={() => act(() => inventoryApi.deleteDocument(doc.id)).then(onClose)}
                  className="px-4 py-2 border border-gray-300 text-red-600 rounded-lg hover:bg-red-50 text-sm">删除</button>
                <button onClick={() => act(() => inventoryApi.submit(doc.id))}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">提交审批</button>
              </>
            )}
            {doc.status === 'reviewing' && isCreator && (
              <button onClick={() => act(() => inventoryApi.withdraw(doc.id))}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">撤回</button>
            )}
            {doc.status === 'reviewing' && isReviewer && (
              <>
                <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'returned' }))}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm">退回</button>
                <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'rejected' }))}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">拒绝</button>
                <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'approved' }))}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">通过</button>
              </>
            )}
            {doc.status === 'approved' && (
              <>
                <select value={reassign} onChange={(e) => setReassign(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm bg-white">
                  <option value="">改派库管员…</option>
                  {users.filter((u) => u.role !== 'guest').map((u) => (
                    <option key={u.id} value={u.id}>{u.real_name}</option>
                  ))}
                </select>
                {reassign && (
                  <button onClick={() => act(() => inventoryApi.assignKeeper(doc.id, reassign)).then(() => setReassign(''))}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">确认改派</button>
                )}
                <button onClick={() => act(() => inventoryApi.cancel(doc.id))}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消单据</button>
                {isKeeper && (
                  <button onClick={doPost}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">过账</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
