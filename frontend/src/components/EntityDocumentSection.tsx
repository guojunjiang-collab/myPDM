import { useState, useEffect, useCallback, useRef } from 'react';
import { entityDocumentsApi, customFieldsApi, documentsApi, mediaApi, v2UploadApi, CHUNK_THRESHOLD, CHUNK_SIZE } from '../services/api';
import { previewAttachment } from '../utils/attachmentPreview';
import type { EntityDocument, CustomFieldDefinition, CustomFieldValue, Document, DocumentAttachment } from '../types';
import { canEdit } from '../stores/auth';
import { useDataStore } from '../stores/data';
import { Modal } from './Modal';
import DocumentPicker from './DocumentPicker';
import VersionSelectModal from './VersionSelectModal';
import ArchiveTreeModal from './ArchiveTreeModal';
import DocumentDetailContent from './DocumentDetailContent';

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */

interface EntityDocumentSectionProps {
  entityType: 'part' | 'assembly' | 'component' | 'configuration';
  entityId: string;
  editable: boolean;
  entityCode?: string;
  entityName?: string;
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

export default function EntityDocumentSection({ entityType, entityId, editable, entityCode, entityName }: EntityDocumentSectionProps) {
  const [docs, setDocs] = useState<EntityDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* 自定义字段 */
  const [docFieldDefs, setDocFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [docFieldValues, setDocFieldValues] = useState<Record<string, Record<string, unknown>>>({});

  /* 图文档编辑弹窗 */
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [viewingDocDetail, setViewingDocDetail] = useState<Document | null>(null);
  const [viewingDocCustomDefs, setViewingDocCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingDocCustomValues, setViewingDocCustomValues] = useState<Record<string, any>>({});
  const [editFormData, setEditFormData] = useState<{ name: string; status: string; remark: string }>({ name: '', status: 'draft', remark: '' });
  const [editCustomDefs, setEditCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [editCustomValues, setEditCustomValues] = useState<Record<string, any>>({});
  const [editAttachments, setEditAttachments] = useState<DocumentAttachment[]>([]);
  const [editLoadingAttach, setEditLoadingAttach] = useState(false);
  const [editUploading, setEditUploading] = useState(false);
  const [editUploadFileName, setEditUploadFileName] = useState('');
  const [editUploadProgress, setEditUploadProgress] = useState(0);
  const [editDeletingAttId, setEditDeletingAttId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
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

  const handleDownload = async (fileId: string, fileName: string) => {
    try {
      const mt = await mediaApi.token(fileId, 'direct-download');
      const a = document.createElement('a');
      a.href = `/api/v2/attachments/${fileId}/direct-download?token=${encodeURIComponent(mt)}`;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      alert('下载失败，请重试');
    }
  };

  const handlePreviewAttachment = (fileId: string, fileName: string) => {
    previewAttachment(fileId, fileName, {
      onArchive: (id, name) => setArchivePreview({ attId: id, fileName: name }),
    });
  };

  /** 查看图文档详情 */
  const handleViewDocument = async (ed: EntityDocument) => {
    let doc: Document;
    try {
      const res = await documentsApi.get(ed.document_id);
      doc = res.data as Document;
    } catch {
      doc = ed.document as Document;
    }
    setViewingDocDetail(doc);
    const allDefs = useDataStore.getState().customFieldDefs;
    setViewingDocCustomDefs(allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document')));
    if (docFieldValues[ed.document_id]) {
      setViewingDocCustomValues(docFieldValues[ed.document_id] as Record<string, any>);
    } else {
      try {
        const res = await customFieldsApi.getValues('document', ed.document_id);
        const values: Record<string, any> = {};
        (res.data || []).forEach((v: CustomFieldValue) => { values[v.field_id] = v.value; });
        setViewingDocCustomValues(values);
      } catch { setViewingDocCustomValues({}); }
    }
  };

  /** 编辑图文档 */
  const handleEditDocument = async (ed: EntityDocument) => {
    let doc: Document;
    try {
      const res = await documentsApi.get(ed.document_id);
      doc = res.data as Document;
    } catch {
      doc = ed.document as Document;
    }
    setEditingDoc(doc);
    setEditFormData({ name: doc.name, status: doc.status, remark: doc.remark || '' });
    setEditCustomValues({});
    setEditAttachments([]);
    setEditSaveError(null);
    setEditUploading(false);
    setEditUploadFileName('');
    setEditUploadProgress(0);

    const allDefs = useDataStore.getState().customFieldDefs;
    const docDefs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
    setEditCustomDefs(docDefs);
    if (docFieldValues[ed.document_id]) {
      setEditCustomValues(docFieldValues[ed.document_id] as Record<string, any>);
    } else {
      try {
        const res = await customFieldsApi.getValues('document', ed.document_id);
        const values: Record<string, any> = {};
        (res.data || []).forEach((v: CustomFieldValue) => { values[v.field_id] = v.value; });
        setEditCustomValues(values);
      } catch { setEditCustomValues({}); }
    }
    loadEditAttachments(doc.id);
  };

  const loadEditAttachments = async (docId: string) => {
    setEditLoadingAttach(true);
    try {
      const res = await documentsApi.listAttachments(docId);
      setEditAttachments(res.data || []);
    } catch { setEditAttachments([]); }
    finally { setEditLoadingAttach(false); }
  };

  const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingDoc) return;
    const MAX_ALLOWED = 1073741824;
    if (file.size > MAX_ALLOWED) { alert(`文件大小超过系统限制 1GB`); if (editFileInputRef.current) editFileInputRef.current.value = ''; return; }
    setEditUploading(true); setEditUploadFileName(file.name); setEditUploadProgress(0);
    try {
      if (file.size > CHUNK_THRESHOLD) {
        await uploadEditLargeFile(file, editingDoc.id);
      } else {
        await v2UploadApi.uploadSmallFile(file, 'documents', editingDoc.id, (p) => setEditUploadProgress(p));
      }
      await loadEditAttachments(editingDoc.id);
    } catch { alert('上传失败，请重试'); }
    finally { setEditUploading(false); setEditUploadFileName(''); setEditUploadProgress(0); if (editFileInputRef.current) editFileInputRef.current.value = ''; }
  };

  const uploadEditLargeFile = async (file: File, docId: string) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const initResult = await v2UploadApi.initChunkedUpload(file.name, file.size, 'documents', docId);
    const uploadId = initResult.upload_id;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      await v2UploadApi.uploadChunk(uploadId, i, file.slice(start, end));
      setEditUploadProgress(Math.round(5 + ((i + 1) / totalChunks) * 90));
    }
    await v2UploadApi.completeChunkedUpload(uploadId);
    setEditUploadProgress(100);
  };

  const handleEditDeleteAttachment = async (attId: string) => {
    if (!editingDoc || !confirm('确定要删除该附件吗？')) return;
    setEditDeletingAttId(attId);
    try { await documentsApi.deleteAttachment(editingDoc.id, attId); await loadEditAttachments(editingDoc.id); }
    catch { alert('删除失败，请重试'); }
    finally { setEditDeletingAttId(null); }
  };

  const handleEditSave = async () => {
    if (!editingDoc) return;
    setEditSaving(true); setEditSaveError(null);
    try {
      const data = { name: editFormData.name, status: editFormData.status, remark: editFormData.remark || undefined };
      const res = await documentsApi.update(editingDoc.id, data);
      const updated = res.data as Document;
      useDataStore.getState().setDocuments(
        useDataStore.getState().documents.map(d => d.id === editingDoc.id ? updated : d)
      );
      const fieldValues = editCustomDefs.map(def => ({ field_id: def.id, value: editCustomValues[def.id] ?? null })).filter(fv => fv.value !== null && fv.value !== '');
      if (fieldValues.length > 0) { await customFieldsApi.setValues('document', editingDoc.id, fieldValues); }
      setEditingDoc(null);
      await load();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setEditSaveError(typeof detail === 'string' ? detail : '更新失败，请重试');
    } finally { setEditSaving(false); }
  };

  const handleEditUpgrade = async () => {
    if (!editingDoc) return;
    setEditSaving(true); setEditSaveError(null);
    try {
      const res = await documentsApi.upgrade(editingDoc.id);
      const newDoc = res.data;
      useDataStore.getState().setDocuments([...useDataStore.getState().documents, newDoc]);
      setEditingDoc(null);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setEditSaveError(typeof detail === 'string' ? detail : '升版失败，请重试');
    } finally { setEditSaving(false); }
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
                  const isAccessible = (ed.document as any).accessible !== false;
                  return (
                    <tr key={ed.id} className={`hover:bg-gray-50 cursor-pointer ${!isAccessible ? 'opacity-60' : ''}`} onClick={() => { if (hasEditableAction) { handleEditDocument(ed); } else { handleViewDocument(ed); } }}>
                      <td className="px-3 py-2 font-medium">
                        {!isAccessible && <span className="mr-1" title="无权限：需关联用户组成员">🔒</span>}
                        {ed.document.code}
                      </td>
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
                              isAccessible ? (
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
                              ) : (
                                <span className="text-gray-400 text-xs" title="无权限：需关联用户组成员">🔒 不可预览/下载</span>
                              )
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
        entityType={entityType}
        entityCode={entityCode}
        entityName={entityName}
      />

      {/* 图文档编辑弹窗 */}
      <Modal open={!!editingDoc} title="编辑图文档" onClose={() => setEditingDoc(null)} width="full" zIndex={60}>
        {editingDoc && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">编号</label>
                <input type="text" value={editingDoc.code} disabled className="w-full text-sm px-2 py-1 border border-gray-200 rounded disabled:bg-gray-100 disabled:text-gray-400" />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">名称 <span className="text-red-500">*</span></label>
                <input type="text" value={editFormData.name} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">版本</label>
                <input type="text" value={editingDoc.version || ''} disabled className="w-full text-sm px-2 py-1 border border-gray-200 rounded disabled:bg-gray-100 disabled:text-gray-400" />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">状态</label>
                <select value={editFormData.status} onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="draft">草稿</option>
                  <option value="frozen">冻结</option>
                  <option value="released">发布</option>
                  <option value="obsolete">作废</option>
                </select>
              </div>
              <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">备注</label>
                <textarea value={editFormData.remark} onChange={(e) => setEditFormData({ ...editFormData, remark: e.target.value })} rows={1} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
              </div>
            </div>

            {editCustomDefs.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {editCustomDefs.map(def => (
                    <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-gray-500 mb-0.5">{def.name}{def.is_required && <span className="text-red-500 ml-1">*</span>}</label>
                      {def.field_type === 'select' && def.options?.length ? (
                        <select value={editCustomValues[def.id] ?? ''} onChange={(e) => setEditCustomValues({ ...editCustomValues, [def.id]: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500">
                          <option value="">请选择</option>
                          {def.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : def.field_type === 'number' ? (
                        <input type="number" value={editCustomValues[def.id] ?? ''} onChange={(e) => setEditCustomValues({ ...editCustomValues, [def.id]: e.target.value ? Number(e.target.value) : null })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      ) : (
                        <input type="text" value={editCustomValues[def.id] ?? ''} onChange={(e) => setEditCustomValues({ ...editCustomValues, [def.id]: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">附件管理</h4>
                {!editUploading && (
                  <>
                    <button type="button" onClick={() => editFileInputRef.current?.click()} className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 上传附件</button>
                    <input ref={editFileInputRef} type="file" className="hidden" onChange={handleEditFileChange} accept="*/*" />
                  </>
                )}
              </div>
              {editUploading && (
                <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-700">正在上传 "{editUploadFileName}"</span>
                    <span className="text-blue-600 font-medium">{editUploadProgress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${editUploadProgress}%` }} />
                  </div>
                </div>
              )}
              {editLoadingAttach ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : editAttachments.length === 0 && !editUploading ? (
                <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">暂无附件</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">文件名</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">大小</th>
                        <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {editAttachments.map(att => (
                        <tr key={att.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2"><span className="text-primary-600">{att.file_name}</span></td>
                          <td className="px-3 py-2 text-gray-500">{att.file_size != null ? (att.file_size < 1024 ? att.file_size + ' B' : att.file_size < 1048576 ? (att.file_size / 1024).toFixed(1) + ' KB' : (att.file_size / 1048576).toFixed(1) + ' MB') : '-'}</td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => handleEditDeleteAttachment(att.id)} disabled={editDeletingAttId === att.id} className="text-red-600 hover:text-red-800 disabled:opacity-50 text-xs">
                              {editDeletingAttId === att.id ? '删除中...' : '删除'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {editSaveError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{editSaveError}</div>}

            <div className="flex justify-between items-center gap-2 pt-4 border-t">
              <div>
                {editingDoc && (editingDoc.status === 'released' || editingDoc.status === 'obsolete') && (
                  <button type="button" onClick={handleEditUpgrade} disabled={editSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">升版</button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingDoc(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                <button type="button" onClick={handleEditSave} disabled={editSaving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">{editSaving ? '保存中...' : '保存'}</button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 图文档详情弹窗 */}
      {viewingDocDetail && (
        <Modal open={!!viewingDocDetail} title="图文档详情" onClose={() => setViewingDocDetail(null)} width="full" zIndex={61}>
          <DocumentDetailContent
            doc={viewingDocDetail}
            customFieldDefs={viewingDocCustomDefs}
            customFieldValues={viewingDocCustomValues}
            groupNames={(viewingDocDetail as any).group_names || []}
          />
          <div className="flex justify-end pt-4 border-t mt-4">
            <button type="button" onClick={() => setViewingDocDetail(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">关闭</button>
          </div>
        </Modal>
      )}

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
        />
      )}
    </div>
  );
}
