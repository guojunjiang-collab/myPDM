import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { assemblyPartsApi, componentsApi, customFieldsApi, bomApi } from '../services/api';
import type { Component, AssemblyPartItem, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin, canDownload, can, useAuthStore } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import AssemblyDetailContent from '../components/AssemblyDetailContent';
import PartDetailContent from '../components/PartDetailContent';
import BOMTraceModal from '../components/BOMTraceModal';
import VersionHistory from '../components/VersionHistory';
import VersionSelectModal from '../components/VersionSelectModal';
import AssemblyPartPicker from '../components/AssemblyPartPicker';
import EntityEditModal from '../components/EntityEditModal';
import EntityDocumentSection from '../components/EntityDocumentSection';
import { useDataStore } from '../stores/data';
import { useTableSort } from '../hooks/useTableSort';
import {
  exportAssembliesToFolder,
  exportSingleAssemblyBOM,
  previewAssembliesImport,
  executeAssembliesImport,
} from '../services/importExport';
import type { ImportPreview } from '../services/importExport';
import ImportPreviewModal from '../components/ImportPreviewModal';

/* ================================================================
   Types
   ================================================================ */

interface ComponentFormData {
  code: string;
  name: string;
  spec: string;
  version: string;
  status: string;
  remark: string;
}

const initialFormData: ComponentFormData = {
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
  const location = useLocation();
  /* ---- 列表状态 ---- */
  const [components, setComponents] = useState<Component[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [status, setStatus] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  // 仅显示顶层部件（不作为任何其它部件的子部件）。由服务端按 BOM 父子关系返回 id 集合后过滤。
  const [topLevelOnly, setTopLevelOnly] = useState(false);
  const [topLevelIds, setTopLevelIds] = useState<Set<string> | null>(null);

  // 反查弹窗
  const [traceEntity, setTraceEntity] = useState<{ type: 'part' | 'assembly'; id: string; code: string; name: string; version?: string } | null>(null);

  /* ---- 编辑弹窗 ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingComponent, setEditingComponent] = useState<Component | null>(null);
  const [formData, setFormData] = useState<ComponentFormData>(initialFormData);
  const specRef = useRef<HTMLTextAreaElement>(null);
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!modalOpen) return;
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

  /* ---- 导入导出 ---- */
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  /* ---- 子项（编辑） ---- */
  const [editParts, setEditParts] = useState<AssemblyPartItem[]>([]);
  const [loadingEditParts, setLoadingEditParts] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editSortField, setEditSortField] = useState<string | null>('code');
  const [editSortDir, setEditSortDir] = useState<'asc' | 'desc'>('asc');
  // 子项树形展开
  const [expandedParts, setExpandedParts] = useState<Record<string, any[]>>({});
  const [loadingPart, setLoadingPart] = useState<string | null>(null);
  // 选择器目标（null=当前部件, string=子部件ID）
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);

  const getEditSortIcon = (field: string) => {
    if (editSortField !== field) return <span className="text-gray-300 ml-0.5">⇅</span>;
    return editSortDir === 'asc' ? <span className="text-gray-500 ml-0.5">↑</span> : <span className="text-gray-500 ml-0.5">↓</span>;
  };

  const handleEditSort = (field: string) => {
    if (editSortField === field) {
      setEditSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setEditSortField(field);
      setEditSortDir('asc');
    }
  };

  // 展开/折叠子部件的子项
  const toggleEditExpand = async (idx: string, childId: string) => {
    if (expandedParts[idx]) { setExpandedParts(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    setLoadingPart(idx);
    try {
      const res = await assemblyPartsApi.list(childId);
      const children = (res.data || []).map((c: any) => ({
        ...c,
        childType: c.childType === 'component' ? 'assembly' : c.childType,
        parent_id: childId,
      }));
      setExpandedParts(p => ({ ...p, [idx]: children }));
    } catch { } finally { setLoadingPart(null); }
  };

  // 刷新指定父级的展开子项
  const refreshParentParts = (parentId: string) => {
    for (const [key, rows] of Object.entries(expandedParts)) {
      if (rows.length > 0 && rows[0]?.parent_id === parentId) {
        assemblyPartsApi.list(parentId).then(res => {
          const fresh = (res.data || []).map((c: any) => ({
            ...c, childType: c.childType === 'component' ? 'assembly' : c.childType, parent_id: parentId,
          }));
          setExpandedParts(p => ({ ...p, [key]: fresh }));
        }).catch(() => {});
        return;
      }
    }
  };

  // 嵌套行：移除
  const handleNestedRemove = async (parentId: string, itemId: string) => {
    await assemblyPartsApi.remove(parentId, itemId);
    refreshParentParts(parentId);
  };

  // 嵌套行：更新用量
  const handleNestedQuantity = async (parentId: string, itemId: string, qty: number) => {
    await assemblyPartsApi.update(parentId, itemId, { quantity: qty });
  };

  const sortedEditParts = useMemo(() => {
    if (!editSortField) return editParts;
    return [...editParts].sort((a, b) => {
      const getVal = (p: AssemblyPartItem) => {
        const d = p.child_detail;
        switch (editSortField) {
          case 'code': return d?.code || '';
          case 'name': return d?.name || '';
          case 'spec': return d?.spec || '';
          case 'version': return d?.version || '';
          case 'status': return d?.status || '';
          case 'quantity': return p.quantity || 0;
          default: return '';
        }
      };
      const va = String(getVal(a)); const vb = String(getVal(b));
      const cmp = va.localeCompare(vb, 'zh-CN');
      return editSortDir === 'asc' ? cmp : -cmp;
    });
  }, [editParts, editSortField, editSortDir]);
  const [versionSelectState, setVersionSelectState] = useState<{ itemId: string; childId: string; childType: string; childName: string; parentId: string; quantity: number } | null>(null);

/* ---- 详情弹窗 ---- */
  const [viewingComponent, setViewingComponent] = useState<Component | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, unknown>>({});
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');
  // 子项点击 → 嵌套详情弹窗
  const [nestedEntity, setNestedEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [nestedData, setNestedData] = useState<any>(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedCustomDefs, setNestedCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [nestedCustomValues, setNestedCustomValues] = useState<Record<string, any>>({});
  // 嵌套编辑
  const [nestedEdit, setNestedEdit] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const nestedReqId = useRef(0);
  // Tree state now managed by AssemblyDetailContent - kept for backward compat only
  const [viewParts, setViewPartsState] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIdsState] = useState<Set<string>>(new Set());
  const [noChildren, setNoChildren] = useState<Set<string>>(new Set());
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

  const storeComponents = useDataStore((s) => s.components);

  /* ==============================================================
     Data Loading
     ============================================================== */

  const { sortedData, handleSort, getSortIcon } = useTableSort<Component>(components, 'code', 'asc');

  // 获取部件适用的自定义字段定义
  const componentCustomDefs = customFieldDefs.filter((d) => d.applies_to?.includes('component'));

  // 筛选逻辑
  const filteredData = sortedData.filter(component => {
    // 仅顶层部件：只保留服务端返回的顶层 id 集合中的部件（集合加载完成前不显示）
    if (topLevelOnly && (!topLevelIds || !topLevelIds.has(component.id))) return false;
    if (status && component.status !== status) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
      // 基础字段搜索
      if (searchField === 'all') {
        if (match(component.code) || match(component.name) || match(component.spec) || match(component.version) || match(component.remark)) return true;
        // 搜索自定义字段
        const asmCustomValues = customFieldValuesMap[component.id] || {};
        for (const def of componentCustomDefs) {
          const val = asmCustomValues[def.id];
          if (val != null && String(val).toLowerCase().includes(keyword)) return true;
        }
        return false;
      }
      if (searchField === 'code') return match(component.code);
      if (searchField === 'name') return match(component.name);
      if (searchField === 'spec') return match(component.spec);
      if (searchField === 'version') return match(component.version);
      if (searchField === 'status') return match(component.status);
      if (searchField === 'remark') return match(component.remark);
      // 自定义字段搜索
      if (searchField.startsWith('cf_')) {
        const fieldId = searchField.replace('cf_', '');
        const asmCustomValues = customFieldValuesMap[component.id] || {};
        const val = asmCustomValues[fieldId];
        return val != null && String(val).toLowerCase().includes(keyword);
      }
      return true;
    }
    return true;
  });

  // 版本计数
  const versionCountMap: Record<string, number> = {};
  components.forEach(a => {
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
    loadComponents();
  }, [search, status, storeComponents]);

  // 勾选"仅顶层部件"时，向服务端拉取顶层部件 id 集合用于过滤；取消勾选则清空
  useEffect(() => {
    if (!topLevelOnly) { setTopLevelIds(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await componentsApi.list({ top_level: true, page_size: 10000, brief: true });
        const arr = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        if (!cancelled) setTopLevelIds(new Set(arr.map((a: any) => a.id)));
      } catch {
        if (!cancelled) setTopLevelIds(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [topLevelOnly, storeComponents]);

  // 从 URL 参数 auto-open 编辑弹窗
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const editId = params.get('edit');
    if (editId && components.length > 0 && !modalOpen) {
      const component = components.find(a => a.id === editId);
      if (component) {
        handleEdit(component);
        window.history.replaceState({}, '', '/components');
      }
    }
  }, [location.search, components]);

  const loadComponents = () => {
    const localComponents = useDataStore.getState().components;
    setComponents(localComponents);
    setLoading(false);
    // 加载自定义字段定义
    loadCustomFields();
    // 加载所有部件的自定义字段值
    loadAllCustomFieldValues(localComponents);
  };

  // 批量加载所有部件的自定义字段值
  const loadAllCustomFieldValues = async (componentsList: Component[]) => {
    if (componentsList.length === 0) return;
    try {
      const results = await Promise.allSettled(
        componentsList.map(asm => customFieldsApi.getValues('component', asm.id))
      );
      const map: Record<string, Record<string, unknown>> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const values: Record<string, unknown> = {};
          (result.value.data || []).forEach((v: CustomFieldValue) => {
            values[v.field_id] = v.value;
          });
          map[componentsList[index].id] = values;
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

  const loadCustomFieldValues = async (componentId: string, isView = false) => {
    try {
      const response = await customFieldsApi.getValues('component', componentId);
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

  const loadEditParts = useCallback(async (componentId: string) => {
    setLoadingEditParts(true);
    try {
      const res = await assemblyPartsApi.list(componentId);
      setEditParts(res.data || []);
    } catch {
      setEditParts([]);
    } finally {
      setLoadingEditParts(false);
    }
  }, []);

  /** 递归加载子项树 */
  const loadViewParts = useCallback(async (componentId: string): Promise<TreeNode[]> => {
    setLoadingViewParts(true);
    try {
      const res = await assemblyPartsApi.list(componentId);
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
        hasChildren: false,
        expanded: expandedIds.has(ci.id),
      }));
      return { ...node, children, hasChildren: childItems.length > 0 };
    } catch {
      return node;
    }
  }, [expandedIds]);

  /* ==============================================================
     子项操作
     ============================================================== */

  const handleAddParts = async (items: { child_type: string; child_id: string; quantity: number }[]) => {
    if (!editingComponent) return;
    try {
      const targetId = pickerTargetId || editingComponent.id;
      await Promise.all(items.map((it) => assemblyPartsApi.add(targetId, it)));
      if (pickerTargetId) {
        refreshParentParts(pickerTargetId);
      } else {
        await loadEditParts(editingComponent.id);
      }
      setPickerOpen(false);
      setPickerTargetId(null);
    } catch {
      alert('添加子项失败');
    }
  };

  const handleRemovePart = async (itemId: string) => {
    if (!editingComponent) return;
    try {
      await assemblyPartsApi.remove(editingComponent.id, itemId);
      await loadEditParts(editingComponent.id);
    } catch {
      alert('删除子项失败');
    }
  };

  const handleVersionSelectChild = async (selectedVersionId: string) => {
    if (!editingComponent || !versionSelectState) return;
    const { itemId, childType, parentId, quantity } = versionSelectState;
    // 顶层子项的父级是当前部件，嵌套子项的父级是其所属子部件
    const targetParentId = parentId || editingComponent.id;
    try {
      await assemblyPartsApi.remove(targetParentId, itemId);
      await assemblyPartsApi.add(targetParentId, {
        child_type: childType,
        child_id: selectedVersionId,
        quantity,
      });
      if (targetParentId === editingComponent.id) {
        await loadEditParts(editingComponent.id);
      } else {
        refreshParentParts(targetParentId);
      }
    } catch {
      alert('切换版本失败');
    } finally {
      setVersionSelectState(null);
    }
  };

  const handleUpdateQuantity = async (itemId: string, qty: number) => {
    if (!editingComponent) return;
    try {
      await assemblyPartsApi.update(editingComponent.id, itemId, { quantity: qty });
    } catch {
      alert('更新用量失败');
      await loadEditParts(editingComponent.id);
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
      const expandedNode = await expandChildren(node);
      if (expandedNode.children.length === 0) {
        setNoChildren(prev => new Set(prev).add(node.item.id));
      }
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
    setEditingComponent(null);
    setFormData(initialFormData);
    setCustomFieldValues({});
    setEditParts([]);
    setExpandedParts({});
    setLoadingPart(null);
    loadCustomFields();
    setModalOpen(true);
  };

  const handleEdit = async (component: Component) => {
    let a = component;
    try {
      const res = await componentsApi.get(component.id);
      a = { ...component, ...res.data };
    } catch {}
    setEditingComponent(a);
    setFormData({
      code: a.code,
      name: a.name,
      spec: a.spec || '',
      version: a.version || 'A',
      status: a.status,
      remark: a.remark || '',
    });
    // 重置上一次编辑遗留的嵌套展开状态（其 key 按行号索引，会与新部件的行号串台）
    setExpandedParts({});
    setLoadingPart(null);
    await loadCustomFields();
    await loadCustomFieldValues(component.id);
    loadEditParts(component.id);
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
      let newComponent: Component | null = null;
      if (editingComponent) {
        const res = await componentsApi.update(editingComponent.id, data);
        newComponent = res.data;
        useDataStore.getState().setComponents(
          useDataStore.getState().components.map((a) => (a.id === editingComponent.id ? newComponent! : a)),
        );
      } else {
        const res = await componentsApi.create(data);
        newComponent = res.data;
        useDataStore.getState().setComponents([...useDataStore.getState().components, newComponent!]);
      }

      const fieldValues = customFieldDefs
        .map((def) => ({
          field_id: def.id,
          value: customFieldValues[def.id] ?? null,
        }))
        .filter((fv) => fv.value !== null && fv.value !== '');

      if (fieldValues.length > 0) {
        await customFieldsApi.setValues('component', newComponent!.id, fieldValues);
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
            : editingComponent
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
      const res = await bomApi.checkReferences('component', deleteId);
      const refs = res.data || [];
      if (refs.length > 0) {
        const names = refs.map((r: any) => r.label).join(', ');
        setDeleteError('该零部件被以下实体引用，不能删除: ' + names);
        return;
      }
      await componentsApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setComponents(
        useDataStore.getState().components.filter((a) => a.id !== deleteId),
      );
    } catch {
      alert('删除失败');
    }
  };

  const handleUpgrade = async () => {
    if (!editingComponent) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await componentsApi.upgrade(editingComponent.id);
      const newComponent = res.data;
      useDataStore.getState().setComponents([...useDataStore.getState().components, newComponent]);
      setModalOpen(false);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: unknown } } };
      const detail = err?.response?.data?.detail;
      setSaveError(typeof detail === 'string' ? detail : '升版失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (component: Component) => {
    setViewingComponent(component);
    setDetailTab('detail');
    setExpandedIds(new Set());
    const allDefs = useDataStore.getState().customFieldDefs;
    setViewingCustomDefs(allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('component')));
    await loadCustomFieldValues(component.id, true);
    const tree = await loadViewParts(component.id);
    setViewParts(tree);
  };

  // 子项行点击 → 弹出嵌套详情
  const handleNestedView = async (type: 'part' | 'assembly', id: string) => {
    const reqId = ++nestedReqId.current;
    setNestedEntity({ type, id });
    setNestedData(null);
    setNestedLoading(true);
    setNestedCustomDefs([]);
    setNestedCustomValues({});
    try {
      const api = componentsApi;
      const res = await api.get(id);
      if (reqId !== nestedReqId.current) return; // 忽略过期请求
      setNestedData(res.data);
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setNestedCustomDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          if (reqId !== nestedReqId.current) return;
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setNestedCustomValues(vals);
        } catch { /* optional */ }
      }
    } catch {
      if (reqId !== nestedReqId.current) return;
      setNestedData(null);
    }
    finally {
      if (reqId === nestedReqId.current) {
        setNestedLoading(false);
      }
    }
  };

  /* ==============================================================
     导入导出
     ============================================================== */

  const handleExportComponents = async () => {
    try {
      await exportAssembliesToFolder();
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleExportSingleBOM = async (componentId: string) => {
    try {
      await exportSingleAssemblyBOM(componentId);
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleImportComponentsClick = async () => {
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

  const handleImportComponentsConfirm = async () => {
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
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
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
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
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
        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    );
  };

  /* ==============================================================
     子项表格渲染（编辑 + 详情共用）
     ============================================================== */

  const existingChildIds = new Set(editParts.map((p) => p.child_id));

  const renderPartRow = (part: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = part.childType === 'assembly' || part.childType === 'component';
    const childRows = expandedParts[idx];
    
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50">
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && (
              <button type="button" onClick={(e) => { e.stopPropagation(); toggleEditExpand(idx, part.child_id); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '\u25bc' : '\u25b6'}
              </button>
            )}
          </td>
          <td className="px-3 py-2 cursor-pointer" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>
            <span className={`px-1.5 py-0.5 text-xs rounded ${isAssembly ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
              {isAssembly ? '部件' : '零件'}
            </span>
          </td>
          <td className="px-3 py-2 font-medium cursor-pointer hover:text-primary-600" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>{part.child_detail?.code || '-'}</td>
          <td className="px-3 py-2 cursor-pointer hover:text-primary-600" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>{part.child_detail?.name || '-'}</td>
          <td className="px-3 py-2 text-gray-500 cursor-pointer hover:text-primary-600" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>{part.child_detail?.spec || '-'}</td>
          <td className="px-3 py-2 text-gray-500 cursor-pointer hover:text-primary-600" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>{part.child_detail?.version || '-'}</td>
          <td className="px-3 py-2 cursor-pointer" onClick={() => setNestedEdit({ type: isAssembly ? 'assembly' : 'part', id: part.child_id })}>
            <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(part.child_detail?.status || 'draft').cls}`}>
              {statusTag(part.child_detail?.status || 'draft').label}
            </span>
          </td>
          <td className="px-3 py-2">
            {level === 0 ? (
              <input type="number" min={1} step={1} value={part.quantity}
                onChange={(e) => { const qty = Math.floor(parseFloat(e.target.value)); if (!isNaN(qty) && qty > 0) { setEditParts((prev) => prev.map((p) => (p.id === part.id ? { ...p, quantity: qty } : p))); } }}
                onBlur={() => handleUpdateQuantity(part.id, part.quantity)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
            ) : (
              <input type="number" min={1} step={1} defaultValue={part.quantity}
                onBlur={(e) => { const v = parseInt(e.target.value); if (v > 0 && v !== part.quantity) handleNestedQuantity(part.parent_id || 'root', part.id, v); }}
                className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
            )}
          </td>
          <td className="px-3 py-2 text-right whitespace-nowrap">
            <span className="inline-flex items-center gap-1">
              {canEdit() && (
                <button type="button" onClick={() => setVersionSelectState({ itemId: part.id, childId: part.child_id, childType: part.childType === 'component' ? 'assembly' : part.childType, childName: part.child_detail?.code || part.child_detail?.name || '', parentId: level === 0 ? (editingComponent?.id || '') : (part.parent_id || ''), quantity: part.quantity })} className="text-primary-600 hover:text-primary-800 text-xs" title="选择版本">选择</button>
              )}
              {isAssembly && canEdit() && (
                <button type="button" onClick={() => { setPickerTargetId(part.child_id); setPickerOpen(true); }} className="text-primary-600 hover:text-primary-800 text-xs" title="添加子项">+子项</button>
              )}
              {canEdit() && (
                <button type="button" onClick={() => { if (level === 0) handleRemovePart(part.id); else handleNestedRemove(part.parent_id || 'root', part.id); }} className="text-red-500 hover:text-red-700 text-xs" title="移除子项">移除</button>
              )}
            </span>
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={9} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  /** 渲染编辑态的子项表格 */
  const renderEditPartsTable = () => (
    <div className="border rounded-lg overflow-hidden mt-1">
      {loadingEditParts ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
      ) : editParts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</div>
      ) : (
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">层级</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                <th className="px-3 py-2 text-right text-gray-500 font-medium w-32">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedEditParts.map((part: any, i: number) => renderPartRow(part, 0, String(i)))}
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
          {hasChildren && !noChildren.has(item.id) && (
            <button
              onClick={() => toggleExpand(node)}
              className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
            >
              {children.length > 0 ? '▼' : '▶'}
            </button>
          )}
        </td>
        {/* 件号 */}
        <td className="px-3 py-2 font-medium">
          {hasChildren ? (
            <button
              onClick={() => handleView(item.child_detail! as unknown as Component)}
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
    <div className="h-full flex flex-col">
      {/* 列表头部 */}
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
          {componentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${componentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '件号' : searchField === 'name' ? '名称' : searchField === 'spec' ? '规格型号' : searchField === 'version' ? '版本' : searchField === 'status' ? '状态' : '备注'}...`}
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
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap" title="只显示没有父部件的最顶层部件">
          <input
            type="checkbox"
            checked={topLevelOnly}
            onChange={(e) => setTopLevelOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          仅顶层部件
        </label>
        <div className="flex-1" />
        {isAdmin() && (
          <button onClick={handleExportComponents} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">📥 导出全部</button>
        )}
        {canEdit() && (
          <>
            <button onClick={handleImportComponentsClick} disabled={importLoading} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">{importLoading ? '解析中...' : '📤 导入'}</button>
          </>
        )}
        {canEdit() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新增零部件</button>
        )}
      </div>

      {/* 列表表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof Component)} className="w-56 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">件号 {getSortIcon('code' as keyof Component)}</th>
              <th onClick={() => handleSort('name' as keyof Component)} className="w-80 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">中文名称 {getSortIcon('name' as keyof Component)}</th>
              <th onClick={() => handleSort('spec' as keyof Component)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">规格型号 {getSortIcon('spec' as keyof Component)}</th>
              <th onClick={() => handleSort('version' as keyof Component)} className="w-14 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">版本 {getSortIcon('version' as keyof Component)}</th>
              <th onClick={() => handleSort('status' as keyof Component)} className="w-20 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">状态 {getSortIcon('status' as keyof Component)}</th>
              <th className="w-52 px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
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
              displayData.map((component) => (
                <tr
                  key={component.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleView(component)}
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {component.code}
                    {!showAllVersions && (versionCountMap[component.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[component.code] || 0)}个版本
                      </span>
                    )}
                  </td>
<td className="px-4 py-3 text-sm truncate">{component.name}</td>
<td className="px-4 py-3 text-sm text-gray-500 break-words whitespace-normal">{component.spec || '-'}</td>
<td className="px-4 py-3 text-sm text-gray-500">{component.version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(component.status).cls}`}>
                      {statusTag(component.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    {can('bom:trace') && (
                      <button
                        onClick={() => setTraceEntity({ type: 'assembly', id: component.id, code: component.code, name: component.name, version: component.version })}
                        className="text-indigo-600 hover:text-indigo-800 mr-3"
                      >
                        反查
                      </button>
                    )}
                    {canDownload() && (
                      <button
                        onClick={() => handleExportSingleBOM(component.id)}
                        className="text-green-600 hover:text-green-800 mr-3"
                      >
                        导出
                      </button>
                    )}
                    {(() => { const isCreator = (component as any).creator_id === useAuthStore.getState().user?.id; const canManage = isAdmin() || isCreator; return canManage && (
                      <button
                        onClick={() => handleEdit(component)}
                        className="text-primary-600 hover:text-primary-800 mr-3"
                      >
                        编辑
                      </button>
                    ); })()}
                    {(() => { const isCreator = (component as any).creator_id === useAuthStore.getState().user?.id; const canManage = isAdmin() || isCreator; return canManage && (
                      <button
                        onClick={() => setDeleteId(component.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        删除
                      </button>
                    ); })()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 反查弹窗 */}
      <BOMTraceModal entity={traceEntity} onClose={() => setTraceEntity(null)} />

      {/* ========== 新增/编辑弹窗 ========== */}
      <Modal
        open={modalOpen}
        title={editingComponent ? '编辑零部件' : '新增零部件'}
        onClose={() => setModalOpen(false)}
        width="full"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4 max-h-[80vh] overflow-y-auto px-1">
          {/* 基本属性 - 卡片式 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">件号 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={!!editingComponent && !(isAdmin() && formData.version === 'A')}
                title={editingComponent && isAdmin() ? (formData.version === 'A' ? '管理员可修改件号' : '仅 A 版允许修改件号，升版后的版本不可改') : undefined}
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
                onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
                rows={1}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none placeholder:text-gray-300"
              />
            </div>
            {editingComponent && (
              <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">创建人</label>
                <div className="text-sm text-gray-700 py-1">{(editingComponent as any).creator_name || '-'}</div>
              </div>
            )}
            <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
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
          </div>

          {/* 自定义字段 */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {customFieldDefs.map((def) => (
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

          {/* 关联图文档（仅编辑已有部件时显示） */}
          {editingComponent && (
            <EntityDocumentSection entityType="component" entityId={editingComponent.id} entityCode={editingComponent.code} entityName={editingComponent.name} editable />
          )}

          {/* 子项清单（仅编辑时显示） */}
          {editingComponent && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-700">子项清单</h4>
                {canEdit() && (
                  <button
                    type="button"
                    onClick={() => { setPickerTargetId(null); setExpandedParts({}); setPickerOpen(true); }}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                  >
                    + 添加子项
                  </button>
                )}
              </div>
              {renderEditPartsTable()}
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

          </div>
          {/* 底部操作 */}
           <div className="flex justify-between items-center gap-2 pt-4 border-t">
            <div>
              {editingComponent &&
                (editingComponent.status === 'released' || editingComponent.status === 'obsolete') && (
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
        onClose={() => { setPickerOpen(false); setPickerTargetId(null); }}
        onConfirm={handleAddParts}
        currentAssemblyId={pickerTargetId || editingComponent?.id}
        existingChildIds={pickerTargetId
          ? new Set([
              pickerTargetId,
              ...Object.values(expandedParts).flat().filter((p: any) => p.parent_id === pickerTargetId).map((p: any) => p.child_id),
            ])
          : new Set(editParts.map(p => p.child_id))}
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

      {/* 行点击 → 嵌套编辑弹窗 */}
      <EntityEditModal
        open={!!nestedEdit}
        entityType={nestedEdit?.type || 'part'}
        entityId={nestedEdit?.id || ''}
        onClose={() => setNestedEdit(null)}
        onSaved={() => {
          setNestedEdit(null);
          loadEditParts(editingComponent!.id);
        }}
      />

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "确认删除"}
        content={deleteError || "确定要删除该零部件吗？此操作不可撤销。"}
        confirmText={deleteError ? "知道了" : "删除"}
        cancelText="取消"
        type={deleteError ? "info" : "danger"}
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* ========== 详情弹窗 ========== */}
      <Modal
        open={!!viewingComponent}
        title="零部件详情"
        onClose={() => setViewingComponent(null)}
        width="full"
      >
        {viewingComponent && (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
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
                assembly={viewingComponent}
                customFieldDefs={viewingCustomDefs}
                customFieldValues={viewingCustomValues}
                onSubItemClick={(item) => handleNestedView(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
              />
            ) : (
              <VersionHistory
                entityType="component"
                entityId={viewingComponent.id}
                onViewVersion={async (id) => {
                  try {
                    const res = await componentsApi.get(id);
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
        title={nestedEntity ? (nestedEntity.type === 'part' ? '零件详情' : '零部件详情') : ''}
        onClose={() => { nestedReqId.current++; setNestedEntity(null); setNestedData(null); }}
        width="full"
      >
        <div className="max-h-[70vh] overflow-y-auto pr-1">
        {nestedLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !nestedData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : nestedEntity?.type === 'part' ? (
          <PartDetailContent part={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} />
        ) : (
          <AssemblyDetailContent assembly={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} onSubItemClick={(item) => handleNestedView(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
        )}
        </div>
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
        onConfirm={handleImportComponentsConfirm}
      />
    </div>
  );
}
