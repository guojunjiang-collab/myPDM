import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import type { Warehouse } from '../../types';

const WH_TYPES = [
  { value: 'raw', label: '原料库' },
  { value: 'finished', label: '成品库' },
  { value: 'defective', label: '不良品库' },
  { value: 'general', label: '通用' },
];

export default function WarehouseTab() {
  const { warehouses, loadWarehouses, users } = useInventoryStore();
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);

  const save = async () => {
    if (!editing) return;
    if (editing.id) {
      await inventoryApi.updateWarehouse(editing.id, editing);
    } else {
      await inventoryApi.createWarehouse(editing);
    }
    setEditing(null);
    await loadWarehouses();
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该仓库？')) return;
    await inventoryApi.deleteWarehouse(id);
    await loadWarehouses();
  };

  return (
    <div>
      <button onClick={() => setEditing({ code: '', name: '', type: 'general' })}
        className="mb-3 px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建仓库</button>
      <table className="w-full text-sm border">
        <thead className="bg-gray-50">
          <tr><th className="p-2 text-left">编码</th><th className="p-2 text-left">名称</th>
            <th className="p-2 text-left">类型</th><th className="p-2 text-left">默认库管员</th>
            <th className="p-2">操作</th></tr>
        </thead>
        <tbody>
          {warehouses.map((w) => (
            <tr key={w.id} className="border-t">
              <td className="p-2">{w.code}</td><td className="p-2">{w.name}</td>
              <td className="p-2">{WH_TYPES.find((t) => t.value === w.type)?.label || w.type}</td>
              <td className="p-2">{users.find((u) => u.id === w.default_keeper_id)?.real_name || '-'}</td>
              <td className="p-2 text-center">
                <button onClick={() => setEditing(w)} className="text-blue-500 mr-2">编辑</button>
                <button onClick={() => remove(w.id)} className="text-red-500">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-96 space-y-3">
            <h3 className="font-medium">{editing.id ? '编辑仓库' : '新建仓库'}</h3>
            <input placeholder="编码" value={editing.code || ''} disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="名称" value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <select value={editing.type || 'general'}
              onChange={(e) => setEditing({ ...editing, type: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm">
              {WH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={editing.default_keeper_id || ''}
              onChange={(e) => setEditing({ ...editing, default_keeper_id: e.target.value || null })}
              className="w-full border px-2 py-1 rounded text-sm">
              <option value="">（无默认库管员）</option>
              {users.filter((u) => u.role !== 'guest').map((u) => (
                <option key={u.id} value={u.id}>{u.real_name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm">取消</button>
              <button onClick={save} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
