import { useState, useEffect, useMemo, useRef } from 'react';
import { bomApi, partsApi } from '../services/api';
import { Modal, MODAL_Z } from './Modal';
import { toast } from './Toast';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import TreeToggle from './ui/TreeToggle';

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
    return sortDir === 'asc' ? <span className="text-[var(--ui-text-secondary)] ml-0.5">↑</span> : <span className="text-[var(--ui-text-secondary)] ml-0.5">↓</span>;
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
    <Modal open={open} title="添加子项" onClose={handleCancel} width="full" zIndex={MODAL_Z.picker}>
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* ---- 1. 已选子项 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-[var(--ui-bg-subtle)] border-b px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              已选子项{selectedList.length > 0 ? ` (${selectedList.length})` : ''}
            </span>
          </div>
          {selectedList.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">请在下方列表中选择要添加的子项</div>
          ) : (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">件号</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">中文名称</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-24">用量</th>
                    <th className="px-3 py-2 text-right text-[var(--ui-text-secondary)] font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedList.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                      <td className="px-3 py-2 font-medium">{item.code}</td>
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version}</td>
                      <td className="px-3 py-2">
                        <Badge status={item.status} />
                      </td>
                      <td className="px-3 py-2">
                        <Input size="xs"
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10) || 1)}
                          className="!w-20 text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="danger"
                          size="xs"
                          onClick={() => removeFromSelected(item.id)}
                          title="移除"
                        >
                          ✕
                        </Button>
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
          <Input
            type="text"
            placeholder="搜索件号、名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-0"
          />
          <Select
            className="!w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="frozen">冻结</option>
            <option value="released">发布</option>
            <option value="obsolete">作废</option>
          </Select>
        </div>

        {/* ---- 快速新建 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center">
            <TreeToggle expanded={quickOpen} onClick={() => setQuickOpen(!quickOpen)} size="sm" />
            <Button variant="ghost" size="sm" className="flex-1 !justify-start" onClick={() => setQuickOpen(!quickOpen)}>
              快速新建零部件
            </Button>
          </div>
          {quickOpen && (
            <div className="px-4 py-3 border-t space-y-2 bg-[var(--ui-bg-subtle)]">
              <div className="flex gap-2">
                <Input size="xs" value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })} placeholder="件号 *" className="flex-1" />
                <Input size="xs" value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })} placeholder="名称 *" className="flex-1" />
              </div>
              <div className="flex gap-2">
                <Input size="xs" value={quickForm.spec} onChange={e => setQuickForm({ ...quickForm, spec: e.target.value })} placeholder="规格型号" className="flex-1" />
                <Button size="sm" onClick={async () => {
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
                }} disabled={quickCreating} className="whitespace-nowrap">
                  {quickCreating ? '创建中...' : '新建并添加'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ---- 3. 可选子项列表 ---- */}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
          <div className="overflow-y-auto max-h-64">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">无匹配结果</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0">
                  <tr>
                    <th onClick={() => handlePickerSort('code')} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium cursor-pointer select-none whitespace-nowrap">件号 {getPickerSortIcon('code')}</th>
                    <th onClick={() => handlePickerSort('name')} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium cursor-pointer select-none whitespace-nowrap">中文名称 {getPickerSortIcon('name')}</th>
                    <th onClick={() => handlePickerSort('version')} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16 cursor-pointer select-none whitespace-nowrap">版本 {getPickerSortIcon('version')}</th>
                    <th onClick={() => handlePickerSort('status')} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16 cursor-pointer select-none whitespace-nowrap">状态 {getPickerSortIcon('status')}</th>
                    <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const isAdded = selected.has(item.id);
                    return (
                      <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                        <td className="px-3 py-2 font-medium">
                          {item.code}
                        </td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version}</td>
                        <td className="px-3 py-2">
                          <Badge status={item.status} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isAdded ? (
                            <span className="text-xs text-green-600">已添加</span>
                          ) : (
                            <Button
                              size="xs"
                              onClick={() => addToSelected(item)}
                            >
                              添加
                            </Button>
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
          <span className="text-sm text-[var(--ui-text-secondary)]">
            已选 <span className="font-medium text-gray-700">{selectedList.length}</span> 项
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleCancel}
            >
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedList.length === 0}
            >
              确认添加
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
