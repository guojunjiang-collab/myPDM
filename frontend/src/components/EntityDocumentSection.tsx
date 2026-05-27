import { useState, useEffect, useCallback } from 'react';
import { entityDocumentsApi, customFieldsApi, attachmentApi, documentsApi } from '../services/api';
import type { EntityDocument, CustomFieldDefinition, CustomFieldValue, Document } from '../types';
import { canEdit, useAuthStore } from '../stores/auth';
import { useDataStore } from '../stores/data';
import { Modal } from './Modal';
import DocumentPicker from './DocumentPicker';
import DocumentDetailContent from './DocumentDetailContent';
import VersionSelectModal from './VersionSelectModal';
import ArchiveTreeModal from './ArchiveTreeModal';

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */

interface EntityDocumentSectionProps {
  entityType: 'part' | 'assembly' | 'configuration';
  entityId: string;
  editable: boolean;
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */

const statusTag = (s: string) => {
  const map: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800',
    frozen: 'bg-orange-100 text-orange-800',
    released: 'bg-green-100 text-green-800',
    obsolete: 'bg-red-100 text-red-800',
  };
  return map[s] || 'bg-gray-100 text-gray-800';
};

const statusLabel = (s: string) => {
  const map: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  return map[s] || s;
};

/** 渲染单个自定义字段值 */
const renderFieldValue = (v: unknown) => {
  if (v === undefined || v === null || v === '') return <span className="text-gray-300">-</span>;
  if (Array.isArray(v)) return v.length > 0 ? String(v.join(',')) : <span className="text-gray-300">-</span>;
  return String(v);
};

/* ----------------------------------------------------------------
   Component
   ---------------------------------------------------------------- */

export default function EntityDocumentSection({ entityType, entityId, editable }: EntityDocumentSectionProps) {
  const [docs, setDocs] = useState<EntityDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* 自定义字段 */
  const [docFieldDefs, setDocFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [docFieldValues, setDocFieldValues] = useState<Record<string, Record<string, unknown>>>({});

  /* 图文档详情弹窗 */
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [viewDocCustomDefs, setViewDocCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewDocCustomValues, setViewDocCustomValues] = useState<Record<string, any>>({});
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await entityDocumentsApi.list(entityType, entityId);
      setDocs(res.data || []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  /* 加载自定义字段定义和值 */
  useEffect(() => {
    if (docs.length === 0) return;
    const allDefs = useDataStore.getState().customFieldDefs;
    const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
    setDocFieldDefs(defs);

    if (defs.length > 0) {
      Promise.all(
        docs.map(async (ed) => {
          try {
            const res = await customFieldsApi.getValues('document', ed.document_id);
            const vals: Record<string, unknown> = {};
            (res.data || []).forEach((v: CustomFieldValue) => {
              vals[v.field_id] = v.value;
            });
            return { id: ed.document_id, vals };
          } catch {
            return { id: ed.document_id, vals: {} };
          }
        }),
      ).then((results) => {
        const all: Record<string, Record<string, unknown>> = {};
        for (const r of results) all[r.id] = r.vals;
        setDocFieldValues(all);
      });
    }
  }, [docs]);

  /* 操作 */
  const handleAddDocs = async (items: { document_id: string }[]) => {
    try {
      for (const it of items) {
        await entityDocumentsApi.add(entityType, entityId, { document_id: it.document_id });
      }
      await load();
      setPickerOpen(false);
    } catch {
      alert('关联图文档失败');
    }
  };

  const handleRemove = async (edocId: string) => {
    try {
      await entityDocumentsApi.remove(entityType, entityId, edocId);
      await load();
    } catch {
      alert('移除关联失败');
    }
  };

  /** 版本选择 */
  const [versionSelectState, setVersionSelectState] = useState<{ edocId: string; documentId: string; docCode: string } | null>(null);

  const handleVersionSelect = async (selectedVersionId: string) => {
    if (!versionSelectState) return;
    try {
      await entityDocumentsApi.remove(entityType, entityId, versionSelectState.edocId);
      await entityDocumentsApi.add(entityType, entityId, { document_id: selectedVersionId });
      await load();
    } catch {
      alert('切换版本失败');
    } finally {
      setVersionSelectState(null);
    }
  };

  const handleDownload = (fileId: string, fileName: string) => {
    const token = useAuthStore.getState().token;
    if (!token) {
      alert('登录已过期，请重新登录');
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/v2/attachments/${fileId}/direct-download?token=${encodeURIComponent(token)}`;
    a.download = fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePreviewAttachment = (fileId: string, fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const token = useAuthStore.getState().token;
    if (!token) { alert('登录已过期，请重新登录'); return; }

    // PDF — 浏览器内嵌预览
    if (ext === 'pdf') {
      window.open(`/api/v2/attachments/${fileId}/preview?token=${encodeURIComponent(token)}`, '_blank');
      return;
    }
    // 压缩包 — 树形预览
    if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) {
      setArchivePreview({ attId: fileId, fileName });
      return;
    }
    // STP — 三维预览（新窗口）
    if (ext === 'stp' || ext === 'step') {
      const token = useAuthStore.getState().token;
      if (token) {
        window.open(`/stp-viewer?id=${fileId}&token=${encodeURIComponent(token)}`, '_blank');
      }
      return;
    }
    alert('该格式暂不支持预览');
  };

  /** 查看图文档详情 */
  const handleViewDocument = async (ed: EntityDocument) => {
    try {
      const res = await documentsApi.get(ed.document_id);
      setViewDoc(res.data as Document);
    } catch {
      // fallback: use the data from the entity document record
      setViewDoc(ed.document as Document);
    }
    const allDefs = useDataStore.getState().customFieldDefs;
    const docDefs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
    setViewDocCustomDefs(docDefs);
    // Use already-loaded custom field values if available
    if (docFieldValues[ed.document_id]) {
      setViewDocCustomValues(docFieldValues[ed.document_id] as Record<string, any>);
    } else {
      try {
        const res = await customFieldsApi.getValues('document', ed.document_id);
        const values: Record<string, any> = {};
        (res.data || []).forEach((v: CustomFieldValue) => { values[v.field_id] = v.value; });
        setViewDocCustomValues(values);
      } catch { setViewDocCustomValues({}); }
    }
  };

  const existingDocIds = new Set(docs.map((d) => d.document_id));

  /* 固定列 + 动态自定义字段列 */
  const hasEditableAction = editable && canEdit();

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-bold text-gray-700">关联图文档</h4>
        {hasEditableAction && (
          <button type="button" onClick={() => setPickerOpen(true)} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">
            + 关联图文档
          </button>
        )}
      </div>

      <div className="border rounded-lg overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">加载中...</div>
        ) : docs.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">暂无关联图文档</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档编号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                  {/* 动态自定义字段列 */}
                  {docFieldDefs.map((def) => (
                    <th key={def.id} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">
                      {def.name}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                  <th className="px-3 py-2 text-center text-gray-500 font-medium w-20">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((ed) => {
                  const vals = docFieldValues[ed.document_id] || {};
                  return (
                    <tr key={ed.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleViewDocument(ed)}>
                      <td className="px-3 py-2 font-medium">{ed.document.code}</td>
                      <td className="px-3 py-2">{ed.document.name}</td>
                      <td className="px-3 py-2 text-gray-500">{ed.document.version}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(ed.document.status)}`}>
                          {statusLabel(ed.document.status)}
                        </span>
                      </td>
                      {/* 动态自定义字段值 */}
                      {docFieldDefs.map((def) => (
                        <td key={def.id} className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {renderFieldValue(vals[def.id])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-gray-600">
                        {ed.document.file_id && ed.document.file_name ? (
                          <span className="text-xs">{ed.document.file_name}</span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          {hasEditableAction ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setVersionSelectState({ edocId: ed.id, documentId: ed.document_id, docCode: ed.document.code }); }}
                                className="text-primary-600 hover:text-primary-800 text-xs"
                                title="选择版本"
                              >
                                选择
                              </button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); handleRemove(ed.id); }} className="text-red-500 hover:text-red-700 text-xs" title="移除关联">移除</button>
                            </>
                          ) : (
                            ed.document.file_id && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handlePreviewAttachment(ed.document.file_id!, ed.document.file_name!); }}
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                  title="预览"
                                >
                                  预览
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleDownload(ed.document.file_id!, ed.document.file_name!); }}
                                  className="text-primary-600 hover:text-primary-800 text-xs"
                                  title={`下载 ${ed.document.file_name}`}
                                >
                                  下载
                                </button>
                              </>
                            )
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocumentPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handleAddDocs}
        existingDocIds={existingDocIds}
        docFieldDefs={docFieldDefs}
        docFieldValues={docFieldValues}
      />

      {/* 图文档详情弹窗 */}
      <Modal open={!!viewDoc} title="图文档详情" onClose={() => setViewDoc(null)} width="full" zIndex={60}>
        {viewDoc && (
          <DocumentDetailContent
            doc={viewDoc}
            customFieldDefs={viewDocCustomDefs}
            customFieldValues={viewDocCustomValues}
            onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}
          />
        )}
      </Modal>

      {/* 版本选择弹窗 */}
      <VersionSelectModal
        open={!!versionSelectState}
        entityType="document"
        entityId={versionSelectState?.documentId || ''}
        entityName={versionSelectState?.docCode}
        currentVersionId={versionSelectState?.documentId}
        onSelect={handleVersionSelect}
        onClose={() => setVersionSelectState(null)}
      />

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
