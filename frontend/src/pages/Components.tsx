import { useEffect, useState, useCallback } from 'react';
import { assembliesApi, assemblyPartsApi, customFieldsApi, bomApi, partsApi } from '../services/api';
import type { Assembly, AssemblyPartItem, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin, canDownload } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import AssemblyDetailContent from '../components/AssemblyDetailContent';
import PartDetailContent from '../components/PartDetailContent';
import VersionHistory from '../components/VersionHistory';
import VersionSelectModal from '../components/VersionSelectModal';
import AssemblyPartPicker from '../components/AssemblyPartPicker';
import EntityDocumentSection from '../components/EntityDocumentSection';
import { useDataStore } from '../stores/data';
import { useTableSort } from '../hooks/useTableSort';
import {
  exportAssembliesToFolder,
  previewAssembliesImport,
  executeAssembliesImport,
} from '../services/importExport';
import type { ImportPreview } from '../services/importExport';
import ImportPreviewModal from '../components/ImportPreviewModal';

/* ================================================================
   Types
   ================================================================ */

interface AssemblyFormData {
  code: string;
  name: string;
  spec: string;
  version: string;
  status: string;
  remark: string;
}

const initialFormData: AssemblyFormData = {
  code: '',
  name: '',
  spec: '',
  version: 'A',
  status: 'draft',
  remark: '',
};

/** 递归树节点 */
interface TreeNode {
  item: AssemblyPartItem;
  level: number;
  children: TreeNode[];
  hasChildren: boolean;
  expanded: boolean;
}

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

/* ================================================================
   Component
   ================================================================ */

export default function Components() {
  /* ---- 列表状态 ---- */
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [status, setStatus] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);

  /* ---- 编辑弹窗 ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState<Assembly | null>(null);
  const [formData, setFormData] = useState<AssemblyFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* ---- 导入导出 ---- */
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  /* ---- 子项（编辑） ---- */
  const [editParts, setEditParts] = useState<AssemblyPartItem[]>([]);
  const [loadingEditParts, setLoadingEditParts] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionSelectState, setVersionSelectState] = useState<{ itemId: string; childId: string; childType: string; childName: string } | null>(null);

/* ---- 详情弹窗 ---- */
  const [viewingAssembly, setViewingAssembly] = useState<Assembly | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, unknown>>({});
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');
  // 子项点击 → 嵌套详情弹窗
  const [nestedEntity, setNestedEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [nestedData, setNestedData] = useState<any>(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedCustomDefs, setNestedCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [nestedCustomValues, setNestedCustomValues] = useState<Record<string, any>>({});
  // Tree state now managed by AssemblyDetailContent - kept for backward compat only
  const [viewParts, setViewPartsState] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIdsState] = useState<Set<string>>(new Set());
  const [loadingViewParts, setLoadingPartsState] = useState(false);
  const [viewSortField, setViewSortFieldState] = useState<string | null>(null);
  const [viewSortDir, setViewSortDirState] = useState<'asc' | 'desc' | null>(null);
  // Alias for existing setter functions
  const setExpandedIds = setExpandedIdsState;
  const setLoadingViewParts = setLoadingPartsState;
  const setViewParts = (v: TreeNode[] | ((prev: TreeNode[]) => TreeNode[])) => {
    setViewPartsState(Array.isArray(v) ? v : v([]));
  };
  const setViewSortField = setViewSortFieldState;
  const setViewSortDir = setViewSortDirState;

  /* ---- 自定义字段 ---- */
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  // 自定义字段值映射：{ entityId: { fieldId: value } }
  const [customFieldValuesMap, setCustomFieldValuesMap] = useState<Record<string, Record<string, unknown>>>({});

  const storeAssemblies = useDataStore((s) => s.assemblies);

  /* ==============================================================
     Data Loading
     ============================================================== */

  const { sortedData, handleSort, getSortIcon } = useTableSort<Assembly>(assemblies, 'code', 'asc');

  // 获取部件适用的自定义字段定义
  const componentCustomDefs = customFieldDefs.filter((d) => d.applies_to?.includes('component'));

  // 筛选逻辑
  const filteredData = sortedData.filter(assembly => {
    if (status && assembly.status !== status) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
      // 基础字段搜索
      if (searchField === 'all') {
        if (match(assembly.code) || match(assembly.name) || match(assembly.spec) || match(assembly.version) || match(assembly.remark)) return true;
        // 搜索自定义字段
        const asmCustomValues = customFieldValuesMap[assembly.id] || {};
        for (const def of componentCustomDefs) {
          const val = asmCustomValues[def.id];
          if (val != null && String(val).toLowerCase().includes(keyword)) return true;
        }
        return false;
      }
      if (searchField === 'code') return match(assembly.code);
      if (searchField === 'name') return match(assembly.name);
      if (searchField === 'spec') return match(assembly.spec);
      if (searchField === 'version') return match(assembly.version);
      if (searchField === 'status') return match(assembly.status);
      if (searchField === 'remark') return match(assembly.remark);
      // 自定义字段搜索
      if (searchField.startsWith('cf_')) {
        const fieldId = searchField.replace('cf_', '');
        const asmCustomValues = customFieldValuesMap[assembly.id] || {};
        const val = asmCustomValues[fieldId];
        return val != null && String(val).toLowerCase().includes(keyword);
      }
      return true;
    }
    return true;
  });

  // 版本计数
  const versionCountMap: Record<string, number> = {};
  assemblies.forEach(a => {
    versionCountMap[a.code] = (versionCountMap[a.code] || 0) + 1;
  });

  // 仅显示最新版本
  const displayData = showAllVersions ? filteredData : (() => {
    const latestMap: Record<string, typeof filteredData[0]> = {};
    filteredData.forEach(a => {
      const existing = latestMap[a.code];
      if (!existing || new Date(a.created_at || 0) > new Date(existing.created_at || 0)) {
        latestMap[a.code] = a;
      }
    });
    return Object.values(latestMap);
  })();

  useEffect(() => {
    loadAssemblies();
  }, [search, status, storeAssemblies]);

  const loadAssemblies = () => {
    const localAssemblies = useDataStore.getState().assemblies;
    setAssemblies(localAssemblies);
    setLoading(false);
    // 加载自定义字段定义
    loadCustomFields();
    // 加载所有部件的自定义字段值
    loadAllCustomFieldValues(localAssemblies);
  };

  // 批量加载所有部件的自定义字段值
  const loadAllCustomFieldValues = async (assembliesList: Assembly[]) => {
    if (assembliesList.length === 0) return;
    try {
      const results = await Promise.allSettled(
        assembliesList.map(asm => customFieldsApi.getValues('component', asm.id))
      );
      const map: Record<string, Record<string, unknown>> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const values: Record<string, unknown> = {};
          (result.value.data || []).forEach((v: CustomFieldValue) => {
            values[v.field_id] = v.value;
          });
          map[assembliesList[index].id] = values;
        }
      });
      setCustomFieldValuesMap(map);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  const loadCustomFields = useCallback(() => {
    const localDefs = useDataStore.getState().customFieldDefs;
    setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('component')));
    setLoadingCustomFields(false);
  }, []);

  const loadCustomFieldValues = async (assemblyId: string, isView = false) => {
    try {
      const response = await customFieldsApi.getValues('component', assemblyId);
      const values: Record<string, unknown> = {};
      (response.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      if (isView) {
        setViewingCustomValues(values);
      } else {
        setCustomFieldValues(values);
      }
    } catch {
      /* handled silently */
    }
  };

  /* ==============================================================
     子项加载 & 树构建
     ============================================================== */

  const loadEditParts = useCallback(async (assemblyId: string) => {
    setLoadingEditParts(true);
    try {
      const res = await assemblyPartsApi.list(assemblyId);
      setEditParts(res.data || []);
    } catch {
      setEditParts([]);
    } finally {
      setLoadingEditParts(false);
    }
  }, []);

  /** 递归加载子项树 */
  const loadViewParts = useCallback(async (assemblyId: string): Promise<TreeNode[]> => {
    setLoadingViewParts(true);
    try {
      const res = await assemblyPartsApi.list(assemblyId);
      const items: AssemblyPartItem[] = res.data || [];
      return items.map((item) => ({
        item,
        level: 0,
        children: [],
        hasChildren: item.childType === 'component',
        expanded: expandedIds.has(item.id),
      }));
    } catch {
      return [];
    } finally {
      setLoadingViewParts(false);
    }
  }, [expandedIds]);

  /** 递归展开子部件的子项 */
  const expandChildren = useCallback(async (node: TreeNode): Promise<TreeNode> => {
    if (node.item.childType !== 'component' || !node.item.child_detail) {
      return node;
    }
    try {
      const res = await assemblyPartsApi.list(node.item.child_detail.id);
      const childItems: AssemblyPartItem[] = res.data || [];
      const children: TreeNode[] = childItems.map((ci) => ({
        item: ci,
        level: node.level + 1,
        children: [],
        hasChildren: ci.childType === 'component',
        expanded: expandedIds.has(ci.id),
      }));
      return { ...node, children };
    } catch {
      return node;
    }
  }, [expandedIds]);

  /* ==============================================================
     子项操作
     ============================================================== */

  const handleAddParts = async (items: { child_type: string; child_id: string; quantity: number }[]) => {
    if (!editingAssembly) return;
    try {
      await Promise.all(
        items.map((it) => assemblyPartsApi.add(editingAssembly.id, it))
      );
      await loadEditParts(editingAssembly.id);
      setPickerOpen(false);
    } catch {
      alert('添加子项失败');
    }
  };

  const handleRemovePart = async (itemId: string) => {
    if (!editingAssembly) return;
    try {
      await assemblyPartsApi.remove(editingAssembly.id, itemId);
      await loadEditParts(editingAssembly.id);
    } catch {
      alert('删除子项失败');
    }
  };

  const handleVersionSelectChild = async (selectedVersionId: string) => {
    if (!editingAssembly || !versionSelectState) return;
    const item = editParts.find(p => p.id === versionSelectState.itemId);
    if (!item) return;
    try {
      await assemblyPartsApi.remove(editingAssembly.id, versionSelectState.itemId);
      await assemblyPartsApi.add(editingAssembly.id, {
        child_type: versionSelectState.childType,
        child_id: selectedVersionId,
        quantity: item.quantity,
      });
      await loadEditParts(editingAssembly.id);
    } catch {
      alert('切换版本失败');
    } finally {
      setVersionSelectState(null);
    }
  };

  const handleUpdateQuantity = async (itemId: string, qty: number) => {
    if (!editingAssembly) return;
    try {
      await assemblyPartsApi.update(editingAssembly.id, itemId, { quantity: qty });
    } catch {
      alert('更新用量失败');
      await loadEditParts(editingAssembly.id);
    }
  };

  /* ==============================================================
     展开子部件（详情弹窗）
     ============================================================== */

  const toggleExpand = async (node: TreeNode) => {
    if (node.item.childType !== 'component') return;

    const nextExpanded = new Set(expandedIds);
    if (nextExpanded.has(node.item.id)) {
      nextExpanded.delete(node.item.id);
    } else {
      nextExpanded.add(node.item.id);
    }
    setExpandedIds(nextExpanded);

    if (nextExpanded.has(node.item.id)) {
      // 展开：递归加载子项
      const expandedNode = await expandChildren(node);
      setViewParts((prev) => replaceNode(prev, node.item.id, expandedNode));
    } else {
      // 收起
      setViewParts((prev) => replaceNode(prev, node.item.id, { ...node, children: [] }));
    }
  };

  const replaceNode = (nodes: TreeNode[], targetId: string, replacement: TreeNode): TreeNode[] => {
    return nodes.map((n) => {
      if (n.item.id === targetId) return replacement;
      if (n.children.length > 0) {
        return { ...n, children: replaceNode(n.children, targetId, replacement) };
      }
      return n;
    });
  };

  /** 渲染扁平化的树行 */
  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        result.push(n);
        if (n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return result;
  };

  /** 详情子项排序：只排顶层，子节点保持跟随 */
  const sortViewParts = useCallback((nodes: TreeNode[]): TreeNode[] => {
    if (!viewSortField || !viewSortDir) return nodes;
    return [...nodes].sort((a, b) => {
      let aVal: string = '';
      let bVal: string = '';
      const ad = a.item.child_detail;
      const bd = b.item.child_detail;
      if (viewSortField === 'type') { aVal = a.item.childType; bVal = b.item.childType; }
      else if (viewSortField === 'code') { aVal = ad?.code || ''; bVal = bd?.code || ''; }
      else if (viewSortField === 'version') { aVal = ad?.version || ''; bVal = bd?.version || ''; }
      else if (viewSortField === 'status') { aVal = ad?.status || ''; bVal = bd?.status || ''; }
      const cmp = aVal.localeCompare(bVal, 'zh-CN');
      return viewSortDir === 'desc' ? -cmp : cmp;
    });
  }, [viewSortField, viewSortDir]);

  const handleViewSort = (field: string) => {
    if (viewSortField === field) {
      if (viewSortDir === 'asc') setViewSortDir('desc');
      else if (viewSortDir === 'desc') { setViewSortField(null); setViewSortDir(null); }
    } else {
      setViewSortField(field);
      setViewSortDir('asc');
    }
  };

  const getViewSortIcon = (field: string): string => {
    if (viewSortField !== field) return '↕';
    if (viewSortDir === 'asc') return '↑';
    return '↓';
  };

  /* ==============================================================
     CRUD Handlers
     ============================================================== */

  const handleAdd = () => {
    setEditingAssembly(null);
    setFormData(initialFormData);
    setCustomFieldValues({});
    setEditParts([]);
    loadCustomFields();
    setModalOpen(true);
  };

  const handleEdit = async (assembly: Assembly) => {
    setEditingAssembly(assembly);
    setFormData({
      code: assembly.code,
      name: assembly.name,
      spec: assembly.spec || '',
      version: assembly.version || 'A',
      status: assembly.status,
      remark: assembly.remark || '',
    });
    await loadCustomFields();
    await loadCustomFieldValues(assembly.id);
    loadEditParts(assembly.id);
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
      let newAssembly: Assembly | null = null;
      if (editingAssembly) {
        const res = await assembliesApi.update(editingAssembly.id, data);
        newAssembly = res.data;
        useDataStore.getState().setAssemblies(
          useDataStore.getState().assemblies.map((a) => (a.id === editingAssembly.id ? newAssembly! : a)),
        );
      } else {
        const res = await assembliesApi.create(data);
        newAssembly = res.data;
        useDataStore.getState().setAssemblies([...useDataStore.getState().assemblies, newAssembly!]);
      }

      const fieldValues = customFieldDefs
        .map((def) => ({
          field_id: def.id,
          value: customFieldValues[def.id] ?? null,
        }))
        .filter((fv) => fv.value !== null && fv.value !== '');

      if (fieldValues.length > 0) {
        await customFieldsApi.setValues('component', newAssembly!.id, fieldValues);
      }

      setModalOpen(false);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: unknown } } };
      const detail = err?.response?.data?.detail;
      setSaveError(
        Array.isArray(detail)
          ? (detail as { msg?: string }[]).map((e) => e.msg || JSON.stringify(e)).join('; ')
          : typeof detail === 'string'
            ? detail
            : editingAssembly
              ? '更新失败，请重试'
              : '创建失败，请检查网络或数据是否已存在',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      const res = await bomApi.checkReferences('assembly', deleteId);
      const refs = res.data || [];
      if (refs.length > 0) {
        const names = refs.map((r: any) => r.label).join(', ');
        setDeleteError('该部件被以下实体引用，不能删除: ' + names);
        return;
      }
      await assembliesApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setAssemblies(
        useDataStore.getState().assemblies.filter((a) => a.id !== deleteId),
      );
    } catch {
      alert('删除失败');
    }
  };

  const handleUpgrade = async () => {
    if (!editingAssembly) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await assembliesApi.upgrade(editingAssembly.id);
      const newAssembly = res.data;
      useDataStore.getState().setAssemblies([...useDataStore.getState().assemblies, newAssembly]);
      setModalOpen(false);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: unknown } } };
      const detail = err?.response?.data?.detail;
      setSaveError(typeof detail === 'string' ? detail : '升版失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (assembly: Assembly) => {
    setViewingAssembly(assembly);
    setDetailTab('detail');
    setExpandedIds(new Set());
    const allDefs = useDataStore.getState().customFieldDefs;
    setViewingCustomDefs(allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('component')));
    await loadCustomFieldValues(assembly.id, true);
    const tree = await loadViewParts(assembly.id);
    setViewParts(tree);
  };

  // 子项行点击 → 弹出嵌套详情
  const handleNestedView = async (type: 'part' | 'assembly', id: string) => {
    setNestedEntity({ type, id });
    setNestedData(null);
    setNestedLoading(true);
    setNestedCustomDefs([]);
    setNestedCustomValues({});
    try {
      const api = type === 'part' ? partsApi : assembliesApi;
      const res = await api.get(id);
      setNestedData(res.data);
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setNestedCustomDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setNestedCustomValues(vals);
        } catch { /* optional */ }
      }
    } catch { setNestedData(null); }
    finally { setNestedLoading(false); }
  };

  /* ==============================================================
     导入导出
     ============================================================== */

  const handleExportAssemblies = async () => {
    try {
      await exportAssembliesToFolder();
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleImportAssembliesClick = async () => {
    setImportLoading(true);
    try {
      const preview = await previewAssembliesImport();
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

  const handleImportAssembliesConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      await executeAssembliesImport(importPreview);
      setImportPreviewOpen(false);
      setImportPreview(null);
      alert('导入成功');
    } catch (err: any) {
      alert(err.message || '导入执行失败');
    } finally {
      setImporting(false);
    }
  };

  /* ==============================================================
     Custom Field Render
     ============================================================== */

  const renderCustomFieldInput = (def: CustomFieldDefinition) => {
    const value = customFieldValues[def.id] ?? '';
    const handleChange = (v: unknown) => {
      setCustomFieldValues({ ...customFieldValues, [def.id]: v });
    };

    if (def.field_type === 'select' && def.options?.length) {
      return (
        <select
          value={value as string}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">请选择</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    if (def.field_type === 'number') {
      return (
        <input
          type="number"
          value={value as number}
          onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    }
    if (def.field_type === 'multiselect' && def.options?.length) {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2">
          {def.options.map((opt) => {
            const isChecked = selected.includes(opt);
            return (
              <label key={opt} className="inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    const next = isChecked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt];
                    handleChange(next);
                  }}
                  className="rounded"
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
    }
    return (
      <input
        type="text"
        value={value as string}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    );
  };

  /* ==============================================================
     子项表格渲染（编辑 + 详情共用）
     ============================================================== */

  const existingChildIds = new Set(editParts.map((p) => p.child_id));

  /** 渲染编辑态的子项表格 */
  const renderEditPartsTable = () => (
    <div className="border rounded-lg overflow-hidden mt-1">
      <div className="bg-gray-50 border-b px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">
          子项清单{editParts.length > 0 ? ` (${editParts.length})` : ''}
        </span>
        {canEdit() && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            + 添加子项
          </button>
        )}
      </div>
      {loadingEditParts ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
      ) : editParts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</div>
      ) : (
        <div className="max-h-[240px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">类型</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                <th className="px-3 py-2 text-right text-gray-500 font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {editParts.map((part) => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 text-xs rounded ${
                      part.childType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                    }`}>
                      {part.childType === 'part' ? '零件' : '部件'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{part.child_detail?.code || '-'}</td>
                  <td className="px-3 py-2">{part.child_detail?.name || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{part.child_detail?.spec || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{part.child_detail?.version || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(part.child_detail?.status || 'draft').cls}`}>
                      {statusTag(part.child_detail?.status || 'draft').label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      step="any"
                      value={part.quantity}
                      onChange={(e) => {
                        const qty = parseFloat(e.target.value);
                        if (!isNaN(qty) && qty > 0) {
                          setEditParts((prev) =>
                            prev.map((p) => (p.id === part.id ? { ...p, quantity: qty } : p)),
                          );
                        }
                      }}
                      onBlur={() => handleUpdateQuantity(part.id, part.quantity)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {canEdit() && (
                        <button
                          type="button"
                          onClick={() => setVersionSelectState({
                            itemId: part.id,
                            childId: part.child_id,
                            childType: part.childType === 'component' ? 'assembly' : part.childType,
                            childName: part.child_detail?.code || part.child_detail?.name || '',
                          })}
                          className="text-primary-600 hover:text-primary-800 text-xs"
                          title="选择版本"
                        >
                          选择
                        </button>
                      )}
                      {isAdmin() && (
                        <button
                          type="button"
                          onClick={() => handleRemovePart(part.id)}
                          className="text-red-500 hover:text-red-700 text-xs"
                          title="移除子项"
                        >
                          移除
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  /** 渲染一行树节点（详情态） */
  const renderViewTreeNode = (node: TreeNode) => {
    const { item, level, children, hasChildren } = node;

    return (
      <tr key={item.id} className="hover:bg-gray-50">
        {/* 层级 */}
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
          <span className="text-xs text-gray-400">L{level + 1}</span>
          {hasChildren && (
            <button
              onClick={() => toggleExpand(node)}
              className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
            >
              {children.length > 0 ? '▼' : '▶'}
            </button>
          )}
        </td>
        {/* 类型 */}
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 text-xs rounded ${
            item.childType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
          }`}>
            {item.childType === 'part' ? '零件' : '部件'}
          </span>
        </td>
        {/* 件号 */}
        <td className="px-3 py-2 font-medium">
          {hasChildren ? (
            <button
              onClick={() => handleView(item.child_detail! as unknown as Assembly)}
              className="text-primary-600 hover:text-primary-800 hover:underline"
              title="点击查看部件详情"
            >
              {item.child_detail?.code || '-'}
            </button>
          ) : (
            item.child_detail?.code || '-'
          )}
        </td>
        {/* 中文名称 */}
        <td className="px-3 py-2">{item.child_detail?.name || '-'}</td>
        {/* 规格型号 */}
        <td className="px-3 py-2 text-gray-500">{item.child_detail?.spec || '-'}</td>
        {/* 版本 */}
        <td className="px-3 py-2 text-gray-500">{item.child_detail?.version || '-'}</td>
        {/* 状态 */}
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag(item.child_detail?.status || 'draft').cls}`}>
            {statusTag(item.child_detail?.status || 'draft').label}
          </span>
        </td>
        {/* 用量 */}
        <td className="px-3 py-2">{item.quantity}</td>
      </tr>
    );
  };

  /** 渲染详情态的子项树表格 */
  // Note: renderViewPartsTable moved to AssemblyDetailContent component

  /* ==============================================================
     Render
     ============================================================== */

  return (
    <div>
      {/* 列表头部 */}
      <div className="flex items-center justify-end mb-4">
        <div className="flex gap-2">
          {canDownload() && (
            <button
              onClick={handleExportAssemblies}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              📥 导出全部
            </button>
          )}
          {canEdit() && (
            <button
              onClick={handleImportAssembliesClick}
              disabled={importLoading}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50"
            >
              {importLoading ? '解析中...' : '📤 导入'}
            </button>
          )}
          {canEdit() && (
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              + 新增部件
            </button>
          )}
        </div>
      </div>

      {/* 搜索 & 筛选 */}
      <div className="flex gap-2 mb-4">
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
          {componentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索全部字段...' : searchField.startsWith('cf_') ? `搜索${componentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '件号' : searchField === 'name' ? '中文名称' : searchField === 'spec' ? '规格型号' : searchField === 'version' ? '版本' : searchField === 'status' ? '状态' : '备注'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-4 h-4 text-primary-600 rounded"
          />
          显示全部版本
        </label>
      </div>

      {/* 列表表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th onClick={() => handleSort('code' as keyof Assembly)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">件号 {getSortIcon('code' as keyof Assembly)}</th>
              <th onClick={() => handleSort('name' as keyof Assembly)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">中文名称 {getSortIcon('name' as keyof Assembly)}</th>
              <th onClick={() => handleSort('spec' as keyof Assembly)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">规格型号 {getSortIcon('spec' as keyof Assembly)}</th>
              <th onClick={() => handleSort('version' as keyof Assembly)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">版本 {getSortIcon('version' as keyof Assembly)}</th>
              <th onClick={() => handleSort('status' as keyof Assembly)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">状态 {getSortIcon('status' as keyof Assembly)}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : filteredData.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  无匹配数据
                </td>
              </tr>
            ) : (
              displayData.map((assembly) => (
                <tr
                  key={assembly.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleView(assembly)}
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {assembly.code}
                    {!showAllVersions && (versionCountMap[assembly.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[assembly.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{assembly.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{assembly.spec || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{assembly.version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(assembly.status).cls}`}>
                      {statusTag(assembly.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleEdit(assembly)}
                      className="text-primary-600 hover:text-primary-800 mr-3"
                    >
                      编辑
                    </button>
                    {isAdmin() && (
                      <button
                        onClick={() => setDeleteId(assembly.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ========== 新增/编辑弹窗 ========== */}
      <Modal
        open={modalOpen}
        title={editingAssembly ? '编辑部件' : '新增部件'}
        onClose={() => setModalOpen(false)}
        width="full"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 基本属性 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                件号 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                中文名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">规格型号</label>
              <input
                type="text"
                value={formData.spec}
                onChange={(e) => setFormData({ ...formData, spec: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">版本</label>
              <input
                type="text"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="如: A, B, V1.0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="draft">草稿</option>
                <option value="frozen">冻结</option>
                <option value="released">发布</option>
                <option value="obsolete">作废</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
              <textarea
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                rows={1}
                placeholder="可选"
              />
            </div>
          </div>

          {/* 自定义字段 */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 gap-x-4">
                  {customFieldDefs.map((def) => (
                    <div key={def.id}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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

          {/* 关联图文档（仅编辑已有部件时显示） */}
          {editingAssembly && (
            <EntityDocumentSection entityType="assembly" entityId={editingAssembly.id} editable />
          )}

          {/* 子项管理（仅编辑时显示） */}
          {editingAssembly && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">子项管理</h4>
              {renderEditPartsTable()}
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

          {/* 底部操作 */}
           <div className="flex justify-between items-center gap-2 pt-4 border-t">
            <div>
              {editingAssembly &&
                (editingAssembly.status === 'released' || editingAssembly.status === 'obsolete') && (
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
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 子项选择弹窗 */}
      <AssemblyPartPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handleAddParts}
        currentAssemblyId={editingAssembly?.id}
        existingChildIds={existingChildIds}
      />

      {/* 子项版本选择弹窗 */}
      <VersionSelectModal
        open={!!versionSelectState}
        entityType={versionSelectState?.childType as 'part' | 'assembly' || 'part'}
        entityId={versionSelectState?.childId || ''}
        entityName={versionSelectState?.childName}
        currentVersionId={versionSelectState?.childId}
        onSelect={handleVersionSelectChild}
        onClose={() => setVersionSelectState(null)}
      />

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "确认删除"}
        content={deleteError || "确定要删除该部件吗？此操作不可撤销。"}
        confirmText={deleteError ? "知道了" : "删除"}
        cancelText="取消"
        type={deleteError ? "info" : "danger"}
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* ========== 详情弹窗 ========== */}
      <Modal
        open={!!viewingAssembly}
        title="部件详情"
        onClose={() => setViewingAssembly(null)}
        width="full"
      >
        {viewingAssembly && (
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
              <AssemblyDetailContent
                assembly={viewingAssembly}
                customFieldDefs={viewingCustomDefs}
                customFieldValues={viewingCustomValues}
                onSubItemClick={(item) => handleNestedView(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
              />
            ) : (
              <VersionHistory
                entityType="assembly"
                entityId={viewingAssembly.id}
                onViewVersion={async (id) => {
                  try {
                    const res = await assembliesApi.get(id);
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

      {/* ========== 嵌套详情弹窗（子项点击） ========== */}
      <Modal
        open={!!nestedEntity}
        title={nestedEntity ? (nestedEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setNestedEntity(null)}
        width="full"
      >
        {nestedLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !nestedData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : nestedEntity?.type === 'part' ? (
          <PartDetailContent part={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} />
        ) : (
          <AssemblyDetailContent assembly={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} onSubItemClick={(item) => handleNestedView(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
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
        onConfirm={handleImportAssembliesConfirm}
      />
    </div>
  );
}
