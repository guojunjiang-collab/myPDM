import { useState, useEffect, useMemo, useRef } from 'react';
import { bomApi, partsApi } from '../services/api';
import { Modal } from './Modal';
import { toast } from './Toast';

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */

interface CandidateItem {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  spec?: string;
  type: 'part' | 'component';
}

interface SelectedItem {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  type: 'part' | 'component';
  quantity: number;
}

interface AssemblyPartPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { child_type: string; child_id: string; quantity: number }[]) => void;
  currentAssemblyId?: string;
  existingChildIds?: Set<string>;
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

/* ----------------------------------------------------------------
   Component
   ---------------------------------------------------------------- */

export default function AssemblyPartPicker({
  open,
  onClose,
  onConfirm,
  currentAssemblyId,
  existingChildIds = new Set(),
}: AssemblyPartPickerProps) {
  /* ---- 筛选 ---- */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  /* ---- 已选 ---- */
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  /* ---- 数据源 ---- */
  const [fetchedParts, setFetchedParts] = useState<any[]>([]);
  const [ancestorIds, setAncestorIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '', spec: '', remark: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  /* 加载数据 */
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const loadParts = (keyword?: string) => {
    setLoading(true);
    const params: any = { page_size: 200, show_all_versions: true };
    if (keyword) params.search = keyword;
    partsApi.list(params)
      .then((r: any) => {
        const items = r.items || r || [];
        const transformed = items.map((p: any) => ({
          id: p.revision_id,
          code: p.code,
          name: p.name,
          spec: p.spec,
          version: p.version,
          status: p.status,
          type: p.type || 'part',
          component_type: p.type || 'part',
        }));
        setFetchedParts(transformed);
      })
      .catch(() => setFetchedParts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    setQuickForm({ code: '', name: '', spec: '', remark: '' });
    setQuickOpen(false);
    setQuickCreating(false);

    loadParts();

    // 计算祖先链：向上查找所有包含当前部件的父部件（避免自引用循环）
    if (currentAssemblyId) {
      bomApi.getAll()
        .then((r) => r.data as { parent_type: string; parent_id: string; child_type: string; child_id: string }[])
        .then((allItems) => {
          const childToParents = new Map<string, string[]>();
          for (const item of allItems) {
            if (item.child_type === 'assembly' || item.child_type === 'component') {
              const existing = childToParents.get(item.child_id) || [];
              existing.push(item.parent_id);
              childToParents.set(item.child_id, existing);
            }
          }
          const ancestors = new Set<string>();
          const queue = [currentAssemblyId];
          while (queue.length > 0) {
            const current = queue.shift()!;
            const parents = childToParents.get(current);
            if (parents) {
              for (const pid of parents) {
                if (!ancestors.has(pid)) {
                  ancestors.add(pid);
                  queue.push(pid);
                }
              }
            }
          }
          setAncestorIds(ancestors);
        })
        .catch(() => setAncestorIds(new Set()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentAssemblyId]);

  // 搜索时调用后端 API，300ms 防抖
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const keyword = search.trim();
    if (!keyword) {
      loadParts();
    } else {
      debounceRef.current = setTimeout(() => {
        loadParts(keyword);
      }, 300);
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, open]);

  const componentsList = fetchedParts;

  /* 合并所有零件+部件为一个列表 */
  const allCandidates = useMemo<CandidateItem[]>(() => {
    const excludeIds = new Set([
      ...existingChildIds,
      ...ancestorIds,
      ...(currentAssemblyId ? [currentAssemblyId] : []),
    ]);
    const result: CandidateItem[] = [];

    for (const c of componentsList) {
      if (!excludeIds.has(c.id)) {
        const isAssembly = c.type === 'assembly';
        result.push({ id: c.id, code: c.code, name: c.name, version: c.version || (isAssembly ? 'V1.0' : 'A'), status: c.status, spec: c.spec, type: isAssembly ? 'component' : 'part' });
      }
    }
    return result;
  }, [componentsList, existingChildIds, currentAssemblyId, ancestorIds]);

  /* 搜索 + 筛选 + 排序 */
  const handlePickerSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const getPickerSortIcon = (field: string) => {
    if (sortField !== field) return <span className="text-gray-300 ml-0.5">⇅</span>;
    return sortDir === 'asc' ? <span className="text-gray-500 ml-0.5">↑</span> : <span className="text-gray-500 ml-0.5">↓</span>;
  };
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let result = allCandidates.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        item.code.toLowerCase().includes(keyword) ||
        item.name.toLowerCase().includes(keyword)
      );
    });
    if (sortField) {
      result = [...result].sort((a, b) => {
        let va = ''; let vb = '';
        switch (sortField) {
          case 'type': va = '零部件'; vb = '零部件'; break;
          case 'code': va = a.code; vb = b.code; break;
          case 'name': va = a.name; vb = b.name; break;
          case 'version': va = a.version; vb = b.version; break;
          case 'status': va = a.status; vb = b.status; break;
        }
        const cmp = va.localeCompare(vb, 'zh-CN');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [allCandidates, search, statusFilter, sortField, sortDir]);

  /* ---- 操作 ---- */

  const addToSelected = (item: CandidateItem) => {
    if (selected.has(item.id)) return;
    setSelected(new Map(selected).set(item.id, { ...item, quantity: 1 }));
  };

  const removeFromSelected = (id: string) => {
    const next = new Map(selected);
    next.delete(id);
    setSelected(next);
  };

  const updateQuantity = (id: string, qty: number) => {
    const next = new Map(selected);
    const entry = next.get(id);
    if (entry) next.set(id, { ...entry, quantity: Math.max(1, qty) });
    setSelected(next);
  };

  const handleConfirm = () => {
    const result = Array.from(selected.values()).map((v) => ({
      child_type: 'component',
      child_id: v.id,
      quantity: v.quantity,
    }));
    onConfirm(result);
    setSelected(new Map());
    setSearch('');
    setStatusFilter('');
  };

  const handleCancel = () => {
    setSelected(new Map());
    setSearch('');
    setStatusFilter('');
    onClose();
  };

  /* 已选列表排序后的数组 */
  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  return (
    <Modal open={open} title="添加子项" onClose={handleCancel} width="full" zIndex={60}>
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* ---- 1. 已选子项 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              已选子项{selectedList.length > 0 ? ` (${selectedList.length})` : ''}
            </span>
          </div>
          {selectedList.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">请在下方列表中选择要添加的子项</div>
          ) : (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">用量</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedList.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{item.code}</td>
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 text-gray-500">{item.version}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10) || 1)}
                          className="w-20 px-2 py-1 border border-gray-300 rounded text-right text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => removeFromSelected(item.id)}
                          className="text-red-500 hover:text-red-700 text-xs"
                          title="移除"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ---- 2. 搜索 & 筛选 ---- */}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="搜索件号、名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="frozen">冻结</option>
            <option value="released">发布</option>
            <option value="obsolete">作废</option>
          </select>
        </div>

        {/* ---- 快速新建 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <button onClick={() => setQuickOpen(!quickOpen)} className="w-full px-4 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 flex items-center gap-1">
            <span className="text-xs">{quickOpen ? '▼' : '▶'}</span>
            快速新建零部件
          </button>
          {quickOpen && (
            <div className="px-4 py-3 border-t space-y-2 bg-gray-50">
              <div className="flex gap-2">
                <input value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })} placeholder="件号 *" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
                <input value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })} placeholder="名称 *" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div className="flex gap-2">
                <input value={quickForm.spec} onChange={e => setQuickForm({ ...quickForm, spec: e.target.value })} placeholder="规格型号" className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500" />
                <button onClick={async () => {
                  if (!quickForm.code.trim() || !quickForm.name.trim()) return;
                  setQuickCreating(true);
                  try {
                    const created = await partsApi.create({ code: quickForm.code.trim(), name: quickForm.name.trim(), spec: quickForm.spec || undefined });
                    const revId = created.latest_revision?.id;
                    if (!revId) throw new Error('创建的零部件缺少版本信息');
                    const version = created.latest_revision?.version || '-';
                    const status = created.latest_revision?.status || 'draft';
                    const newItem: SelectedItem = { id: revId, code: created.code, name: created.name, version, status, type: 'part', quantity: 1 };
                    setSelected(prev => new Map(prev).set(newItem.id, newItem));
                    const candidate: CandidateItem = { id: revId, code: created.code, name: created.name, spec: created.spec, version, status, type: 'part' };
                    setFetchedParts(prev => [...prev, candidate as any]);
                    setQuickForm({ code: '', name: '', spec: '', remark: '' });
                  } catch (e: any) {
                    toast.error(e?.response?.data?.detail || e?.message || '创建失败');
                  } finally { setQuickCreating(false); }
                }} disabled={quickCreating} className="px-4 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap">
                  {quickCreating ? '创建中...' : '新建并添加'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- 3. 可选子项列表 ---- */}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
          <div className="overflow-y-auto max-h-64">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">无匹配结果</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th onClick={() => handlePickerSort('code')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer select-none whitespace-nowrap">件号 {getPickerSortIcon('code')}</th>
                    <th onClick={() => handlePickerSort('name')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer select-none whitespace-nowrap">中文名称 {getPickerSortIcon('name')}</th>
                    <th onClick={() => handlePickerSort('version')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer select-none whitespace-nowrap">版本 {getPickerSortIcon('version')}</th>
                    <th onClick={() => handlePickerSort('status')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer select-none whitespace-nowrap">状态 {getPickerSortIcon('status')}</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-20">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const isAdded = selected.has(item.id);
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">
                          {item.code}
                        </td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-gray-500">{item.version}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isAdded ? (
                            <span className="text-xs text-green-600">已添加</span>
                          ) : (
                            <button
                              onClick={() => addToSelected(item)}
                              className="px-2.5 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                            >
                              添加
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ---- 底部操作 ---- */}
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-gray-500">
            已选 <span className="font-medium text-gray-700">{selectedList.length}</span> 项
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedList.length === 0}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              确认添加
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
