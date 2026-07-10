import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { Loading } from './Loading';
import { toast } from './Toast';
import { useAuthStore, isAdmin } from '../stores/auth';
import { documentsApi, mediaApi, v2UploadApi, CHUNK_SIZE, CHUNK_THRESHOLD } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import { formatDateTime } from '../utils/date';
import type { Document, DocumentIteration, DocumentAttachment } from '../types';

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

type TabKey = 'attachments' | 'versions' | 'iterations';

export default function DocumentDetailModal({ open, docId, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user);
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('attachments');
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [iterations, setIterations] = useState<DocumentIteration[]>([]);
  const [versions, setVersions] = useState<Document[]>([]);
  const [editForm, setEditForm] = useState({ code: '', name: '', remark: '' });
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [checkinNote, setCheckinNote] = useState('');
  const [uploading, setUploading] = useState(false);

  const isCheckedOut = !!doc?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && doc?.check_out_user_id === user?.id;
  const isDraft = doc?.status === 'draft';
  const canEdit = isCheckedOutByMe && isDraft;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (doc?.latest_iteration || 0) > 1;
  const canForceCheckin = isCheckedOut && isAdmin();

  const loadDoc = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const res = await documentsApi.get(docId);
      const d = (res.data ?? res) as Document;
      setDoc(d);
      setEditForm({ code: d.code || '', name: d.name || '', remark: d.remark || '' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  const loadAttachments = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await documentsApi.listAttachments(docId);
      setAttachments((res.data || []) as DocumentAttachment[]);
    } catch {
      setAttachments([]);
    }
  }, [docId]);

  const loadIterations = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await documentsApi.iterations(docId);
      setIterations((res.data || []) as DocumentIteration[]);
    } catch {
      setIterations([]);
    }
  }, [docId]);

  const loadVersions = useCallback(async () => {
    if (!docId) return;
    try {
      const res = await documentsApi.versions(docId);
      setVersions((res.data || []) as Document[]);
    } catch {
      setVersions([]);
    }
  }, [docId]);

  useEffect(() => {
    if (open && docId) {
      loadDoc();
      loadAttachments();
      loadIterations();
      loadVersions();
    }
  }, [open, docId, loadDoc, loadAttachments, loadIterations, loadVersions]);

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
      { key: 'attachments' as const, label: '附件' },
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
            {/* 顶部核心信息 */}
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
              <Field label="版本">
                <div className="text-sm text-gray-900 font-medium">{doc.version || '-'}</div>
              </Field>
              <Field label="状态">
                <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${tag.class}`}>{tag.label}</span>
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
              <Field label="更新时间">
                <div className="text-sm text-gray-900 font-medium">{formatDateTime(doc.updated_at)}</div>
              </Field>
            </div>

            {/* 中部操作区 */}
            <div className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-3 shrink-0">
              <div className="text-xs">
                {isCheckedOut ? (
                  <span className="text-orange-600">🔒 已签出：{doc.check_out_user_name || '未知'}</span>
                ) : (
                  <span className="text-gray-400">未签出</span>
                )}
              </div>
              <div className="flex gap-2">
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
                {isDraft && isCheckedOutByMe && (
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
              {activeTab === 'attachments' && (
                <div>
                  {canEdit && (
                    <div className="mb-2">
                      <label className="inline-block px-3 py-1 text-sm bg-primary-600 text-white rounded cursor-pointer hover:bg-primary-700">
                        {uploading ? '上传中...' : '上传附件'}
                        <input
                          type="file"
                          className="hidden"
                          onChange={handleUpload}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                  )}
                  {attachments.length === 0 ? (
                    <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
                      暂无附件
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
                                {canEdit && (
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
              )}
              {activeTab === 'versions' && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">版本</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">状态</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">更新时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {versions.map((v) => (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">{v.version}</td>
                          <td className="px-3 py-2">{statusTag(v.status).label}</td>
                          <td className="px-3 py-2 text-gray-500">{formatDateTime(v.updated_at)}</td>
                        </tr>
                      ))}
                      {versions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
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
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">迭代</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-40">签入时间</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">签入说明</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {iterations.map((it) => (
                        <tr key={it.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">#{it.iteration}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {it.check_in_date ? (
                              formatDateTime(it.check_in_date)
                            ) : (
                              <span className="text-orange-600">进行中</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{it.check_in_note || '-'}</td>
                          <td className="px-3 py-2 text-gray-500">
                            {(it.attachments || []).map((a) => a.file_name).join('、') || '-'}
                          </td>
                        </tr>
                      ))}
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
