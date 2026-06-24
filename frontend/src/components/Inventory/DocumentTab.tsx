import { useEffect, useState, useRef, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import { canDownload } from '../../stores/auth';
import DocumentEditModal from './DocumentEditModal';
import DocumentDetail from './DocumentDetail';
import type { InvDocType, InvDocStatus } from '../../types';

const DOC_TYPES: { key: InvDocType; label: string }[] = [
  { key: 'inbound', label: '入库单' }, { key: 'outbound', label: '出库单' },
  { key: 'transfer', label: '调拨单' }, { key: 'stocktake', label: '盘点单' },
  { key: 'adjustment', label: '库存调整单' },
];
const STATUS_LABEL: Record<InvDocStatus, string> = {
  draft: '草稿', reviewing: '审批中', approved: '已审批', posted: '已过账',
  rejected: '已拒绝', cancelled: '已取消',
};
const STATUS_COLOR: Record<InvDocStatus, string> = {
  draft: 'bg-gray-100 text-gray-600', reviewing: 'bg-amber-100 text-amber-700',
  approved: 'bg-primary-100 text-primary-700', posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400',
};

const ACT_BTN = 'text-sm';

export default function DocumentTab() {
  const { loadMaterials, loadWarehouses } = useInventoryStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState<InvDocType | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await inventoryApi.listDocuments({
        doc_type: typeFilter || undefined, status: statusFilter || undefined, page_size: 100,
      });
      setDocs(res.data.items);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadMaterials(); loadWarehouses(); }, [loadMaterials, loadWarehouses]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, statusFilter]);

  // 客户端即时过滤（边输入边搜索）：单据号/业务子类/创建人/库管员/类型
  const filteredDocs = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return docs;
    return docs.filter((d) => {
      const typeLabel = DOC_TYPES.find((t) => t.key === d.doc_type)?.label || '';
      return [d.doc_number, d.biz_type, d.creator_name, d.keeper_name, typeLabel, d.materials]
        .some((v) => (v || '').toLowerCase().includes(kw));
    });
  }, [docs, search]);

  // 点击外部关闭新建菜单
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectCls = 'px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white';

  const act = async (fn: () => Promise<any>) => {
    try { await fn(); await load(); }
    catch (e: any) { alert(e?.response?.data?.detail || '操作失败'); }
  };

  // 行内操作列：按状态/角色显示动作；过账(盘点)与改派需在详情里填实盘/选人，故打开详情
  const renderActions = (d: any) => {
    const isCreator = d.creator_id === user?.id || isAdmin;
    const isKeeper = d.keeper_id === user?.id || isAdmin;
    const isReviewer = (d.reviewers || []).some((r: any) => r.user_id === user?.id);
    if (d.status === 'draft' && isCreator) {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => act(() => inventoryApi.submit(d.id))} className="text-blue-600 hover:text-blue-800 text-sm mr-2">提交审批</button>
          <button onClick={() => confirm('确认删除该单据？') && act(() => inventoryApi.deleteDocument(d.id))} className="text-red-600 hover:text-red-800 text-sm">删除</button>
        </div>
      );
    }
    if (d.status === 'reviewing') {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {(isReviewer || isAdmin) && (
            <>
              <button onClick={() => act(() => inventoryApi.review(d.id, { decision: 'approved' }))} className="text-green-600 hover:text-green-800 text-sm mr-2">通过</button>
              <button onClick={() => act(() => inventoryApi.review(d.id, { decision: 'returned' }))} className="text-orange-600 hover:text-orange-800 text-sm mr-2">退回</button>
              <button onClick={() => act(() => inventoryApi.review(d.id, { decision: 'rejected' }))} className="text-red-600 hover:text-red-800 text-sm mr-2">拒绝</button>
            </>
          )}
          {isCreator && <button onClick={() => act(() => inventoryApi.withdraw(d.id))} className="text-gray-600 hover:text-gray-800 text-sm">撤回</button>}
        </div>
      );
    }
    if (d.status === 'approved') {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {isKeeper && (
            <button onClick={() => d.doc_type === 'stocktake' ? setDetailId(d.id) : (confirm('确认过账？') && act(() => inventoryApi.post(d.id, {})))}
              className="text-green-600 hover:text-green-800 text-sm mr-2">过账</button>
          )}
          <button onClick={() => setDetailId(d.id)} className="text-primary-600 hover:text-primary-800 text-sm mr-2">改派</button>
          <button onClick={() => confirm('确认取消该单据？') && act(() => inventoryApi.cancel(d.id))} className="text-red-600 hover:text-red-800 text-sm">取消</button>
        </div>
      );
    }
    return <span className="text-gray-300 text-sm">—</span>;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 items-center shrink-0">
        <input type="text" placeholder="搜索单据号/业务/创建人/物料..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-80 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls}>
          <option value="">全部类型</option>
          {DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex-1" />
        {canDownload() && (
          <div className="relative" ref={menuRef}>
            <button onClick={() => setShowMenu(!showMenu)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建单据 ▾</button>
            {showMenu && (
              <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                {DOC_TYPES.map((t) => (
                  <button key={t.key} onClick={() => { setCreating(t.key); setShowMenu(false); }}
                    className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 whitespace-nowrap">{t.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">单据号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">类型</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">库管员</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建人</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : filteredDocs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : filteredDocs.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(d.id)}>
                <td className="px-4 py-3 text-sm font-medium text-primary-600">{d.doc_number}</td>
                <td className="px-4 py-3 text-sm font-medium">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</td>
                <td className="px-4 py-3 text-sm font-medium">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[d.status as InvDocStatus]}`}>
                    {STATUS_LABEL[d.status as InvDocStatus]}</span>
                </td>
                <td className="px-4 py-3 text-sm font-medium">{d.keeper_name || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{d.creator_name}</td>
                <td className="px-4 py-3 text-sm font-medium">{d.created_at?.slice(0, 16).replace('T', ' ')}</td>
                <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>{renderActions(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <DocumentEditModal docType={creating} onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load(); }} />
      )}
      {detailId && (
        <DocumentDetail docId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
      )}
    </div>
  );
}
