import { useState, useEffect, useCallback, useRef } from 'react';
import api, { partsApi, mediaApi } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import ArchiveTreeModal from './ArchiveTreeModal';

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
  category: 'cad' | 'production';
  label: string;
  editable: boolean;
  hideWhenEmpty?: boolean;
}

const fmtSize = (n: number | null) =>
  n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function PartAttachmentBucket({ revisionId, category, label, editable, hideWhenEmpty }: Props) {
  const [items, setItems] = useState<PartAttachmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await partsApi.listAttachments(revisionId, category);
      setItems(Array.isArray(res) ? res : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [revisionId, category]);

  useEffect(() => { load(); }, [load]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_ALLOWED = 1073741824;
    if (file.size > MAX_ALLOWED) { alert('文件大小超过系统限制 1GB'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setUploading(true); setUploadName(file.name);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);
      await api.post(`/parts/revisions/${revisionId}/attachments`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
    } catch {
      alert('上传失败，请重试');
    } finally {
      setUploading(false); setUploadName('');
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
      const mt = await mediaApi.token(att.id, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${att.id}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = att.file_name || 'download';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { alert('下载失败，请重试'); }
  };

  const [downloadingAll, setDownloadingAll] = useState(false);
  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const data = await partsApi.listBomAttachments(revisionId, category);
      for (const it of data.items) {
        try {
          const mt = await mediaApi.token(it.attachment_id, 'direct-download');
          const a = document.createElement('a');
          a.href = `/api/v2/attachments/${it.attachment_id}/direct-download?token=${encodeURIComponent(mt)}`;
          a.download = it.file_name || 'download';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          await new Promise((r) => setTimeout(r, 250)); // 间隔触发，避免浏览器合并/丢弃
        } catch { /* 单个失败跳过，继续其余 */ }
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
          <button type="button" onClick={handleDownloadAll} disabled={downloadingAll}
            title={`下载本部件及全部子项的${label}`}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
            {downloadingAll ? '下载中...' : '一键下载(含子项)'}
          </button>
          {editable && !uploading && (
            <>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 上传附件</button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
            </>
          )}
        </div>
      </div>

      {uploading && (
        <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <span className="text-blue-700">正在上传 "{uploadName}"</span>
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
                      <button type="button" onClick={() => handlePreview(att)} className="text-blue-600 hover:text-blue-800 text-xs">预览</button>
                      <button type="button" onClick={() => handleDownload(att)} className="text-primary-600 hover:text-primary-800 text-xs">下载</button>
                      {editable && (
                        <button type="button" onClick={() => handleDelete(att.id)} disabled={deletingId === att.id} className="text-red-500 hover:text-red-700 disabled:opacity-50 text-xs">
                          {deletingId === att.id ? '删除中...' : '删除'}
                        </button>
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
