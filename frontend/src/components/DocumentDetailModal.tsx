import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { Loading } from './Loading';
import { toast } from './Toast';
import { useAuthStore, isAdmin } from '../stores/auth';
import { documentsApi, customFieldsApi, mediaApi, v2UploadApi, CHUNK_SIZE, CHUNK_THRESHOLD } from '../services/api';
import CustomFieldInput from './CustomFieldInput';
import { previewAttachment } from '../utils/attachmentPreview';
import { formatDateTime } from '../utils/date';
import type { Document, DocumentIteration, DocumentAttachment, CustomFieldDefinition } from '../types';

interface Props {
  open: boolean;
  docId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const statusTag = (s: string) => {
  const tags: Record<string, { label: string; class: string }> = {
    draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', class: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
  };
  return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
};

type TabKey = 'info' | 'versions' | 'iterations';

export default function DocumentDetailModal({ open, docId, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('info');
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [iterations, setIterations] = useState<DocumentIteration[]>([]);
  const [versions, setVersions] = useState<Document[]>([]);
  // 自定义字段定义与值
  const [cfDefs, setCfDefs] = useState<CustomFieldDefinition[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, any>>({});
  // 当前正在查看的迭代 id（null=查看当前最新迭代）
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  // 当前正在查看的版本 id（null=查看 prop 传入的当前版本）
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  // 切换版本时显示的附件迭代过滤器（不与 viewingIterationId 互锁）
  const [editForm, setEditForm] = useState({ code: '', name: '', remark: '' });
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinNote, setCheckinNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const isCheckedOut = !!doc?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && doc?.check_out_user_id === user?.id;
  const isDraft = doc?.status === 'draft';

  // 实际加载/展示的文档 id：viewingVersionId 优先，否则用 prop 传入的 docId
  const effectiveDocId = viewingVersionId || docId;
  // 是否在查看历史版本（不是打开时传入的那个版本）
  const isViewingOtherVersion = !!viewingVersionId && viewingVersionId !== docId;
  // 当前版本 id（即 prop 传入的 docId）
  const currentVersionId = docId;

  const canEdit = isCheckedOutByMe && isDraft && !isViewingOtherVersion;
  const canCheckout = isDraft && !isCheckedOut && !isViewingOtherVersion;
  const canCheckin = isDraft && isCheckedOutByMe && !isViewingOtherVersion;
  const canUndo = isDraft && isCheckedOutByMe && (doc?.latest_iteration || 0) > 1 && !isViewingOtherVersion;
  const canForceCheckin = isCheckedOut && isAdmin() && !isViewingOtherVersion;

  const loadDoc = useCallback(async () => {
    if (!effectiveDocId) return;
    setLoading(true);
    try {
      const res = await documentsApi.get(effectiveDocId);
      const d = (res.data ?? res) as Document;
      setDoc(d);
      setEditForm({ code: d.code || '', name: d.name || '', remark: d.remark || '' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [effectiveDocId]);

  const loadAttachments = useCallback(async () => {
    if (!effectiveDocId) return;
    try {
      const res = await documentsApi.listAttachments(effectiveDocId, viewingIterationId || undefined);
      setAttachments((res.data || []) as DocumentAttachment[]);
    } catch {
      setAttachments([]);
    }
  }, [effectiveDocId, viewingIterationId]);

  const loadIterations = useCallback(async () => {
    if (!effectiveDocId) return;
    try {
      const res = await documentsApi.iterations(effectiveDocId);
      setIterations((res.data || []) as DocumentIteration[]);
    } catch {
      setIterations([]);
    }
  }, [effectiveDocId]);

  const loadVersions = useCallback(async () => {
    if (!effectiveDocId) return;
    try {
      const res = await documentsApi.versions(effectiveDocId);
      setVersions((res.data || []) as Document[]);
    } catch {
      setVersions([]);
    }
  }, [effectiveDocId]);

  // 加载文档适用的自定义字段定义 + 当前文档的字段值
  const loadCustomFields = useCallback(async () => {
    if (!effectiveDocId) return;
    try {
      const defsRes = await customFieldsApi.listDefinitions();
      const defs: CustomFieldDefinition[] = ((defsRes.data || defsRes || []) as CustomFieldDefinition[]).filter(
        (d) => d.applies_to?.includes('document')
      );
      setCfDefs(defs);
      const valsRes = await customFieldsApi.getValues('document', effectiveDocId);
      const map: Record<string, any> = {};
      ((valsRes.data || []) as any[]).forEach((v: any) => {
        map[v.field_id] = v.value;
      });
      setCfValues(map);
    } catch (e) {
      console.error(e);
    }
  }, [effectiveDocId]);

  // 当前迭代 id：未签入的迭代（最新且无 check_in_date）；若都已签入则取 iteration 最大的
  const currentIterationId = useMemo(() => {
    const ongoing = iterations.find((it) => !it.check_in_date);
    if (ongoing) return ongoing.id;
    if (iterations.length === 0) return null;
    return iterations.reduce((max, it) => (it.iteration > max.iteration ? it : max)).id;
  }, [iterations]);

  // 查看的迭代对象
  const viewingIteration = useMemo(
    () => iterations.find((it) => it.id === viewingIterationId) ?? null,
    [iterations, viewingIterationId]
  );
  const isViewingHistorical = !!viewingIterationId;

  useEffect(() => {
    if (open && docId) {
      setViewingIterationId(null);
      setViewingVersionId(null);
      loadDoc();
      loadAttachments();
      loadIterations();
      loadVersions();
      loadCustomFields();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId]);

  // 切换查看的迭代时重拉附件
  useEffect(() => {
    if (open && docId) {
      loadAttachments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingIterationId]);

  // 切换查看的版本时重拉所有数据，并清空迭代选择（不同版本的迭代不互通）
  useEffect(() => {
    if (open && docId) {
      setViewingIterationId(null);
      loadDoc();
      loadAttachments();
      loadIterations();
      loadCustomFields();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingVersionId]);

  // 防抖保存自定义字段
  const cfSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const debouncedCfSave = useCallback(
    (next: Record<string, any>) => {
      if (!effectiveDocId) return;
      if (cfSaveTimer.current) clearTimeout(cfSaveTimer.current);
      cfSaveTimer.current = setTimeout(async () => {
        try {
          const fieldValues = cfDefs.map((def) => ({
            field_id: def.id,
            value: next[def.id] ?? null,
          })).filter((fv) => fv.value !== null && fv.value !== '');
          await customFieldsApi.setValues('document', effectiveDocId, fieldValues);
          onSaved();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || '自定义字段保存失败');
        }
      }, 500);
    },
    [effectiveDocId, cfDefs, onSaved]
  );

  // 字段自动保存（防抖）
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoSave = useCallback(
    (patch: Partial<{ code: string; name: string; remark: string }>) => {
      if (!docId) return;
      const next = { ...editForm, ...patch };
      setEditForm(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await documentsApi.update(docId, patch);
          onSaved();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || '保存失败');
        }
      }, 600);
    },
    [docId, editForm, onSaved]
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

  const uploadLargeFile = async (file: File, docId: string, onProgress: (p: number) => void) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const initResult: any = await v2UploadApi.initChunkedUpload(file.name, file.size, 'documents', docId);
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
    if (!file || !docId) return;
    setUploading(true);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadLargeFile(file, docId, () => {});
      } else {
        await v2UploadApi.uploadSmallFile(file, 'documents', docId, () => {});
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
    if (!docId || !confirm('确定删除该附件？')) return;
    try {
      await documentsApi.deleteAttachment(docId, attId);
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
      { key: 'info' as const, label: '基本信息' },
      { key: 'versions' as const, label: '版本历史' },
      { key: 'iterations' as const, label: '迭代历史' },
    ],
    []
  );

  if (!open) return null;
  const tag = doc ? statusTag(doc.status) : { label: '', class: '' };

  return (
    <Modal open={open} title="图文档详情" onClose={onClose} width="full">
      <div className="min-h-[50vh] flex flex-col">
        {loading && !doc ? (
          <Loading />
        ) : !doc ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            {/* 顶部核心信息（不含版本/状态/更新时间 — 版本状态放入操作行，更新时间见版本/迭代历史） */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 mb-3">
              <Field label="图文档编号">
                {canEdit && doc.version === 'A' ? (
                  <input
                    value={editForm.code}
                    onChange={(e) => autoSave({ code: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <div className="text-sm text-gray-900 font-medium font-mono">{doc.code}</div>
                )}
              </Field>
              <Field label="名称">
                {canEdit ? (
                  <input
                    value={editForm.name}
                    onChange={(e) => autoSave({ name: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <div className="text-sm text-gray-900 font-medium">{doc.name}</div>
                )}
              </Field>
              <Field label="备注" className="col-span-2">
                {canEdit ? (
                  <input
                    value={editForm.remark}
                    onChange={(e) => autoSave({ remark: e.target.value })}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                ) : (
                  <div className="text-sm text-gray-900 font-medium whitespace-pre-wrap">
                    {doc.remark || '-'}
                  </div>
                )}
              </Field>
              <Field label="创建人">
                <div className="text-sm text-gray-900 font-medium">{doc.creator_name || '-'}</div>
              </Field>
            </div>

            {/* 中部操作区：版本/状态/签出状态 与 签入签出等按钮同一行（参考零部件详情） */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 mb-3 shrink-0">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold text-sm">版本：{doc.version || '-'}</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${tag.class}`}>{tag.label}</span>
                  {isCheckedOut ? (
                    <span className="text-xs text-orange-600">🔒 已签出：{doc.check_out_user_name || '未知'}</span>
                  ) : (
                    <span className="text-xs text-gray-400">未签出</span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                {canCheckout && (
                  <button
                    onClick={() => doAction(() => documentsApi.checkout(doc.id), '签出成功')}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                  >
                    签出
                  </button>
                )}
                {canCheckin && (
                  <button
                    onClick={() => setShowCheckinModal(true)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    签入
                  </button>
                )}
                {canUndo && (
                  <button
                    onClick={() => doAction(() => documentsApi.undocheckout(doc.id), '已撤销签出')}
                    className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-100"
                  >
                    撤销签出
                  </button>
                )}
                {canForceCheckin && (
                  <button
                    onClick={() => {
                      if (confirm('确定强制签入该文档？')) {
                        doAction(() => documentsApi.forceCheckin(doc.id), '已强制签入');
                      }
                    }}
                    className="px-3 py-1 text-sm border border-red-300 rounded text-red-600 hover:bg-red-50"
                  >
                    强制签入
                  </button>
                )}
                {isDraft && isCheckedOutByMe && !isViewingOtherVersion && (
                  <button
                    onClick={() => {
                      if (confirm('确定升版？')) doAction(() => documentsApi.upgrade(doc.id), '升版成功');
                    }}
                    className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-100"
                  >
                    升版
                  </button>
                )}
                </div>
              </div>
            </div>

            {/* 查看历史版本提示 */}
            {isViewingOtherVersion && doc && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5 shrink-0 mb-3 text-sm flex items-center justify-between">
                <span>正在查看版本 {doc.version}（只读）</span>
                <button
                  onClick={() => setViewingVersionId(null)}
                  className="text-primary-600 hover:text-primary-800 hover:underline text-xs"
                >
                  返回当前
                </button>
              </div>
            )}

            {/* 查看历史迭代提示 */}
            {isViewingHistorical && viewingIteration && !isViewingOtherVersion && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5 shrink-0 mb-3 text-sm flex items-center justify-between">
                <span>正在查看 Iteration #{viewingIteration.iteration} 历史数据（只读）</span>
                <button
                  onClick={() => setViewingIterationId(null)}
                  className="text-primary-600 hover:text-primary-800 hover:underline text-xs"
                >
                  返回当前
                </button>
              </div>
            )}

            {/* 底部 Tab */}
            <div className="border-b flex gap-1 shrink-0">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-sm -mb-px border-b-2 ${
                    activeTab === t.key
                      ? 'border-primary-600 text-primary-600 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto pt-3">
              {activeTab === 'info' && (
                <div className="space-y-5">
                  {/* 1. 自有字段（无标题） — 仅展示顶部/操作行未覆盖的字段（创建人、用户组） */}
                  <div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">创建人</div>
                        <div className="text-sm text-gray-900 font-medium">{doc.creator_name || '-'}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">用户组</div>
                        <div className="text-sm text-gray-900 font-medium break-all">
                          {(doc as any).group_names?.length ? (doc as any).group_names.join('、') : '-'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. 自定义字段 */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-gray-700">自定义字段</h4>
                    {cfDefs.length === 0 ? (
                      <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg py-3 text-center">无</div>
                    ) : (
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
                            <div key={def.id}>
                              <label className="text-xs text-gray-500">{def.name}</label>
                              <div className="mt-0.5">
                                <CustomFieldInput
                                  def={def}
                                  value={val}
                                  onChange={handleChange}
                                  readOnly={!canEdit || isViewingHistorical || isViewingOtherVersion}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 3. 附件 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-700">附件</h4>
                      {canEdit && !isViewingHistorical && !isViewingOtherVersion && (
                        <label className="inline-block px-3 py-1 text-sm bg-primary-600 text-white rounded cursor-pointer hover:bg-primary-700">
                          {uploading ? '上传中...' : '上传附件'}
                          <input
                            type="file"
                            className="hidden"
                            onChange={handleUpload}
                            disabled={uploading}
                          />
                        </label>
                      )}
                    </div>
                    {attachments.length === 0 ? (
                      <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
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
                                <td className="px-3 py-2 text-gray-500">
                                  {formatFileSize(att.file_size || 0)}
                                </td>
                                <td className="px-3 py-2 text-gray-500">{formatDateTime(att.created_at)}</td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() =>
                                      previewAttachment(att.id, att.file_name || 'preview', {
                                        onArchive: () => {},
                                      })
                                    }
                                    className="text-blue-600 hover:text-blue-800 mr-2"
                                  >
                                    预览
                                  </button>
                                  <button
                                    onClick={() => handleDownload(att.id, att.file_name || 'download')}
                                    className="text-primary-600 hover:text-primary-800 mr-2"
                                  >
                                    下载
                                  </button>
                                  {canEdit && !isViewingHistorical && (
                                    <button
                                      onClick={() => handleDeleteAtt(att.id)}
                                      className="text-red-600 hover:text-red-800"
                                    >
                                      删除
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {activeTab === 'versions' && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-44">更新时间</th>
                        <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {versions.map((v) => {
                        const isCurrent = v.id === currentVersionId;
                        const isViewing = v.id === viewingVersionId;
                        return (
                          <tr
                            key={v.id}
                            className={`hover:bg-gray-50 ${isViewing ? 'bg-blue-50' : ''}`}
                          >
                            <td className="px-3 py-2">{v.version}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(v.status).class}`}>
                                {statusTag(v.status).label}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{formatDateTime(v.updated_at)}</td>
                            <td className="px-3 py-2 text-right">
                              {isCurrent ? (
                                <span className="text-primary-600 text-xs">当前</span>
                              ) : (
                                <button
                                  onClick={() => setViewingVersionId(v.id)}
                                  className={`text-xs hover:underline ${
                                    isViewing ? 'text-orange-600' : 'text-primary-600 hover:text-primary-800'
                                  }`}
                                >
                                  {isViewing ? '查看中' : '切换'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {versions.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-gray-400">
                            暂无版本历史
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {activeTab === 'iterations' && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">迭代</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-44">签入时间</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">签入说明</th>
                        <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {iterations.map((it) => {
                        const isCurrent = it.id === currentIterationId;
                        const isViewing = it.id === viewingIterationId;
                        return (
                          <tr
                            key={it.id}
                            className={`hover:bg-gray-50 ${isViewing ? 'bg-blue-50' : ''}`}
                          >
                            <td className="px-3 py-2">#{it.iteration}</td>
                            <td className="px-3 py-2 text-gray-500">
                              {(it.check_in_date || it.created_at)
                                ? new Date(it.check_in_date || it.created_at as string).toLocaleString('zh-CN', { hour12: false })
                                : '-'}
                            </td>
                            <td className="px-3 py-2 text-gray-700">{it.check_in_note || '-'}</td>
                            <td className="px-3 py-2 text-right">
                              {isCurrent ? (
                                <span className="text-primary-600 text-xs">当前</span>
                              ) : (
                                <button
                                  onClick={() => setViewingIterationId(it.id)}
                                  className={`text-xs hover:underline ${
                                    isViewing ? 'text-orange-600' : 'text-primary-600 hover:text-primary-800'
                                  }`}
                                >
                                  {isViewing ? '查看中' : '查看数据'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {iterations.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-gray-400">
                            暂无迭代记录
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showCheckinModal && (
        <Modal
          open={showCheckinModal}
          title="签入说明"
          onClose={() => setShowCheckinModal(false)}
          width="md"
        >
          <textarea
            value={checkinNote}
            onChange={(e) => setCheckinNote(e.target.value)}
            placeholder="请输入签入说明（选填）..."
            rows={4}
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => setShowCheckinModal(false)}
              className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600"
            >
              取消
            </button>
            <button
              onClick={async () => {
                if (!doc) return;
                await doAction(
                  () => documentsApi.checkin(doc.id, checkinNote || undefined),
                  '签入成功'
                );
                setShowCheckinModal(false);
                setCheckinNote('');
              }}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
            >
              确认签入
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 ${className || ''}`}>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
