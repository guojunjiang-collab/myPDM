import { useEffect, useState } from 'react';
import { ecoApi, documentsApi, assemblyPartsApi, partsApi, assembliesApi, customFieldsApi, mediaApi } from '../../services/api';
import type { ECORequest, Document, ECRDocumentLink } from '../../types';
import { ECOStatusBadge, ECOPriorityBadge } from './ECOStatusBadge';
import { Modal, ConfirmModal } from '../Modal';
import { toast } from '../Toast';
import { useAuthStore, canDownload } from '../../stores/auth';
import { exportEcoPdf } from '../../services/ecPdfExport';
import { useDataStore } from '../../stores/data';
import { ECOEditView } from './ECOEditView';
import { ECRReviewPanel } from '../ECR/ECRReviewPanel';
import { ECRDocumentPicker } from '../ECR/ECRDocumentPicker';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import DocumentDetailContent from '../DocumentDetailContent';
import VersionHistory from '../VersionHistory';
import EntityEditModal from '../EntityEditModal';

const statusTag = (s: string) => {
  const labels: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  const colors: Record<string, string> = { draft: 'bg-blue-100 text-blue-800', frozen: 'bg-orange-100 text-orange-800', released: 'bg-green-100 text-green-800', obsolete: 'bg-red-100 text-gray-800' };
  return { label: labels[s] || s, cls: colors[s] || 'bg-gray-100 text-gray-800' };
};

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
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const [docCustomValues, setDocCustomValues] = useState<Record<string, Record<string, any>>>({});
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [nestedDetail, setNestedDetail] = useState<{ type: string; id: string } | null>(null);
  const [nestedData, setNestedData] = useState<any>(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedCustomDefs, setNestedCustomDefs] = useState<any[]>([]);
  const [nestedCustomValues, setNestedCustomValues] = useState<Record<string, any>>({});
  const [checkedExecIds, setCheckedExecIds] = useState<string[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showReleasePicker, setShowReleasePicker] = useState(false);
  const [documentLinks, setDocumentLinks] = useState<ECRDocumentLink[]>([]);
  const [releaseItems, setReleaseItems] = useState<any[]>([]);
  const [versionSelectState, setVersionSelectState] = useState<{ docId: string; oldDocId: string } | null>(null);
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');
  const [editEntity, setEditEntity] = useState<{ type: string; id: string } | null>(null);
  const [showPublishAll, setShowPublishAll] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{ has_pending: boolean; pending_count: number; total: number } | null>(null);
  const [publishedNonce, setPublishedNonce] = useState(0);  // 一键发布后递增，通知列表就地刷新已展开子项状态

  const load = async () => {
    setLoading(true);
    try {
      const r = await ecoApi.detail(ecoId);
      setEco(r.data);
      setDocumentLinks(r.data.document_links || []);
      setReleaseItems(r.data.release_items || []);
      // 刷新 release_items 状态（避免显示过期状态）
      const items = r.data.release_items || [];
      if (items.length > 0) {
        const refreshed = await Promise.all(items.map(async (ri: any) => {
          try {
            const api = ri.entity_type === 'assembly' ? assembliesApi : partsApi;
            const entity = await api.get(ri.entity_id);
            return { ...ri, status: entity.data.status };
          } catch { return ri; }
        }));
        setReleaseItems(refreshed);
      }
      const docs = r.data.document_links || [];
      if (docs.length > 0) {
        const results = await Promise.allSettled(docs.map((d: any) => documentsApi.get(d.document_id)));
        const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value.data);
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
    try { await fn(); toast.success(msg); load(); } catch (err: any) {
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
    if (mode === 'edit') {
      // 打开编辑弹窗
      setEditEntity({ type: entityType, id: entityId });
      return;
    }
    setNestedDetail({ type: entityType, id: entityId });
    setNestedLoading(true);
    setNestedCustomDefs([]);
    setNestedCustomValues({});
    try {
      const api = entityType === 'assembly' ? assembliesApi : partsApi;
      const r = await api.get(entityId);
      setNestedData(r.data);
      // 加载自定义字段定义
      const allDefs = useDataStore.getState().customFieldDefs;
      const cfType = entityType === 'assembly' ? 'component' : 'part';
      const defs = allDefs.filter((d: any) => d.applies_to?.includes(cfType));
      setNestedCustomDefs(defs);
      // 加载自定义字段值
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(cfType, entityId);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
          setNestedCustomValues(vals);
        } catch { /* optional */ }
      }
    } catch { toast.error('加载详情失败'); }
    finally { setNestedLoading(false); }
  };

  const handleDocDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { alert('下载失败，请重试'); }
  };

  const handleDocPreview = async (attId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') { try { const mt = await mediaApi.token(attId, 'preview'); window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank'); } catch { alert('预览失败，请重试'); } return; }
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) { try { const mt = await mediaApi.token(attId, 'preview'); window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(mt)}`, '_blank'); } catch { alert('预览失败，请重试'); } return; }
    if (ext === 'stp' || ext === 'step') { try { const mt = await mediaApi.token(attId, 'gltf'); window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(mt)}`, '_blank'); } catch { alert('预览失败，请重试'); } return; }
    alert('该格式暂不支持预览');
  };

  // 是否可一键发布：以后端递归校验（含所有层级子项）为准。
  // 校验结果未知（加载中 / 接口失败）时默认允许点击——发布是幂等且安全的操作，
  // 宁可让用户点一次（无待发布项时仅提示"已发布 0"），也不要用浅层启发式误判为"已全部发布"而错误阻断。
  const canPublishAll = publishStatus ? publishStatus.has_pending : true;

  return (
    <>
    <Modal open={true} title={executionMode ? 'ECO 执行' : 'ECO 详情'} onClose={onClose} width="3xl"
      headerAction={eco && canDownload() ? (
        <button
          onClick={() => { if (eco) exportEcoPdf(eco).catch(() => toast.error('导出失败')); }}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          title="导出为 PDF 文档"
        >📄 导出PDF</button>
      ) : undefined}
    >
      {loading ? <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
      : !eco ? <div className="py-8 text-center text-gray-400 text-sm">未找到 ECO</div>
      : (
        <>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div>
              <div className="text-lg font-bold text-gray-900">{eco.eco_number}</div>
              <div className="text-sm text-gray-500 mt-0.5">{eco.title}</div>
            </div>
            <div className="flex items-center gap-2">
              <ECOStatusBadge status={eco.status} />
              <ECOPriorityBadge priority={eco.priority} />
            </div>
          </div>

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

          {/* Reviewers */}
          {eco.reviewers && eco.reviewers.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">审批人 <span className="ml-2 text-xs font-normal text-gray-500">({eco.approved_count || 0}/{eco.reviewers_count || eco.reviewers.length} 已审批)</span></h4>
              <ECRReviewPanel reviewers={eco.reviewers} reviewRecords={eco.review_records || []} currentUserId={user?.id || ''} onReview={async (decision, comment) => { setActionLoading(true); try { await ecoApi.review(ecoId, decision, comment); toast.success('操作成功'); load(); } catch { toast.error('操作失败'); } finally { setActionLoading(false); } }} loading={actionLoading} />
            </div>
          )}

          {/* Document links */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-gray-700">关联图文档</h4>
            </div>
            <div className="border rounded-lg overflow-hidden">
              {documentLinks.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">暂无关联图文档</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b"><tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档编号</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档名称</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                      {docFieldDefs.map((def) => <th key={def.id} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{def.name}</th>)}
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                      <th className="px-3 py-2 text-center text-gray-500 font-medium whitespace-nowrap w-24">操作</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {documents.map((doc) => {
                        const atts = docAttachments[doc.id] || [];
                        return (
                          <tr key={doc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setViewingDoc(doc)}>
                            <td className="px-3 py-2 text-sm font-medium">{doc.code}</td>
                            <td className="px-3 py-2 text-sm">{doc.name}</td>
                            <td className="px-3 py-2 text-sm text-gray-500">{doc.version || '-'}</td>
                            <td className="px-3 py-2 text-sm"><span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(doc.status).cls}`}>{statusTag(doc.status).label}</span></td>
                            {docFieldDefs.map((def) => { const vals = docCustomValues[doc.id] || {}; const val = vals[def.id]; return <td key={def.id} className="px-3 py-2 text-sm text-gray-500">{val !== undefined && val !== null && val !== '' ? String(val) : '-'}</td>; })}
                            <td className="px-3 py-2 text-sm text-gray-500">{atts.length > 0 ? atts.map((a: any) => <div key={a.id} className="text-xs">{a.file_name} ({formatFileSize(a.file_size)})</div>) : (doc.file_name || '-')}</td>
                            <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                {doc.file_id && <button onClick={() => handleDocPreview(doc.file_id!, doc.file_name || '')} className="px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">预览</button>}
                                {doc.file_id && <button onClick={() => handleDocDownload(doc.file_id!, doc.file_name || '')} className="px-2 py-0.5 text-xs text-green-600 hover:text-green-800 whitespace-nowrap">下载</button>}
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

          {/* CC users */}
          {eco.cc_users && eco.cc_users.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">知会用户</h4>
              <div className="flex flex-wrap gap-2">{eco.cc_users.map((c, i) => <span key={i} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700">{c.user_name}</span>)}</div>
            </div>
          )}

          {/* BOM impact */}
          {eco.ecr_id && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">ECR 变更分析（{eco.ecr_number || 'ECR'}）</h4>
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
                    await ecoApi.revertItem(ecoId, itemId, newEntityId);
                    updateExecutionItem(itemId, { new_entity_id: undefined, new_version: undefined, new_entity_status: undefined });
                    toast.success('已还原');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onExecuteFreeze={async (itemId, newEntityId) => {
                  try {
                    await ecoApi.freezeItem(ecoId, itemId, newEntityId);
                    updateExecutionItem(itemId, { new_entity_status: 'frozen' });
                    toast.success('冻结完成');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onExecutePublish={async (itemId, newEntityId) => {
                  try {
                    await ecoApi.releaseItem(ecoId, itemId, newEntityId);
                    updateExecutionItem(itemId, { new_entity_status: 'released' });
                    toast.success('发布完成');
                  } catch (err: any) { toast.error(err?.response?.data?.detail || '操作失败'); }
                }}
                onViewItem={(entityType, entityId) => viewItem(entityType, entityId, 'view')}
                onEditItem={(entityType, entityId) => viewItem(entityType, entityId, 'edit')}
                onCheckedChange={setCheckedExecIds} />
            </div>
          )}

          {/* 工程变更结果 */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-gray-700">工程变更结果</h4>
              {executionMode && eco.status === 'executing' && releaseItems.length > 0 && (
                <button onClick={() => setShowPublishAll(true)} disabled={actionLoading || !canPublishAll}
                  title={canPublishAll ? '存在草稿/冻结状态的零部件，可一键发布' : '工程变更结果已全部发布'}
                  className={`px-3 py-1 text-sm rounded-lg disabled:cursor-not-allowed disabled:opacity-60 ${canPublishAll ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500'}`}>
                  {canPublishAll ? '一键发布' : '已全部发布'}</button>
              )}
            </div>
            {releaseItems.length === 0 ? (
              <div className="border rounded-lg px-4 py-6 text-center text-sm text-gray-400">暂无工程变更结果</div>
            ) : (
              <ReleaseItemsTable items={releaseItems} onViewItem={viewItem} publishedNonce={publishedNonce} />
            )}
          </div>

          {/* Status logs */}
          {eco.status_logs && eco.status_logs.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">状态日志</h4>
              <div className="space-y-1">{eco.status_logs.map((l, i) => (
                <div key={i} className="text-xs px-2 py-1 rounded bg-gray-50 flex gap-2">
                  <span className="text-gray-400">{l.from_status || '-'} → </span><span className="font-medium">{l.to_status}</span>
                  <span className="text-gray-500">by {l.operator_name}</span>
                  {l.comment && <span className="text-gray-400">: {l.comment}</span>}
                  <span className="text-gray-400 ml-auto">{fmt(l.created_at)}</span>
                </div>
              ))}</div>
            </div>
          )}

          {/* Timestamps */}
          <div className="border-t pt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div><span className="text-gray-400">创建</span> {fmt(eco.created_at)}</div>
            <div><span className="text-gray-400">更新</span> {fmt(eco.updated_at)}</div>
            {eco.reviewed_at && <div><span className="text-gray-400">审批完成</span> {fmt(eco.reviewed_at)}</div>}
            {eco.executed_at && <div><span className="text-gray-400">执行完成</span> {fmt(eco.executed_at)}</div>}
          </div>
        </div>

        {/* 执行模式底部按钮 */}
        {executionMode && (eco.status === 'executing' || eco.status === 'approved') && (
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              {eco.status === 'executing' && (
                <button onClick={() => act(() => ecoApi.completeExecution(ecoId), '执行已完成')} disabled={actionLoading} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">完成执行</button>
              )}
            </div>
          </div>
        )}
        </>
      )}

      {/* 嵌套详情弹窗 - 复用零件/部件管理的详情界面 */}
      {nestedDetail && (
        <Modal open={true} title={nestedDetail.type === 'assembly' ? '部件详情' : '零件详情'} onClose={() => { setNestedDetail(null); setNestedData(null); setDetailTab('detail'); }} width="full">
          {nestedLoading ? <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
          : nestedData ? (
            <div>
              {/* Tab 切换 */}
              <div className="flex gap-1 mb-4 border-b">
                <button onClick={() => setDetailTab('detail')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${detailTab === 'detail' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>基本信息</button>
                <button onClick={() => setDetailTab('versions')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${detailTab === 'versions' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>版本历史</button>
              </div>
              {detailTab === 'detail' ? (
                nestedDetail.type === 'assembly' ? (
                  <AssemblyDetailContent assembly={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} />
                ) : (
                  <PartDetailContent part={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} />
                )
              ) : (
                <VersionHistory
                  entityType={nestedDetail.type as 'part' | 'assembly'}
                  entityId={nestedData.id}
                  onViewVersion={async (id) => {
                    try {
                      const api = nestedDetail.type === 'assembly' ? assembliesApi : partsApi;
                      const r = await api.get(id);
                      setNestedData(r.data);
                      // 加载该版本的自定义字段值
                      const cfType = nestedDetail.type === 'assembly' ? 'component' : 'part';
                      try {
                        const valuesRes = await customFieldsApi.getValues(cfType, id);
                        const vals: Record<string, any> = {};
                        (valuesRes.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
                        setNestedCustomValues(vals);
                      } catch { /* optional */ }
                      setDetailTab('detail');
                    } catch { toast.error('加载版本失败'); }
                  }}
                />
              )}
            </div>
          ) : <div className="text-center py-8 text-sm text-gray-400">未找到数据</div>}
        </Modal>
      )}
    </Modal>

    {/* 图文档详情弹窗 */}
    <Modal open={!!viewingDoc} title="图文档详情" onClose={() => setViewingDoc(null)} width="full">
      {viewingDoc && <div className="max-h-[70vh] overflow-y-auto pr-1"><DocumentDetailContent doc={viewingDoc} customFieldDefs={docFieldDefs} customFieldValues={docCustomValues[viewingDoc.id] || {}} /></div>}
    </Modal>

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

    {/* 图文档选择器 */}
    <ECRDocumentPicker open={showDocPicker} onClose={() => setShowDocPicker(false)}
      onSelect={(docs: ECRDocumentLink[]) => { const existing = new Set(documentLinks.map(d => d.document_id)); const newDocs = docs.filter(d => !existing.has(d.document_id)); saveDocumentLinks([...documentLinks, ...newDocs]); setShowDocPicker(false); }}
      alreadyLinked={documentLinks.map(d => d.document_id)} />

    {/* 零部件选择器 */}
    <AssemblyPartPicker open={showReleasePicker} onClose={() => setShowReleasePicker(false)}
      onConfirm={(items) => {
        setShowReleasePicker(false);
        Promise.allSettled(items.map(async (item) => { const api = item.child_type === 'assembly' ? assembliesApi : partsApi; const r = await api.get(item.child_id); return { ...r.data, child_type: item.child_type, quantity: item.quantity }; })).then(results => {
          const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
          const existingIds = new Set(releaseItems.map((r: any) => r.entity_id));
          const merged = [...releaseItems, ...loaded.filter((r: any) => !existingIds.has(r.id)).map((r: any) => ({ entity_type: r.child_type === 'assembly' ? 'assembly' : 'part', entity_id: r.id, entity_code: r.code || '', entity_name: r.name || '', entity_version: r.version || '', spec: r.spec || '', status: r.status || '', quantity: r.quantity || 1 }))];
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
    <div className={`bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 ${className || ''}`}>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium whitespace-pre-wrap">{icon && <span className="mr-1">{icon}</span>}{value}</div>
    </div>
  );
}

function ReleaseItemsTable({ items, onViewItem, publishedNonce }: { items: any[]; onViewItem: (type: string, id: string, mode?: 'view' | 'edit') => void; publishedNonce?: number }) {
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<string | null>(null);

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

  const toggleExpand = async (idx: string, entityId: string, entityType: string) => {
    if (expanded[idx]) { setExpanded(prev => { const n = {...prev}; delete n[idx]; return n; }); return; }
    if (entityType !== 'assembly') return;
    setLoadingIdx(idx);
    try {
      const r = await assemblyPartsApi.list(entityId);
      const children = (r.data || []).map((c: any) => ({ entity_type: c.childType === 'component' || c.childType === 'assembly' ? 'assembly' : 'part', entity_id: c.child_id, entity_code: c.child_detail?.code || '', entity_name: c.child_detail?.name || '', entity_version: c.child_detail?.version || '', spec: c.child_detail?.spec || '', status: c.child_detail?.status || '', quantity: c.quantity || 1 }));
      setExpanded(prev => ({ ...prev, [idx]: children }));
    } catch { toast.error('加载子项失败'); }
    finally { setLoadingIdx(null); }
  };

  const renderRow = (ri: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = ri.entity_type === 'assembly';
    const childRows = expanded[idx];
    const rowNum = parseInt(idx.split('-')[0], 10);
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50 cursor-pointer" onClick={() => onViewItem(isAssembly ? 'assembly' : 'part', ri.entity_id, 'view')}>
          <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && <button onClick={(e) => { e.stopPropagation(); toggleExpand(idx, ri.entity_id, ri.entity_type); }} className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">{childRows ? '▼' : '▶'}</button>}
          </td>
          <td className="px-3 py-1.5 text-xs"><span className={`px-1.5 py-0.5 rounded text-xs ${isAssembly ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{isAssembly ? '部件' : '零件'}</span></td>
          <td className="px-3 py-1.5 text-xs font-mono">{ri.entity_code}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_name}</td>
          <td className="px-3 py-1.5 text-xs text-gray-500">{ri.spec || '-'}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_version || 'A'}</td>
          <td className="px-3 py-1.5 text-xs whitespace-nowrap">{ri.status ? <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(ri.status).cls}`}>{statusTag(ri.status).label}</span> : '-'}</td>
          <td className="px-3 py-1.5 text-xs text-center">{ri.quantity || 1}</td>
        </tr>
        {childRows && childRows.map((child: any, j: number) => renderRow(child, level + 1, `${idx}-${j}`))}
        {loadingIdx === idx && <tr><td colSpan={8} className="px-3 py-1.5 text-xs text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b"><tr>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">层级</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">类型</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">件号</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">中文名称</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-14">版本</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">状态</th>
          <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-12">用量</th>
        </tr></thead>
        <tbody className="divide-y">{items.map((ri, i) => renderRow(ri, 0, String(i)))}</tbody>
      </table>
    </div>
  );
}
