import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecrApi, documentsApi, customFieldsApi, mediaApi } from '../../services/api';
import { useAuthStore, canEdit, isAdmin, canDownload } from '../../stores/auth';
import { exportEcrPdf } from '../../services/ecPdfExport';
import { useDataStore } from '../../stores/data';
import { ECRStatusBadge, ECRPriorityBadge } from './ECRStatusBadge';
import { ECRReviewPanel } from './ECRReviewPanel';
import { ECRBomImpactView } from './ECRBomImpactView';
import DocumentDetailContent from '../DocumentDetailContent';
import type { ECRRequest, ECRReviewRecord, ECRAffectedItem, ECRStatusLog, ECRDocumentLink, Document } from '../../types';

const REASON_LABELS: Record<string, string> = {
  quality_defect: '质量缺陷',
  design_opt: '设计优化',
  cost_reduce: '成本降低',
  customer_req: '客户要求',
  supplier_change: '供应商变更',
  process_improve: '工艺改进',
  other: '其他',
};

const CATEGORY_LABELS: Record<string, string> = {
  design_change: '设计变更',
  process_change: '工艺变更',
  material_change: '材料变更',
  other: '其他',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: '紧急',
  high: '高',
  normal: '普通',
  low: '低',
};

const STATUS_LABELS: Record<string, string> = {
  created: '创建',
  submitted: '提交评审',
  reviewing: '审核中',
  approved: '审批通过',
  rejected: '审批驳回',
  returned: '退回修改',
  closed: '关闭',
};

interface ECRDetail extends ECRRequest {
  review_records?: ECRReviewRecord[];
  affected_items?: ECRAffectedItem[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface ECRDetailModalProps {
  open: boolean;
  ecrId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ECRDetailModal({ open, ecrId, onClose, onSuccess }: ECRDetailModalProps) {
  const user = useAuthStore((s) => s.user);
  const currentUserId = user?.id || '';
  const docFieldDefs = useDataStore((s) => s.customFieldDefs).filter((d) => d.applies_to?.includes('document'));

  // Data state
  const [detail, setDetail] = useState<ECRDetail | null>(null);
  const [statusLogs, setStatusLogs] = useState<ECRStatusLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [docDetails, setDocDetails] = useState<Record<string, any>>({});
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [docCustomValues, setDocCustomValues] = useState<Record<string, Record<string, any>>>({});

  // Review action state
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeComment, setCloseComment] = useState('');

  const loadDetail = useCallback(async () => {
    if (!ecrId) return;
    setLoading(true);
    try {
      const resp = await ecrApi.get(ecrId);
      setDetail(resp.data as ECRDetail);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载 ECR 详情失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [ecrId]);

  const loadStatusLogs = useCallback(async () => {
    if (!ecrId) return;
    try {
      const resp = await ecrApi.getStatusLogs(ecrId);
      const data = resp.data;
      const list = data.items || data || [];
      setStatusLogs(Array.isArray(list) ? list : []);
    } catch {
      // Status logs are non-critical
    }
  }, [ecrId]);

  useEffect(() => {
    if (!detail?.document_links?.length) return;
    const ids = detail.document_links.map(d => d.document_id).filter(Boolean);
    ids.forEach(id => {
      if (!docDetails[id]) {
        documentsApi.get(id).then(r => setDocDetails(prev => ({...prev, [id]: r.data}))).catch(() => {});
        documentsApi.listAttachments(id).then(r => setDocAttachments(prev => ({...prev, [id]: r.data||[]}))).catch(() => {});
      }
      if (!docCustomValues[id]) {
        customFieldsApi.getValues('document', id).then(r => {
          const vals: Record<string, any> = {};
          (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
          setDocCustomValues(prev => ({...prev, [id]: vals}));
        }).catch(() => {});
      }
    });
  }, [detail?.document_links]);

  const handleDocDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      alert('下载失败，请重试');
    }
  };

  const handleDocPreview = async (attId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      try {
        const mt = await mediaApi.token(attId, 'preview');
        window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
      } catch { alert('预览失败，请重试'); }
      return;
    }
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) {
      try {
        const mt = await mediaApi.token(attId, 'preview');
        window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank');
      } catch { alert('预览失败，请重试'); }
      return;
    }
    if (ext === 'stp' || ext === 'step') {
      try {
        const mt = await mediaApi.token(attId, 'gltf');
        window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(mt)}`, '_blank');
      } catch { alert('预览失败，请重试'); }
      return;
    }
    alert('该格式暂不支持预览');
  };

  useEffect(() => {
    if (open && ecrId) {
      loadDetail();
      loadStatusLogs();
      setShowCloseForm(false);
      setCloseComment('');
    }
  }, [open, ecrId, loadDetail, loadStatusLogs]);

  // Actions
  const handleSubmit = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await ecrApi.submit(detail.id);
      toast.success('ECR 已提交评审');
      loadDetail();
      loadStatusLogs();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '提交评审失败';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReview = async (decision: string, comment: string) => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await ecrApi.review(detail.id, decision, comment || undefined);
      const labels: Record<string, string> = { approved: '通过', rejected: '驳回', returned: '退回' };
      toast.success(`ECR 已${labels[decision] || decision}`);
      loadDetail();
      loadStatusLogs();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '审批操作失败';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await ecrApi.close(detail.id, closeComment || undefined);
      toast.success('ECR 已关闭');
      setShowCloseForm(false);
      setCloseComment('');
      loadDetail();
      loadStatusLogs();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '关闭 ECR 失败';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await ecrApi.withdraw(detail.id);
      toast.success('ECR 已撤回');
      loadDetail();
      loadStatusLogs();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '撤回失败';
      toast.error(message);
    } finally {
      setActionLoading(false);
    }
  };

  const isCurrentReviewer = (): boolean => {
    if (!detail || !currentUserId) return false;
    return detail.reviewers?.some((r) => r.user_id === currentUserId) ?? false;
  };

  const hasPendingReview = (): boolean => {
    if (!detail || !currentUserId) return false;
    const records = detail.review_records || [];
    return detail.reviewers?.some((r) => {
      if (r.user_id !== currentUserId) return false;
      return !records.some((rec) => rec.reviewer_id === r.user_id);
    }) ?? false;
  };

  const renderActions = () => {
    if (!detail) return null;
    const busy = actionLoading;
    const isCreator = detail.creator_id === currentUserId;

    switch (detail.status) {
      case 'reviewing':
        return (
          <div className="flex gap-2 flex-wrap">
            {isCreator && (
              <button onClick={handleWithdraw} disabled={busy}
                className="px-4 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50">
                {busy ? '处理中...' : '撤回评审'}
              </button>
            )}
            {isCurrentReviewer() && hasPendingReview() && (
              <span className="text-sm text-blue-600 self-center">👆 请在上方审批区域进行操作</span>
            )}
          </div>
        );

      case 'approved':
        return null;

      default:
        return null;
    }
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      width="3xl"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">ECR 详情</h3>
        {detail && canDownload() && (
          <button
            onClick={() => { try { exportEcrPdf(detail, statusLogs); } catch { toast.error('导出失败'); } }}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
            title="导出为 PDF 文档（展开所有信息，打印另存为 PDF）"
          >
            📄 导出PDF
          </button>
        )}
      </div>
      {loading && !detail ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        </div>
      ) : !detail ? (
        <div className="text-center text-gray-500 py-12">暂无数据</div>
      ) : (
        <div className="print-area space-y-6 max-h-[70vh] overflow-y-auto pr-1">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div>
              <div className="text-lg font-bold text-gray-900">
                {detail.ecr_number}
              </div>
              <div className="text-sm text-gray-500 mt-0.5">{detail.title}</div>
            </div>
            <div className="flex items-center gap-2">
              <ECRStatusBadge status={detail.status} />
              <ECRPriorityBadge priority={detail.priority} />
            </div>
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="变更原因" value={REASON_LABELS[detail.reason] || detail.reason} />
            <InfoItem label="变更类别" value={CATEGORY_LABELS[detail.category || ''] || detail.category || '-'} />
            <InfoItem label="优先级" value={PRIORITY_LABELS[detail.priority] || detail.priority} />
            <InfoItem label="审批模式" value={detail.review_mode === 'all' ? '会签' : '或签'} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="创建人" value={detail.creator_name} icon="👤" />
            <InfoItem
              label="创建时间"
              value={new Date(detail.created_at).toLocaleString('zh-CN')}
            />
            <InfoItem
              label="更新时间"
              value={new Date(detail.updated_at).toLocaleString('zh-CN')}
            />
            <InfoItem
              label="审批时间"
              value={detail.reviewed_at ? new Date(detail.reviewed_at).toLocaleString('zh-CN') : '-'}
            />
          </div>

          {/* Description */}
          {detail.description && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">📝 变更描述</h4>
              <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap border border-gray-200">
                {detail.description}
              </div>
            </div>
          )}

          {/* Review Progress */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              👥 审批进度
              {detail.reviewers && detail.reviewers.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ({detail.approved_count || 0}/{detail.reviewers_count || detail.reviewers.length} 已审批)
                </span>
              )}
            </h4>
            <ECRReviewPanel
              reviewers={detail.reviewers || []}
              reviewRecords={detail.review_records || []}
              currentUserId={currentUserId}
              onReview={handleReview}
              loading={actionLoading}
            />
          </div>

          {/* Document Links */}
          {detail.document_links && detail.document_links.length > 0 ? (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">关联图文档</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档编号</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档名称</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                      {docFieldDefs.map((def) => (
                        <th key={def.id} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{def.name}</th>
                      ))}
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                      <th className="px-3 py-2 text-center text-gray-500 font-medium whitespace-nowrap w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.document_links.map((link, idx) => {
                      const doc = docDetails[link.document_id];
                      const atts = docAttachments[link.document_id] || [];
                      return (
                        <tr key={link.document_id || idx}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => doc && setViewingDoc(doc)}>
                          <td className="px-3 py-2 text-sm font-medium">{doc?.code || link.document_code}</td>
                          <td className="px-3 py-2 text-sm">{doc?.name || link.document_name}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">{doc?.version || link.document_version || '-'}</td>
                          <td className="px-3 py-2 text-sm">
                            {doc?.status ? (
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                doc.status === 'draft' ? 'bg-blue-100 text-blue-800' :
                                doc.status === 'frozen' ? 'bg-orange-100 text-orange-800' :
                                doc.status === 'released' ? 'bg-green-100 text-green-800' :
                                doc.status === 'obsolete' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'
                              }`}>
                                {({draft:'草稿', frozen:'冻结', released:'发布', obsolete:'作废'} as Record<string, string>)[doc.status] || doc.status}
                              </span>
                            ) : '-'}
                          </td>
                          {docFieldDefs.map((def) => {
                            const vals = docCustomValues[link.document_id] || {};
                            const val = vals[def.id];
                            return (
                              <td key={def.id} className="px-3 py-2 text-sm text-gray-500">
                                {val !== undefined && val !== null && val !== '' ? String(val) : '-'}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-sm text-gray-500">
                            {atts.length > 0 ? atts.map((a: any) => (
                              <div key={a.id} className="text-xs">{a.file_name} ({formatFileSize(a.file_size)})</div>
                            )) : '-'}
                          </td>
                          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {atts.length > 0 && (
                                <button onClick={() => handleDocPreview(atts[0].id, atts[0].file_name)}
                                  className="px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800"
                                  title="预览">预览</button>
                              )}
                              {atts.length > 0 && (
                                <button onClick={() => handleDocDownload(atts[0].id, atts[0].file_name)}
                                  className="px-2 py-0.5 text-xs text-green-600 hover:text-green-800"
                                  title="下载">下载</button>
                              )}
                              {atts.length === 0 && <span className="text-xs text-gray-400">-</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Affected Items */}
          {detail.affected_items && detail.affected_items.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                📦 受影响物料 ({detail.affected_items.length})
              </h4>
              <div className="space-y-4">
                {detail.affected_items.map((item) => (
                  <div
                    key={item.id}
                    className="border border-gray-200 rounded-lg overflow-hidden"
                  >
                    {/* Item header */}
                    <div className="flex items-center gap-3 p-3 bg-gray-50">
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          item.entity_type === 'part'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {item.entity_type === 'part' ? '零件' : '部件'}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{item.entity_code}</span>
                      <span className="text-sm text-gray-600">{item.entity_name}</span>
                      <span className="text-xs text-gray-400">v{item.entity_version}</span>
                      {item.change_type && (
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          {item.change_type}
                        </span>
                      )}
                      {item.change_description && (
                        <span className="text-xs text-gray-500 flex-1 truncate">
                          {item.change_description}
                        </span>
                      )}
                    </div>

                    {/* Bom impact result */}
                    {item.bom_impact && (
                      <div className="p-3 border-t border-gray-200">
                        <ECRBomImpactView
                          upwardChain={item.bom_impact.upward_chain}
                          downwardItems={item.bom_impact.downward_items}
                          onChange={() => {}}
                          editable={false}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status Log */}
          {statusLogs.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">📋 状态记录</h4>
              <div className="space-y-0">
                {statusLogs.map((log) => (
                  <div key={log.id} className="flex gap-3 pb-4">
                    {/* Timeline dot and line */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full border-2 ${
                          log.to_status === 'approved'
                            ? 'bg-green-500 border-green-500'
                            : log.to_status === 'rejected'
                              ? 'bg-red-500 border-red-500'
                              : log.to_status === 'returned'
                                ? 'bg-orange-500 border-orange-500'
                                : 'bg-blue-500 border-blue-500'
                        }`}
                      />
                      <div className="w-0.5 flex-1 bg-gray-200 min-h-[16px]" />
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="text-sm text-gray-900">
                        <span className="font-medium">{log.operator_name}</span>
                        <span className="text-gray-500 mx-1">·</span>
                        <span
                          className={`${
                            log.to_status === 'approved'
                              ? 'text-green-600'
                              : log.to_status === 'rejected'
                                ? 'text-red-600'
                                : log.to_status === 'returned'
                                  ? 'text-orange-600'
                                  : 'text-blue-600'
                          }`}
                        >
                          {STATUS_LABELS[log.to_status] || log.to_status}
                        </span>
                      </div>
                      {log.comment && (
                        <div className="text-sm text-gray-500 mt-0.5">{log.comment}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">
                        {new Date(log.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Close form */}
          {showCloseForm && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-red-700 mb-2">关闭 ECR</h4>
              <textarea
                value={closeComment}
                onChange={(e) => setCloseComment(e.target.value)}
                rows={2}
                className="w-full border border-red-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                placeholder="关闭原因（可选）"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleClose}
                  disabled={actionLoading}
                  className="px-4 py-1.5 text-sm rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {actionLoading ? '处理中...' : '确认关闭'}
                </button>
                <button
                  onClick={() => {
                    setShowCloseForm(false);
                    setCloseComment('');
                  }}
                  className="px-4 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-4 border-t border-gray-200 flex items-center justify-between">
            {renderActions()}
          </div>
        </div>
      )}
    </Modal>

    {/* 图文档详情弹窗 */}
    <Modal open={!!viewingDoc} title="图文档详情" onClose={() => setViewingDoc(null)} width="full">
      {viewingDoc && (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <DocumentDetailContent doc={viewingDoc} customFieldDefs={[]} customFieldValues={{}} />
        </div>
      )}
    </Modal>
    </>
  );
}

/** Small info item for the basic info grid */
function InfoItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium">
        {icon && <span className="mr-1">{icon}</span>}
        {value}
      </div>
    </div>
  );
}
