import { useEffect, useState, useCallback } from 'react';
import { assembliesApi, assemblyPartsApi, customFieldsApi } from '../services/api';
import type { Assembly, AssemblyPartItem, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import AssemblyPartPicker from '../components/AssemblyPartPicker';
import { getNextVersion } from '../constants';
import { useDataStore } from '../stores/data';
import { formatDateTime } from '../utils/date';

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
  const [status, setStatus] = useState('');

  /* ---- 编辑弹窗 ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState<Assembly | null>(null);
  const [formData, setFormData] = useState<AssemblyFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  /* ---- 子项（编辑） ---- */
  const [editParts, setEditParts] = useState<AssemblyPartItem[]>([]);
  const [loadingEditParts, setLoadingEditParts] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* ---- 详情弹窗 ---- */
  const [viewingAssembly, setViewingAssembly] = useState<Assembly | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, unknown>>({});
  const [viewParts, setViewParts] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingViewParts, setLoadingViewParts] = useState(false);

  /* ---- 自定义字段 ---- */
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);

  const storeAssemblies = useDataStore((s) => s.assemblies);

  /* ==============================================================
     Data Loading
     ============================================================== */

  useEffect(() => {
    loadAssemblies();
  }, [search, status, storeAssemblies]);

  const loadAssemblies = async () => {
    const localAssemblies = useDataStore.getState().assemblies;
    if (localAssemblies.length > 0) {
      setAssemblies(localAssemblies);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await assembliesApi.list({ search, status });
      setAssemblies(Array.isArray(response.data) ? response.data : (response.data.items || []));
    } catch {
      /* handled silently */
    } finally {
      setLoading(false);
    }
  };

  const loadCustomFields = useCallback(async () => {
    const localDefs = useDataStore.getState().customFieldDefs;
    if (localDefs.length > 0) {
      setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('component')));
      return;
    }
    try {
      setLoadingCustomFields(true);
      const response = await customFieldsApi.listDefinitions();
      const defs = (response.data || []).filter((d: CustomFieldDefinition) => d.applies_to?.includes('component'));
      setCustomFieldDefs(defs);
    } catch {
      /* handled silently */
    } finally {
      setLoadingCustomFields(false);
    }
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
    try {
      await assembliesApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setAssemblies(
        useDataStore.getState().assemblies.filter((a) => a.id !== deleteId),
      );
    } catch {
      alert('删除失败');
    }
  };

  const handleView = async (assembly: Assembly) => {
    setViewingAssembly(assembly);
    setExpandedIds(new Set());
    const allDefs = useDataStore.getState().customFieldDefs;
    setViewingCustomDefs(allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('component')));
    await loadCustomFieldValues(assembly.id, true);
    const tree = await loadViewParts(assembly.id);
    setViewParts(tree);
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-12">层级</th>
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
              {editParts.map((part, idx) => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
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
                  <td className="px-3 py-2 text-gray-500">-</td>
                  <td className="px-3 py-2">-</td>
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
                  <td className="px-3 py-2 text-right">
                    {isAdmin() && (
                      <button
                        onClick={() => handleRemovePart(part.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                        title="删除子项"
                      >
                        删除
                      </button>
                    )}
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
    const indent = level * 24;

    return (
      <tr key={item.id} className="hover:bg-gray-50">
        {/* 层级 */}
        <td className="px-3 py-2 text-gray-400">
          <span style={{ paddingLeft: indent }}>
            {hasChildren ? (
              <button
                onClick={() => toggleExpand(node)}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600"
              >
                {children.length > 0 ? '▼' : '▶'}
              </button>
            ) : (
              <span className="inline-block w-5" />
            )}
          </span>
          {level > 0 && <span className="text-xs text-gray-400 ml-1">L{level}</span>}
          {level === 0 && <span className="text-xs text-gray-400 ml-1">L0</span>}
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
        <td className="px-3 py-2 text-gray-500">-</td>
        {/* 状态 */}
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag('draft').cls}`}>
            {statusTag('draft').label}
          </span>
        </td>
        {/* 用量 */}
        <td className="px-3 py-2">{item.quantity}</td>
      </tr>
    );
  };

  /** 渲染详情态的子项树表格 */
  const renderViewPartsTable = () => {
    const flatRows = flattenTree(viewParts);
    return (
      <div className="border rounded-lg overflow-hidden mt-1">
        {loadingViewParts && flatRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
        ) : flatRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">层级</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">类型</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {flatRows.map(renderViewTreeNode)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  /* ==============================================================
     Render
     ============================================================== */

  return (
    <div>
      {/* 列表头部 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">部件管理</h2>
        {canEdit() && (
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            + 新增部件
          </button>
        )}
      </div>

      {/* 搜索 & 筛选 */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索件号/中文名称..."
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
      </div>

      {/* 列表表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">件号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">中文名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">规格型号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">版本</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
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
            ) : assemblies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              assemblies.map((assembly) => (
                <tr
                  key={assembly.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleView(assembly)}
                >
                  <td className="px-4 py-3 text-sm font-medium">{assembly.code}</td>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={2}
              placeholder="可选"
            />
          </div>

          {/* 自定义字段 */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="space-y-3">
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
                    onClick={() =>
                      setFormData({ ...formData, version: getNextVersion(formData.version) })
                    }
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    title="升版"
                  >
                    升版
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

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title="确认删除"
        content="确定要删除该部件吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* ========== 详情弹窗 ========== */}
      <Modal
        open={!!viewingAssembly}
        title="部件详情"
        onClose={() => setViewingAssembly(null)}
        width="full"
      >
        {viewingAssembly && (
          <div className="space-y-4">
            {/* 基本属性 */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">件号</label>
                <div className="text-sm font-medium">{viewingAssembly.code}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">中文名称</label>
                <div className="text-sm">{viewingAssembly.name}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">规格型号</label>
                <div className="text-sm">{viewingAssembly.spec || '-'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
                <div className="text-sm">{viewingAssembly.version || '-'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
                <span className={`inline-block px-2 py-1 text-xs rounded-full ${statusTag(viewingAssembly.status).cls}`}>
                  {statusTag(viewingAssembly.status).label}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
                <div className="text-sm">{viewingAssembly.remark || '-'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
                <div className="text-sm">{formatDateTime(viewingAssembly.created_at)}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
                <div className="text-sm">{formatDateTime(viewingAssembly.updated_at)}</div>
              </div>
            </div>

            {/* 自定义字段 */}
            {viewingCustomDefs.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
                <div className="grid grid-cols-2 gap-4">
                  {viewingCustomDefs.map((def) => (
                    <div key={def.id}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {def.name}
                      </label>
                      <div className="text-sm">
                        {def.field_type === 'select'
                          ? String(
                              (def.options || []).find((o) => o === viewingCustomValues[def.id]) ||
                                viewingCustomValues[def.id] ||
                                '-',
                            )
                          : Array.isArray(viewingCustomValues[def.id])
                            ? ((viewingCustomValues[def.id] as string[]).join(', ') || '-')
                            : String(viewingCustomValues[def.id] ?? '-')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 子项清单 */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">子项清单</h4>
              {renderViewPartsTable()}
            </div>


          </div>
        )}
      </Modal>
    </div>
  );
}
