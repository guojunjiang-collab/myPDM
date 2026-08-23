import { useState, useEffect, useCallback, useRef } from 'react';
import { componentAttachmentsApi, mediaApi, v2UploadApi, CHUNK_THRESHOLD, CHUNK_SIZE } from '../services/api';
import type { ComponentAttachment } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import ArchiveTreeModal from './ArchiveTreeModal';
import Button from './ui/Button';
import { ConfirmModal } from './Modal';
import { toast } from './Toast';

interface Props {
  componentId: string;
  category: 'cad' | 'production';
  label: string;
  editable: boolean;
  hideWhenEmpty?: boolean;
}

const fmtSize = (n: number | null) =>
  n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function ComponentAttachmentBucket({ componentId, category, label, editable, hideWhenEmpty }: Props) {
  const [items, setItems] = useState<ComponentAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [progress, setProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await componentAttachmentsApi.list(componentId, category);
      setItems(res.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [componentId, category]);

  useEffect(() => { load(); }, [load]);

  const uploadLarge = async (file: File) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const init = await v2UploadApi.initChunkedUpload(file.name, file.size, 'components', componentId, category);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      await v2UploadApi.uploadChunk(init.upload_id, i, file.slice(start, Math.min(start + CHUNK_SIZE, file.size)));
      setProgress(Math.round(5 + ((i + 1) / totalChunks) * 90));
    }
    await v2UploadApi.completeChunkedUpload(init.upload_id);
    setProgress(100);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_ALLOWED = 1073741824;
    if (file.size > MAX_ALLOWED) { toast.error('文件大小超过系统限制 1GB'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setUploading(true); setUploadName(file.name); setProgress(0);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadLarge(file);
      } else {
        await v2UploadApi.uploadSmallFile(file, 'components', componentId, (p) => setProgress(p), category);
      }
      await load();
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploading(false); setUploadName(''); setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 删除附件确认（状态驱动 ConfirmModal）
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleDelete = (attId: string) => setConfirmDeleteId(attId);

  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, { onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }) });
  };

  const handleDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName || 'download';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { toast.error('下载失败，请重试'); }
  };

  if (hideWhenEmpty && !loading && !uploading && items.length === 0) return null;

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">{label}</h4>
        {editable && !uploading && (
          <>
            <Button size="sm" type="button" onClick={() => fileInputRef.current?.click()}>+ 上传附件</Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
          </>
        )}
      </div>

      {uploading && (
        <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-blue-700">正在上传 "{uploadName}"</span>
            <span className="text-blue-600 font-medium">{progress}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
        ) : items.length === 0 && !uploading ? (
          <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无附件</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--ui-bg-subtle)] border-b">
              <tr>
                <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">文件名</th>
                <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-24">大小</th>
                <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((att) => (
                <tr key={att.id} className="hover:bg-[var(--ui-bg-hover)]">
                  <td className="px-3 py-2"><span className="text-primary-600">{att.file_name}</span></td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{fmtSize(att.file_size)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <Button variant="link" size="xs" type="button" onClick={() => handlePreview(att.id, att.file_name)}>预览</Button>
                      <Button variant="link" size="xs" type="button" onClick={() => handleDownload(att.id, att.file_name)}>下载</Button>
                      {editable && (
                        <Button variant="danger" size="xs" type="button" onClick={() => handleDelete(att.id)} disabled={deletingId === att.id}>
                          {deletingId === att.id ? '删除中...' : '删除'}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {archivePreview && (
        <ArchiveTreeModal open={!!archivePreview} onClose={() => setArchivePreview(null)} attachmentId={archivePreview.attId} fileName={archivePreview.fileName} />
      )}

      {/* 删除附件确认 */}
      <ConfirmModal
        open={!!confirmDeleteId}
        title="确认删除"
        content="确定要删除该附件吗？"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={async () => {
          if (!confirmDeleteId) return;
          setDeletingId(confirmDeleteId);
          try { await componentAttachmentsApi.remove(componentId, confirmDeleteId); await load(); }
          catch { toast.error('删除失败，请重试'); }
          finally { setDeletingId(null); setConfirmDeleteId(null); }
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
