import { useEffect, useState, useRef, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
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

export default function DocumentTab() {
  const { loadMaterials, loadWarehouses } = useInventoryStore();
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
      return [d.doc_number, d.biz_type, d.creator_name, d.keeper_name, typeLabel]
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

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 items-center">
        <input type="text" placeholder="搜索单据号/业务/创建人..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-52 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
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
              <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-hidden">
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
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">单据号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">类型</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">库管员</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建人</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : filteredDocs.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : filteredDocs.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(d.id)}>
                <td className="px-4 py-3 text-sm font-medium text-primary-600">{d.doc_number}</td>
                <td className="px-4 py-3 text-sm">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[d.status as InvDocStatus]}`}>
                    {STATUS_LABEL[d.status as InvDocStatus]}</span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{d.keeper_name || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{d.creator_name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{d.created_at?.slice(0, 16).replace('T', ' ')}</td>
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
