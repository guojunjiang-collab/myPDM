import { useEffect, useState, useCallback, useRef } from 'react';
import { ecoApi } from '../../services/api';
import type { ECORequest } from '../../types';
import { canEdit, isAdmin, useAuthStore } from '../../stores/auth';
import { toast } from '../Toast';
import { ECOStatusBadge, ECOPriorityBadge } from './ECOStatusBadge';
import { ECOCreateModal } from './ECOCreateModal';
import { ECODetailModal } from './ECODetailModal';
import { ECRCcPicker } from '../ECR/ECRCcPicker';
import { ECOCcPicker } from './ECOCcPicker';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

const PAGE_SIZE = 20;

const statusLabels: Record<string, string> = {
  draft: '草稿', reviewing: '审核中', approved: '已批准',
  rejected: '已驳回', executing: '执行中', completed: '已完成',
};

const priorityLabels: Record<string, string> = {
  urgent: '紧急', high: '高', normal: '普通', low: '低',
};

function formatDate(iso?: string) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ECOList() {
  const user = useAuthStore((s) => s.user);
  const [ecos, setEcos] = useState<ECORequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [execId, setExecId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEco, setEditingEco] = useState<ECORequest | null>(null);
  const [ccEcoId, setCcEcoId] = useState<string | null>(null);
  const editReqId = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: PAGE_SIZE };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const response = await ecoApi.list(params as Parameters<typeof ecoApi.list>[0]);
      const data = response.data;
      setEcos(data.items || []);
      setTotal(data.total || 0);
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter, priorityFilter]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (id: string) => {
    setActionLoading(id);
    try { await ecoApi.submit(id); toast.success('已提交'); load(); } catch { toast.error('提交失败'); }
    finally { setActionLoading(null); }
  };
  const handleWithdraw = async (id: string) => {
    setActionLoading(id);
    try { await ecoApi.withdraw(id); toast.success('已撤回'); load(); } catch { toast.error('撤回失败'); }
    finally { setActionLoading(null); }
  };
  const handleExecute = async (id: string) => {
    setActionLoading(id);
    try { await ecoApi.startExecution(id); toast.success('已开始执行'); load(); } catch { toast.error('执行失败'); }
    finally { setActionLoading(null); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该 ECO？')) return;
    setActionLoading(id);
    try { await ecoApi.delete(id); toast.success('已删除'); load(); } catch { toast.error('删除失败'); }
    finally { setActionLoading(null); }
  };
  const handleEdit = async (eco: ECORequest) => {
    const reqId = ++editReqId.current;
    try {
      const resp = await ecoApi.detail(eco.id);
      if (reqId !== editReqId.current) return; // 忽略过期请求
      setEditingEco(resp.data as ECORequest);
    } catch { toast.error('获取详情失败'); }
  };

  const renderActions = (eco: ECORequest) => {
    const busy = actionLoading === eco.id;
    const isCreator = user?.id === eco.creator_id;
    const admin = isAdmin();
    const ccBtn = (
      <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setCcEcoId(eco.id); }}>
        知会
      </Button>
    );
    switch (eco.status) {
      case 'draft':
        return (
          <div className="flex gap-1 justify-end">
            {(isCreator || admin) && <>
              <Button variant="link" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); handleSubmit(eco.id); }} disabled={busy}>{busy ? '...' : '提交'}</Button>
              <Button variant="link" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); handleEdit(eco); }}>编辑</Button>
              <Button variant="danger" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); handleDelete(eco.id); }} disabled={busy}>{busy ? '...' : '删除'}</Button>
            </>}
            {ccBtn}
          </div>);
      case 'reviewing':
        return (
          <div className="flex gap-1 justify-end">
            {isCreator && <Button variant="link" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); handleWithdraw(eco.id); }} disabled={busy}>{busy ? '...' : '撤回'}</Button>}
            {ccBtn}
          </div>);
      case 'approved':
        return (
          <div className="flex gap-1 justify-end">
            {(isCreator || admin) && <Button variant="link" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); handleExecute(eco.id); }} disabled={busy}>{busy ? '...' : '开始执行'}</Button>}
            {ccBtn}
          </div>);
      case 'executing':
        return (
          <div className="flex gap-1 justify-end">
            {(isCreator || admin) && <Button variant="link" size="xs" className="mr-2" onClick={(e) => { e.stopPropagation(); setExecId(eco.id); }}>执行</Button>}
            {ccBtn}
          </div>);
      case 'completed':
        return (
          <div className="flex gap-1 justify-end">
            {ccBtn}
          </div>);
      case 'rejected':
        return (
          <div className="flex gap-1 justify-end">
            {ccBtn}
          </div>);
      default: return null;
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input type="text" placeholder="搜索..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-0" />
        <Select className="!w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select className="!w-auto" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}>
          <option value="">全部优先级</option>
          {Object.entries(priorityLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <div className="flex-1" />
        {canEdit() && <Button onClick={() => { editReqId.current++; setEditingEco(null); setCreateOpen(true); }}>+ 新建 ECO</Button>}
      </div>
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">ECO 编号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">标题</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">优先级</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">创建人</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">创建时间</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (<tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--ui-text-tertiary)]">加载中...</td></tr>)
              : ecos.length === 0 ? (<tr><td colSpan={7} className="px-4 py-12 text-center text-[var(--ui-text-tertiary)]">暂无数据</td></tr>)
                : ecos.map(eco => (
                  <tr key={eco.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setDetailId(eco.id)}>
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">{eco.eco_number}</td>
                    <td className="px-4 py-3 text-sm font-medium max-w-48 truncate">{eco.title}</td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap"><ECOStatusBadge status={eco.status} /></td>
                    <td className="px-4 py-3 font-medium whitespace-nowrap"><ECOPriorityBadge priority={eco.priority} /></td>
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">{eco.creator_name}</td>
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">{formatDate(eco.created_at)}</td>
                    <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>{renderActions(eco)}</td>
                  </tr>))
            }
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 shrink-0">
          <span className="text-sm text-[var(--ui-text-secondary)]">共 {total} 条，第 {page} / {totalPages} 页</span>
          <div className="flex gap-1 justify-end">
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2).map((p, idx, arr) => (
              <span key={p}>{idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-[var(--ui-text-tertiary)]">...</span>}
                <Button variant={p === page ? 'primary' : 'secondary'} size="sm" onClick={() => setPage(p)}>{p}</Button></span>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        </div>
      )}
      <ECOCreateModal open={createOpen || !!editingEco} onClose={() => { setCreateOpen(false); setEditingEco(null); }} onCreated={() => { setCreateOpen(false); setEditingEco(null); load(); }} editingEco={editingEco} />
      {detailId && <ECODetailModal ecoId={detailId} onClose={() => setDetailId(null)} onRefresh={load} />}
      {execId && <ECODetailModal ecoId={execId} onClose={() => setExecId(null)} onRefresh={load} executionMode />}
      {ccEcoId && (
        <ECRCcPicker
          open={true}
          ecrId={ccEcoId}
          onClose={() => setCcEcoId(null)}
          api={{
            get: (id: string) => ecoApi.detail(id),
            cc: (id: string, userIds: string[]) => ecoApi.cc(id, userIds),
            uncc: (id: string, userId: string) => ecoApi.uncc(id, userId),
          }}
        />
      )}
      {ccEcoId && <ECOCcPicker open={!!ccEcoId} ecoId={ccEcoId} onClose={() => setCcEcoId(null)} />}
    </div>
  );
}
