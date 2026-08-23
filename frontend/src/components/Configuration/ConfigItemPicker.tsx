import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal';
import { configurationApi } from '../../services/api';
import { toast } from '../Toast';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import TreeToggle from '../ui/TreeToggle';

interface ConfigItem {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
}

interface SelectedItem extends ConfigItem {
  is_required: boolean;
}

interface ConfigItemPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { child_revision_id: string; is_required: boolean }[]) => void;
  excludeId?: string;
}

export default function ConfigItemPicker({ open, onClose, onConfirm, excludeId }: ConfigItemPickerProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Map());
    setSearch('');
    setStatusFilter('');
    setQuickOpen(false);
    setQuickForm({ code: '', name: '' });
    setLoading(true);
    configurationApi.list({ page: 1, page_size: 200 })
      .then((r) => {
        const all = ((r.items || []) as any[]).map((i: any) => ({
          id: i.revision_id || i.id || '',
          code: i.code || '',
          name: i.name || '',
          version: i.version || 'A',
          status: i.status || 'draft',
        } as ConfigItem));
        setItems(excludeId ? all.filter(i => i.id !== excludeId) : all);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, excludeId]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter(i => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (!kw) return true;
      return i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw);
    });
  }, [items, search, statusFilter]);

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  const addToSelected = (item: ConfigItem) => {
    if (selected.has(item.id)) return;
    setSelected(new Map(selected).set(item.id, { ...item, is_required: true }));
  };
  const removeFromSelected = (id: string) => {
    const next = new Map(selected); next.delete(id); setSelected(next);
  };

  const handleQuickCreate = async () => {
    if (!quickForm.code.trim() || !quickForm.name.trim()) return;
    setQuickCreating(true);
    try {
      const r = await configurationApi.create({ code: quickForm.code.trim(), name: quickForm.name.trim() });
      const newItem: ConfigItem = { id: r.id, code: quickForm.code.trim(), name: quickForm.name.trim(), version: 'A', status: 'draft' };
      setItems(prev => [newItem, ...prev]);
      setSelected(new Map(selected).set(newItem.id, { ...newItem, is_required: true }));
      setQuickForm({ code: '', name: '' });
      setQuickOpen(false);
    } catch { /* 静默失败 */ }
    finally { setQuickCreating(false); }
  };

  const handleConfirm = () => {
    if (selectedList.length === 0) return;
    onConfirm(selectedList.map(s => ({ child_revision_id: s.id, is_required: s.is_required })));
    onClose();
  };

  const handleCancel = () => { setSelected(new Map()); onClose(); };

  return (
    <Modal open={open} title="添加子构型项" onClose={handleCancel} width="xl" zIndex={60}>
      <div className="space-y-4 max-h-[70vh] flex flex-col">
        {/* ---- 1. 已选面板 ---- */}
        {selectedList.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-[var(--ui-text-secondary)] mb-2">
              已选子构型项 {selectedList.length > 0 ? `(${selectedList.length})` : ''}
            </h4>
            <div className="border rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">构型号</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
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
                      <td className="px-3 py-2 text-right">
                        <Button variant="danger" size="xs" onClick={() => removeFromSelected(item.id)} title="移除">✕</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---- 2. 搜索 & 筛选 ---- */}
        <div className="flex gap-2 items-center">
          <Input type="text" placeholder="搜索构型号、名称..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
              快速新建构型项
            </Button>
          </div>
          {quickOpen && (
            <div className="px-4 py-3 border-t space-y-2 bg-[var(--ui-bg-subtle)]">
              <div className="flex gap-2">
                <Input size="xs" value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })} placeholder="构型号 *" className="flex-1" />
                <Input size="xs" value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })} placeholder="名称 *" className="flex-1" />
                <Button size="sm" className="whitespace-nowrap" onClick={handleQuickCreate} disabled={quickCreating}>
                  {quickCreating ? '创建中...' : '新建并添加'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ---- 3. 候选列表 ---- */}
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
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">构型号</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                    <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const isAdded = selected.has(item.id);
                    return (
                      <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                        <td className="px-3 py-2 font-medium">{item.code}</td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version}</td>
                        <td className="px-3 py-2">
                          <Badge status={item.status} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isAdded ? (
                            <span className="text-xs text-green-600">已添加</span>
                          ) : (
                            <Button size="xs" onClick={() => addToSelected(item)}>添加</Button>
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

        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-[var(--ui-text-secondary)]">
            已选 <span className="font-medium text-gray-700">{selectedList.length}</span> 项
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleCancel}>取消</Button>
            <Button onClick={handleConfirm} disabled={selectedList.length === 0}>确认添加</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
