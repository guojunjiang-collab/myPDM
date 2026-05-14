import { useState, useEffect } from 'react';
import type { Document, CustomFieldDefinition, DocumentAttachment } from '../types';
import { documentsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { formatDateTime } from '../utils/date';
import ArchiveTreeModal from './ArchiveTreeModal';

interface DocumentDetailContentProps {
  doc: Document;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, any>;
}

/** 文件大小格式化 */
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

export default function DocumentDetailContent({ doc, customFieldDefs, customFieldValues }: DocumentDetailContentProps) {
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);

  // 加载附件列表
  const loadAttachments = async () => {
    setLoadingAttachments(true);
    try {
      const res = await documentsApi.listAttachments(doc.id);
      setAttachments(res.data || []);
    } catch (error) {
      console.error('加载附件失败', error);
      setAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  };

  useEffect(() => {
    loadAttachments();
  }, [doc.id]);

  // 下载附件（直接流式下载，不阻塞界面）
  const handleDownload = (attId: string, fileName: string) => {
    const token = useAuthStore.getState().token;
    if (!token) {
      alert('登录已过期，请重新登录');
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(token)}`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 预览附件
  const handlePreview = (attId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const token = useAuthStore.getState().token;
    if (!token) { alert('登录已过期，请重新登录'); return; }

    // PDF — 浏览器内嵌预览
    if (ext === 'pdf') {
      window.open(`/api/v2/attachments/${attId}/preview?token=${encodeURIComponent(token)}`, '_blank');
      return;
    }
    // 压缩包 — 树形预览
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) {
      setArchivePreview({ attId, fileName });
      return;
    }
    // STP — 三维预览（新窗口）
    if (ext === 'stp' || ext === 'step') {
      window.open(`/stp-viewer?id=${attId}&token=${encodeURIComponent(token)}`, '_blank');
      return;
    }
    alert('该格式暂不支持预览');
  };

  return (
    <div className="space-y-4">
      {/* 基本属性 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">图文档编号</label>
          <div className="text-sm font-medium">{doc.code}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">图文档名称</label>
          <div className="text-sm">{doc.name}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
          <div className="text-sm">{doc.version || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
          <span className={`inline-block px-2 py-1 text-xs rounded-full ${statusTag(doc.status).class}`}>
            {statusTag(doc.status).label}
          </span>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
          <div className="text-sm">{doc.remark || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
          <div className="text-sm">{formatDateTime(doc.created_at)}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
          <div className="text-sm">{formatDateTime(doc.updated_at)}</div>
        </div>
      </div>

      {/* 自定义字段 */}
      {customFieldDefs.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
          <div className="grid grid-cols-2 gap-4">
            {customFieldDefs.map(def => (
              <div key={def.id}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{def.name}</label>
                <div className="text-sm">
                  {def.field_type === 'select'
                    ? (def.options || []).find(o => o === customFieldValues[def.id]) || customFieldValues[def.id] || '-'
                    : (customFieldValues[def.id] ?? '-')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 附件区域 - 只显示、预览、下载，无上传/删除 */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">附件</h4>

        {loadingAttachments ? (
          <div className="text-sm text-gray-500">加载中...</div>
        ) : attachments.length === 0 ? (
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
                  <th className="px-3 py-2 text-right text-gray-500 font-medium w-32">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attachments.map(att => (
                  <tr key={att.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span className="text-primary-600">{att.file_name}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{formatFileSize(att.file_size || 0)}</td>
                    <td className="px-3 py-2 text-gray-500">{formatDateTime(att.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handlePreview(att.id, att.file_name || 'preview')}
                        className="text-blue-600 hover:text-blue-800 mr-3"
                      >
                        预览
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(att.id, att.file_name || 'download')}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        下载
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
          token={useAuthStore.getState().token || ''}
        />
      )}
    </div>
  );
}