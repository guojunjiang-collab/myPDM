import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
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
  draft: 'bg-gray-100 text-gray-600', reviewing: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700', posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-400',
};

export default function DocumentTab() {
  const { loadMaterials, loadWarehouses } = useInventoryStore();
  const [docs, setDocs] = useState<any[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState<InvDocType | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = async () => {
    const res = await inventoryApi.listDocuments({
      doc_type: typeFilter || undefined, status: statusFilter || undefined,
    });
    setDocs(res.data.items);
  };

  useEffect(() => { loadMaterials(); loadWarehouses(); }, [loadMaterials, loadWarehouses]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeFilter, statusFilter]);

  return (
    <div>
      <div className="flex gap-2 mb-3 items-center">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="border px-2 py-1 rounded text-sm">
          <option value="">全部类型</option>
          {DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border px-2 py-1 rounded text-sm">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative ml-auto">
          <button onClick={() => setShowMenu(!showMenu)}
            className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建单据 ▾</button>
          {showMenu && (
            <div className="absolute right-0 mt-1 bg-white border rounded shadow z-10">
              {DOC_TYPES.map((t) => (
                <button key={t.key} onClick={() => { setCreating(t.key); setShowMenu(false); }}
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">{t.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <table className="w-full text-sm border">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-left">单据号</th><th className="p-2 text-left">类型</th>
          <th className="p-2 text-left">状态</th><th className="p-2 text-left">库管员</th>
          <th className="p-2 text-left">创建人</th><th className="p-2 text-left">创建时间</th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(d.id)}>
              <td className="p-2 text-blue-600">{d.doc_number}</td>
              <td className="p-2">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</td>
              <td className="p-2"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLOR[d.status as InvDocStatus]}`}>
                {STATUS_LABEL[d.status as InvDocStatus]}</span></td>
              <td className="p-2">{d.keeper_name || '-'}</td>
              <td className="p-2">{d.creator_name}</td>
              <td className="p-2">{d.created_at?.slice(0, 16).replace('T', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
