import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import type { Warehouse } from '../../types';

const WH_TYPES = [
  { value: 'raw', label: '原料库' },
  { value: 'finished', label: '成品库' },
  { value: 'defective', label: '不良品库' },
  { value: 'general', label: '通用' },
];

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500';

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
          <button onClick={() => setEditing({ code: '', name: '', type: 'general' })}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建仓库</button>
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
                    <button onClick={() => setEditing(w)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                  )}
                  {isAdmin() && (
                    <button onClick={() => setDeleteId(w.id)} className="text-red-600 hover:text-red-800">删除</button>
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
              <input placeholder="仓库编码" value={editing.code || ''} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">名称</label>
              <input placeholder="仓库名称" value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">类型</label>
              <select value={editing.type || 'general'}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })} className={inputCls}>
                {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">默认库管员</label>
              <select value={editing.default_keeper_id || ''}
                onChange={(e) => setEditing({ ...editing, default_keeper_id: e.target.value || null })} className={inputCls}>
                <option value="">（无默认库管员）</option>
                {users.filter((u) => u.role !== 'guest').map((u) => (
                  <option key={u.id} value={u.id}>{u.real_name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={save} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">保存</button>
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
