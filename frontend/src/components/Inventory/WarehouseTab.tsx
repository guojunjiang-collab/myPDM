import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import type { Warehouse } from '../../types';

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

  const reload = async () => {
    setLoading(true);
    try { await loadWarehouses(); } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!editing) return;
    if (editing.id) await inventoryApi.updateWarehouse(editing.id, editing);
    else await inventoryApi.createWarehouse(editing);
    setEditing(null);
    await reload();
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
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">编码</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">类型</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">默认库管员</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : warehouses.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : warehouses.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50">
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

      {/* 新建/编辑弹窗 */}
      <Modal open={!!editing} title={editing?.id ? '编辑仓库' : '新建仓库'} onClose={() => setEditing(null)} width="md">
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">编码</label>
              <Input placeholder="仓库编码" value={editing.code || ''} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">名称</label>
              <Input placeholder="仓库名称" value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">类型</label>
              <Select value={editing.type || 'general'}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">默认库管员</label>
              <Select value={editing.default_keeper_id || ''}
                onChange={(e) => setEditing({ ...editing, default_keeper_id: e.target.value || null })}>
                <option value="">（无默认库管员）</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>取消</Button>
              <Button onClick={save}>保存</Button>
            </div>
          </div>
        )}
      </Modal>

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
