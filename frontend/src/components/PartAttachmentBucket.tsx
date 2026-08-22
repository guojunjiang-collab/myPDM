import { useState, useEffect, useCallback, useRef } from 'react';
import api, { partsApi, v2UploadApi, CHUNK_SIZE, CHUNK_THRESHOLD } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import ArchiveTreeModal from './ArchiveTreeModal';
import Button from './ui/Button';

interface PartAttachmentItem {
  id: string;
  iteration_id: string;
  category: string;
  file_name: string;
  file_size: number | null;
  file_path: string;
  file_hash: string;
  created_at: string | null;
}

interface Props {
  revisionId: string;
  iterationId?: string | null;
  category: 'cad' | 'production';
  label: string;
  editable: boolean;
  hideWhenEmpty?: boolean;
  showDownloadAll?: boolean;
}

const fmtSize = (n: number | null) =>
  n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function PartAttachmentBucket({ revisionId, iterationId, category, label, editable, hideWhenEmpty, showDownloadAll }: Props) {
  const [items, setItems] = useState<PartAttachmentItem[]>([]);
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
      const res = await partsApi.listAttachments(revisionId, category, iterationId || undefined);
      setItems(Array.isArray(res) ? res : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [revisionId, category, iterationId]);

  useEffect(() => { load(); }, [load]);

  const uploadLarge = async (file: File) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const init = await v2UploadApi.initPartAttachmentChunk(revisionId, file.name, file.size, category);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      await v2UploadApi.uploadChunk(init.upload_id, i, file.slice(start, Math.min(start + CHUNK_SIZE, file.size)));
      setProgress(Math.round(5 + ((i + 1) / totalChunks) * 90));
    }
    await v2UploadApi.completePartAttachmentChunk(revisionId, init.upload_id);
    setProgress(100);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_ALLOWED = 1073741824;
    if (file.size > MAX_ALLOWED) { alert('文件大小超过系统限制 1GB'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setUploading(true); setUploadName(file.name); setProgress(0);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadLarge(file);
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('category', category);
        await api.post(`/parts/revisions/${revisionId}/attachments`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      await load();
    } catch {
      alert('上传失败，请重试');
    } finally {
      setUploading(false); setUploadName(''); setProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (attId: string) => {
    if (!confirm('确定要删除该附件吗？')) return;
    setDeletingId(attId);
    try { await partsApi.deleteAttachment(revisionId, attId); await load(); }
    catch { alert('删除失败，请重试'); }
    finally { setDeletingId(null); }
  };

  const handlePreview = (att: PartAttachmentItem) => {
    previewAttachment(att.id, att.file_name, { onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }) });
  };

  const handleDownload = async (att: PartAttachmentItem) => {
    try {
      const blob = await partsApi.downloadPartAttachmentBlob(att.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.file_name || 'download';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert('下载失败，请重试'); }
  };

  const [downloadingAll, setDownloadingAll] = useState(false);
  const handleDownloadAll = async () => {
    const anyWindow = window as any;
    // 优先让用户选择保存文件夹（File System Access API，Chrome/Edge 支持）
    let dirHandle: any = null;
    if (anyWindow.showDirectoryPicker) {
      try {
        dirHandle = await anyWindow.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // 用户取消选择文件夹
      }
    }
    setDownloadingAll(true);
    try {
      const data = await partsApi.listBomAttachments(revisionId, category);
      if (dirHandle) {
        // 写入用户选定的文件夹；平铺，同名跳过
        let ok = 0, skip = 0;
        for (const it of data.items) {
          try {
            let exists = false;
            try { await dirHandle.getFileHandle(it.file_name); exists = true; } catch { /* 不存在 */ }
            if (exists) { skip++; continue; }
            const blob = await partsApi.downloadPartAttachmentBlob(it.attachment_id);
            const fh = await dirHandle.getFileHandle(it.file_name, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            ok++;
          } catch { /* 单个失败跳过 */ }
        }
        alert(`已保存 ${ok} 个${label}到所选文件夹${skip ? `，跳过同名 ${skip} 个` : ''}`);
      } else {
        // 回退：浏览器逐个下载到默认目录（Firefox/Safari 等不支持文件夹选择）
        for (const it of data.items) {
          try {
            const blob = await partsApi.downloadPartAttachmentBlob(it.attachment_id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = it.file_name || 'download';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            await new Promise((r) => setTimeout(r, 250));
          } catch { /* 单个失败跳过 */ }
        }
      }
    } catch (e: any) {
      if (e?.response?.status === 404) alert(`该部件及子项没有可下载的${label}`);
      else alert('获取附件清单失败，请重试');
    } finally {
      setDownloadingAll(false);
    }
  };

  if (hideWhenEmpty && !loading && !uploading && items.length === 0) return null;

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">{label}</h4>
        <div className="flex items-center gap-2">
          {showDownloadAll && (
            <Button size="sm" type="button" onClick={handleDownloadAll} disabled={downloadingAll}
              title={`下载本部件及全部子项的${label}`}>
              {downloadingAll ? '下载中...' : '一键下载(含子项)'}
            </Button>
          )}
          {editable && !uploading && (
            <>
              <Button size="sm" type="button" onClick={() => fileInputRef.current?.click()}>+ 上传附件</Button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
            </>
          )}
        </div>
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
          <div className="px-4 py-6 text-center text-sm text-gray-400">加载中...</div>
        ) : items.length === 0 && !uploading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">暂无附件</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">文件名</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">大小</th>
                <th className="px-3 py-2 text-center text-gray-500 font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((att) => (
                <tr key={att.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><span className="text-primary-600">{att.file_name}</span></td>
                  <td className="px-3 py-2 text-gray-500">{fmtSize(att.file_size)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <Button variant="link" size="xs" type="button" onClick={() => handlePreview(att)}>预览</Button>
                      <Button variant="link" size="xs" type="button" onClick={() => handleDownload(att)}>下载</Button>
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
    </div>
  );
}
