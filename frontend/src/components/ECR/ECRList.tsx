import { useEffect, useState, useCallback } from 'react';
import { ecrApi } from '../../services/api';
import type { ECRRequest } from '../../types';
import { canEdit, isAdmin, useAuthStore } from '../../stores/auth';
import { toast } from '../Toast';
import { ECRStatusBadge, ECRPriorityBadge } from './ECRStatusBadge';
import { ConfirmModal } from '../Modal';
import { ECRCreateModal } from './ECRCreateModal';
import { ECRDetailModal } from './ECRDetailModal';
import { CcPicker } from '../CcPicker';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SortableTh from '../ui/SortableTh';
import { useServerSort } from '../../hooks/useServerSort';

const PAGE_SIZE = 20;

const statusLabels: Record<string, string> = {
  draft: '草稿',
  reviewing: '审核中',
  approved: '已批准',
  rejected: '已驳回',
  closed: '已关闭',
};

const priorityLabels: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
};

const categoryLabels: Record<string, string> = {
  design_change: '设计变更',
  process_change: '工艺变更',
  material_change: '物料变更',
  other: '其他',
};

export function ECRList() {
  const user = useAuthStore((s) => s.user);
  const [ecrs, setEcrs] = useState<ECRRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [detailEcrId, setDetailEcrId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEcr, setEditEcr] = useState<ECRRequest | null>(null);
  const [ccEcrId, setCcEcrId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sort = useServerSort('created_at', 'desc');

  const loadEcrs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        page_size: PAGE_SIZE,
        sort_field: sort.sortField ?? 'created_at',
        sort_order: sort.sortOrder,
      };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;

      const response = await ecrApi.list(params as Parameters<typeof ecrApi.list>[0]);
      const data = response.data;
      setEcrs(data.items || data || []);
      setTotal(data.total || (data.items ? data.items.length : Array.isArray(data) ? data.length : 0));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载 ECR 列表失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, priorityFilter, sort.sortField, sort.sortOrder]);

  useEffect(() => {
    loadEcrs();
  }, [loadEcrs]);

  // 排序变化时重置到第 1 页
  useEffect(() => {
    setPage(1);
  }, [sort.sortField, sort.sortOrder]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleEdit = async (ecr: ECRRequest) => {
    try {
      const resp = await ecrApi.get(ecr.id);
      const detail = (resp.data || resp) as ECRRequest;
      setEditEcr(detail);
    } catch {
      toast.error('获取 ECR 详情失败');
    }
  };

  const handlePriorityChange = (value: string) => {
    setPriorityFilter(value);
    setPage(1);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await ecrApi.delete(deleteId);
      toast.success('ECR 已删除');
      setDeleteId(null);
      loadEcrs();
    } catch (err: unknown) {
      // 后端引用限制等校验信息放在 response.data.detail
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const message = detail || (err instanceof Error ? err.message : '删除失败');
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (id: string, isWithdraw = false) => {
    setActionLoading(id);
    try {
      if (isWithdraw) {
        await ecrApi.withdraw(id);
        toast.success('ECR 已撤回');
      } else {
        await ecrApi.submit(id);
        toast.success('ECR 已提交审核');
      }
      loadEcrs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '提交失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleClose = async (id: string) => {
    setActionLoading(id);
    try {
      await ecrApi.close(id);
      toast.success('ECR 已关闭');
      loadEcrs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '关闭失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReviewAction = async (id: string, decision: string) => {
    setActionLoading(id);
    try {
      await ecrApi.review(id, decision);
      const labels: Record<string, string> = { approved: '批准', rejected: '驳回', returned: '退回' };
      toast.success(`ECR 已${labels[decision] || decision}`);
      loadEcrs();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '操作失败';
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const renderActions = (ecr: ECRRequest) => {
    const isBusy = actionLoading === ecr.id;
    const isCreator = user?.id === ecr.creator_id;
    const isReviewer = ecr.reviewers?.some((r) => r.user_id === user?.id);
    const admin = isAdmin();

    switch (ecr.status) {
      case 'draft':
        return (
          <div className="flex gap-1 justify-end">
            {(isCreator || admin) && (
              <>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleSubmit(ecr.id)} disabled={isBusy}>
                  {isBusy ? '...' : '提交'}
                </Button>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleEdit(ecr)}>
                  编辑
                </Button>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleClose(ecr.id)} disabled={isBusy}>
                  {isBusy ? '...' : '关闭'}
                </Button>
              </>
            )}
            {(isCreator || admin) && (
              <Button variant="danger" size="xs" className="mr-2" onClick={() => setDeleteId(ecr.id)}>
                删除
              </Button>
            )}
            <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}>
              知会
            </Button>
          </div>
        );
      case 'reviewing':
        return (
          <div className="flex gap-1 justify-end">
            {isCreator && (
              <>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleSubmit(ecr.id, true)} disabled={isBusy}>
                  {isBusy ? '...' : '撤回'}
                </Button>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleEdit(ecr)}>
                  编辑
                </Button>
              </>
            )}
            {(isReviewer || admin) && (
              <>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleReviewAction(ecr.id, 'approved')} disabled={isBusy}>
                  {isBusy ? '...' : '通过'}
                </Button>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleReviewAction(ecr.id, 'rejected')} disabled={isBusy}>
                  {isBusy ? '...' : '驳回'}
                </Button>
                <Button variant="link" size="xs" className="mr-2" onClick={() => handleReviewAction(ecr.id, 'returned')} disabled={isBusy}>
                  {isBusy ? '...' : '退回'}
                </Button>
              </>
            )}
            {admin && (
              <Button variant="danger" size="xs" className="mr-2" onClick={() => setDeleteId(ecr.id)}>
                删除
              </Button>
            )}
            <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}>
              知会
            </Button>
          </div>
        );
      case 'approved':
      case 'rejected':
        return (
          <div className="flex gap-1 justify-end">
            {admin && (
              <Button variant="link" size="xs" className="mr-2" onClick={() => handleClose(ecr.id)} disabled={isBusy}>
                {isBusy ? '...' : '关闭'}
              </Button>
            )}
            {admin && (
              <Button variant="danger" size="xs" className="mr-2" onClick={() => setDeleteId(ecr.id)}>
                删除
              </Button>
            )}
            <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}>
              知会
            </Button>
          </div>
        );
      case 'closed':
        return (
          <div className="flex gap-1 justify-end">
            {admin && (
              <Button variant="danger" size="xs" className="mr-2" onClick={() => setDeleteId(ecr.id)}>
                删除
              </Button>
            )}
            <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}>
              知会
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Header & Filters */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 min-w-0"
        />
        <Select
          className="!w-auto"
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
        >
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Select
          className="!w-auto"
          value={priorityFilter}
          onChange={(e) => handlePriorityChange(e.target.value)}
        >
          <option value="">全部优先级</option>
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <div className="flex-1" />
        {canEdit() && (
          <Button onClick={() => setCreateOpen(true)}>
            + 新建 ECR
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <SortableTh sortKey="ecr_number" active={sort.isActive('ecr_number')} direction={sort.direction} onSort={sort.handleSort}>ECR 编号</SortableTh>
              <SortableTh sortKey="title" active={sort.isActive('title')} direction={sort.direction} onSort={sort.handleSort}>标题</SortableTh>
              <SortableTh sortKey="status" active={sort.isActive('status')} direction={sort.direction} onSort={sort.handleSort}>状态</SortableTh>
              <SortableTh sortKey="priority" active={sort.isActive('priority')} direction={sort.direction} onSort={sort.handleSort}>优先级</SortableTh>
              <SortableTh sortKey="creator_name" active={sort.isActive('creator_name')} direction={sort.direction} onSort={sort.handleSort}>创建人</SortableTh>
              <SortableTh sortKey="created_at" active={sort.isActive('created_at')} direction={sort.direction} onSort={sort.handleSort}>创建时间</SortableTh>
              <SortableTh align="right">操作</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[var(--ui-text-tertiary)]">
                  加载中...
                </td>
              </tr>
            ) : ecrs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[var(--ui-text-tertiary)]">
                  暂无数据
                </td>
              </tr>
            ) : (
              ecrs.map((ecr) => (
                <tr
                  key={ecr.id}
                  className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                  onClick={() => setDetailEcrId(ecr.id)}
                >
                  <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">
                    {ecr.ecr_number}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium max-w-48 truncate">
                    {ecr.title}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <ECRStatusBadge status={ecr.status} />
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <ECRPriorityBadge priority={ecr.priority} />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">
                    {ecr.creator_name}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium whitespace-nowrap">
                    {formatDate(ecr.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    {renderActions(ecr)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 shrink-0">
          <span className="text-sm text-[var(--ui-text-secondary)]">
            共 {total} 条，第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-1 justify-end">
            <Button variant="secondary" size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              上一页
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .map((p, idx, arr) => (
                <span key={p}>
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="px-1 text-[var(--ui-text-tertiary)]">...</span>
                  )}
                  <Button variant={p === page ? 'primary' : 'secondary'} size="sm"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                </span>
              ))}
            <Button variant="secondary" size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <ECRCreateModal
        open={createOpen || !!editEcr}
        editingEcr={editEcr}
        onClose={() => { setCreateOpen(false); setEditEcr(null); }}
        onSuccess={() => { setCreateOpen(false); setEditEcr(null); loadEcrs(); }}
      />

      {/* Detail Modal */}
      {detailEcrId && (
        <ECRDetailModal
          open={!!detailEcrId}
          ecrId={detailEcrId}
          onClose={() => setDetailEcrId(null)}
          onSuccess={() => { setDetailEcrId(null); loadEcrs(); }}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        open={!!deleteId}
        title="确认删除"
        content="确定要删除该 ECR 吗？此操作不可撤销。"
        confirmText={deleting ? '删除中...' : '删除'}
        cancelText="取消"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* 知会用户选择 */}
      <CcPicker
        open={!!ccEcrId}
        entityId={ccEcrId || ''}
        onClose={() => setCcEcrId(null)}
      />
    </div>
  );
}

export default ECRList;
