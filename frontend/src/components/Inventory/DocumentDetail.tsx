import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import type { InvDocument, InvDocStatus } from '../../types';

const STATUS_LABEL: Record<InvDocStatus, string> = {
  draft: '草稿', reviewing: '审批中', approved: '已审批', posted: '已过账',
  rejected: '已拒绝', cancelled: '已取消',
};

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

  if (!doc) return null;
  const matName = (id: string) => {
    const m = materials.find((x) => x.id === id);
    return m ? `${m.code} ${m.name}` : id;
  };
  const isAdmin = user?.role === 'admin';
  const isKeeper = doc.keeper_id === user?.id || isAdmin;
  const isCreator = doc.creator_id === user?.id || isAdmin;

  const act = async (fn: () => Promise<any>) => { await fn(); await reload(); onChanged(); };

  const doPost = async () => {
    const payload = doc.doc_type === 'stocktake'
      ? { counts: (doc.lines || []).map((l) => ({ line_id: l.id!, counted_quantity: counts[l.id!] ?? 0 })) }
      : {};
    await act(() => inventoryApi.post(doc.id, payload));
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white p-5 rounded w-[46rem] max-h-[90vh] overflow-auto space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">{doc.doc_number}
            <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">{STATUS_LABEL[doc.status]}</span>
          </h3>
          <button onClick={onClose} className="text-gray-400">✕</button>
        </div>

        <div className="text-sm text-gray-600">库管员：{doc.keeper_name || '未指定'} · 创建人：{doc.creator_name}</div>

        {/* 明细 */}
        <table className="w-full text-xs border">
          <thead className="bg-gray-50"><tr>
            <th className="p-1 text-left">物料</th><th className="p-1">批次</th>
            {doc.doc_type === 'adjustment' && <th className="p-1">方向</th>}
            {doc.doc_type === 'stocktake' && <th className="p-1">账面</th>}
            {doc.doc_type === 'stocktake' && <th className="p-1">实盘</th>}
            <th className="p-1">数量</th></tr></thead>
          <tbody>
            {(doc.lines || []).map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-1">{matName(l.material_id)}</td>
                <td className="p-1 text-center">{l.batch_no || '-'}</td>
                {doc.doc_type === 'adjustment' && <td className="p-1 text-center">{l.direction === 'out' ? '报损-' : '盘盈+'}</td>}
                {doc.doc_type === 'stocktake' && <td className="p-1 text-center">{l.book_quantity ?? '-'}</td>}
                {doc.doc_type === 'stocktake' && (
                  <td className="p-1 text-center">
                    {doc.status === 'approved' && isKeeper ? (
                      <input type="number" value={counts[l.id!] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [l.id!]: Number(e.target.value) })}
                        className="w-16 border px-1 rounded" />
                    ) : (l.counted_quantity ?? '-')}
                  </td>
                )}
                <td className="p-1 text-center">{l.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 审批记录 + 状态日志 */}
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="font-medium mb-1">审批记录</div>
            {(doc.review_records || []).map((r: any) => (
              <div key={r.id} className="border-b py-1">{r.reviewer_name}：{r.decision} {r.comment}</div>
            ))}
            {(doc.review_records || []).length === 0 && <div className="text-gray-400">暂无</div>}
          </div>
          <div>
            <div className="font-medium mb-1">状态流转</div>
            {(doc.status_logs || []).map((s: any) => (
              <div key={s.id} className="border-b py-1">{s.from_status || '—'}→{s.to_status} · {s.operator_name}</div>
            ))}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2 justify-end border-t pt-3">
          {doc.status === 'draft' && isCreator && (
            <button onClick={() => act(() => inventoryApi.submit(doc.id))}
              className="px-3 py-1 bg-blue-500 text-white text-sm rounded">提交审批</button>
          )}
          {doc.status === 'draft' && isCreator && (
            <button onClick={() => act(() => inventoryApi.deleteDocument(doc.id)).then(onClose)}
              className="px-3 py-1 text-red-500 text-sm">删除</button>
          )}
          {doc.status === 'reviewing' && (doc.reviewers || []).some((r) => r.user_id === user?.id) && (
            <>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'approved' }))}
                className="px-3 py-1 bg-green-500 text-white text-sm rounded">通过</button>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'returned' }))}
                className="px-3 py-1 bg-yellow-500 text-white text-sm rounded">退回</button>
              <button onClick={() => act(() => inventoryApi.review(doc.id, { decision: 'rejected' }))}
                className="px-3 py-1 bg-red-500 text-white text-sm rounded">拒绝</button>
            </>
          )}
          {doc.status === 'reviewing' && isCreator && (
            <button onClick={() => act(() => inventoryApi.withdraw(doc.id))}
              className="px-3 py-1 text-sm border rounded">撤回</button>
          )}
          {doc.status === 'approved' && (
            <>
              <select value={reassign} onChange={(e) => setReassign(e.target.value)}
                className="border px-2 py-1 rounded text-sm">
                <option value="">改派库管员…</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </select>
              {reassign && (
                <button onClick={() => act(() => inventoryApi.assignKeeper(doc.id, reassign)).then(() => setReassign(''))}
                  className="px-3 py-1 text-sm border rounded">确认改派</button>
              )}
              {isKeeper && (
                <button onClick={doPost}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded">过账</button>
              )}
              <button onClick={() => act(() => inventoryApi.cancel(doc.id))}
                className="px-3 py-1 text-sm border rounded">取消</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
