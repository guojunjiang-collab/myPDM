import { useEffect, useState, useMemo } from 'react';
import { formatDate } from '../../lib/date';
import { useInventoryStore } from '../../stores/inventory';
import { useAuthStore } from '../../stores/auth';
import { inventoryApi } from '../../services/inventoryApi';
import { canDownload } from '../../stores/auth';
import { BADGE_DOMAINS } from '../../constants/badges';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Dropdown from '../ui/Dropdown';
import SortableTh from '../ui/SortableTh';
import { ConfirmModal } from '../Modal';
import { toast } from '../Toast';
import DocumentEditModal from './DocumentEditModal';
import DocumentDetail from './DocumentDetail';
import type { InvDocType } from '../../types';
import { useTableSort } from '../../hooks/useTableSort';

const DOC_TYPES: { key: InvDocType; label: string }[] = [
  { key: 'inbound', label: '入库单' }, { key: 'outbound', label: '出库单' },
  { key: 'transfer', label: '调拨单' }, { key: 'stocktake', label: '盘点单' },
  { key: 'adjustment', label: '库存调整单' },
];

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
  // 行级破坏性操作确认（状态驱动 ConfirmModal）
  const [confirmDoc, setConfirmDoc] = useState<{ id: string; action: 'delete' | 'post' | 'cancel' } | null>(null);

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

  // 客户端排序（全量数据）
  const { sortedData: sortedDocs, sortField, sortDirection, handleSort } = useTableSort<any>(filteredDocs);

  // 点击外部关闭新建菜单 → Dropdown 内置处理

  const act = async (fn: () => Promise<any>) => {
    try { await fn(); await load(); }
    catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
  };

  // 行内操作列：按状态/角色显示动作；过账(盘点)与改派需在详情里填实盘/选人，故打开详情
  const renderActions = (d: any) => {
    const isCreator = d.creator_id === user?.id || isAdmin;
    const isKeeper = d.keeper_id === user?.id || isAdmin;
    const isReviewer = (d.reviewers || []).some((r: any) => r.user_id === user?.id);
    if (d.status === 'draft' && isCreator) {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <Button variant="link" size="xs" className="mr-2" onClick={() => act(() => inventoryApi.submit(d.id))}>提交审批</Button>
          <Button variant="danger" size="xs" onClick={() => setConfirmDoc({ id: d.id, action: 'delete' })}>删除</Button>
        </div>
      );
    }
    if (d.status === 'reviewing') {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {(isReviewer || isAdmin) && (
            <>
              <Button variant="link" size="xs" className="mr-2" onClick={() => act(() => inventoryApi.review(d.id, { decision: 'approved' }))}>通过</Button>
              <Button variant="link" size="xs" className="mr-2" onClick={() => act(() => inventoryApi.review(d.id, { decision: 'returned' }))}>退回</Button>
              <Button variant="link" size="xs" className="mr-2" onClick={() => act(() => inventoryApi.review(d.id, { decision: 'rejected' }))}>拒绝</Button>
            </>
          )}
          {isCreator && <Button variant="link" size="xs" onClick={() => act(() => inventoryApi.withdraw(d.id))}>撤回</Button>}
        </div>
      );
    }
    if (d.status === 'approved') {
      return (
        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {isKeeper && (
            <Button variant="link" size="xs" className="mr-2" onClick={() => d.doc_type === 'stocktake' ? setDetailId(d.id) : setConfirmDoc({ id: d.id, action: 'post' })}>过账</Button>
          )}
          <Button variant="link" size="xs" className="mr-2" onClick={() => setDetailId(d.id)}>改派</Button>
          <Button variant="link" size="xs" onClick={() => setConfirmDoc({ id: d.id, action: 'cancel' })}>取消</Button>
        </div>
      );
    }
    return <span className="text-gray-300 text-sm">—</span>;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 items-center shrink-0">
        <Input type="text" placeholder="搜索单据号/业务/创建人/物料..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="!w-64" />
        <Select className="!w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">全部类型</option>
          {DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
        <Select className="!w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(BADGE_DOMAINS.inventoryDoc).map(([k, def]) => <option key={k} value={k}>{def.label}</option>)}
        </Select>
        <div className="flex-1" />
        {canDownload() && (
          <Dropdown
            open={showMenu}
            onOpenChange={setShowMenu}
            align="right"
            trigger={<Button onClick={() => setShowMenu(!showMenu)}>+ 新建单据 ▾</Button>}
          >
            {DOC_TYPES.map((t) => (
              <Button key={t.key} variant="ghost" size="sm" className="w-full !justify-start rounded-none"
                onClick={() => { setCreating(t.key); setShowMenu(false); }}>{t.label}</Button>
            ))}
          </Dropdown>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <SortableTh sortKey="doc_number" active={sortField === 'doc_number'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">单据号</SortableTh>
              <SortableTh sortKey="doc_type" active={sortField === 'doc_type'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">类型</SortableTh>
              <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">状态</SortableTh>
              <SortableTh sortKey="keeper_name" active={sortField === 'keeper_name'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">库管员</SortableTh>
              <SortableTh sortKey="creator_name" active={sortField === 'creator_name'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">创建人</SortableTh>
              <SortableTh sortKey="created_at" active={sortField === 'created_at'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-center">创建时间</SortableTh>
              <SortableTh align="right">操作</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : sortedDocs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">无匹配结果</td></tr>
            ) : sortedDocs.map((d) => (
              <tr key={d.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setDetailId(d.id)}>
                <td className="px-4 py-3 text-sm font-medium text-primary-600">{d.doc_number}</td>
                <td className="px-4 py-3 text-sm font-medium">{DOC_TYPES.find((t) => t.key === d.doc_type)?.label}</td>
                <td className="px-4 py-3 text-sm font-medium">
                  <Badge status={d.status} domain="inventoryDoc" />
                </td>
                <td className="px-4 py-3 text-sm font-medium">{d.keeper_name || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{d.creator_name}</td>
                <td className="px-4 py-3 text-sm font-medium text-center whitespace-nowrap">{formatDate(d.created_at, 'YYYY-MM-DD HH:mm')}</td>
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

      {/* 行级操作确认 */}
      <ConfirmModal
        open={!!confirmDoc}
        title="确认操作"
        content={
          confirmDoc?.action === 'delete' ? '确认删除该单据？'
          : confirmDoc?.action === 'post' ? '确认过账？'
          : '确认取消该单据？'
        }
        onConfirm={() => {
          if (!confirmDoc) return;
          const { id, action } = confirmDoc;
          if (action === 'delete') act(() => inventoryApi.deleteDocument(id));
          else if (action === 'post') act(() => inventoryApi.post(id, {}));
          else act(() => inventoryApi.cancel(id));
          setConfirmDoc(null);
        }}
        onCancel={() => setConfirmDoc(null)}
      />
    </div>
  );
}
