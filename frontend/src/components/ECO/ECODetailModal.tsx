import { useEffect, useState, useCallback } from 'react';
import { ecoApi, documentsApi, partsApi, customFieldsApi, mediaApi } from '../../services/api';
import type { ECORequest, Document, ECRDocumentLink } from '../../types';
import { ECOStatusBadge, ECOPriorityBadge } from './ECOStatusBadge';
import { Modal, ConfirmModal } from '../Modal';
import { toast } from '../Toast';
import { useAuthStore, canDownload } from '../../stores/auth';
import { exportEcoPdf } from '../../services/ecPdfExport';
import { useDataStore } from '../../stores/data';
import { ECOEditView } from './ECOEditView';
import { ECRReviewPanel } from '../ECR/ECRReviewPanel';
import DocumentPicker from '../DocumentPicker';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';
import PartDetailModal from '../PartDetailModal';
import DocumentDetailModal from '../DocumentDetailModal';
import EntityEditModal from '../EntityEditModal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import SortableTh from '../ui/SortableTh';
import TreeToggle from '../ui/TreeToggle';
import { useTableSort } from '../../hooks/useTableSort';
import { compareVersions } from '../../constants';
import Tabs from '../ui/Tabs';

interface Props { ecoId: string; onClose: () => void; onRefresh: () => void; executionMode?: boolean; }

function fmt(d?: string) { return d ? new Date(d).toLocaleString('zh-CN') : '-'; }

const REASON: Record<string, string> = {
  quality_defect: '质量缺陷', design_opt: '设计优化', cost_reduce: '成本降低',
  customer_req: '客户要求', supplier_change: '供应商变更', process_improve: '工艺改进',
  new_release: '首次发布', other: '其他',
};

const CAT: Record<string, string> = {
  design_change: '设计变更', process_change: '工艺变更', material_change: '物料变更',
  new_release: '新发布', other: '其他',
};

export function ECODetailModal({ ecoId, onClose, onRefresh, executionMode }: Props) {
  const user = useAuthStore((s) => s.user);
  const [eco, setEco] = useState<ECORequest | null>(null);
  const docFieldDefs = useDataStore((s) => s.customFieldDefs).filter((d) => d.applies_to?.includes('document'));
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const [docCustomValues, setDocCustomValues] = useState<Record<string, Record<string, any>>>({});
  const [viewDocRevisionId, setViewDocRevisionId] = useState<string | null>(null);
  const [viewPartMasterId, setViewPartMasterId] = useState<string | null>(null);
  const [viewPartRevisionId, setViewPartRevisionId] = useState<string | null>(null);
  const [checkedExecIds, setCheckedExecIds] = useState<string[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showReleasePicker, setShowReleasePicker] = useState(false);
  const [documentLinks, setDocumentLinks] = useState<ECRDocumentLink[]>([]);
  const [releaseItems, setReleaseItems] = useState<any[]>([]);

  // 关联图文档表排序
  const { sortedData: sortedDocuments, sortField: docSortField, sortDirection: docSortDirection, handleSort: handleDocSort } = useTableSort<any>(documents, { fieldComparators: { version: (a, b) => compareVersions(String(a), String(b)) } });

  const [versionSelectState, setVersionSelectState] = useState<{ docId: string; oldDocId: string } | null>(null);
  const [editEntity, setEditEntity] = useState<{ type: string; id: string } | null>(null);
  const [showPublishAll, setShowPublishAll] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{ has_pending: boolean; pending_count: number; total: number } | null>(null);
  const [publishedNonce, setPublishedNonce] = useState(0);  // 一键发布后递增，通知列表就地刷新已展开子项状态
  // Tab 分页（与编辑页一致：基本信息/ECR变更分析/关联图文档/审批/工程变更结果）
  const [activeTab, setActiveTab] = useState<'info' | 'ecr' | 'docs' | 'review' | 'items'>('info');

  const load = async () => {
    setLoading(true);
    try {
      const r = await ecoApi.detail(ecoId);
      setEco(r.data);
      setDocumentLinks(r.data.document_links || []);
      setReleaseItems(r.data.release_items || []);
      // 刷新 release_items 状态（避免显示过期状态），并用 master.type 权威修正类型（历史数据可能错标）
      const items = r.data.release_items || [];
      if (items.length > 0) {
        const refreshed = await Promise.all(items.map(async (ri: any) => {
          try {
            const rev = await partsApi.getRevision(ri.entity_id);
            const master = await partsApi.get(rev.master_id);
            return { ...ri, status: rev.status, entity_version: rev.version, entity_code: master.code, entity_name: master.name, entity_type: master.type === 'assembly' ? 'assembly' : 'part' };
          } catch { return ri; }
        }));
        setReleaseItems(refreshed);
      }
      const docs = r.data.document_links || [];
      if (docs.length > 0) {
        const results = await Promise.allSettled(docs.map(async (d: any) => {
          try {
            const res = await documentsApi.get(d.document_id);
            return { ...res.data, _revision_id: d.document_id };
          } catch { return null; }
        }));
        const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value).filter(Boolean) as any[];
        setDocuments(loaded);
        loaded.forEach((doc: Document) => {
          documentsApi.listAttachments(doc.id).then(r => setDocAttachments(prev => ({...prev, [doc.id]: r.data||[]}))).catch(() => {});
          customFieldsApi.getValues('document', doc.id).then(r => { const vals: Record<string, any> = {}; (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; }); setDocCustomValues(prev => ({...prev, [doc.id]: vals})); }).catch(() => {});
        });
      } else { setDocuments([]); }
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { setShowPublishAll(false); load(); }, [ecoId]);

  // 进入执行界面时校验工程变更结果：递归检查所有层级子项，若仍有草稿/冻结件则激活"一键发布"。
  // 依赖 releaseItems：load() 刷新或编辑实体后会更新其引用，从而自动重新校验
  //（覆盖"用户临时退改状态后再发布"的场景）。
  useEffect(() => {
    if (!executionMode || eco?.status !== 'executing') { setPublishStatus(null); return; }
    ecoApi.getReleaseItemsPublishStatus(ecoId)
      .then(r => setPublishStatus(r.data))
      .catch(() => setPublishStatus(null));
  }, [ecoId, executionMode, eco?.status, releaseItems]);

  const act = async (fn: () => Promise<any>, msg: string) => {
    setActionLoading(true);
    try { await fn(); toast.success(msg); load(); onRefresh(); } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '操作失败');
    }
    finally { setActionLoading(false); }
  };

  // 增量更新执行项状态（不重新加载整个 ECO，避免闪屏）
  const updateExecutionItem = (itemId: string, patch: Record<string, any>) => {
    if (!eco) return;
    const items = [...(eco.execution_items || [])];
    const idx = items.findIndex((ei: any) => ei.id === itemId);
    if (idx >= 0) {
      items[idx] = { ...items[idx], ...patch };
      setEco({ ...eco, execution_items: items });
    }
  };

  const saveDocumentLinks = async (newLinks: ECRDocumentLink[]) => {
    try {
      await ecoApi.update(ecoId, { document_links: newLinks });
      setDocumentLinks(newLinks);
      if (newLinks.length > 0) {
        const results = await Promise.allSettled(newLinks.map((d: any) => documentsApi.get(d.document_id)));
        const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value.data);
        setDocuments(loaded);
        loaded.forEach((doc: Document) => {
          documentsApi.listAttachments(doc.id).then(r => setDocAttachments(prev => ({...prev, [doc.id]: r.data||[]}))).catch(() => {});
          customFieldsApi.getValues('document', doc.id).then(r => { const vals: Record<string, any> = {}; (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; }); setDocCustomValues(prev => ({...prev, [doc.id]: vals})); }).catch(() => {});
        });
      } else { setDocuments([]); }
      toast.success('图文档已更新');
    } catch { toast.error('保存失败'); }
  };

  const saveReleaseItems = async (newItems: any[]) => {
    try { await ecoApi.update(ecoId, { release_items: newItems }); setReleaseItems(newItems); toast.success('工程变更结果已更新'); } catch { toast.error('保存失败'); }
  };

  const viewItem = async (entityType: string, entityId: string, mode?: 'view' | 'edit') => {
    // 统一使用最新的 PartDetailModal，不再区分为内联 EntityEditModal
    try {
      const rev = await partsApi.getRevision(entityId);
      setViewPartMasterId(rev.master_id);
      setViewPartRevisionId(entityId);
    } catch {
      const execItem = (eco?.execution_items || []).find((ei: any) =>
        ei.new_entity_id === entityId || ei.entity_id === entityId
      );
      const fallbackId = execItem?.entity_id || entityId;
      try {
        const rev = await partsApi.getRevision(fallbackId);
        setViewPartMasterId(rev.master_id);
        setViewPartRevisionId(fallbackId);
      } catch {
        setViewPartMasterId(fallbackId);
        setViewPartRevisionId(null);
      }
    }
  };

  const handleDocDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { toast.error('下载失败，请重试'); }
  };

  const handleDocPreview = async (attId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') { try { const mt = await mediaApi.token(attId, 'preview'); window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank'); } catch { toast.error('预览失败，请重试'); } return; }
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) { try { const mt = await mediaApi.token(attId, 'preview'); window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank'); } catch { toast.error('预览失败，请重试'); } return; }
    if (ext === 'stp' || ext === 'step') { try { const mt = await mediaApi.token(attId, 'gltf'); window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(mt)}`, '_blank'); } catch { toast.error('预览失败，请重试'); } return; }
    toast.info('该格式暂不支持预览');
  };

  // 是否可一键发布：以后端递归校验（含所有层级子项）为准。
  // 校验结果未知（加载中 / 接口失败）时默认允许点击——发布是幂等且安全的操作，
  // 宁可让用户点一次（无待发布项时仅提示"已发布 0"），也不要用浅层启发式误判为"已全部发布"而错误阻断。
  const canPublishAll = publishStatus ? publishStatus.has_pending : true;

  return (
    <>
    <Modal open={true} title={executionMode ? 'ECO 执行' : 'ECO 详情'} onClose={onClose} width="3xl" height="75vh"
      headerAction={eco && canDownload() ? (
        <Button variant="secondary" size="sm"
          onClick={() => { if (eco) exportEcoPdf(eco).catch(() => toast.error('导出失败')); }}
          title="导出为 PDF 文档"
        >📄 导出PDF</Button>
      ) : undefined}
      footer={executionMode && eco?.status === 'executing' ? (
        <Button variant="success" size="sm" onClick={async () => {
          setActionLoading(true);
          try {
            await ecoApi.completeExecution(ecoId);
            toast.success('执行已完成');
            onRefresh();      // 主界面列表立即刷新（executing → completed）
            onClose();        // 完成执行后自动返回主界面
          } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : '操作失败');
          } finally { setActionLoading(false); }
        }} disabled={actionLoading}>
          {actionLoading ? '处理中...' : '完成执行'}
        </Button>
      ) : undefined}
    >
      {loading ? <div className="py-8 text-center text-[var(--ui-text-tertiary)] text-sm">加载中...</div>
      : !eco ? <div className="py-8 text-center text-[var(--ui-text-tertiary)] text-sm">未找到 ECO</div>
      : (
        <>
        <div className="h-full flex flex-col min-h-0">
          {/* 常驻摘要条：编号 + 标题 + 状态/优先级 */}
          <div className="flex items-center justify-between gap-3 pb-3 mb-3 border-b border-[var(--ui-border)] shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-lg font-bold text-[var(--ui-text-primary)] shrink-0">{eco.eco_number}</span>
              <span className="text-sm text-[var(--ui-text-secondary)] truncate">{eco.title}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ECOStatusBadge status={eco.status} />
              <ECOPriorityBadge priority={eco.priority} />
            </div>
          </div>

          {/* Tab 栏（与编辑页一致：基本信息/ECR变更分析/关联图文档/审批/工程变更结果） */}
          <div className="shrink-0 mb-3">
            <Tabs
              items={[
                { key: 'info', label: '基本信息' },
                { key: 'ecr', label: 'ECR变更分析' },
                { key: 'docs', label: '关联图文档' },
                { key: 'review', label: '审批' },
                { key: 'items', label: '工程变更结果' },
              ]}
              activeKey={activeTab}
              onChange={(k) => setActiveTab(k as any)}
            />
          </div>

          {/* Tab 内容区 */}
          <div className="flex-1 min-h-0 overflow-auto pr-1 space-y-4">
            {activeTab === 'info' && (
              <>

          {/* Basic info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoItem label="变更原因" value={REASON[eco.reason] || eco.reason || '-'} />
            <InfoItem label="变更类别" value={CAT[eco.category||''] || eco.category || '-'} />
            <InfoItem label="优先级" value={eco.priority} />
            <InfoItem label="审批模式" value={eco.review_mode === 'all' ? '会签' : '或签'} />
            <InfoItem label="创建人" value={eco.creator_name} icon="👤" />
            <InfoItem label="来源" value={eco.ecr_number || '独立创建'} />
          </div>

          <InfoItem label="变更描述" value={eco.description || '-'} className="col-span-2 md:col-span-4" />
            </>
          )}
          {activeTab === 'review' && (
            <>

          {/* Reviewers */}
          {eco.reviewers && eco.reviewers.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-3">审批人 <span className="ml-2 text-xs font-normal text-[var(--ui-text-secondary)]">({eco.approved_count || 0}/{eco.reviewers_count || eco.reviewers.length} 已审批)</span></h4>
              <ECRReviewPanel reviewers={eco.reviewers} reviewRecords={eco.review_records || []} currentUserId={user?.id || ''} onReview={async (decision, comment) => { setActionLoading(true); try { await ecoApi.review(ecoId, decision, comment); toast.success('操作成功'); load(); } catch { toast.error('操作失败'); } finally { setActionLoading(false); } }} loading={actionLoading} />
            </div>
          )}
            </>
          )}
          {activeTab === 'docs' && (
            <>

          {/* Document links */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">关联图文档</h4>
            </div>
            <div className="border rounded-lg overflow-hidden">
              {documentLinks.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无关联图文档</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
                      <SortableTh sortKey="code" active={docSortField === 'code'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left">图文档编号</SortableTh>
                      <SortableTh sortKey="name" active={docSortField === 'name'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left">图文档名称</SortableTh>
                      <SortableTh sortKey="version" active={docSortField === 'version'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left w-16">版本</SortableTh>
                      <SortableTh sortKey="status" active={docSortField === 'status'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left w-16">状态</SortableTh>
                      {docFieldDefs.map((def) => <th key={def.id} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium whitespace-nowrap">{def.name}</th>)}
                      <SortableTh className="text-left">附件</SortableTh>
                      <SortableTh className="text-center whitespace-nowrap w-24">操作</SortableTh>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedDocuments.map((doc) => {
                        const atts = docAttachments[doc.id] || [];
                        return (
                          <tr key={doc.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setViewDocRevisionId(doc._revision_id || doc.id)}>
                            <td className="px-3 py-2 text-sm font-medium">{doc.code}</td>
                            <td className="px-3 py-2 text-sm">{doc.name}</td>
                            <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{doc.version || '-'}</td>
                            <td className="px-3 py-2 text-sm"><Badge status={doc.status} /></td>
                            {docFieldDefs.map((def) => { const vals = docCustomValues[doc.id] || {}; const val = vals[def.id]; return <td key={def.id} className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{val !== undefined && val !== null && val !== '' ? String(val) : '-'}</td>; })}
                            <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{atts.length > 0 ? atts.map((a: any) => <div key={a.id} className="text-xs">{a.file_name} ({formatFileSize(a.file_size)})</div>) : (doc.file_name || '-')}</td>
                            <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {doc.file_id && <Button variant="link" size="xs" onClick={() => handleDocPreview(doc.file_id!, doc.file_name || '')} className="whitespace-nowrap">预览</Button>}
                                {doc.file_id && <Button variant="link" size="xs" onClick={() => handleDocDownload(doc.file_id!, doc.file_name || '')} className="whitespace-nowrap">下载</Button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
            </>
          )}
          {activeTab === 'review' && (
            <>

          {/* CC users */}
          {eco.cc_users && eco.cc_users.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">知会用户</h4>
              <div className="flex flex-wrap gap-2">{eco.cc_users.map((c, i) => <span key={i} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700">{c.user_name}</span>)}</div>
            </div>
          )}
            </>
          )}
          {activeTab === 'ecr' && (
            <>

          {/* BOM impact */}
          {eco.ecr_id && (
            <div className="border-t pt-4">
              <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">ECR 变更分析（{eco.ecr_number || 'ECR'}）</h4>
              <ECOEditView ecrId={eco.ecr_id} onEcrLinked={() => {}} readOnly executionItems={eco.execution_items}
                ecoId={ecoId} ecoStatus={eco.status} canExecute={executionMode && (eco.status === 'approved' || eco.status === 'executing')}
                onExecuteUpgrade={async (itemId, entityInfo) => {
                  try {
                    let actualItemId = itemId;
                    if (!actualItemId && entityInfo) {
                      const created = await ecoApi.addExecutionItem(ecoId, { ...entityInfo, source: 'manual' });
                      actualItemId = created.data?.id;
                      if (actualItemId && eco) {
                        setEco({ ...eco, execution_items: [...(eco.execution_items || []), { id: actualItemId, ...entityInfo, source: 'manual', status: 'pending', sort_order: 0 } as any] });
                      }
                    }
                    const r = await ecoApi.upgradeItem(ecoId, actualItemId);
                    updateExecutionItem(actualItemId, { new_entity_id: r.data?.new_entity_id, new_version: r.data?.new_version, new_entity_status: 'draft' });
                    toast.success('升版完成');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onExecuteRelease={async (itemId, newEntityId) => {
                  try {
                    const r = await ecoApi.revertItem(ecoId, itemId, newEntityId);
                    const newStatus = r.data?.new_entity_status;
                    updateExecutionItem(itemId, {
                      new_entity_id: newStatus ? (r.data?.new_entity_id || newEntityId) : undefined,
                      new_version: newStatus ? (r.data?.new_version || undefined) : undefined,
                      new_entity_status: newStatus || undefined,
                    });
                    toast.success('已还原');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onExecuteFreeze={async (itemId, newEntityId) => {
                  try {
                    await ecoApi.freezeItem(ecoId, itemId, newEntityId);
                    updateExecutionItem(itemId, { new_entity_status: 'frozen' });
                    // 同步工程变更结果表：该实体对应行状态 → 冻结
                    setReleaseItems(prev => prev.map((ri: any) =>
                      ri.entity_id === newEntityId ? { ...ri, status: 'frozen' } : ri
                    ));
                    toast.success('冻结完成');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onExecutePublish={async (itemId, newEntityId) => {
                  try {
                    await ecoApi.releaseItem(ecoId, itemId, newEntityId);
                    updateExecutionItem(itemId, { new_entity_status: 'released' });
                    // 同步工程变更结果表：该实体对应行状态 → 发布
                    setReleaseItems(prev => prev.map((ri: any) =>
                      ri.entity_id === newEntityId ? { ...ri, status: 'released' } : ri
                    ));
                    toast.success('发布完成');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onViewItem={(entityType, entityId) => viewItem(entityType, entityId, 'view')}
                onEditItem={(entityType, entityId) => viewItem(entityType, entityId, 'edit')}
                onCheckedChange={setCheckedExecIds} />
            </div>
          )}
            </>
          )}
          {activeTab === 'items' && (
            <>

          {/* 工程变更结果 */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">工程变更结果</h4>
              {executionMode && eco.status === 'executing' && releaseItems.length > 0 && (
                <Button variant={canPublishAll ? 'success' : 'secondary'} size="sm" onClick={() => setShowPublishAll(true)} disabled={actionLoading || !canPublishAll}
                  title={canPublishAll ? '存在草稿/冻结状态的零部件，可一键发布' : '工程变更结果已全部发布'}>
                  {canPublishAll ? '一键发布' : '已全部发布'}</Button>
              )}
            </div>
            {releaseItems.length === 0 ? (
              <div className="border rounded-lg px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无工程变更结果</div>
            ) : (
              <ReleaseItemsTable items={releaseItems} onViewItem={viewItem} publishedNonce={publishedNonce} />
            )}
          </div>
            </>
          )}
          {activeTab === 'review' && (
            <>

          {/* Status logs */}
          {eco.status_logs && eco.status_logs.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">状态日志</h4>
              <div className="space-y-1">{eco.status_logs.map((l, i) => (
                <div key={i} className="text-xs px-2 py-1 rounded bg-[var(--ui-bg-subtle)] flex gap-2">
                  <span className="text-[var(--ui-text-tertiary)]">{l.from_status || '-'} → </span><span className="font-medium">{l.to_status}</span>
                  <span className="text-[var(--ui-text-secondary)]">by {l.operator_name}</span>
                  {l.comment && <span className="text-[var(--ui-text-tertiary)]">: {l.comment}</span>}
                  <span className="text-[var(--ui-text-tertiary)] ml-auto">{fmt(l.created_at)}</span>
                </div>
              ))}</div>
            </div>
          )}
            </>
          )}
          {activeTab === 'info' && (
            <>

          {/* Timestamps */}
          <div className="border-t pt-3 grid grid-cols-2 gap-2 text-xs text-[var(--ui-text-secondary)]">
            <div><span className="text-[var(--ui-text-tertiary)]">创建</span> {fmt(eco.created_at)}</div>
            <div><span className="text-[var(--ui-text-tertiary)]">更新</span> {fmt(eco.updated_at)}</div>
            {eco.reviewed_at && <div><span className="text-[var(--ui-text-tertiary)]">审批完成</span> {fmt(eco.reviewed_at)}</div>}
            {eco.executed_at && <div><span className="text-[var(--ui-text-tertiary)]">执行完成</span> {fmt(eco.executed_at)}</div>}
          </div>
            </>
          )}
        </div>
      </div>
        </>
      )}

      {/* 零件/部件详情弹窗 */}
      {viewPartMasterId && (
        <PartDetailModal
          masterId={viewPartMasterId}
          revisionId={viewPartRevisionId || undefined}
          open={!!viewPartMasterId}
          onClose={() => { setViewPartMasterId(null); setViewPartRevisionId(null); load(); }}
        />
      )}
    </Modal>

    {/* 图文档详情弹窗 */}
    {viewDocRevisionId && (
      <DocumentDetailModal
        open={!!viewDocRevisionId}
        revisionId={viewDocRevisionId}
        onClose={() => { setViewDocRevisionId(null); load(); }}
        onSaved={() => { load(); }}
      />
    )}

    {/* 编辑弹窗 */}
    {editEntity && (
      <EntityEditModal
        open={!!editEntity}
        entityType={editEntity.type as 'part' | 'assembly'}
        entityId={editEntity.id}
        onClose={() => setEditEntity(null)}
        onSaved={() => { setEditEntity(null); load(); toast.success('保存成功'); }}
      />
    )}

    {/* 图文档选择器（共享 DocumentPicker） */}
    <DocumentPicker open={showDocPicker} onClose={() => setShowDocPicker(false)}
      onConfirm={(items) => {
        const existing = new Set(documentLinks.map(d => d.document_id));
        const newDocs = items
          .filter(v => !existing.has(v.document_id))
          .map(v => ({ document_id: v.document_id, document_code: '', document_name: '', document_version: '' }));
        saveDocumentLinks([...documentLinks, ...newDocs]);
      }}
      existingDocIds={new Set(documentLinks.map(d => d.document_id))} />

    {/* 零部件选择器 */}
    <AssemblyPartPicker open={showReleasePicker} onClose={() => setShowReleasePicker(false)}
      onConfirm={(items) => {
        setShowReleasePicker(false);
        Promise.allSettled(items.map(async (item) => { const rev = await partsApi.getRevision(item.child_id); const m = await partsApi.get(rev.master_id); return { ...m, ...rev, child_type: item.child_type, quantity: item.quantity }; })).then(results => {
          const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
          const existingIds = new Set(releaseItems.map((r: any) => r.entity_id));
          const merged = [...releaseItems, ...loaded.filter((r: any) => !existingIds.has(r.master_id || r.id)).map((r: any) => ({ entity_type: r.type === 'assembly' ? 'assembly' : 'part', entity_id: r.master_id || r.id, entity_code: r.code || '', entity_name: r.name || '', entity_version: r.version || '', spec: r.spec || '', status: r.status || '', quantity: r.quantity || 1 }))];
          saveReleaseItems(merged);
        });
      }} />

    {/* 版本选择器 */}
    <VersionSelectModal open={!!versionSelectState} entityType="document" entityId={versionSelectState?.docId || ''} entityName={documents.find(d => d.id === versionSelectState?.docId)?.code || ''} currentVersionId={versionSelectState?.oldDocId || ''}
      onSelect={(newVerId) => { if (versionSelectState) { const newLinks = documentLinks.map(d => d.document_id === versionSelectState.oldDocId ? { document_id: newVerId, document_code: '', document_name: '', document_version: '' } : d); saveDocumentLinks(newLinks); } setVersionSelectState(null); }}
      onClose={() => setVersionSelectState(null)} />

    {/* 一键发布确认 */}
    <ConfirmModal open={showPublishAll} type="warning" title="一键发布" confirmText="全部发布"
      content="将把工程变更结果中所有关联零部件及其全部层级子项的状态置为「发布」（作废件除外），确认继续？"
      onCancel={() => setShowPublishAll(false)}
      onConfirm={async () => {
        setShowPublishAll(false);
        setActionLoading(true);
        try {
          const r = await ecoApi.publishAllReleaseItems(ecoId);
          toast.success(r.data?.detail || '已一键发布');
          // 仅就地更新工程变更结果列表的状态，避免整屏 load() 造成的闪屏与滚动复位。
          // 一键发布确定性地把树中所有非作废件置为 released，故可乐观更新顶层 + 已展开子项。
          setReleaseItems(prev => prev.map((ri: any) => ri.status === 'obsolete' ? ri : { ...ri, status: 'released' }));
          // 同步执行项状态（draft/frozen → released）：ECR 变更分析操作列的"发布"按钮随之消失，
          // 与工程变更结果表的"已全部发布"保持一致
          setEco(prev => prev ? {
            ...prev,
            execution_items: (prev.execution_items || []).map((ei: any) =>
              (ei.new_entity_status === 'draft' || ei.new_entity_status === 'frozen')
                ? { ...ei, new_entity_status: 'released' } : ei
            ),
          } : prev);
          setPublishedNonce(n => n + 1);
          // releaseItems 引用变化会触发发布状态校验，从而自动把"一键发布"按钮置灰
        } catch (err: any) {
          toast.error(err?.response?.data?.detail || '操作失败');
        } finally { setActionLoading(false); }
      }} />
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function InfoItem({ label, value, icon, className }: { label: string; value: string; icon?: string; className?: string }) {
  return (
    <div className={`bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)] ${className || ''}`}>
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium whitespace-pre-wrap">{icon && <span className="mr-1">{icon}</span>}{value}</div>
    </div>
  );
}

// 部件类型判定：'component' 为历史遗留值，语义等同 'assembly'（部件）
const isAssemblyType = (t: string) => t === 'assembly' || t === 'component';

function ReleaseItemsTable({ items, onViewItem, publishedNonce }: { items: any[]; onViewItem: (type: string, id: string, mode?: 'view' | 'edit') => void; publishedNonce?: number }) {
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<string | null>(null);
  // 表头点击排序（件号/名称/版本/状态/用量）：顶层与各层子项统一排序（渲染时派生，切换排序即时生效于整棵树）
  const { sortField, sortDirection, handleSort } = useTableSort<any>(items, { fieldComparators: { version: (a, b) => compareVersions(String(a), String(b)) } });
  // 排序 key → release item 实际字段映射
  const fieldOf = (ri: any, f: string) => f === 'code' ? ri.entity_code : f === 'name' ? ri.entity_name : f === 'version' ? ri.entity_version : f === 'status' ? ri.status : ri.quantity;
  const sortRows = useCallback((list: any[]) => {
    if (!sortField || !sortDirection) return list;
    return [...list].sort((a: any, b: any) => {
      const aVal = fieldOf(a, String(sortField));
      const bVal = fieldOf(b, String(sortField));
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      let cmp: number;
      if (sortField === 'version') cmp = compareVersions(String(aVal), String(bVal));
      else if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal), 'zh-CN');
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [sortField, sortDirection]);
  const sortedItems = sortRows(items);
  // 展开状态用稳定标识（entity_id/code），排序后展开不错位
  const keyOf = (ri: any, fallback: string) => ri.entity_id || ri.entity_code || fallback;

  // 一键发布后：就地把已展开子项的非作废状态更新为 released（与后端一致），无需重新拉取、不收起、不闪屏
  useEffect(() => {
    setExpanded(prev => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Record<string, any[]> = {};
      for (const [k, rows] of Object.entries(prev)) {
        next[k] = rows.map((c: any) => c.status === 'obsolete' ? c : { ...c, status: 'released' });
      }
      return next;
    });
  }, [publishedNonce]);

  const toggleExpand = async (key: string, entityId: string, entityType: string) => {
    if (expanded[key]) { setExpanded(prev => { const n = {...prev}; delete n[key]; return n; }); return; }
    if (!isAssemblyType(entityType)) return;
    setLoadingIdx(key);
    try {
      const master = await partsApi.get(entityId);
      const revId = master.latest_revision?.id;
      if (!revId) { toast.error('无法获取最新版本'); return; }
      const rows = await partsApi.getBOM(revId);
      const children = rows.map((c: any) => ({ entity_type: isAssemblyType(c.child_type) ? 'assembly' : 'part', entity_id: c.child_master_id, entity_code: c.child_code || '', entity_name: c.child_name || '', entity_version: c.child_version || '', spec: c.child_spec || '', status: c.child_status || '', quantity: c.quantity || 1 }));
      setExpanded(prev => ({ ...prev, [key]: children }));
    } catch { toast.error('加载子项失败'); }
    finally { setLoadingIdx(null); }
  };

  const renderRow = (ri: any, level: number, key: string): React.ReactNode => {
    const isAssembly = isAssemblyType(ri.entity_type);
    const childRows = expanded[key];
    return (
      <>
        <tr key={key} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => onViewItem(isAssembly ? 'assembly' : 'part', ri.entity_id, 'view')}>
          <td className="relative px-3 py-2 font-medium whitespace-nowrap" style={{ paddingLeft: `calc(8px + ${level} * var(--ui-tree-indent))` }} onClick={(e) => e.stopPropagation()}>
            {level > 0 && Array.from({ length: level }, (_, k) => (
              <span key={k} className="absolute -top-px bottom-0 w-px bg-[var(--ui-border)] pointer-events-none" style={{ left: `calc(16px + ${k} * var(--ui-tree-indent))` }} />
            ))}
            <span className="inline-flex items-center gap-1">
              {isAssembly ? (
                <TreeToggle expanded={!!childRows} onClick={() => toggleExpand(key, ri.entity_id, ri.entity_type)} size="sm" title={childRows ? '折叠' : '展开'} />
              ) : (
                <TreeToggle leaf size="sm" />
              )}
              <span className="text-sm">{ri.entity_code}</span>
            </span>
          </td>
          <td className="px-3 py-2">{ri.entity_name}</td>
          <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{ri.entity_version || 'A'}</td>
          <td className="px-3 py-2 whitespace-nowrap">{ri.status ? <Badge status={ri.status} /> : '-'}</td>
          <td className="px-3 py-2 text-center">{ri.quantity || 1}</td>
        </tr>
        {childRows && sortRows(childRows).map((child: any, j: number) => renderRow(child, level + 1, keyOf(child, `${key}-${j}`)))}
        {loadingIdx === key && <tr><td colSpan={5} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };

  return (
    <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr className="sticky top-0 z-10">
          <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2">件号</SortableTh>
          <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2">中文名称</SortableTh>
          <SortableTh sortKey="version" active={sortField === 'version'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2 w-14">版本</SortableTh>
          <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2 w-20">状态</SortableTh>
          <SortableTh sortKey="quantity" active={sortField === 'quantity'} direction={sortDirection} onSort={(k) => handleSort(k)} align="center" className="!px-3 !py-2 w-12">用量</SortableTh>
        </tr></thead>
        <tbody className="divide-y">{sortedItems.map((ri, i) => renderRow(ri, 0, keyOf(ri, String(i))))}</tbody>
      </table>
    </div>
  );
}
