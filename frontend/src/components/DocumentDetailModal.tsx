import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { Loading } from './Loading';
import { toast } from './Toast';
import { useAuthStore, isAdmin as checkIsAdmin } from '../stores/auth';
import { useDataStore } from '../stores/data';
import { documentsApi, customFieldsApi, mediaApi, v2UploadApi, CHUNK_SIZE, CHUNK_THRESHOLD, userGroupsApi } from '../services/api';
import CustomFieldInput from './CustomFieldInput';
import { previewAttachment } from '../utils/attachmentPreview';
import ArchiveTreeModal from './ArchiveTreeModal';
import { formatDateTime } from '../utils/date';
import DocWhereUsedTab from './DocumentDetailModal/DocWhereUsedTab';
import ConfigItemDetailModal from './Configuration/ConfigItemDetailModal';
import PartDetailModal from './PartDetailModal';
import TaskEditModal from '../pages/Project/TaskEditModal';
import { ECODetailModal } from './ECO/ECODetailModal';
import { ECRDetailModal } from './ECR/ECRDetailModal';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Textarea from './ui/Textarea';
import type { DocumentRevision, DocumentIteration, CustomFieldDefinition } from '../types';

interface Props {
  open: boolean;
  revisionId: string | null;
  onClose: (savedPatch?: Record<string, string>) => void;
  onSaved: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

type TabKey = 'attachments' | 'versions' | 'iterations' | 'custom-fields' | 'whereused';

interface AttInfo {
  id: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

export default function DocumentDetailModal({ open, revisionId, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<DocumentRevision | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('attachments');
  const [attachments, setAttachments] = useState<AttInfo[]>([]);
  const [iterations, setIterations] = useState<DocumentIteration[]>([]);
  const [versions, setVersions] = useState<DocumentRevision[]>([]);
  const [cfDefs, setCfDefs] = useState<CustomFieldDefinition[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, any>>({});
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '', remark: '' });
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinNote, setCheckinNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [wuConfig, setWuConfig] = useState<string | null>(null);
  const [wuPart, setWuPart] = useState<{ masterId: string; revisionId: string } | null>(null);
  const [wuTask, setWuTask] = useState<{ projectId: string; task: any } | null>(null);
  const [wuEco, setWuEco] = useState<string | null>(null);
  const [wuEcr, setWuEcr] = useState<string | null>(null);

  const effectiveRevisionId = viewingVersionId || revisionId;
  const isViewingOtherVersion = !!viewingVersionId && viewingVersionId !== revisionId;
  const currentRevisionId = revisionId;

  const isCheckedOut = !!doc?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && doc?.check_out_user_id === user?.id;
  const isDraft = doc?.status === 'draft';
  const canEdit = isCheckedOutByMe && isDraft && !isViewingOtherVersion;
  const canCheckout = isDraft && !isCheckedOut && !isViewingOtherVersion;
  const canCheckin = isDraft && isCheckedOutByMe && !isViewingOtherVersion;
  const canUndo = isDraft && isCheckedOutByMe && (doc?.latest_iteration || 0) > 1 && !isViewingOtherVersion;
  const canFreeze = doc?.status === 'draft' && !isCheckedOut && !isViewingOtherVersion;
  const canUnfreeze = doc?.status === 'frozen' && checkIsAdmin();
  const canRelease = (doc?.status === 'draft' || doc?.status === 'frozen') && !isCheckedOut && !isViewingOtherVersion;
  const canUpgrade = (doc?.status === 'released' || doc?.status === 'obsolete') && !isViewingOtherVersion;
  const canObsolete = doc?.status === 'released' && !isViewingOtherVersion;
  const canForceCheckin = isCheckedOut && checkIsAdmin() && !isViewingOtherVersion;

  const currentIterationId = useMemo(() => {
    const ongoing = iterations.find((it) => !it.check_in_date);
    if (ongoing) return ongoing.id;
    if (iterations.length === 0) return null;
    return iterations.reduce((max, it) => (it.iteration > max.iteration ? it : max)).id;
  }, [iterations]);

  const loadSeq = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const loadDoc = useCallback(async () => {
    if (!effectiveRevisionId) return;
    setLoading(true);
    try {
      const res = await documentsApi.detail(effectiveRevisionId);
      const d = (res.data ?? res) as DocumentRevision;
      setDoc(d);
      setEditForm({ code: d.code || '', name: d.name || '', remark: d.remark || '' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [effectiveRevisionId]);

  const loadAttachments = useCallback(async (iterId?: string | null) => {
    if (!effectiveRevisionId) return;
    const seq = ++loadSeq.current;
    try {
      const finalIterId = iterId ?? viewingIterationId ?? currentIterationId;
      const res = await documentsApi.listAttachments(effectiveRevisionId, finalIterId || undefined);
      if (seq !== loadSeq.current) return;
      setAttachments((res.data || []) as AttInfo[]);
    } catch {
      if (seq !== loadSeq.current) return;
      setAttachments([]);
    }
  }, [effectiveRevisionId, viewingIterationId, currentIterationId]);

  const loadIterations = useCallback(async () => {
    if (!effectiveRevisionId) return;
    try {
      const res = await documentsApi.iterations(effectiveRevisionId);
      setIterations((res.data || []) as DocumentIteration[]);
    } catch {
      setIterations([]);
    }
  }, [effectiveRevisionId]);

  const loadVersions = useCallback(async () => {
    if (!effectiveRevisionId) return;
    try {
      const res = await documentsApi.versions(effectiveRevisionId);
      setVersions((res.data || []) as DocumentRevision[]);
    } catch {
      setVersions([]);
    }
  }, [effectiveRevisionId]);

  const loadCustomFields = useCallback(async () => {
    if (!effectiveRevisionId) return;
    try {
      const allDefs = useDataStore.getState().customFieldDefs || [];
      const defs = allDefs.filter((d: any) => d.applies_to?.includes('document'));
      setCfDefs(defs);
      const valsRes = await customFieldsApi.getValues('document', effectiveRevisionId);
      const map: Record<string, any> = {};
      ((valsRes.data || []) as any[]).forEach((v: any) => {
        map[v.field_id] = v.value;
      });
      setCfValues(map);
    } catch (e) {
      console.error(e);
    }
  }, [effectiveRevisionId]);

  const loadGroups = useCallback(async () => {
    if (!effectiveRevisionId) return;
    try {
      const res = await userGroupsApi.list();
      const groups: Array<{ id: string; name: string }> = Array.isArray(res.data) ? res.data : [];
      setAllGroups(groups);
      const d = await documentsApi.detail(effectiveRevisionId);
      const docData: any = (d.data ?? d);
      setSelectedGroupIds((docData.group_ids || []).map(String));
    } catch (e) {
      console.error(e);
    }
  }, [effectiveRevisionId]);

  const viewingIteration = useMemo(
    () => iterations.find((it) => it.id === viewingIterationId) ?? null,
    [iterations, viewingIterationId]
  );
  const isViewingHistorical = !!viewingIterationId;

  useEffect(() => {
    if (open && revisionId) {
      setViewingIterationId(null);
      setViewingVersionId(null);
      setIterations([]);
      setAttachments([]);
      loadDoc();
      loadAttachments();
      loadIterations();
      loadVersions();
      loadCustomFields();
      loadGroups();
    }
  }, [open, revisionId]);

  useEffect(() => {
    if (open && revisionId) {
      loadAttachments(viewingIterationId);
    }
  }, [viewingIterationId]);

  useEffect(() => {
    if (open && revisionId && currentIterationId && !viewingIterationId) {
      loadAttachments();
    }
  }, [currentIterationId]);

  useEffect(() => {
    if (open && revisionId) {
      setViewingIterationId(null);
      setIterations([]);
      setAttachments([]);
      loadDoc();
      loadAttachments();
      loadIterations();
      loadCustomFields();
      loadGroups();
    }
  }, [viewingVersionId]);

  const cfSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const debouncedCfSave = useCallback(
    (next: Record<string, any>) => {
      if (!effectiveRevisionId) return;
      if (cfSaveTimer.current) clearTimeout(cfSaveTimer.current);
      cfSaveTimer.current = setTimeout(async () => {
        try {
          const fieldValues = cfDefs.map((def) => ({
            field_id: def.id,
            value: next[def.id] ?? null,
          }));
          await customFieldsApi.setValues('document', effectiveRevisionId, fieldValues);
          onSaved();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || '自定义字段保存失败');
        }
      }, 500);
    },
    [effectiveRevisionId, cfDefs, onSaved]
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedPatchRef = useRef<Record<string, string>>({});

  const autoSave = useCallback(
    (patch: Partial<{ code: string; name: string; remark: string }>) => {
      if (!revisionId) return;
      const next = { ...editForm, ...patch };
      setEditForm(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await documentsApi.update(revisionId, patch);
          if (patch.code !== undefined || patch.name !== undefined) {
            Object.assign(savedPatchRef.current, patch);
          }
          onSaved();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || '保存失败');
        }
      }, 600);
    },
    [revisionId, editForm, onSaved]
  );

  const doAction = async (fn: () => Promise<any>, okMsg: string) => {
    try {
      await fn();
      toast.success(okMsg);
      await loadDoc();
      await loadIterations();
      await loadAttachments();
      onSaved();
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '操作失败');
    }
  };

  const uploadLargeFile = async (file: File, revId: string, onProgress: (p: number) => void) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const initResult: any = await v2UploadApi.initChunkedUpload(file.name, file.size, 'documents', revId);
    const uploadId = initResult.upload_id ?? initResult.data?.upload_id;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      await v2UploadApi.uploadChunk(uploadId, i, file.slice(start, end));
      onProgress(Math.round(((i + 1) / totalChunks) * 95));
    }
    await v2UploadApi.completeChunkedUpload(uploadId);
    onProgress(100);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !revisionId) return;
    setUploading(true);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadLargeFile(file, revisionId, () => {});
      } else {
        await v2UploadApi.uploadSmallFile(file, 'documents', revisionId, () => {});
      }
      await loadAttachments();
      toast.success('上传成功');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteAtt = async (attId: string) => {
    if (!revisionId || !confirm('确定删除该附件？')) return;
    try {
      await documentsApi.deleteAttachment(revisionId, attId);
      await loadAttachments();
      toast.success('已删除');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '删除失败');
    }
  };

  const handleDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error('下载失败');
    }
  };

  const tabs = useMemo(
    () => [
      { key: 'attachments' as const, label: '附件管理' },
      { key: 'custom-fields' as const, label: '自定义字段' },
      { key: 'versions' as const, label: '版本历史' },
      { key: 'iterations' as const, label: '迭代历史' },
      { key: 'whereused' as const, label: '反查' },
    ],
    []
  );

  if (!open) return null;

  const handleClose = () => {
    const hasChanges = Object.keys(savedPatchRef.current).length > 0;
    onClose(hasChanges ? { ...savedPatchRef.current } : undefined);
    savedPatchRef.current = {};
  };

  return (
    <Modal open={open} title="图文档详情" onClose={handleClose} width="full"
      headerAction={(isViewingOtherVersion && doc) ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看版本 {doc.version}（只读）
          <Button variant="link" size="xs" onClick={() => setViewingVersionId(null)}>返回当前</Button>
        </span>
      ) : (isViewingHistorical && viewingIteration && !isViewingOtherVersion) ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看 Iteration #{viewingIteration.iteration} 历史数据（只读）
          <Button variant="link" size="xs" onClick={() => setViewingIterationId(null)}>返回当前</Button>
        </span>
      ) : undefined}
    >
      <div className="h-[50vh] flex flex-col">
        {loading && !doc ? (
          <Loading />
        ) : !doc ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            {/* 信息卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0 mb-3">
              <InfoCard label="图文档编号" readonly={!canEdit}>
                {canEdit ? (
                  <Input
                    value={editForm.code}
                    onChange={(e) => autoSave({ code: e.target.value })}
                    size="xs"
                    className="font-mono"
                  />
                ) : (
                  <div className="text-sm text-gray-900 font-medium font-mono">{doc.code}</div>
                )}
              </InfoCard>
              <InfoCard label="名称" readonly={!canEdit}>
                {canEdit ? (
                  <Input
                    value={editForm.name}
                    onChange={(e) => autoSave({ name: e.target.value })}
                    size="xs"
                  />
                ) : (
                  <div className="text-sm text-gray-900 font-medium">{doc.name}</div>
                )}
              </InfoCard>
              <InfoCard label="用户组" readonly={!canEdit}>
                {canEdit ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 py-0.5">
                    {allGroups.length === 0 ? (
                      <span className="text-sm text-gray-400">加载中...</span>
                    ) : (
                      allGroups.map((g) => (
                        <label key={g.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-3 h-3"
                            checked={selectedGroupIds.includes(String(g.id))}
                            onChange={async (e) => {
                              const next = e.target.checked
                                ? [...selectedGroupIds, String(g.id)]
                                : selectedGroupIds.filter((x) => x !== String(g.id));
                              setSelectedGroupIds(next);
                              try {
                                await documentsApi.update(doc.id, { group_ids: next });
                                await loadDoc();
                                onSaved();
                              } catch (err: any) {
                                toast.error(err?.response?.data?.detail || '用户组更新失败');
                              }
                            }}
                          />
                          {g.name}
                        </label>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-900 font-medium break-all">
                    {(doc as any).group_names?.length ? (doc as any).group_names.join('、') : '-'}
                  </div>
                )}
              </InfoCard>
            </div>

            {/* 操作栏 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-3 shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-sm">版本：{doc.version || '-'}</span>
                  <Badge status={doc.status} />
                  {isCheckedOut ? (
                    <span className="text-xs text-orange-600">已签出：{doc.check_out_user_name || '未知'}</span>
                  ) : (
                    <span className="text-xs text-gray-400">未签出</span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap items-center">
                  {canCheckout && (
                    <Button size="sm" onClick={() => doAction(() => documentsApi.checkout(doc.id), '签出成功')}>签出/编辑</Button>
                  )}
                  {canCheckin && (
                    <Button size="sm" onClick={() => setShowCheckinModal(true)}>签入/解锁</Button>
                  )}
                  {canUndo && (
                    <Button variant="dark" size="sm" onClick={() => doAction(() => documentsApi.undocheckout(doc.id), '已撤销签出')}>撤销签出</Button>
                  )}
                  {canFreeze && (
                    <Button size="sm" onClick={() => doAction(() => documentsApi.freeze(doc.id), '已冻结')}>冻结</Button>
                  )}
                  {canUnfreeze && (
                    <Button variant="dark" size="sm" onClick={() => doAction(() => documentsApi.unfreeze(doc.id), '已解冻')}>解冻</Button>
                  )}
                  {canRelease && (
                    <Button size="sm" onClick={() => doAction(() => documentsApi.release(doc.id), '已发布')}>发布</Button>
                  )}
                  {canUpgrade && (
                    <Button size="sm" onClick={() => doAction(() => documentsApi.upgrade(doc.id), '已升版')}>升版</Button>
                  )}
                  {canObsolete && (
                    <Button variant="danger" size="sm" onClick={() => doAction(() => documentsApi.obsolete(doc.id), '已作废')}>作废</Button>
                  )}
                  {canForceCheckin && (
                    <Button variant="danger" size="sm" onClick={() => doAction(() => documentsApi.forceCheckin(doc.id), '已强制签入')}>强制签入</Button>
                  )}
                </div>
              </div>
            </div>

            {/* Tab 导航 + 内容 */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="flex border-b border-gray-200 shrink-0">
                {tabs.map((t) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === t.key
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                {/* 附件管理 Tab */}
                {activeTab === 'attachments' && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-700">附件列表</h4>
                      {canEdit && !isViewingHistorical && !isViewingOtherVersion && (
                        <>
                          <Button size="sm" type="button" onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
                            {uploading ? '上传中...' : '+ 上传附件'}
                          </Button>
                          <input ref={uploadInputRef} type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
                        </>
                      )}
                    </div>
                    {attachments.length === 0 ? (
                      <div className="text-sm text-gray-400 py-8 text-center border border-dashed border-gray-300 rounded-lg">
                        {isViewingHistorical ? '该迭代暂无附件' : '暂无附件'}
                      </div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">文件名</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">大小</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium w-40">上传时间</th>
                              <th className="px-3 py-2 text-right text-gray-500 font-medium w-40">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {attachments.map((att) => (
                              <tr key={att.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-primary-600">{att.file_name}</td>
                                <td className="px-3 py-2 text-gray-500">{formatFileSize(att.file_size || 0)}</td>
                                <td className="px-3 py-2 text-gray-500">{formatDateTime(att.created_at)}</td>
                                <td className="px-3 py-2 text-right">
                                  <Button variant="link" size="xs" className="mr-2"
                                    onClick={() => previewAttachment(att.id, att.file_name || 'preview', {
                                      onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }),
                                    })}>预览</Button>
                                  <Button variant="link" size="xs" className="mr-2"
                                    onClick={() => handleDownload(att.id, att.file_name || 'download')}>下载</Button>
                                  {canEdit && !isViewingHistorical && (
                                    <Button variant="danger" size="xs" onClick={() => handleDeleteAtt(att.id)}>删除</Button>
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

                {/* 自定义字段 Tab */}
                {activeTab === 'custom-fields' && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">自定义字段</h4>
                    {cfDefs.length === 0 ? (
                      <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg py-8 text-center">无</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {cfDefs.map((def) => {
                            const val = cfValues[def.id] ?? '';
                            const handleChange = (newVal: any) => {
                              const next = { ...cfValues, [def.id]: newVal };
                              setCfValues(next);
                              if (canEdit && !isViewingHistorical && !isViewingOtherVersion) {
                                debouncedCfSave(next);
                              }
                            };
                            return (
                              <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                <div className="text-xs text-gray-500 mb-0.5">{def.name}</div>
                                <CustomFieldInput
                                  def={def}
                                  value={val}
                                  onChange={handleChange}
                                  readOnly={!canEdit || isViewingHistorical || isViewingOtherVersion}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="mt-4 text-xs text-gray-400">
                      创建人：{doc.creator_name || '-'} | 创建时间：{doc.created_at ? new Date(doc.created_at).toLocaleString('zh-CN') : '-'}
                    </div>
                  </div>
                )}

                {/* 版本历史 Tab */}
                {activeTab === 'versions' && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-44">创建时间</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {versions.map((v) => {
                          const isCurrent = v.id === currentRevisionId;
                          const isViewing = v.id === viewingVersionId;
                          return (
                            <tr key={v.id} className={`hover:bg-gray-50 ${isViewing ? 'bg-blue-50' : ''}`}>
                              <td className="px-3 py-2">{v.version}</td>
                              <td className="px-3 py-2">
                                <Badge status={v.status} />
                              </td>
                              <td className="px-3 py-2 text-gray-500">{formatDateTime(v.created_at)}</td>
                              <td className="px-3 py-2 text-right">
                                {isCurrent ? (
                                  <span className="text-primary-600 text-xs">当前</span>
                                ) : (
                                  <Button variant="link" size="xs" className={isViewing ? 'text-orange-600' : ''}
                                    onClick={() => setViewingVersionId(v.id)}>
                                    {isViewing ? '查看中' : '切换'}
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {versions.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">暂无版本历史</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 迭代历史 Tab */}
                {activeTab === 'iterations' && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">迭代</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-44">签入时间</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">签入说明</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">创建人</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {iterations.map((it) => {
                          const isCurrent = it.id === currentIterationId;
                          const isViewing = it.id === viewingIterationId;
                          return (
                            <tr key={it.id} className={`hover:bg-gray-50 ${isViewing ? 'bg-blue-50' : ''}`}>
                              <td className="px-3 py-2">#{it.iteration}</td>
                              <td className="px-3 py-2 text-gray-500">
                                {(it.check_in_date || it.created_at)
                                  ? new Date(it.check_in_date || it.created_at as string).toLocaleString('zh-CN', { hour12: false })
                                  : '-'}
                              </td>
                              <td className="px-3 py-2 text-gray-700">{it.check_in_note || '-'}</td>
                              <td className="px-3 py-2 text-gray-500">{(it as any).creator_name || '-'}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {isCurrent ? (
                                    <span className="text-primary-600 text-xs">当前</span>
                                  ) : (
                                    <Button variant="link" size="xs" className={isViewing ? 'text-orange-600' : ''}
                                      onClick={() => setViewingIterationId(it.id)}>
                                      {isViewing ? '查看中' : '查看数据'}
                                    </Button>
                                  )}
                                  {it.iteration > 1 && checkIsAdmin() && (
                                    <Button variant="danger" size="xs" onClick={async () => {
                                      if (!doc || !confirm(`确定删除迭代 #${it.iteration}？该迭代的附件也将被删除。`)) return;
                                      try {
                                        await documentsApi.deleteIteration(doc.id, it.id);
                                        toast.success('迭代已删除');
                                        await loadIterations();
                                        await loadAttachments();
                                        onSaved();
                                      } catch (e: any) {
                                        toast.error(e?.response?.data?.detail || '删除失败');
                                      }
                                    }}>删除</Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {iterations.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400">暂无迭代记录</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {activeTab === 'whereused' && effectiveRevisionId && (
                  <DocWhereUsedTab
                    revisionId={effectiveRevisionId}
                    onOpenConfig={(cirId) => setWuConfig(cirId)}
                    onOpenPart={(masterId, revisionId) => setWuPart({ masterId, revisionId })}
                    onOpenTask={(projectId, task) => setWuTask({ projectId, task })}
                    onOpenEco={(ecoId) => setWuEco(ecoId)}
                    onOpenEcr={(ecrId) => setWuEcr(ecrId)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 签入说明弹窗 */}
      {showCheckinModal && (
        <Modal open={showCheckinModal} title="签入说明" onClose={() => setShowCheckinModal(false)} width="md">
          <Textarea
            value={checkinNote}
            onChange={(e) => setCheckinNote(e.target.value)}
            placeholder="请输入签入说明（选填）..."
            rows={4}
          />
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="secondary" size="sm" onClick={() => setShowCheckinModal(false)}>取消</Button>
            <Button variant="success" size="sm" onClick={async () => {
              if (!doc) return;
              await doAction(() => documentsApi.checkin(doc.id, checkinNote || undefined), '签入成功');
              setShowCheckinModal(false);
              setCheckinNote('');
            }}>确认签入</Button>
          </div>
        </Modal>
      )}

      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
        />
      )}
      {wuConfig && (
        <ConfigItemDetailModal open={!!wuConfig} revisionId={wuConfig} onClose={() => setWuConfig(null)} />
      )}
      {wuPart && (
        <PartDetailModal open={!!wuPart} masterId={wuPart.masterId} revisionId={wuPart.revisionId}
          onClose={() => setWuPart(null)} />
      )}
      {wuTask && (
        <TaskEditModal open={!!wuTask} projectId={wuTask.projectId} task={wuTask.task} parentId={null}
          onClose={() => setWuTask(null)} onSaved={() => {}} onRefresh={() => {}} />
      )}
      {wuEco && (
        <ECODetailModal ecoId={wuEco} onClose={() => setWuEco(null)} onRefresh={() => {}} />
      )}
      {wuEcr && (
        <ECRDetailModal open={!!wuEcr} ecrId={wuEcr} onClose={() => setWuEcr(null)} onSuccess={() => {}} />
      )}
    </Modal>
  );
}

function InfoCard({ label, readonly, children }: { label: string; readonly: boolean; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
