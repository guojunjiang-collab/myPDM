import { useState, useEffect } from 'react';
import type { Document, CustomFieldDefinition, DocumentAttachment } from '../types';
import { documentsApi, mediaApi } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import { toast } from './Toast';
import { formatDateTime } from '../utils/date';
import Badge from './ui/Badge';

interface DocumentDetailContentProps {
  doc: Document;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, any>;
  onArchivePreview?: (attId: string, fileName: string) => void;
  accessible?: boolean;
  groupNames?: string[];
}

/** 文件大小格式化 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function DocumentDetailContent({ doc, customFieldDefs, customFieldValues, onArchivePreview, accessible, groupNames }: DocumentDetailContentProps) {
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);

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
  const handleDownload = async (attId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(attId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${attId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        toast.error('无权限访问该附件');
      } else {
        toast.error('下载失败，请重试');
      }
    }
  };

  // 预览附件（统一分发）
  const handlePreview = (attId: string, fileName: string) => {
    previewAttachment(attId, fileName, {
      onArchive: (id, name) => onArchivePreview?.(id, name),
    });
  };

  return (
    <div className="space-y-4">
      {/* 基本属性 - 卡片式 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoItem label="图文档编号" value={doc.code} />
        <InfoItem label="图文档名称" value={doc.name} />
        <InfoItem label="版本" value={doc.version || '-'} />
        <StatusItem label="状态" status={doc.status} />
        <InfoItem label="备注" value={doc.remark || '-'} className="col-span-2 md:col-span-2" />
        <InfoItem label="创建人" value={doc.creator_name || '-'} />
        <InfoItem label="创建时间" value={formatDateTime(doc.created_at)} />
        <InfoItem label="更新时间" value={formatDateTime(doc.updated_at)} />
        {groupNames && groupNames.length > 0 && (
          <InfoItem label="关联用户组" value={groupNames.join('、')} className="col-span-2 md:col-span-2" />
        )}
      </div>

      {/* 自定义字段 - 卡片式 */}
      {customFieldDefs.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">自定义字段</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {customFieldDefs.map(def => (
              <InfoItem
                key={def.id}
                label={def.name}
                value={String(
                  def.field_type === 'select'
                    ? (def.options || []).find(o => o === customFieldValues[def.id]) || customFieldValues[def.id] || '-'
                    : customFieldValues[def.id] ?? '-'
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* 附件区域 - 只显示、预览、下载，无上传/删除 */}
      <div className="border-t pt-4">
        <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">附件</h4>

        {loadingAttachments ? (
          <div className="text-sm text-[var(--ui-text-secondary)]">加载中...</div>
        ) : attachments.length === 0 ? (
          <div className="text-sm text-[var(--ui-text-tertiary)] py-4 text-center border border-dashed border-gray-300 rounded-lg">
            暂无附件
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ui-bg-subtle)] border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">文件名</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-24">大小</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-40">上传时间</th>
                  <th className="px-3 py-2 text-right text-[var(--ui-text-secondary)] font-medium w-32">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {attachments.map(att => (
                  <tr key={att.id} className="hover:bg-[var(--ui-bg-hover)]">
                    <td className="px-3 py-2">
                      <span className="text-primary-600">{att.file_name}</span>
                    </td>
                    <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{formatFileSize(att.file_size || 0)}</td>
                    <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{formatDateTime(att.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  {(doc as any).accessible === false ? (
                    <span className="inline-flex items-center gap-1 text-[var(--ui-text-tertiary)]" title="无权限：需关联用户组成员">
                      🔒 <button className="text-gray-300 cursor-not-allowed" disabled>预览</button> <button className="text-gray-300 cursor-not-allowed" disabled>下载</button>
                    </span>
                  ) : (
                    <>
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
                    </>
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
  );
}

function InfoItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)] ${className || ''}`}>
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <Badge status={status} />
    </div>
  );
}
