import { useEffect, useState, useCallback } from 'react';
import { ecrApi } from '../../services/api';
import type { ECRRequest } from '../../types';
import { canEdit, isAdmin, useAuthStore } from '../../stores/auth';
import { toast } from '../Toast';
import { ECRStatusBadge, ECRPriorityBadge } from './ECRStatusBadge';
import { ConfirmModal } from '../Modal';
import { ECRCreateModal } from './ECRCreateModal';
import { ECRDetailModal } from './ECRDetailModal';
import { ECRCcPicker } from './ECRCcPicker';

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

  const loadEcrs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        page_size: PAGE_SIZE,
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
  }, [page, search, statusFilter, priorityFilter]);

  useEffect(() => {
    loadEcrs();
  }, [loadEcrs]);

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
                <button onClick={() => handleSubmit(ecr.id)} disabled={isBusy}
                  className="text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '提交'}
                </button>
                <button onClick={() => handleEdit(ecr)}
                  className="text-primary-600 hover:text-primary-800 text-sm mr-2">
                  编辑
                </button>
                <button onClick={() => handleClose(ecr.id)} disabled={isBusy}
                  className="text-gray-600 hover:text-gray-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '关闭'}
                </button>
              </>
            )}
            {(isCreator || admin) && (
              <button onClick={() => setDeleteId(ecr.id)}
                className="text-red-600 hover:text-red-800 text-sm mr-2">
                删除
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}
              className="text-purple-600 hover:text-purple-800 text-sm">
              知会
            </button>
          </div>
        );
      case 'reviewing':
        return (
          <div className="flex gap-1 justify-end">
            {isCreator && (
              <>
                <button onClick={() => handleSubmit(ecr.id, true)} disabled={isBusy}
                  className="text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '撤回'}
                </button>
                <button onClick={() => handleEdit(ecr)}
                  className="text-primary-600 hover:text-primary-800 text-sm mr-2">
                  编辑
                </button>
              </>
            )}
            {(isReviewer || admin) && (
              <>
                <button onClick={() => handleReviewAction(ecr.id, 'approved')} disabled={isBusy}
                  className="text-green-600 hover:text-green-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '通过'}
                </button>
                <button onClick={() => handleReviewAction(ecr.id, 'rejected')} disabled={isBusy}
                  className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '驳回'}
                </button>
                <button onClick={() => handleReviewAction(ecr.id, 'returned')} disabled={isBusy}
                  className="text-orange-600 hover:text-orange-800 text-sm disabled:opacity-50 mr-2">
                  {isBusy ? '...' : '退回'}
                </button>
              </>
            )}
            {admin && (
              <button onClick={() => setDeleteId(ecr.id)}
                className="text-red-600 hover:text-red-800 text-sm mr-2">
                删除
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}
              className="text-purple-600 hover:text-purple-800 text-sm">
              知会
            </button>
          </div>
        );
      case 'approved':
      case 'rejected':
        return (
          <div className="flex gap-1 justify-end">
            {admin && (
              <button onClick={() => handleClose(ecr.id)} disabled={isBusy}
                className="text-gray-600 hover:text-gray-800 text-sm disabled:opacity-50 mr-2">
                {isBusy ? '...' : '关闭'}
              </button>
            )}
            {admin && (
              <button onClick={() => setDeleteId(ecr.id)}
                className="text-red-600 hover:text-red-800 text-sm mr-2">
                删除
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}
              className="text-purple-600 hover:text-purple-800 text-sm">
              知会
            </button>
          </div>
        );
      case 'closed':
        return (
          <div className="flex gap-1 justify-end">
            {admin && (
              <button onClick={() => setDeleteId(ecr.id)}
                className="text-red-600 hover:text-red-800 text-sm mr-2">
                删除
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setCcEcrId(ecr.id); }}
              className="text-purple-600 hover:text-purple-800 text-sm">
              知会
            </button>
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
        <input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => handlePriorityChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部优先级</option>
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="flex-1" />
        {canEdit() && (
          <button
            onClick={() => setCreateOpen(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
          >
            + 新建 ECR
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">
                ECR 编号
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                标题
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">
                状态
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">
                优先级
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">
                创建人
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap">
                创建时间
              </th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : ecrs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              ecrs.map((ecr) => (
                <tr
                  key={ecr.id}
                  className="hover:bg-gray-50 cursor-pointer"
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
          <span className="text-sm text-gray-500">
            共 {total} 条，第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-1 justify-end">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .map((p, idx, arr) => (
                <span key={p}>
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="px-1 text-gray-400">...</span>
                  )}
                  <button
                    onClick={() => setPage(p)}
                    className={`px-3 py-1 border rounded text-sm ${
                      p === page
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
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
      <ECRCcPicker
        open={!!ccEcrId}
        ecrId={ccEcrId || ''}
        onClose={() => setCcEcrId(null)}
      />
    </div>
  );
}

export default ECRList;
