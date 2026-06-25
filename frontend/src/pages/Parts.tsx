import { useEffect, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { partsApi, customFieldsApi, bomApi } from '../services/api';
import type { Part, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin, canDownload, can, useAuthStore } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import PartDetailContent from '../components/PartDetailContent';
import BOMTraceModal from '../components/BOMTraceModal';
import VersionHistory from '../components/VersionHistory';
import EntityDocumentSection from '../components/EntityDocumentSection';
import { useDataStore } from '../stores/data';
import { useTableSort } from '../hooks/useTableSort';
import {
  exportPartsExcel,
  previewPartsImport,
  executePartsImport,
} from '../services/importExport';
import type { ImportPreview } from '../services/importExport';
import ImportPreviewModal from '../components/ImportPreviewModal';

interface PartFormData {
  code: string;
  name: string;
  spec: string;
  version: string;
  status: string;
  remark: string;
}

const initialFormData: PartFormData = {
  code: '',
  name: '',
  spec: '',
  version: 'A',
  status: 'draft',
  remark: '',
};

export default function Parts() {
  const location = useLocation();
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [status, setStatus] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [formData, setFormData] = useState<PartFormData>(initialFormData);
  const specRef = useRef<HTMLTextAreaElement>(null);
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!modalOpen) return;
    // Delay to ensure DOM is rendered after Modal opens
    const timer = setTimeout(() => {
      [specRef, remarkRef].forEach(ref => {
        const el = ref.current;
        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [modalOpen, formData.spec, formData.remark]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 详情弹窗
  const [viewingPart, setViewingPart] = useState<Part | null>(null);
  // 反查弹窗
  const [traceEntity, setTraceEntity] = useState<{ type: 'part' | 'assembly'; id: string; code: string; name: string; version?: string } | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, any>>({});
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');

  // 从 store 订阅数据（store 更新时自动触发重新渲染）
  const storeParts = useDataStore((s) => s.parts);
  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);

  // 导入导出
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  // 自定义字段值映射：{ entityId: { fieldId: value } }
  const [customFieldValuesMap, setCustomFieldValuesMap] = useState<Record<string, Record<string, any>>>({});

  const { sortedData, handleSort, getSortIcon } = useTableSort<Part>(parts, 'code', 'asc');

  // 获取零件适用的自定义字段定义
  const partCustomDefs = customFieldDefs.filter((d) => d.applies_to?.includes('part'));

  // 筛选逻辑
  const filteredData = sortedData.filter(part => {
    if (status && part.status !== status) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
      // 基础字段搜索
      if (searchField === 'all') {
        if (match(part.code) || match(part.name) || match(part.spec) || match(part.version) || match(part.remark)) return true;
        // 搜索自定义字段
        const partCustomValues = customFieldValuesMap[part.id] || {};
        for (const def of partCustomDefs) {
          const val = partCustomValues[def.id];
          if (val != null && String(val).toLowerCase().includes(keyword)) return true;
        }
        return false;
      }
      if (searchField === 'code') return match(part.code);
      if (searchField === 'name') return match(part.name);
      if (searchField === 'spec') return match(part.spec);
      if (searchField === 'version') return match(part.version);
      if (searchField === 'status') return match(part.status);
      if (searchField === 'remark') return match(part.remark);
      // 自定义字段搜索
      if (searchField.startsWith('cf_')) {
        const fieldId = searchField.replace('cf_', '');
        const partCustomValues = customFieldValuesMap[part.id] || {};
        const val = partCustomValues[fieldId];
        return val != null && String(val).toLowerCase().includes(keyword);
      }
      return true;
    }
    return true;
  });

  // 版本计数（用于显示"已有N个版本"）
  const versionCountMap: Record<string, number> = {};
  parts.forEach(p => {
    versionCountMap[p.code] = (versionCountMap[p.code] || 0) + 1;
  });

  // 仅显示最新版本（按创建时间）
  const displayData = showAllVersions ? filteredData : (() => {
    const latestMap: Record<string, typeof filteredData[0]> = {};
    filteredData.forEach(p => {
      const existing = latestMap[p.code];
      if (!existing || new Date(p.created_at || 0) > new Date(existing.created_at || 0)) {
        latestMap[p.code] = p;
      }
    });
    return Object.values(latestMap);
  })();

  useEffect(() => {
    loadParts();
  }, [search, status, storeParts, storeCustomDefs]); // storeParts、storeCustomDefs 变化时也重新加载

  // 从 URL 参数 auto-open 编辑弹窗
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editId = params.get('edit');
    if (editId && parts.length > 0 && !modalOpen) {
      const part = parts.find(p => p.id === editId);
      if (part) {
        handleEdit(part);
        // 清除 URL 参数避免刷新后再次打开
        window.history.replaceState({}, '', '/parts');
      }
    }
  }, [location.search, parts]);

  const loadParts = () => {
    // 仅从本地 store 取数据，不自动调 API
    const localParts = useDataStore.getState().parts;
    setParts(localParts);
    setLoading(false);
    // 加载自定义字段定义
    loadCustomFields();
    // 加载所有零件的自定义字段值
    loadAllCustomFieldValues(localParts);
  };

  // 批量加载所有零件的自定义字段值
  const loadAllCustomFieldValues = async (partsList: Part[]) => {
    if (partsList.length === 0) return;
    try {
      const results = await Promise.allSettled(
        partsList.map(part => customFieldsApi.getValues('part', part.id))
      );
      const map: Record<string, Record<string, any>> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const values: Record<string, any> = {};
          (result.value.data || []).forEach((v: CustomFieldValue) => {
            values[v.field_id] = v.value;
          });
          map[partsList[index].id] = values;
        }
      });
      setCustomFieldValuesMap(map);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  const loadCustomFields = () => {
    const localDefs = useDataStore.getState().customFieldDefs;
    setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) =>
      d.applies_to?.includes('part')
    ));
    setLoadingCustomFields(false);
  };

  const loadCustomFieldValues = async (partId: string) => {
    try {
      const response = await customFieldsApi.getValues('part', partId);
      const values: Record<string, any> = {};
      (response.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      setCustomFieldValues(values);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  const handleAdd = () => {
    setEditingPart(null);
    setFormData(initialFormData);
    setCustomFieldValues({});
    loadCustomFields();
    setModalOpen(true);
  };

  const handleEdit = async (part: Part) => {
    let p = part;
    try {
      const res = await partsApi.get(part.id);
      p = { ...part, ...res.data };
    } catch {}
    setEditingPart(p);
    setFormData({
      code: p.code,
      name: p.name,
      spec: p.spec || '',
      version: p.version || 'A',
      status: p.status,
      remark: p.remark || '',
    });
    await loadCustomFields();
    await loadCustomFieldValues(part.id);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    const data = {
      code: formData.code,
      name: formData.name,
      spec: formData.spec || undefined,
      version: formData.version || undefined,
      status: formData.status,
      remark: formData.remark || undefined,
    };

    try {
      let newPart: Part | null = null;
      if (editingPart) {
        const res = await partsApi.update(editingPart.id, data);
        newPart = res.data;
        // 直接更新 local store
        useDataStore.getState().setParts(
          useDataStore.getState().parts.map(p => p.id === editingPart.id ? newPart! : p)
        );
      } else {
        const res = await partsApi.create(data);
        newPart = res.data;
        // 直接追加到 local store
        useDataStore.getState().setParts([...useDataStore.getState().parts, newPart!]);
      }

      // Save custom field values
      const fieldValues = customFieldDefs.map(def => ({
        field_id: def.id,
        value: customFieldValues[def.id] ?? null,
      })).filter(fv => fv.value !== null && fv.value !== '');
      
      if (fieldValues.length > 0) {
        await customFieldsApi.setValues('part', newPart!.id, fieldValues);
      }

      setModalOpen(false);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ') : (typeof detail === 'string' ? detail : (editingPart ? '更新失败，请重试' : '创建失败，请检查网络或数据是否已存在')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      const res = await bomApi.checkReferences('part', deleteId);
      const refs = res.data || [];
      if (refs.length > 0) {
        const names = refs.map((r: any) => r.label).join(', ');
        setDeleteError('该零件被以下实体引用，不能删除: ' + names);
        return;
      }
      await partsApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setParts(
        useDataStore.getState().parts.filter(p => p.id !== deleteId)
      );
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleUpgrade = async () => {
    if (!editingPart) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await partsApi.upgrade(editingPart.id);
      const newPart = res.data;
      useDataStore.getState().setParts([...useDataStore.getState().parts, newPart]);
      setModalOpen(false);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(typeof detail === 'string' ? detail : '升版失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (part: Part) => {
    setViewingPart(part);
    setDetailTab('detail');
    // 加载该零件的自定义字段定义（适用于零件的）
    const allDefs = useDataStore.getState().customFieldDefs;
    const partDefs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('part'));
    setViewingCustomDefs(partDefs);
    // 加载自定义字段值
    try {
      const res = await customFieldsApi.getValues('part', part.id);
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
  const handleExport = async () => {
    try {
      await exportPartsExcel();
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    try {
      const preview = await previewPartsImport(file);
      setImportPreview(preview);
      setImportPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || '导入解析失败');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      await executePartsImport(importPreview);
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
          <option value="code">件号</option>
          <option value="name">中文名称</option>
          <option value="spec">规格型号</option>
          <option value="version">版本</option>
          <option value="status">状态</option>
          <option value="remark">备注</option>
          {partCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${partCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '件号' : searchField === 'name' ? '名称' : searchField === 'spec' ? '规格型号' : searchField === 'version' ? '版本' : searchField === 'status' ? '状态' : '备注'}...`}
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
        <div className="flex-1" />
        {canDownload() && (
          <button onClick={handleExport} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">📥 导出全部</button>
        )}
        {canEdit() && (
          <>
            <button onClick={handleImportClick} disabled={importLoading} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">{importLoading ? '解析中...' : '📤 导入'}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          </>
        )}
        {canEdit() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新增零件</button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof Part)} className="w-56 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">件号 {getSortIcon('code' as keyof Part)}</th>
              <th onClick={() => handleSort('name' as keyof Part)} className="w-80 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">中文名称 {getSortIcon('name' as keyof Part)}</th>
              <th onClick={() => handleSort('spec' as keyof Part)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">规格型号 {getSortIcon('spec' as keyof Part)}</th>
              <th onClick={() => handleSort('version' as keyof Part)} className="w-14 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">版本 {getSortIcon('version' as keyof Part)}</th>
              <th onClick={() => handleSort('status' as keyof Part)} className="w-20 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">状态 {getSortIcon('status' as keyof Part)}</th>
              <th className="w-52 px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td>
              </tr>
            ) : filteredData.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">无匹配数据</td>
              </tr>
            ) : (
              displayData.map((part) => (
                <tr key={part.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleView(part)}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {part.code}
                    {!showAllVersions && (versionCountMap[part.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[part.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm truncate">{part.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 break-words whitespace-normal">{part.spec || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{part.version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusTag(part.status).class}`}>
                      {getStatusTag(part.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    {can('bom:trace') && (
                      <button
                        onClick={() => setTraceEntity({ type: 'part', id: part.id, code: part.code, name: part.name, version: part.version })}
                        className="text-indigo-600 hover:text-indigo-800 mr-3"
                      >
                        反查
                      </button>
                    )}
                    {(() => { const isCreator = (part as any).creator_id === useAuthStore.getState().user?.id; const canManage = isAdmin() || isCreator; return canManage && <button onClick={() => handleEdit(part)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>; })()}
                    {(() => { const isCreator = (part as any).creator_id === useAuthStore.getState().user?.id; const canManage = isAdmin() || isCreator; return canManage && (
                      <button onClick={() => setDeleteId(part.id)} className="text-red-600 hover:text-red-800">删除</button>
                    ); })()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editingPart ? '编辑零件' : '新增零件'}
        onClose={() => setModalOpen(false)}
        width="full"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">件号 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={!!editingPart && !(isAdmin() && formData.version === 'A')}
                title={editingPart && isAdmin() ? (formData.version === 'A' ? '管理员可修改件号' : '仅 A 版允许修改件号，升版后的版本不可改') : undefined}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
                required
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">中文名称 <span className="text-red-500">*</span></label>
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
              <label className="block text-xs text-gray-500 mb-0.5">规格型号</label>
              <textarea
                ref={specRef}
                value={formData.spec}
                onChange={(e) => setFormData({ ...formData, spec: e.target.value })}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-gray-300"
                rows={1}
              />
            </div>
            {editingPart && (
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">创建人</label>
                <div className="text-sm text-gray-700 py-1">{(editingPart as any).creator_name || '-'}</div>
              </div>
            )}
            <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">备注</label>
              <textarea
                ref={remarkRef}
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-gray-300"
                rows={1}
                placeholder="可选"
              />
            </div>
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

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

          {editingPart && (
            <EntityDocumentSection entityType="part" entityId={editingPart.id} entityCode={editingPart.code} entityName={editingPart.name} editable />
          )}          </div>

           <div className="flex justify-between items-center gap-2 pt-4 border-t">
            <div>
              {editingPart && (editingPart.status === 'released' || editingPart.status === 'obsolete') && (
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
        content={deleteError || "确定要删除该零件吗？此操作不可撤销。"}
        confirmText={deleteError ? "知道了" : "删除"}
        cancelText="取消"
        type={deleteError ? "info" : "danger"}
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* 反查弹窗 */}
      <BOMTraceModal entity={traceEntity} onClose={() => setTraceEntity(null)} />

      {/* 零件详情弹窗 */}
      <Modal
        open={!!viewingPart}
        title="零件详情"
        onClose={() => setViewingPart(null)}
        width="full"
      >
        {viewingPart && (
          <div className="max-h-[75vh] overflow-y-auto">
            {/* Tab 切换 */}
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
              <PartDetailContent
                part={viewingPart}
                customFieldDefs={viewingCustomDefs}
                customFieldValues={viewingCustomValues}
              />
            ) : (
              <VersionHistory
                entityType="part"
                entityId={viewingPart.id}
                onViewVersion={async (id) => {
                  try {
                    const res = await partsApi.get(id);
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
        onConfirm={handleImportConfirm}
      />
    </div>
  );
}