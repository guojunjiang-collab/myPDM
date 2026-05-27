import { useEffect, useState } from 'react';
import { ecoApi, documentsApi, assemblyPartsApi, partsApi, assembliesApi, customFieldsApi } from '../../services/api';
import type { ECORequest, Document } from '../../types';
import { ECOStatusBadge, ECOPriorityBadge, ECOActionBadge, ECOExecStatusBadge } from './ECOStatusBadge';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { useAuthStore, isAdmin } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { ECOEditView } from './ECOEditView';
import { ECRReviewPanel } from '../ECR/ECRReviewPanel';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import DocumentDetailContent from '../DocumentDetailContent';

const statusTag = (s: string) => {
  const labels: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  const colors: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800', frozen: 'bg-orange-100 text-orange-800',
    released: 'bg-green-100 text-green-800', obsolete: 'bg-red-100 text-red-800',
  };
  return { label: labels[s] || s, cls: colors[s] || 'bg-gray-100 text-gray-800' };
};

interface Props { ecoId: string; onClose: () => void; onRefresh: () => void; }

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

export function ECODetailModal({ ecoId, onClose, onRefresh }: Props) {
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

  const load = async () => {
    setLoading(true);
    try {
      const r = await ecoApi.detail(ecoId);
      setEco(r.data);
      // Load document details
      const docs = r.data.document_links || [];
      if (docs.length > 0) {
        const results = await Promise.allSettled(docs.map((d: any) => documentsApi.get(d.document_id)));
        const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value.data);
        setDocuments(loaded);
        // Load attachments and custom field values
        loaded.forEach((doc: Document) => {
          documentsApi.listAttachments(doc.id).then(r => setDocAttachments(prev => ({...prev, [doc.id]: r.data||[]}))).catch(() => {});
          customFieldsApi.getValues('document', doc.id).then(r => {
            const vals: Record<string, any> = {};
            (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
            setDocCustomValues(prev => ({...prev, [doc.id]: vals}));
          }).catch(() => {});
        });
      } else { setDocuments([]); }
    } catch { toast.error('加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [ecoId]);

  const act = async (fn: () => Promise<any>, msg: string) => {
    setActionLoading(true);
    try { await fn(); toast.success(msg); load(); } catch { toast.error('操作失败'); }
    finally { setActionLoading(false); }
  };

  const viewItem = async (entityType: string, entityId: string) => {
    setNestedDetail({ type: entityType, id: entityId });
    setNestedLoading(true);
    try {
      const api = entityType === 'assembly' ? assembliesApi : partsApi;
      const r = await api.get(entityId);
      setNestedData(r.data);
    } catch { toast.error('加载详情失败'); }
    finally { setNestedLoading(false); }
  };

  const handleDocDownload = (attId: string, fileName: string) => {
    const token = useAuthStore.getState().token;
    if (!token) { alert('登录已过期'); return; }
    const a = document.createElement('a');
    a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(token)}`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDocPreview = (attId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const token = useAuthStore.getState().token;
    if (!token) { alert('登录已过期'); return; }
    if (ext === 'pdf') { window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(token)}`, '_blank'); return; }
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) { window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(token)}`, '_blank'); return; }
    if (ext === 'stp' || ext === 'step') { window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(token)}`, '_blank'); return; }
    alert('该格式暂不支持预览');
  };

  return (
    <>
    <Modal open={true} title="ECO 详情" onClose={onClose} width="3xl">
      {loading ? <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
      : !eco ? <div className="py-8 text-center text-gray-400 text-sm">未找到 ECO</div>
      : (
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

          {/* Basic info cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <InfoItem label="变更原因" value={REASON[eco.reason] || eco.reason || '-'} />
            <InfoItem label="变更类别" value={CAT[eco.category||''] || eco.category || '-'} />
            <InfoItem label="优先级" value={eco.priority} />
            <InfoItem label="审批模式" value={eco.review_mode === 'all' ? '会签' : '或签'} />
            <InfoItem label="创建人" value={eco.creator_name} icon="👤" />
            <InfoItem label="执行人" value={eco.executor_name || '未指定'} />
            <InfoItem label="来源" value={eco.ecr_number || '独立创建'} />
            <InfoItem label="进度" value={`${eco.execution_completed_count}/${eco.execution_count}`} />
          </div>

          {/* Description */}
          {eco.description && <p className="text-sm text-gray-600">{eco.description}</p>}

          {/* Reviewers panel — ECR style */}
          {eco.reviewers && eco.reviewers.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">
                审批人
                <span className="ml-2 text-xs font-normal text-gray-500">
                  ({eco.approved_count || 0}/{eco.reviewers_count || eco.reviewers.length} 已审批)
                </span>
              </h4>
              <ECRReviewPanel
                reviewers={eco.reviewers}
                reviewRecords={eco.review_records || []}
                currentUserId={user?.id || ''}
                onReview={async (decision, comment) => {
                  setActionLoading(true);
                  try {
                    await ecoApi.review(ecoId, decision, comment);
                    toast.success('操作成功');
                    load();
                  } catch { toast.error('操作失败'); }
                  finally { setActionLoading(false); }
                }}
                loading={actionLoading}
              />
            </div>
          )}

          {/* Document links */}
          {documents.length > 0 && (
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
                    {documents.map((doc) => {
                      const atts = docAttachments[doc.id] || [];
                      return (
                        <tr key={doc.id} className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setViewingDoc(doc)}>
                          <td className="px-3 py-2 text-sm font-medium">{doc.code}</td>
                          <td className="px-3 py-2 text-sm">{doc.name}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">{doc.version || '-'}</td>
                          <td className="px-3 py-2 text-sm">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(doc.status).cls}`}>{statusTag(doc.status).label}</span>
                          </td>
                          {docFieldDefs.map((def) => {
                            const vals = docCustomValues[doc.id] || {};
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
                            )) : (doc.file_name || '-')}
                          </td>
                          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              {doc.file_id && (
                                <button onClick={() => handleDocPreview(doc.file_id!, doc.file_name || '')}
                                  className="px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800">预览</button>
                              )}
                              {doc.file_id && (
                                <button onClick={() => handleDocDownload(doc.file_id!, doc.file_name || '')}
                                  className="px-2 py-0.5 text-xs text-green-600 hover:text-green-800">下载</button>
                              )}
                              {!doc.file_id && <span className="text-xs text-gray-400">-</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CC users */}
          {eco.cc_users && eco.cc_users.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">知会用户</h4>
              <div className="flex flex-wrap gap-2">
                {eco.cc_users.map((c, i) => (
                  <span key={i} className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700">{c.user_name}</span>
                ))}
              </div>
            </div>
          )}

          {/* BOM impact (if source ECR exists) */}
          {eco.ecr_id && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">ECR 变更分析（{eco.ecr_number || 'ECR'}）</h4>
              <ECOEditView ecrId={eco.ecr_id} onEcrLinked={() => {}} readOnly executionItems={eco.execution_items} />
            </div>
          )}

          {/* 工程预变更关联零部件 */}
          {eco.release_items && eco.release_items.length > 0 && (
            <ReleaseItemsTable items={eco.release_items} onViewItem={viewItem} />
          )}

          {/* Review panel is handled by ECRReviewPanel inside reviewers section */}

          {/* Execute panel */}
          {(eco.status === 'approved' || eco.status === 'executing') && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">执行操作</h4>
              <div className="flex gap-2 mb-2">
                {eco.status === 'approved' && (
                  <button onClick={() => act(() => ecoApi.startExecution(ecoId), '已开始')} disabled={actionLoading}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">开始执行</button>
                )}
                <button onClick={() => act(() => ecoApi.executeAll(ecoId), '已执行')} disabled={actionLoading}
                  className="px-4 py-1.5 bg-green-600 text-white rounded text-sm disabled:opacity-50">一键执行全部</button>
              </div>
              {eco.execution_items && eco.execution_items.length > 0 && (
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-gray-50 border-b">
                      <th className="p-1.5 text-left">#</th><th className="p-1.5 text-left">实体</th>
                      <th className="p-1.5 text-left">操作</th><th className="p-1.5 text-left">状态</th>
                      <th className="p-1.5 text-left">操作</th>
                    </tr></thead>
                    <tbody>
                      {eco.execution_items.map((ei, i) => (
                        <tr key={ei.id} className="border-b hover:bg-gray-50">
                          <td className="p-1.5">{i+1}</td>
                          <td className="p-1.5">{ei.entity_name}</td>
                          <td className="p-1.5"><ECOActionBadge action={ei.action} /></td>
                          <td className="p-1.5"><ECOExecStatusBadge status={ei.status} /></td>
                          <td className="p-1.5">
                            {(ei.status === 'pending' || ei.status === 'failed') && (
                              <button onClick={() => act(() => ecoApi.executeItem(ecoId, ei.id), '已执行')} disabled={actionLoading}
                                className="text-blue-500 text-xs hover:underline">执行</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Status logs */}
          {eco.status_logs && eco.status_logs.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1.5">状态日志</h4>
              <div className="space-y-1">
                {eco.status_logs.map((l, i) => (
                  <div key={i} className="text-xs px-2 py-1 rounded bg-gray-50 flex gap-2">
                    <span className="text-gray-400">{l.from_status || '-'} → </span>
                    <span className="font-medium">{l.to_status}</span>
                    <span className="text-gray-500">by {l.operator_name}</span>
                    {l.comment && <span className="text-gray-400">: {l.comment}</span>}
                    <span className="text-gray-400 ml-auto">{fmt(l.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="border-t pt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div><span className="text-gray-400">创建</span> {fmt(eco.created_at)}</div>
            <div><span className="text-gray-400">更新</span> {fmt(eco.updated_at)}</div>
            {eco.reviewed_at && <div><span className="text-gray-400">审批完成</span> {fmt(eco.reviewed_at)}</div>}
            {eco.executed_at && <div><span className="text-gray-400">执行完成</span> {fmt(eco.executed_at)}</div>}
            {eco.closed_at && <div><span className="text-gray-400">关闭</span> {fmt(eco.closed_at)}</div>}
          </div>

        </div>
      )}

      {/* 嵌套详情弹窗 */}
      {nestedDetail && (
        <Modal open={true} title={nestedDetail.type === 'assembly' ? '部件详情' : '零件详情'}
          onClose={() => { setNestedDetail(null); setNestedData(null); }} width="full">
          {nestedLoading ? (
            <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
          ) : nestedData ? (
            nestedDetail.type === 'assembly' ? (
              <AssemblyDetailContent assembly={nestedData} customFieldDefs={[]} customFieldValues={{}} />
            ) : (
              <PartDetailContent part={nestedData} customFieldDefs={[]} customFieldValues={{}} />
            )
          ) : (
            <div className="text-center py-8 text-sm text-gray-400">未找到数据</div>
          )}
        </Modal>
      )}
    </Modal>

    {/* 图文档详情弹窗 */}
    <Modal open={!!viewingDoc} title="图文档详情" onClose={() => setViewingDoc(null)} width="full">
      {viewingDoc && (
        <div className="max-h-[70vh] overflow-y-auto pr-1">
          <DocumentDetailContent doc={viewingDoc} customFieldDefs={docFieldDefs} customFieldValues={docCustomValues[viewingDoc.id] || {}} />
        </div>
      )}
    </Modal>
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function InfoItem({ label, value, icon }: { label: string; value: string; icon?: string }) {
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

function ReleaseItemsTable({ items, onViewItem }: { items: any[]; onViewItem: (type: string, id: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<string | null>(null);

  const toggleExpand = async (idx: string, entityId: string, entityType: string) => {
    if (expanded[idx]) { setExpanded(prev => { const n = {...prev}; delete n[idx]; return n; }); return; }
    if (entityType !== 'assembly') return;
    setLoadingIdx(idx);
    try {
      const r = await assemblyPartsApi.list(entityId);
      const children = (r.data || []).map((c: any) => ({
        entity_type: c.childType === 'component' || c.childType === 'assembly' ? 'assembly' : 'part',
        entity_id: c.child_id,
        entity_code: c.child_detail?.code || '',
        entity_name: c.child_detail?.name || '',
        entity_version: c.child_detail?.version || '',
        spec: c.child_detail?.spec || '',
        status: c.child_detail?.status || '',
        quantity: c.quantity || 1,
      }));
      setExpanded(prev => ({ ...prev, [idx]: children }));
    } catch { toast.error('加载子项失败'); }
    finally { setLoadingIdx(null); }
  };

  const renderRow = (ri: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = ri.entity_type === 'assembly';
    const childRows = expanded[idx];
    const openDetail = () => {
      onViewItem(isAssembly ? 'assembly' : 'part', ri.entity_id);
    };
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50 cursor-pointer"
          onClick={openDetail}>
          <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && (
              <button onClick={(e) => { e.stopPropagation(); toggleExpand(idx, ri.entity_id, ri.entity_type); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '▼' : '▶'}
              </button>
            )}
          </td>
          <td className="px-3 py-1.5 text-xs">
            <span className={`px-1.5 py-0.5 rounded text-xs ${isAssembly ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {isAssembly ? '部件' : '零件'}
            </span>
          </td>
          <td className="px-3 py-1.5 text-xs font-mono">{ri.entity_code}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_name}</td>
          <td className="px-3 py-1.5 text-xs text-gray-500">{ri.spec || '-'}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_version || 'A'}</td>
          <td className="px-3 py-1.5 text-xs whitespace-nowrap">{ri.status ? <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(ri.status).cls}`}>{statusTag(ri.status).label}</span> : '-'}</td>
          <td className="px-3 py-1.5 text-xs text-center">{ri.quantity || 1}</td>
        </tr>
        {childRows && childRows.map((child: any, j: number) =>
          renderRow(child, level + 1, `${idx}-${j}`)
        )}
        {loadingIdx === idx && (
          <tr><td colSpan={8} className="px-3 py-1.5 text-xs text-gray-400 text-center">加载中...</td></tr>
        )}
      </>
    );
  };

  return (
    <div className="border-t pt-3">
      <h4 className="text-sm font-bold text-gray-700 mb-1.5">工程预变更</h4>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">层级</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">类型</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500">件号</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500">中文名称</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-14">版本</th>
              <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">状态</th>
              <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-12">用量</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((ri, i) => renderRow(ri, 0, String(i)))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
