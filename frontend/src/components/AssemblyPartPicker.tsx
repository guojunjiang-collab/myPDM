import { useState, useEffect, useMemo, useCallback } from 'react';
import { bomApi, partsApi } from '../services/api';
import EntityPickerModal from './ui/EntityPickerModal';
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

interface SelectedItem extends CandidateItem {
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
   Component（EntityPickerModal 薄封装，吸收原自绘骨架）
   ---------------------------------------------------------------- */

export default function AssemblyPartPicker({
  open,
  onClose,
  onConfirm,
  currentAssemblyId,
  existingChildIds = new Set(),
}: AssemblyPartPickerProps) {
  /* ---- 已选（受控：快速新建需追加；打开时重置） ---- */
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  /* ---- 数据源 ---- */
  const [ancestorIds, setAncestorIds] = useState<Set<string>>(new Set());

  /* ---- 快速新建 ---- */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '', spec: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setStatusFilter('');
    setQuickForm({ code: '', name: '', spec: '' });
    setQuickOpen(false);
    setQuickCreating(false);
    setRefreshToken(0);
    setAncestorIds(new Set()); // 先清空，避免首次拉取使用上次的旧排除集

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
    } else {
      setAncestorIds(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentAssemblyId]);

  const fetchData = useCallback(async (params: { search: string; status?: string }) => {
    const reqParams: any = { page_size: 200, show_all_versions: true };
    if (params.search.trim()) reqParams.search = params.search.trim();
    const r: any = await partsApi.list(reqParams);
    const items = r.items || r || [];
    const excludeIds = new Set([
      ...existingChildIds,
      ...ancestorIds,
      ...(currentAssemblyId ? [currentAssemblyId] : []),
    ]);
    return items
      .filter((p: any) => !excludeIds.has(p.revision_id))
      .filter((p: any) => !params.status || p.status === params.status)
      .map((p: any) => {
        const isAssembly = p.type === 'assembly';
        return {
          id: p.revision_id,
          code: p.code,
          name: p.name,
          spec: p.spec,
          version: p.version || (isAssembly ? 'V1.0' : 'A'),
          status: p.status,
          type: isAssembly ? 'component' : 'part',
        } as CandidateItem;
      });
  }, [existingChildIds, ancestorIds, currentAssemblyId]);

  const columns = useMemo(() => ([
    { key: 'code', title: '件号', width: '160px', render: (i: CandidateItem) => <span className="font-medium">{i.code}</span> },
    { key: 'name', title: '中文名称', render: (i: CandidateItem) => i.name },
    { key: 'version', title: '版本', width: '70px', render: (i: CandidateItem) => <span className="text-[var(--ui-text-secondary)]">{i.version}</span> },
    { key: 'status', title: '状态', width: '80px', render: (i: CandidateItem) => <Badge status={i.status} /> },
  ]), []);

  // filterParams 需稳定引用：仅 status/refreshToken/ancestorIds 变化时重建（避免每次渲染触发全量重拉）；
  // ancestorIds 纳入依赖使祖先链计算完成后自动重新拉取（排除集生效）
  const filterParams = useMemo(
    () => ({ status: statusFilter, r: refreshToken, ancestorTick: ancestorIds.size }),
    [statusFilter, refreshToken, ancestorIds],
  );

  const updateQuantity = (id: string, qty: number) => {
    setSelected(prev => prev.map(s => s.id === id ? { ...s, quantity: Math.max(1, qty || 1) } : s));
  };

  const handleQuickCreate = async () => {
    if (!quickForm.code.trim() || !quickForm.name.trim()) return;
    setQuickCreating(true);
    try {
      const created = await partsApi.create({ code: quickForm.code.trim(), name: quickForm.name.trim(), spec: quickForm.spec || undefined });
      const revId = created.latest_revision?.id;
      if (!revId) throw new Error('创建的零部件缺少版本信息');
      const version = created.latest_revision?.version || '-';
      const status = created.latest_revision?.status || 'draft';
      setSelected(prev => [...prev, { id: revId, code: created.code, name: created.name, spec: created.spec, version, status, type: 'part', quantity: 1 }]);
      setQuickForm({ code: '', name: '', spec: '' });
      setQuickOpen(false);
      setRefreshToken(t => t + 1);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '创建失败');
    } finally {
      setQuickCreating(false);
    }
  };

  return (
    <EntityPickerModal<SelectedItem>
      open={open}
      title="添加子项"
      onClose={() => { setSelected([]); onClose(); }}
      width="full"
      fetchData={fetchData}
      filterParams={filterParams}
      getKey={(i) => i.id}
      columns={columns}
      selected={selected}
      onSelectedChange={setSelected}
      selectedExtraTitle="用量"
      selectedExtra={(item) => (
        <Input size="xs"
          type="number"
          min={1}
          step={1}
          value={item.quantity}
          onChange={(e) => updateQuantity(item.id, parseInt(e.target.value, 10) || 1)}
          className="!w-20 text-right"
        />
      )}
      onConfirm={(items) => {
        onConfirm(items.map(v => ({ child_type: 'component', child_id: v.id, quantity: v.quantity })));
        setSelected([]);
        onClose();
      }}
      searchPlaceholder="搜索件号、名称..."
      filters={
        <Select className="!w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </Select>
      }
      quickCreate={
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center">
            <TreeToggle expanded={quickOpen} onClick={() => setQuickOpen(!quickOpen)} size="sm" />
            <Button variant="ghost" size="sm" className="flex-1 !justify-start" type="button" onClick={() => setQuickOpen(!quickOpen)}>
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
                <Button size="sm" type="button" onClick={handleQuickCreate} disabled={quickCreating} className="whitespace-nowrap">
                  {quickCreating ? '创建中...' : '新建并添加'}
                </Button>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
