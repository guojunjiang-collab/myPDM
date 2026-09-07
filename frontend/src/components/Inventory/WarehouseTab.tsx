import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import FormModal from '../ui/FormModal';
import FormField from '../ui/FormField';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SortableTh from '../ui/SortableTh';
import type { Warehouse } from '../../types';
import { useTableSort } from '../../hooks/useTableSort';

const WH_TYPES = [
  { value: 'raw', label: '原料库' },
  { value: 'finished', label: '成品库' },
  { value: 'defective', label: '不良品库' },
  { value: 'general', label: '通用' },
];

export default function WarehouseTab() {
  const { warehouses, loadWarehouses, users } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 保存 loading/错误（阶段2c 补缺口）
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 客户端排序
  const { sortedData: sortedWarehouses, sortField, sortDirection, handleSort } = useTableSort<Warehouse>(warehouses);

  const reload = async () => {
    setLoading(true);
    try { await loadWarehouses(); } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setSaveError(null);
    try {
      if (editing.id) await inventoryApi.updateWarehouse(editing.id, editing);
      else await inventoryApi.createWarehouse(editing);
      setEditing(null);
      await reload();
    } catch (err: any) {
      setSaveError(err?.response?.data?.detail || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await inventoryApi.deleteWarehouse(deleteId);
      setDeleteId(null);
      await reload();
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail || '删除失败，请重试');
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex gap-2 mb-4 shrink-0">
        <div className="flex-1" />
        {canEdit() && (
          <Button onClick={() => setEditing({ code: '', name: '', type: 'general' })}>+ 新建仓库</Button>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Warehouse)} className="text-left">编码</SortableTh>
              <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Warehouse)} className="text-left">名称</SortableTh>
              <SortableTh sortKey="type" active={sortField === 'type'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Warehouse)} className="text-left">类型</SortableTh>
              <SortableTh className="text-left">默认库管员</SortableTh>
              <SortableTh align="right">操作</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : warehouses.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : sortedWarehouses.map((w) => (
              <tr key={w.id} className="hover:bg-[var(--ui-bg-hover)]">
                <td className="px-4 py-3 text-sm font-medium">{w.code}</td>
                <td className="px-4 py-3 text-sm font-medium">{w.name}</td>
                <td className="px-4 py-3 text-sm font-medium">{WH_TYPES.find((t) => t.value === w.type)?.label || w.type || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{users.find((u) => u.id === w.default_keeper_id)?.real_name || '-'}</td>
                <td className="px-4 py-3 text-right text-sm space-x-1">
                  {canEdit() && (
                    <Button variant="link" size="xs" className="mr-3" onClick={() => setEditing(w)}>编辑</Button>
                  )}
                  {isAdmin() && (
                    <Button variant="danger" size="xs" onClick={() => setDeleteId(w.id)}>删除</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑弹窗（FormModal + FormField 统一 label/footer/saving/error） */}
      <FormModal
        open={!!editing}
        title={editing?.id ? '编辑仓库' : '新建仓库'}
        onClose={() => { setEditing(null); setSaveError(null); }}
        width="md"
        onSubmit={save}
        saving={saving}
        error={saveError}
      >
        {editing && (
          <>
            <FormField label="编码" required>
              <Input placeholder="仓库编码" value={editing.code || ''} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </FormField>
            <FormField label="名称" required>
              <Input placeholder="仓库名称" value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </FormField>
            <FormField label="类型">
              <Select value={editing.type || 'general'}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </FormField>
            <FormField label="默认库管员">
              <Select value={editing.default_keeper_id || ''}
                onChange={(e) => setEditing({ ...editing, default_keeper_id: e.target.value || null })}>
                <option value="">（无默认库管员）</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </Select>
            </FormField>
          </>
        )}
      </FormModal>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? '无法删除' : '删除仓库'}
        content={deleteError || '确认删除该仓库？'}
        confirmText={deleteError ? '知道了' : '删除'}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />
    </div>
  );
}
