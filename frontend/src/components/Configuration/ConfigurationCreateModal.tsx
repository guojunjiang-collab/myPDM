import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import { configurationApi, partsApi, assembliesApi } from '../../services/api';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';
import EntityDocumentSection from '../EntityDocumentSection';
import EntityEditModal from '../EntityEditModal';
import type { ConfigurationItem } from '../../types';

interface Props {
  open: boolean;
  item?: ConfigurationItem;
  onClose: () => void;
  onSaved: () => void;
}

interface PartEntry {
  id?: string;
  part_type: string;
  part_id: string;
  part_code: string;
  part_name: string;
  part_version: string;
  part_spec: string;
  part_status: string;
  is_required: boolean;
  quantity: number;
}

interface ChildEntry {
  id?: string;         // relationship record ID (from configuration_item_children)
  child_id: string;
  child_code: string;
  child_name: string;
  child_remark?: string;
  quantity: number;
  is_required: boolean;
  has_children?: boolean;
  parent_id?: string;  // 父构型项 ID（嵌套行使用）
}

export default function ConfigurationCreateModal({ open, item, onClose, onSaved }: Props) {
  const isEdit = !!item;
  const [form, setForm] = useState({ code: '', name: '', spec: '', remark: '' });
  const [creatorName, setCreatorName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  // 弹窗打开或备注内容变化时，自适应 textarea 高度
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const el = remarkRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, form.remark]);

  // 关联零部件
  const [parts, setParts] = useState<PartEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionSelectIdx, setVersionSelectIdx] = useState<number | null>(null);

  // 子构型项
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [cfgPickerOpen, setCfgPickerOpen] = useState(false);
  const [cfgSearch, setCfgSearch] = useState('');
  const [cfgResults, setCfgResults] = useState<any[]>([]);
  const [cfgSearching, setCfgSearching] = useState(false);
  const cfgReqId = useRef(0);
  const [pickerSelected, setPickerSelected] = useState<any[]>([]);
  const [pickerParentId, setPickerParentId] = useState<string | null>(null); // null=根级, string=指定父级子项
  const [pickerParentIdx, setPickerParentIdx] = useState<string | null>(null); // 父行的 idx，用于标记 has_children
  // 快速新建构型项
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '', remark: '' });
  const [quickCreating, setQuickCreating] = useState(false);
  // 嵌套编辑（子项行点击）
  const [nestedEditItem, setNestedEditItem] = useState<ConfigurationItem | null>(null);
  // 关联零部件行点击 → 编辑零件/部件
  const [editingPartEntity, setEditingPartEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);

  // 按构型号排序（定义在 useEffect 之前）
  const sortByCode = (items: any[]) =>
    [...items].sort((a, b) => (a.child_code || '').localeCompare(b.child_code || '', 'zh-CN', { numeric: true }));

  // 子构型项树形展开
  const [expandedChild, setExpandedChild] = useState<Record<string, any[]>>({});
  const [noChildren, setNoChildren] = useState<Set<string>>(new Set());
  const [loadingChild, setLoadingChild] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(item ? {
        code: item.code, name: item.name, spec: item.spec || '',
        remark: item.remark || '',
      } : { code: '', name: '', spec: '', remark: '' });
      setCreatorName((item as any)?.creator_name || '');
      setError('');
      setExpandedChild({}); setNoChildren(new Set()); setLoadingChild(null);
      // Load existing parts and children for edit mode
      if (item?.id) {
        configurationApi.getItem(item.id).then(r => {
          const d = r.data;
          setForm({ code: d.code, name: d.name, spec: d.spec || '', remark: d.remark || '' });
          setCreatorName(d.creator_name || '');
          setParts((r.data.parts || []).map((p: any) => ({
            id: p.id, part_type: p.part_type, part_id: p.part_id,
            part_code: p.part_detail?.code || '', part_name: p.part_detail?.name || '',
            part_version: p.part_detail?.version || '', part_spec: p.part_detail?.spec || '',
            part_status: p.part_detail?.status || '', is_required: p.is_required,
            quantity: p.quantity ?? 1,
          })));
          setChildren(sortByCode((r.data.children || []).map((c: any) => ({
            id: c.id, child_id: c.child_id,
            child_code: c.child_detail?.code || '', child_name: c.child_detail?.name || '',
            child_remark: c.child_detail?.remark || '',
            quantity: c.quantity ?? 1,
            is_required: c.is_required,
            has_children: c.has_children,
            parent_id: item.id,
          }) as ChildEntry)));
        }).catch(() => {});
      } else {
        setParts([]); setChildren([]);
      }
    }
  }, [open, item]);

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('构型号和中文名称不能为空'); return; }
    setSaving(true);
    try {
      let configId: string;
      if (isEdit) {
        await configurationApi.updateItem(item!.id, form);
        configId = item!.id;
      } else {
        const r = await configurationApi.createItem(form);
        configId = r.data.id;
      }
      // Save parts
      if (isEdit) {
        // Full replace: fetch existing data, remove all, then re-add current state
        try {
          const current = await configurationApi.getItem(configId);
          const existingParts = current.data?.parts || [];
          const existingChildren = current.data?.children || [];
          for (const p of existingParts) {
            try { await configurationApi.removePart(configId, p.id); } catch {}
          }
          for (const c of existingChildren) {
            try { await configurationApi.removeChild(configId, c.id); } catch {}
          }
        } catch {}
      }
      if (parts.length > 0) {
        await configurationApi.addParts(configId, parts.map(p => ({
          part_type: p.part_type, part_id: p.part_id, is_required: p.is_required, quantity: p.quantity ?? 1,
        })));
      }
      if (children.length > 0) {
        await configurationApi.addChildren(configId, children.map(c => ({
          child_id: c.child_id, is_required: c.is_required, quantity: c.quantity,
        })));
      }
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || '保存失败');
    } finally { setSaving(false); }
  };

  const togglePartRequired = (idx: number) => {
    setParts(prev => prev.map((p, i) => i === idx ? { ...p, is_required: !p.is_required } : p));
  };
  const updatePartQuantity = (idx: number, quantity: number) => {
    setParts(prev => prev.map((p, i) => i === idx ? { ...p, quantity } : p));
  };
  const toggleChildRequired = (idx: number) => {
    setChildren(prev => prev.map((c, i) => i === idx ? { ...c, is_required: !c.is_required } : c));
  };
  const updateChildQuantity = (idx: number, quantity: number) => {
    setChildren(prev => prev.map((c, i) => i === idx ? { ...c, quantity } : c));
  };

  // 刷新指定父级的展开子项
  const refreshParentChildren = (parentId: string) => {
    for (const [key, rows] of Object.entries(expandedChild)) {
      if (rows.length > 0 && rows[0].parent_id === parentId) {
        configurationApi.getItem(parentId).then(r => {
          const fresh = (r.data.children || []).map((c: any) => ({
            id: c.id, child_id: c.child_id,
            child_code: c.child_detail?.code || '', child_name: c.child_detail?.name || '',
            child_remark: c.child_detail?.remark || '',
            quantity: c.quantity ?? 1, is_required: c.is_required,
            has_children: c.has_children, parent_id: parentId,
          }));
          setExpandedChild(p => ({ ...p, [key]: sortByCode(fresh) }));
        }).catch(() => {});
        return;
      }
    }
  };

  // 嵌套行：即时更新属性
  // 嵌套行：即时更新属性（乐观更新 + API 后台调用）
  const updateNestedField = (c: ChildEntry, field: string, value: any) => {
    if (!c.parent_id) return;
    // 乐观更新本地状态
    for (const [key, rows] of Object.entries(expandedChild)) {
      const rowIdx = rows.findIndex((r: ChildEntry) => r.id === c.id);
      if (rowIdx >= 0) {
        setExpandedChild(prev => ({
          ...prev,
          [key]: prev[key].map((r: ChildEntry, i: number) => i === rowIdx ? { ...r, [field]: value } : r),
        }));
        break;
      }
    }
    // API 后台调用
    configurationApi.updateChild(c.parent_id, c.id!, { [field]: value }).catch(() => {
      refreshParentChildren(c.parent_id!);
    });
  };

  // 嵌套行：移除
  // 嵌套行：移除（乐观更新 + API 后台调用）
  const removeNestedChild = (c: ChildEntry) => {
    if (!c.parent_id) return;
    // 乐观更新本地状态
    for (const [key, rows] of Object.entries(expandedChild)) {
      if (rows.some((r: ChildEntry) => r.id === c.id)) {
        setExpandedChild(prev => ({
          ...prev,
          [key]: prev[key].filter((r: ChildEntry) => r.id !== c.id),
        }));
        break;
      }
    }
    // API 后台调用
    configurationApi.removeChild(c.parent_id, c.id!).catch(() => {
      refreshParentChildren(c.parent_id!);
    });
  };

  // 标记某行已有子项（添加子项后更新 has_children + 清除 noChildren）
  const markHasChildren = (idx: string) => {
    setNoChildren(prev => { const n = new Set(prev); n.delete(idx); return n; });
    const parts = idx.split('-');
    if (parts.length === 1) {
      // 根级行 → 更新 children 数组
      setChildren(prev => prev.map((c, i) => String(i) === idx ? { ...c, has_children: true } : c));
    } else {
      // 嵌套行 → 更新 expandedChild 中的父行
      const parentIdx = parts.slice(0, -1).join('-');
      const childIdx = parseInt(parts[parts.length - 1], 10);
      setExpandedChild(prev => {
        const rows = prev[parentIdx];
        if (!rows) return prev;
        return { ...prev, [parentIdx]: rows.map((r, i) => i === childIdx ? { ...r, has_children: true } : r) };
      });
    }
  };

  const toggleChildExpand = async (idx: string, childId: string) => {
    if (expandedChild[idx]) { setExpandedChild(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (noChildren.has(idx)) return;
    setLoadingChild(idx);
    try {
      const r = await configurationApi.getItem(childId);
      const subChildren = (r.data.children || []).map((c: any) => ({
        id: c.id,
        child_id: c.child_id,
        child_code: c.child_detail?.code || '',
        child_name: c.child_detail?.name || '',
        child_remark: c.child_detail?.remark || '',
        quantity: c.quantity ?? 1,
        is_required: c.is_required,
        has_children: c.has_children,
        parent_id: childId,
      }));
      if (subChildren.length > 0) {
        setExpandedChild(p => ({ ...p, [idx]: sortByCode(subChildren) }));
      } else {
        setNoChildren(prev => new Set(prev).add(idx));
      }
    } catch { setNoChildren(prev => new Set(prev).add(idx)); }
    finally { setLoadingChild(null); }
  };

  const renderChildRow = (c: ChildEntry, level: number, idx: string): React.ReactNode => {
    const childRows = expandedChild[idx];
    const hasChildren = c.has_children === true;
    const isEmpty = noChildren.has(idx);
    const childId = c.child_id;
    const isRoot = level === 0;
    const arrIndex = isRoot ? parseInt(idx, 10) : -1;
      const levelStr = '-'.repeat(level + 1) + (level + 1);

    return (
      <>
        <tr key={idx} className="hover:bg-gray-50">
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            {levelStr}
            {hasChildren && !isEmpty && (
              <button onClick={(e) => { e.stopPropagation(); toggleChildExpand(idx, childId); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '\u25bc' : '\u25b6'}
              </button>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-medium cursor-pointer hover:text-primary-600" onClick={() => setNestedEditItem({ id: c.child_id, code: c.child_code, name: c.child_name } as ConfigurationItem)}>{c.child_code}</td>
          <td className="px-3 py-2 text-sm cursor-pointer hover:text-primary-600" onClick={() => setNestedEditItem({ id: c.child_id, code: c.child_code, name: c.child_name } as ConfigurationItem)}>{c.child_name}</td>
          <td className="px-3 py-2 text-sm text-gray-500 cursor-pointer hover:text-primary-600" onClick={() => setNestedEditItem({ id: c.child_id, code: c.child_code, name: c.child_name } as ConfigurationItem)}>{c.child_remark || '-'}</td>
          <td className="px-3 py-2 text-center text-sm">
            {isRoot ? (
              <input type="number" min={1} value={c.quantity ?? 1}
                onChange={(e) => updateChildQuantity(arrIndex, parseInt(e.target.value) || 1)}
                className="w-14 text-center text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            ) : (
              <input type="number" min={1} value={c.quantity ?? 1}
                onChange={(e) => updateNestedField(c, 'quantity', parseInt(e.target.value) || 1)}
                className="w-14 text-center text-sm border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500" />
            )}
          </td>
          <td className="px-3 py-2 text-center text-sm">
            <button onClick={() => {
              if (isRoot) { toggleChildRequired(arrIndex); }
              else { updateNestedField(c, 'is_required', !c.is_required); }
            }}
              className={`px-2 py-0.5 text-sm rounded cursor-pointer ${c.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {c.is_required ? '必选' : '可选'}
            </button>
          </td>
          <td className="px-3 py-2 text-center text-sm">
            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
              <button onClick={() => {
                setPickerParentId(c.child_id); setPickerParentIdx(idx); setCfgSearch(''); setPickerSelected([]);
                setQuickCreateOpen(false); setQuickForm({ code: '', name: '', remark: '' });
                setCfgResults([]);
                setCfgPickerOpen(true);
              }}
                className="text-sm text-primary-600 hover:text-primary-800">＋子项</button>
              <button onClick={() => {
                if (isRoot) { setChildren(prev => prev.filter((_, j) => j !== arrIndex)); }
                else { removeNestedChild(c); }
              }}
                className="text-sm text-red-500 hover:text-red-700">移除</button>
            </div>
          </td>
        </tr>
        {childRows && childRows.map((cc: any, j: number) => renderChildRow(cc, level + 1, `${idx}-${j}`))}
        {loadingChild === idx && <tr><td colSpan={7} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  // 加载/搜索可选子构型项（exclude 规则与打开弹窗时一致；带请求竞态守卫）
  const loadCfgItems = (search: string) => {
    const reqId = ++cfgReqId.current;
    setCfgSearching(true);
    const params: any = { page: 1, page_size: 100 };
    const excludeId = pickerParentId ?? item?.id;
    if (item?.id && excludeId) params.exclude_ancestors_of = excludeId;
    const kw = search.trim();
    if (kw) params.search = kw;
    configurationApi.listItems(params)
      .then(r => { if (reqId === cfgReqId.current) setCfgResults(r.data.items || []); })
      .catch(() => { if (reqId === cfgReqId.current) setCfgResults([]); })
      .finally(() => { if (reqId === cfgReqId.current) setCfgSearching(false); });
  };

  // 选择子构型项弹窗：随输入实时刷新列表（防抖 250ms）；打开弹窗时也会触发首次加载
  useEffect(() => {
    if (!cfgPickerOpen) return;
    setCfgSearching(true);
    const t = setTimeout(() => loadCfgItems(cfgSearch), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgPickerOpen, cfgSearch, pickerParentId]);

  return (
    <>
    <Modal open={open} onClose={onClose} title={isEdit ? '编辑构型项' : '新建构型项'} width="3xl">
      <div className="flex flex-col max-h-[75vh]">
        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

        {/* 基本信息 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">构型号 *</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300" placeholder="如 CFG-001" />
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">中文名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder:text-gray-300" placeholder="如 A型机翼构型" />
          </div>
          {item && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">创建人</label>
              <div className="text-sm text-gray-700 py-1">{creatorName || '-'}</div>
            </div>
          )}
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 col-span-2 md:col-span-4">
            <label className="block text-xs text-gray-500 mb-0.5">备注</label>
            <textarea ref={remarkRef} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={1}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = el.scrollHeight + 'px';
              }}
            />
          </div>
        </div>

        {/* 关联零部件 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">关联零部件 ({parts.length})</h4>
            <button type="button" onClick={() => setPickerOpen(true)}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">关联零部件</button>
          </div>
          {parts.length === 0 ? (
            <p className="text-xs text-gray-400">暂无关联零部件，点击"关联零部件"添加</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">类型</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">件号</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">名称</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-14">版本</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">状态</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-16">用量</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-20">必选/可选</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                   {parts.map((p, i) => (
                     <tr key={i} className="hover:bg-gray-50 cursor-pointer" onClick={() => setEditingPartEntity({ type: p.part_type as 'part' | 'assembly', id: p.part_id })}>
                       <td className="px-3 py-1.5 text-xs">
                         <span className={`px-1.5 py-0.5 rounded text-xs ${p.part_type === 'assembly' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                           {p.part_type === 'assembly' ? '部件' : '零件'}
                         </span>
                       </td>
                       <td className="px-3 py-1.5 text-xs font-mono">{p.part_code}</td>
                       <td className="px-3 py-1.5 text-xs">{p.part_name}</td>
                       <td className="px-3 py-1.5 text-xs text-gray-500">{p.part_spec || '-'}</td>
                       <td className="px-3 py-1.5 text-xs">{p.part_version || '-'}</td>
                       <td className="px-3 py-1.5 text-xs">
                         <span className={`px-1.5 py-0.5 rounded text-xs ${p.part_status === 'draft' ? 'bg-blue-100 text-blue-800' : p.part_status === 'frozen' ? 'bg-orange-100 text-orange-800' : p.part_status === 'released' ? 'bg-green-100 text-green-800' : p.part_status === 'obsolete' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                           {p.part_status === 'draft' ? '草稿' : p.part_status === 'frozen' ? '冻结' : p.part_status === 'released' ? '发布' : p.part_status === 'obsolete' ? '作废' : '-'}
                         </span>
                       </td>
                       <td className="px-3 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                         <input type="number" min={1} value={p.quantity ?? 1}
                           onChange={(e) => updatePartQuantity(i, parseInt(e.target.value) || 1)}
                           className="w-14 text-center text-xs border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-500" />
                       </td>
                       <td className="px-3 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                         <button onClick={() => togglePartRequired(i)}
                           className={`px-2 py-0.5 text-xs rounded ${p.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                           {p.is_required ? '必选' : '可选'}
                         </button>
                       </td>
                       <td className="px-3 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                         <div className="flex gap-1 justify-center">
                           <button onClick={() => setVersionSelectIdx(i)}
                             className="text-xs text-blue-600 hover:text-blue-800">选择</button>
                           <button onClick={() => setParts(prev => prev.filter((_, j) => j !== i))}
                             className="text-xs text-red-500 hover:text-red-700">移除</button>
                         </div>
                       </td>
                     </tr>
                   ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 子构型项 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">子构型项 ({children.length})</h4>
            <button type="button" onClick={() => {
              setPickerParentId(null); setCfgSearch(''); setPickerSelected([]);
              setQuickCreateOpen(false); setQuickForm({ code: '', name: '', remark: '' });
              setCfgResults([]); setCfgPickerOpen(true);
            }}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">添加子构型项</button>
          </div>

          {/* 构型项选择器弹窗 */}
          {cfgPickerOpen && (
                <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center" onClick={() => { setCfgPickerOpen(false); setPickerParentId(null); }}>
              <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{pickerParentId ? '选择子构型项（添加至下级）' : '选择子构型项'}</h4>
                  <button onClick={() => setCfgPickerOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>

                {/* 已选子项 */}
                <div className="border-b">
                  <div className="bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700">已选子项 ({pickerSelected.length})</div>
                  {pickerSelected.length === 0 ? (
                    <div className="px-4 py-4 text-center text-sm text-gray-400">请在下方列表中选择</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 border-b"><tr>
                          <th className="px-3 py-2 text-left text-xs text-gray-500">构型号</th>
                          <th className="px-3 py-2 text-left text-xs text-gray-500">名称</th>
                          <th className="px-3 py-2 text-right text-xs text-gray-500 w-12"></th>
                        </tr></thead>
                        <tbody className="divide-y">
                          {pickerSelected.map((s: any) => (
                            <tr key={s.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-xs">{s.code}</td>
                              <td className="px-3 py-2 text-xs">{s.name}</td>
                              <td className="px-3 py-2 text-right">
                                <button onClick={() => setPickerSelected(prev => prev.filter(x => x.id !== s.id))}
                                  className="text-xs text-red-500 hover:text-red-700">移除</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 搜索 + 快速新建 + 候选列表 */}
                <div className="px-4 flex-1 flex flex-col min-h-0">
                  <div className="flex gap-2 pt-4 pb-3 items-center flex-shrink-0">
                    <input value={cfgSearch} onChange={e => setCfgSearch(e.target.value)} autoFocus
                      className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm" placeholder="搜索构型号/名称（实时）..." />
                    {cfgSearching && <span className="text-xs text-gray-400 whitespace-nowrap">搜索中...</span>}
                  </div>

                  {/* 快速新建构型项 */}
                  <div className="border rounded-lg overflow-hidden mb-3 flex-shrink-0">
                    <button onClick={() => { setQuickCreateOpen(!quickCreateOpen); if (!quickCreateOpen) setQuickForm({ code: '', name: '', remark: '' }); }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 flex items-center gap-1">
                      <span className="text-xs">{quickCreateOpen ? '▼' : '▶'}</span>
                      快速新建构型项
                    </button>
                    {quickCreateOpen && (
                      <div className="px-4 py-3 border-t space-y-2 bg-gray-50">
                        <div className="flex gap-2">
                          <input value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })}
                            placeholder="构型号 *" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
                          <input value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })}
                            placeholder="名称 *" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
                        </div>
                        <div className="flex gap-2">
                          <input value={quickForm.remark} onChange={e => setQuickForm({ ...quickForm, remark: e.target.value })}
                            placeholder="备注（可选）" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
                          <button onClick={async () => {
                            if (!quickForm.code.trim() || !quickForm.name.trim()) return;
                            setQuickCreating(true);
                            try {
                              const r = await configurationApi.createItem({ code: quickForm.code.trim(), name: quickForm.name.trim(), remark: quickForm.remark.trim() || undefined });
                              const newItem = { id: r.data.id, code: r.data.code, name: r.data.name, spec: r.data.spec || '', remark: r.data.remark || '' };
                              setPickerSelected(prev => [...prev, newItem]);
                              setQuickForm({ code: '', name: '', remark: '' });
                            } catch (e: any) { /* 失败静默，用户可重试 */ }
                            finally { setQuickCreating(false); }
                          }} disabled={quickCreating}
                            className="px-4 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap">
                            {quickCreating ? '创建中...' : '新建并添加'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto border border-gray-200 rounded">
                    {cfgResults.length === 0 ? (
                      <div className="text-center py-8 text-sm text-gray-400">{cfgSearching ? '加载中...' : '无可用构型项'}</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 border-b">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs text-gray-500">构型号</th>
                            <th className="px-3 py-2 text-left text-xs text-gray-500">名称</th>
                            <th className="px-3 py-2 text-left text-xs text-gray-500">规格型号</th>
                            <th className="px-3 py-2 text-center text-xs text-gray-500 w-20">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {cfgResults.filter((r: any) => !children.some(c => c.child_id === r.id) && !pickerSelected.some(s => s.id === r.id) && r.id !== pickerParentId).map((r: any) => (
                            <tr key={r.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium text-xs">{r.code}</td>
                              <td className="px-3 py-2 text-xs">{r.name}</td>
                              <td className="px-3 py-2 text-xs text-gray-400">{r.spec || '-'}</td>
                              <td className="px-3 py-2 text-center">
                                <button onClick={() => setPickerSelected(prev => [...prev, r])}
                                  className="px-2.5 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">添加</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* 底部按钮 */}
                <div className="px-4 py-3 border-t flex justify-end gap-2">
                  <button onClick={() => { setCfgPickerOpen(false); setPickerParentId(null); }}
                    className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50">取消</button>
                  <button onClick={async () => {
                    if (pickerParentId) {
                      // 向指定父级添加子项 → 即时 API
                      if (pickerSelected.length > 0) {
                        await configurationApi.addChildren(pickerParentId, pickerSelected.map((s: any) => ({
                          child_id: s.id, is_required: true, quantity: 1,
                        })));
                        if (pickerParentIdx) markHasChildren(pickerParentIdx);
                        refreshParentChildren(pickerParentId);
                      }
                    } else {
                      setChildren(prev => sortByCode([...prev, ...pickerSelected.map((s: any) => ({
                        child_id: s.id, child_code: s.code, child_name: s.name, child_remark: s.remark || '', quantity: 1, is_required: true,
                        has_children: false,
                      }))]));
                    }
                    setCfgPickerOpen(false);
                    setPickerParentId(null); setPickerParentIdx(null);
                  }}
                    className="px-4 py-2 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">确认添加 ({pickerSelected.length})</button>
                </div>
              </div>
            </div>
          )}

          {children.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">暂无子构型项，点击"添加子构型项"选择</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">层级</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">构型号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">备注</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-16">数量</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-24">必选/可选</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-28">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {children.map((c, i) => renderChildRow(c, 0, String(i)))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 关联图文档（仅编辑模式） */}
        {isEdit && item && (
          <EntityDocumentSection entityType="configuration" entityId={item.id} entityCode={item.code} entityName={item.name} editable />
        )}

        </div>
        <div className="flex-shrink-0 flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">取消</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 零部件选择器 */}
      <AssemblyPartPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
        onConfirm={async (items) => {
          for (const it of items) {
            const key = `${it.child_type}_${it.child_id}`;
            const exists = parts.some(p => `${p.part_type}_${p.part_id}` === key);
            if (exists) continue;
            let code = ''; let name = ''; let ver = ''; let spec = ''; let status = '';
            try {
              const api = it.child_type === 'assembly' ? assembliesApi : partsApi;
              const r = await api.get(it.child_id);
              code = r.data.code; name = r.data.name; ver = r.data.version || '';
              spec = r.data.spec || ''; status = r.data.status || '';
            } catch {}
            setParts(prev => [...prev, { part_type: it.child_type === 'assembly' ? 'assembly' : 'part', part_id: it.child_id, part_code: code, part_name: name, part_version: ver, part_spec: spec, part_status: status, is_required: true, quantity: it.quantity ?? 1 }]);
          }
          setPickerOpen(false);
        }}
      />

      {/* 版本选择器 */}
      {versionSelectIdx !== null && parts[versionSelectIdx] && (
        <VersionSelectModal
          open={versionSelectIdx !== null}
          entityType={parts[versionSelectIdx].part_type === 'assembly' ? 'assembly' : 'part'}
          entityId={parts[versionSelectIdx].part_id}
          entityName={parts[versionSelectIdx].part_name}
          currentVersionId={parts[versionSelectIdx].part_id}
          onSelect={(versionId: string) => {
            const api = parts[versionSelectIdx].part_type === 'assembly' ? assembliesApi : partsApi;
            api.get(versionId).then(r => {
              setParts(prev => prev.map((p, i) => i === versionSelectIdx ? {
                ...p, part_id: versionId,
                part_code: r.data.code, part_name: r.data.name,
                part_version: r.data.version || '', part_spec: r.data.spec || '', part_status: r.data.status || '',
              } : p));
            }).catch(() => {});
            setVersionSelectIdx(null);
          }}
          onClose={() => setVersionSelectIdx(null)}
        />
      )}
    </Modal>

    {/* 子项行点击 → 嵌套编辑弹窗 */}
    {nestedEditItem && (
      <ConfigurationCreateModal
        open={!!nestedEditItem}
        item={nestedEditItem}
        onClose={() => setNestedEditItem(null)}
        onSaved={() => {
          setNestedEditItem(null);
          // 刷新父级及所有已展开子项列表
          if (item?.id) {
            configurationApi.getItem(item.id).then(r => {
              setChildren(sortByCode((r.data.children || []).map((c: any) => ({
                id: c.id, child_id: c.child_id,
                child_code: c.child_detail?.code || '', child_name: c.child_detail?.name || '',
                child_remark: c.child_detail?.remark || '',
                quantity: c.quantity ?? 1,
                is_required: c.is_required,
                has_children: c.has_children,
                parent_id: item.id,
              }))));
            }).catch(() => {});
            // 刷新所有展开的深层子项
            for (const [key, rows] of Object.entries(expandedChild)) {
              if (rows.length > 0 && rows[0].parent_id) {
                configurationApi.getItem(rows[0].parent_id).then(r2 => {
                  setExpandedChild(prev => ({
                    ...prev,
                    [key]: sortByCode((r2.data.children || []).map((c: any) => ({
                      id: c.id, child_id: c.child_id,
                      child_code: c.child_detail?.code || '', child_name: c.child_detail?.name || '',
                      child_remark: c.child_detail?.remark || '',
                      quantity: c.quantity ?? 1,
                      is_required: c.is_required,
                      has_children: c.has_children,
                      parent_id: rows[0].parent_id,
                    }))),
                  }));
                }).catch(() => {});
              }
            }
          }
        }}
      />
    )}
    {/* 关联零部件行点击 → 编辑零件/部件 */}
    {editingPartEntity && (
      <EntityEditModal
        open={!!editingPartEntity}
        entityType={editingPartEntity.type}
        entityId={editingPartEntity.id}
        onClose={() => setEditingPartEntity(null)}
        onSaved={() => {
          const target = editingPartEntity;
          setEditingPartEntity(null);
          // 刷新对应的零部件信息
          const api = target.type === 'assembly' ? assembliesApi : partsApi;
          api.get(target.id).then(r => {
            setParts(prev => prev.map(p => p.part_type === target.type && p.part_id === target.id ? {
              ...p,
              part_code: r.data.code,
              part_name: r.data.name,
              part_version: r.data.version || '',
              part_spec: r.data.spec || '',
              part_status: r.data.status || '',
            } : p));
          }).catch(() => {});
        }}
      />
    )}
    </>
  );
}
