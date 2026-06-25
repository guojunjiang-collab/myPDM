import { useEffect, useState, useRef } from 'react';
import { documentsApi, customFieldsApi, bomApi, v2UploadApi, CHUNK_SIZE, CHUNK_THRESHOLD, userGroupsApi } from '../services/api';
import type { Document, CustomFieldDefinition, CustomFieldValue, DocumentAttachment } from '../types';
import { canEdit, isAdmin, canDownload, useAuthStore } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import DocumentDetailContent from '../components/DocumentDetailContent';
import VersionHistory from '../components/VersionHistory';
import { useDataStore } from '../stores/data';
import { useTableSort } from '../hooks/useTableSort';
import {
  exportDocumentsToFolder,
  previewDocumentsImport,
  executeDocumentsImport,
} from '../services/importExport';
import type { ImportPreview } from '../services/importExport';
import ImportPreviewModal from '../components/ImportPreviewModal';
import ArchiveTreeModal from '../components/ArchiveTreeModal';

/** 生成 UUID */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 文件大小格式化 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Base64 编码文件 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface DocFormData {
  code: string;
  name: string;
  version: string;
  status: string;
  remark: string;
}

const initialFormData: DocFormData = {
  code: '',
  name: '',
  version: 'A',
  status: 'draft',
  remark: '',
};

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [status, setStatus] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [showAccessibleOnly, setShowAccessibleOnly] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [formData, setFormData] = useState<DocFormData>(initialFormData);
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!modalOpen) return;
    const timer = setTimeout(() => {
      const el = remarkRef.current;
      if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    }, 0);
    return () => clearTimeout(timer);
  }, [modalOpen, formData.remark]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 详情弹窗
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, any>>({});
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);

  // 从 store 订阅数据
  const storeDocuments = useDataStore((s) => s.documents);

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  // 自定义字段值映射：{ entityId: { fieldId: value } }
  const [customFieldValuesMap, setCustomFieldValuesMap] = useState<Record<string, Record<string, any>>>({});

  // 附件管理
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0); // 上传进度百分比
  const [deletingAttId, setDeletingAttId] = useState<string | null>(null);
  // 新增模式下暂存的待上传文件（文档创建后随保存上传）
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 导入导出
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // 用户组关联
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [formGroupIds, setFormGroupIds] = useState<string[]>([]);

  useEffect(() => {
    userGroupsApi.list().then((res) => setAllGroups(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [search, status, storeDocuments]);

  const { sortedData, handleSort, getSortIcon } = useTableSort<Document>(documents, 'code', 'asc');

  // 获取图文档适用的自定义字段定义
  const documentCustomDefs = customFieldDefs.filter((d) => d.applies_to?.includes('document'));

  // 筛选逻辑
  const filteredData = sortedData.filter(doc => {
    if (status && doc.status !== status) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
      // 基础字段搜索
      if (searchField === 'all') {
        if (match(doc.code) || match(doc.name) || match(doc.version) || match(doc.remark)) return true;
        // 搜索自定义字段
        const docCustomValues = customFieldValuesMap[doc.id] || {};
        for (const def of documentCustomDefs) {
          const val = docCustomValues[def.id];
          if (val != null && String(val).toLowerCase().includes(keyword)) return true;
        }
        return false;
      }
      if (searchField === 'code') return match(doc.code);
      if (searchField === 'name') return match(doc.name);
      if (searchField === 'version') return match(doc.version);
      if (searchField === 'status') return match(doc.status);
      if (searchField === 'remark') return match(doc.remark);
      // 自定义字段搜索
      if (searchField.startsWith('cf_')) {
        const fieldId = searchField.replace('cf_', '');
        const docCustomValues = customFieldValuesMap[doc.id] || {};
        const val = docCustomValues[fieldId];
        return val != null && String(val).toLowerCase().includes(keyword);
      }
      return true;
    }
    return true;
  });

  // 版本计数
  const versionCountMap: Record<string, number> = {};
  documents.forEach(d => {
    versionCountMap[d.code] = (versionCountMap[d.code] || 0) + 1;
  });

  // 仅显示最新版本
  const displayData = (() => {
    let data = showAllVersions ? filteredData : (() => {
      const latestMap: Record<string, typeof filteredData[0]> = {};
      filteredData.forEach(d => {
        const existing = latestMap[d.code];
        if (!existing || new Date(d.created_at || 0) > new Date(existing.created_at || 0)) {
          latestMap[d.code] = d;
        }
      });
      return Object.values(latestMap);
    })();
    if (showAccessibleOnly) {
      data = data.filter((d: any) => d.accessible !== false);
    }
    return data;
  })();

  const loadDocuments = () => {
    const localDocuments = useDataStore.getState().documents;
    setDocuments(localDocuments);
    setLoading(false);
    // 加载自定义字段定义（同步版本）
    const localDefs = useDataStore.getState().customFieldDefs;
    setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) =>
      d.applies_to?.includes('document')
    ));
    // 加载所有图文档的自定义字段值
    loadAllCustomFieldValues(localDocuments);
  };

  // 批量加载所有图文档的自定义字段值
  const loadAllCustomFieldValues = async (docsList: Document[]) => {
    if (docsList.length === 0) return;
    try {
      const results = await Promise.allSettled(
        docsList.map(doc => customFieldsApi.getValues('document', doc.id))
      );
      const map: Record<string, Record<string, any>> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const values: Record<string, any> = {};
          (result.value.data || []).forEach((v: CustomFieldValue) => {
            values[v.field_id] = v.value;
          });
          map[docsList[index].id] = values;
        }
      });
      setCustomFieldValuesMap(map);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  const loadCustomFields = async () => {
    const localDefs = useDataStore.getState().customFieldDefs;
    if (localDefs.length > 0) {
      setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) =>
        d.applies_to?.includes('document')
      ));
      setLoadingCustomFields(false);
      return;
    }
    try {
      setLoadingCustomFields(true);
      const response = await customFieldsApi.listDefinitions();
      const defs = (response.data || []).filter((d: CustomFieldDefinition) =>
        d.applies_to?.includes('document')
      );
      setCustomFieldDefs(defs);
    } catch (error) {
      console.error('加载自定义字段失败', error);
    } finally {
      setLoadingCustomFields(false);
    }
  };

  const loadCustomFieldValues = async (docId: string) => {
    try {
      const response = await customFieldsApi.getValues('document', docId);
      const values: Record<string, any> = {};
      (response.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      setCustomFieldValues(values);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  // 加载附件列表
  const loadAttachments = async (docId: string) => {
    setLoadingAttachments(true);
    try {
      const res = await documentsApi.listAttachments(docId);
      setAttachments(res.data || []);
    } catch (error) {
      console.error('加载附件失败', error);
      setAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  };

  // 上传附件 - 后台进行，不阻塞 UI
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 文件大小限制检查 (1GB)
    const MAX_ALLOWED = 1073741824;
    if (file.size > MAX_ALLOWED) {
      alert(`文件大小 ${formatFileSize(file.size)} 超过系统限制 1GB`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 新增模式：尚无文档 ID，先暂存到前端，保存时再上传
    if (!editingDoc) {
      setPendingFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadingFileName(file.name);
    setUploadProgress(0);

    try {
      // 根据文件大小选择上传方式
      if (file.size > CHUNK_THRESHOLD) {
        // 大文件：分块上传
        await uploadLargeFile(file, editingDoc.id, (progress) => {
          setUploadProgress(progress);
        });
      } else {
        // 小文件：直接 multipart 上传
        await v2UploadApi.uploadSmallFile(file, 'documents', editingDoc.id, (progress) => {
          setUploadProgress(progress);
        });
      }

      // 上传成功后刷新附件列表
      await loadAttachments(editingDoc.id);
    } catch (error) {
      console.error('上传失败', error);
      alert('上传失败，请重试');
    } finally {
      setUploading(false);
      setUploadingFileName('');
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * 分块上传大文件
   */
  const uploadLargeFile = async (
    file: File,
    docId: string,
    onProgress: (percent: number) => void
  ): Promise<void> => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // 1. 初始化分块上传
    const initResult = await v2UploadApi.initChunkedUpload(
      file.name,
      file.size,
      'documents',
      docId
    );

    const uploadId = initResult.upload_id;
    let uploadedChunks = 0;

    // 2. 逐个上传分块
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      await v2UploadApi.uploadChunk(uploadId, i, chunk);
      uploadedChunks++;

      // 更新进度 (包含初始化和完成两个阶段，各占 5%)
      const uploadProgress = Math.round(
        5 + (uploadedChunks / totalChunks) * 90
      );
      onProgress(uploadProgress);
    }

    // 3. 完成分块上传
    await v2UploadApi.completeChunkedUpload(uploadId);
    onProgress(100);
  };

  // 删除附件
  const handleDeleteAttachment = async (attId: string) => {
    if (!editingDoc || !confirm('确定要删除该附件吗？')) return;

    setDeletingAttId(attId);
    try {
      await documentsApi.deleteAttachment(editingDoc.id, attId);
      await loadAttachments(editingDoc.id);
    } catch (error) {
      console.error('删除失败', error);
      alert('删除失败，请重试');
    } finally {
      setDeletingAttId(null);
    }
  };

  // 下载附件
  const handleDownloadAttachment = async (attId: string, fileName: string) => {
    if (!editingDoc) return;
    try {
      const res = await documentsApi.getAttachment(editingDoc.id, attId);
      const data = res.data as { file_data?: string };

      if (data.file_data) {
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${data.file_data}`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert('文件数据获取失败');
      }
    } catch (error) {
      console.error('下载失败', error);
      alert('下载失败，请重试');
    }
  };

  const handleAdd = () => {
    setEditingDoc(null);
    setFormData(initialFormData);
    setCustomFieldValues({});
    setAttachments([]);
    setPendingFile(null);
    setFormGroupIds([]);
    loadCustomFields();
    setModalOpen(true);
  };

  const handleEdit = async (doc: Document) => {
    setEditingDoc(doc);
    setFormData({
      code: doc.code,
      name: doc.name,
      version: doc.version || 'A',
      status: doc.status,
      remark: doc.remark || '',
    });
    setFormGroupIds(((doc as any).group_ids || []).map(String));
    await loadCustomFields();
    await loadCustomFieldValues(doc.id);
    await loadAttachments(doc.id);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    const data: Record<string, unknown> = {
      code: formData.code,
      name: formData.name,
      version: formData.version || undefined,
      status: formData.status,
      remark: formData.remark || undefined,
      group_ids: formGroupIds,
    };

    try {
      let newDoc: Document | null = null;
      if (editingDoc) {
        const res = await documentsApi.update(editingDoc.id, data);
        newDoc = res.data;
        useDataStore.getState().setDocuments(
          useDataStore.getState().documents.map(d => d.id === editingDoc.id ? newDoc! : d)
        );
      } else {
        const res = await documentsApi.create(data);
        newDoc = res.data;
        useDataStore.getState().setDocuments([...useDataStore.getState().documents, newDoc!]);

        // 新增模式：文档创建成功后上传暂存的附件
        if (pendingFile) {
          setUploading(true);
          setUploadingFileName(pendingFile.name);
          setUploadProgress(0);
          try {
            if (pendingFile.size > CHUNK_THRESHOLD) {
              await uploadLargeFile(pendingFile, newDoc!.id, (p) => setUploadProgress(p));
            } else {
              await v2UploadApi.uploadSmallFile(pendingFile, 'documents', newDoc!.id, (p) => setUploadProgress(p));
            }
          } catch (uploadErr) {
            console.error('附件上传失败', uploadErr);
            alert('图文档已创建，但附件上传失败，请在编辑中重新上传');
          } finally {
            setUploading(false);
            setUploadingFileName('');
            setUploadProgress(0);
            setPendingFile(null);
          }
        }
      }

      const fieldValues = customFieldDefs.map(def => ({
        field_id: def.id,
        value: customFieldValues[def.id] ?? null,
      })).filter(fv => fv.value !== null && fv.value !== '');
      
      if (fieldValues.length > 0) {
        await customFieldsApi.setValues('document', newDoc!.id, fieldValues);
      }

      setModalOpen(false);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ') : (typeof detail === 'string' ? detail : (editingDoc ? '更新失败，请重试' : '创建失败，请检查网络或数据是否已存在')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      const res = await bomApi.checkReferences('document', deleteId);
      const refs = res.data || [];
      if (refs.length > 0) {
        const names = refs.map((r: any) => r.label).join(', ');
        setDeleteError('该图文档被以下实体引用，不能删除: ' + names);
        return;
      }
      await documentsApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setDocuments(
        useDataStore.getState().documents.filter(d => d.id !== deleteId)
      );
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleUpgrade = async () => {
    if (!editingDoc) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await documentsApi.upgrade(editingDoc.id);
      const newDoc = res.data;
      useDataStore.getState().setDocuments([...useDataStore.getState().documents, newDoc]);
      setModalOpen(false);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(typeof detail === 'string' ? detail : '升版失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (doc: Document) => {
    setViewingDoc(doc);
    setDetailTab('detail');
    const allDefs = useDataStore.getState().customFieldDefs;
    const docDefs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
    setViewingCustomDefs(docDefs);
    try {
      const res = await customFieldsApi.getValues('document', doc.id);
      const values: Record<string, any> = {};
      (res.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      setViewingCustomValues(values);
    } catch {
      setViewingCustomValues({});
    }
  };

  // ===== 导入导出 =====
  const handleExportDocuments = async () => {
    try {
      await exportDocumentsToFolder();
    } catch (err: any) {
      if (err.name !== 'AbortError' && !err.message?.includes('abort')) {
        alert(err.message || '导出失败');
      }
    }
  };

  const handleImportDocumentsClick = async () => {
    setImportLoading(true);
    try {
      const preview = await previewDocumentsImport();
      setImportPreview(preview);
      setImportPreviewOpen(true);
    } catch (err: any) {
      if (err.name !== 'AbortError' && !err.message?.includes('abort')) {
        alert(err.message || '导入解析失败');
      }
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportDocumentsConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      await executeDocumentsImport(importPreview);
      setImportPreviewOpen(false);
      setImportPreview(null);
      alert('导入成功');
    } catch (err: any) {
      alert(err.message || '导入执行失败');
    } finally {
      setImporting(false);
    }
  };

  const getStatusTag = (s: string) => {
    const tags: Record<string, { label: string; class: string }> = {
      draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
      frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
      released: { label: '发布', class: 'bg-green-100 text-green-800' },
      obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
    };
    return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
  };

  const renderCustomFieldInput = (def: CustomFieldDefinition) => {
    const value = customFieldValues[def.id] ?? '';
    const handleChange = (v: any) => {
      setCustomFieldValues({ ...customFieldValues, [def.id]: v });
    };

    if (def.field_type === 'select' && def.options?.length) {
      return (
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">请选择</option>
          {def.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (def.field_type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : null)}
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    );
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">编号</option>
          <option value="name">名称</option>
          <option value="version">版本</option>
          <option value="status">状态</option>
          <option value="remark">备注</option>
          {documentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${documentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : searchField === 'version' ? '版本' : searchField === 'status' ? '状态' : '备注'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          全部版本
        </label>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAccessibleOnly}
            onChange={(e) => setShowAccessibleOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          可查看
        </label>
        <div className="flex-1" />
        {canDownload() && (
          <button onClick={handleExportDocuments} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">📥 导出全部</button>
        )}
        {canEdit() && (
          <button onClick={handleImportDocumentsClick} disabled={importLoading} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">{importLoading ? '解析中...' : '📤 导入'}</button>
        )}
        {canEdit() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新增图文档</button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">编号 {getSortIcon('code' as keyof Document)}</th>
              <th onClick={() => handleSort('name' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">名称 {getSortIcon('name' as keyof Document)}</th>
              <th onClick={() => handleSort('version' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">版本 {getSortIcon('version' as keyof Document)}</th>
              <th onClick={() => handleSort('status' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">状态 {getSortIcon('status' as keyof Document)}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">无匹配数据</td></tr>
            ) : (
              displayData.map((doc) => (
                <tr key={doc.id} className={`hover:bg-gray-50 cursor-pointer ${(doc as any).accessible === false ? 'opacity-60' : ''}`} onClick={() => handleView(doc)}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {(doc as any).accessible === false && <span className="mr-1" title="无权限：需关联用户组成员">🔒</span>}
                    {doc.code}
                    {!showAllVersions && (versionCountMap[doc.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[doc.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{doc.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{doc.version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusTag(doc.status).class}`}>
                      {getStatusTag(doc.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const isCreator = (doc as any).creator_id === useAuthStore.getState().user?.id;
                      const canManage = isAdmin() || isCreator;
                      return (
                        <>
                          {canManage && (doc as any).accessible !== false && <button onClick={() => handleEdit(doc)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>}
                          {canManage && (
                            <button onClick={() => setDeleteId(doc.id)} className="text-red-600 hover:text-red-800">删除</button>
                          )}
                        </>
                      );
                    })()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editingDoc ? '编辑图文档' : '新增图文档'}
        onClose={() => setModalOpen(false)}
        width="full"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 基本属性 - 卡片式 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">编号 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={!!editingDoc && !(isAdmin() && formData.version === 'A')}
                title={editingDoc && isAdmin() ? (formData.version === 'A' ? '管理员可修改编号' : '仅 A 版允许修改编号，升版后的版本不可改') : undefined}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                required
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300"
                required
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">版本</label>
              <input
                type="text"
                value={formData.version}
                disabled
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                placeholder="如: A, B, V1.0"
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">状态</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="draft">草稿</option>
                <option value="frozen">冻结</option>
                <option value="released">发布</option>
                <option value="obsolete">作废</option>
              </select>
            </div>
            <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">备注</label>
              <textarea
                ref={remarkRef}
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
                rows={1}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-gray-300"
              />
            </div>
            {editingDoc && (
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">创建人</label>
                <div className="text-sm text-gray-700 py-1">{(editingDoc as any).creator_name || '-'}</div>
              </div>
            )}
          </div>

          {/* Custom Fields */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {customFieldDefs.map(def => (
                    <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-gray-500 mb-0.5">
                        {def.name}
                        {def.is_required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {renderCustomFieldInput(def)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 关联用户组 */}
          {(isAdmin() || (editingDoc && (editingDoc as any).creator_id === useAuthStore.getState().user?.id)) && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">关联用户组（留空=全员可预览/下载）</h4>
              <div className="max-h-32 overflow-auto border border-gray-200 rounded p-2 grid grid-cols-3 gap-x-2 gap-y-0.5">
                {allGroups.length === 0 && <span className="text-gray-400 text-sm col-span-3">暂无用户组</span>}
                {allGroups.map((g) => (
                  <label key={g.id} className="flex items-center gap-1.5 py-0.5">
                    <input
                      type="checkbox"
                      checked={formGroupIds.includes(String(g.id))}
                      onChange={(e) => setFormGroupIds((prev) =>
                        e.target.checked ? [...prev, String(g.id)] : prev.filter((x) => x !== String(g.id)))}
                    />
                    <span className="text-sm truncate">{g.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 附件管理 - 新增/编辑界面一致，且只能上传一个附件 */}
          {(() => {
            const hasAttachment = editingDoc ? attachments.length > 0 : !!pendingFile;
            return (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-700">附件管理</h4>
                {!hasAttachment && !uploading && (
                  <>
                    <button
                      type="button"
                      onClick={handleUploadClick}
                      className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                    >
                      + 上传附件
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleFileChange}
                      accept="*/*"
                    />
                  </>
                )}
              </div>

              {/* 上传状态提示 - 不阻塞保存操作 */}
              {uploading && (
                <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-blue-700">
                      正在上传 "{uploadingFileName}"
                    </span>
                    <span className="text-blue-600 font-medium">
                      {uploadProgress}%
                    </span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {loadingAttachments ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : !hasAttachment && !uploading ? (
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
                      {editingDoc ? (
                        attachments.map(att => (
                          <tr key={att.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <span className="text-primary-600">{att.file_name}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{formatFileSize(att.file_size || 0)}</td>
                            <td className="px-3 py-2 text-gray-500">
                              {att.created_at ? new Date(att.created_at).toLocaleString('zh-CN') : '-'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteAttachment(att.id)}
                                disabled={deletingAttId === att.id}
                                className="text-red-600 hover:text-red-800 disabled:opacity-50"
                              >
                                {deletingAttId === att.id ? '删除中...' : '删除'}
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : pendingFile ? (
                        <tr className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <span className="text-primary-600">{pendingFile.name}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-500">{formatFileSize(pendingFile.size)}</td>
                          <td className="px-3 py-2 text-gray-400">待保存后上传</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setPendingFile(null)}
                              className="text-red-600 hover:text-red-800"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            );
          })()}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

           <div className="flex justify-between items-center gap-2 pt-4 border-t">
            <div>
              {editingDoc && (editingDoc.status === 'released' || editingDoc.status === 'obsolete') && (
                <button
                  type="button"
                  onClick={handleUpgrade}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  title="升版"
                >
                  {saving ? '升版中...' : '升版'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "确认删除"}
        content={deleteError || "确定要删除该图文档吗？此操作不可撤销。"}
        confirmText={deleteError ? "知道了" : "删除"}
        cancelText="取消"
        type={deleteError ? "info" : "danger"}
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* 图文档详情弹窗 */}
      <Modal
        open={!!viewingDoc}
        title="图文档详情"
        onClose={() => setViewingDoc(null)}
        width="full"
      >
        {viewingDoc && (
          <div>
            <div className="flex gap-1 mb-4 border-b">
              <button
                onClick={() => setDetailTab('detail')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'detail'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                基本信息
              </button>
              <button
                onClick={() => setDetailTab('versions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'versions'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                版本历史
              </button>
            </div>

            {detailTab === 'detail' ? (
              <DocumentDetailContent
                doc={viewingDoc}
                customFieldDefs={viewingCustomDefs}
                customFieldValues={viewingCustomValues}
                accessible={(viewingDoc as any).accessible ?? true}
                groupNames={((viewingDoc as any).group_ids || []).map((gid: string) => allGroups.find(g => g.id === gid)?.name || gid).filter(Boolean)}
                onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}
              />
            ) : (
              <VersionHistory
                entityType="document"
                entityId={viewingDoc.id}
                onViewVersion={async (id) => {
                  try {
                    const res = await documentsApi.get(id);
                    handleView(res.data);
                  } catch {
                    alert('加载版本失败');
                  }
                }}
              />
            )}
          </div>
        )}
      </Modal>

      {/* 导入预览弹窗 */}
      <ImportPreviewModal
        open={importPreviewOpen}
        preview={importPreview}
        loading={importLoading}
        onClose={() => {
          setImportPreviewOpen(false);
          setImportPreview(null);
        }}
        onConfirm={handleImportDocumentsConfirm}
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