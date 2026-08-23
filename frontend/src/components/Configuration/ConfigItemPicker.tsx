import { useState, useEffect, useCallback, useMemo } from 'react';
import EntityPickerModal from '../ui/EntityPickerModal';
import { configurationApi } from '../../services/api';
import { toast } from '../Toast';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import TreeToggle from '../ui/TreeToggle';
import { compareVersions } from '../../constants';

interface ConfigItem {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
}

interface ConfigItemPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { child_revision_id: string; is_required: boolean }[]) => void;
  excludeId?: string;
}

/** 子构型项选择弹窗：EntityPickerModal 薄封装（吸收原自绘骨架） */
export default function ConfigItemPicker({ open, onClose, onConfirm, excludeId }: ConfigItemPickerProps) {
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<ConfigItem[]>([]);
  // quickCreate 后自增，触发 filterParams 变化重新拉取候选
  const [refreshToken, setRefreshToken] = useState(0);

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  // 打开时重置（与原实现一致）
  useEffect(() => {
    if (open) {
      setSelected([]);
      setStatusFilter('');
      setQuickOpen(false);
      setQuickForm({ code: '', name: '' });
      setRefreshToken(0);
    }
  }, [open]);

  const fetchData = useCallback(async (params: { search: string; status?: string }) => {
    const r = await configurationApi.list({ page: 1, page_size: 200 });
    const all = ((r.items || []) as any[]).map((i: any) => ({
      id: i.revision_id || i.id || '',
      code: i.code || '',
      name: i.name || '',
      version: i.version || 'A',
      status: i.status || 'draft',
    }) as ConfigItem);
    const kw = params.search.trim().toLowerCase();
    return all.filter((i) => {
      if (excludeId && i.id === excludeId) return false;
      if (params.status && i.status !== params.status) return false;
      if (!kw) return true;
      return i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw);
    });
  }, [excludeId]);

  const columns = useMemo(() => ([
    { key: 'code', title: '构型号', width: '140px', sortable: true, render: (i: ConfigItem) => <span className="font-medium">{i.code}</span> },
    { key: 'name', title: '名称', sortable: true, render: (i: ConfigItem) => i.name },
    { key: 'version', title: '版本', width: '70px', sortable: true, comparator: (a: unknown, b: unknown) => compareVersions(String(a), String(b)), render: (i: ConfigItem) => <span className="text-[var(--ui-text-secondary)]">{i.version}</span> },
    { key: 'status', title: '状态', width: '80px', sortable: true, render: (i: ConfigItem) => <Badge status={i.status} /> },
  ]), []);

  // filterParams 需稳定引用：仅 status/refreshToken 变化时重建（避免每次渲染触发全量重拉）
  const filterParams = useMemo(
    () => ({ status: statusFilter, r: refreshToken }),
    [statusFilter, refreshToken],
  );

  const handleQuickCreate = async () => {
    if (!quickForm.code.trim() || !quickForm.name.trim()) return;
    setQuickCreating(true);
    try {
      const r = await configurationApi.create({ code: quickForm.code.trim(), name: quickForm.name.trim() });
      const newItem: ConfigItem = { id: r.id, code: quickForm.code.trim(), name: quickForm.name.trim(), version: 'A', status: 'draft' };
      setSelected(prev => [...prev, newItem]);
      setQuickForm({ code: '', name: '' });
      setQuickOpen(false);
      setRefreshToken(t => t + 1);
    } catch { toast.error('新建构型项失败'); }
    finally { setQuickCreating(false); }
  };

  return (
    <EntityPickerModal<ConfigItem>
      open={open}
      title="添加子构型项"
      onClose={onClose}
      width="xl"
      fetchData={fetchData}
      filterParams={filterParams}
      getKey={(i) => i.id}
      columns={columns}
      selected={selected}
      onSelectedChange={setSelected}
      onConfirm={(items) => {
        onConfirm(items.map(s => ({ child_revision_id: s.id, is_required: true })));
        setSelected([]);
        onClose();
      }}
      searchPlaceholder="搜索构型号、名称..."
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
              快速新建构型项
            </Button>
          </div>
          {quickOpen && (
            <div className="px-4 py-3 border-t space-y-2 bg-[var(--ui-bg-subtle)]">
              <div className="flex gap-2">
                <Input size="xs" value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })} placeholder="构型号 *" className="flex-1" />
                <Input size="xs" value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })} placeholder="名称 *" className="flex-1" />
                <Button size="sm" className="whitespace-nowrap" type="button" onClick={handleQuickCreate} disabled={quickCreating}>
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
