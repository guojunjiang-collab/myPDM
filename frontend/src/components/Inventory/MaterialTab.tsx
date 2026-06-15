import { useEffect, useState } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { inventoryApi } from '../../services/inventoryApi';
import { partsApi, assembliesApi } from '../../services/api';
import type { InvMaterial } from '../../types';

export default function MaterialTab() {
  const { materials, loadMaterials } = useInventoryStore();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<InvMaterial> | null>(null);
  const [pdmMode, setPdmMode] = useState(false);
  const [pdmKeyword, setPdmKeyword] = useState('');
  const [pdmResults, setPdmResults] = useState<{ id: string; code: string; name: string; entity_type: string }[]>([]);

  useEffect(() => { loadMaterials(); }, [loadMaterials]);

  const saveStandalone = async () => {
    if (!editing) return;
    if (editing.id) await inventoryApi.updateMaterial(editing.id, editing);
    else await inventoryApi.createMaterial(editing);
    setEditing(null);
    await loadMaterials(search);
  };

  const searchPdm = async () => {
    const [p, a] = await Promise.all([
      partsApi.list({ search: pdmKeyword, page_size: 20 }),
      assembliesApi.list({ search: pdmKeyword, page_size: 20 }),
    ]);
    const parts = (p.data.items || []).map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'part' }));
    const asms = (a.data.items || []).map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'assembly' }));
    setPdmResults([...parts, ...asms]);
  };

  const enablePdm = async (r: { id: string; entity_type: string }) => {
    await inventoryApi.enableFromPdm({ entity_type: r.entity_type, entity_id: r.id, track_mode: 'quantity' });
    setPdmMode(false); setPdmResults([]); setPdmKeyword('');
    await loadMaterials(search);
  };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input placeholder="搜索编码/名称" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && loadMaterials(search)}
          className="border px-2 py-1 rounded text-sm" />
        <button onClick={() => setEditing({ code: '', name: '', track_mode: 'quantity', unit: '个' } as any)}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded">+ 新建物料</button>
        <button onClick={() => setPdmMode(true)}
          className="px-3 py-1.5 bg-green-500 text-white text-sm rounded">从 PDM 启用</button>
      </div>
      <table className="w-full text-sm border">
        <thead className="bg-gray-50"><tr>
          <th className="p-2 text-left">编码</th><th className="p-2 text-left">名称</th>
          <th className="p-2 text-left">单位</th><th className="p-2 text-left">来源</th>
          <th className="p-2 text-left">追踪</th><th className="p-2 text-left">安全库存</th>
          <th className="p-2">操作</th></tr></thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.id} className="border-t">
              <td className="p-2">{m.code}</td><td className="p-2">{m.name}</td>
              <td className="p-2">{m.unit}</td>
              <td className="p-2">{m.source_type === 'standalone' ? '非PDM' : m.source_type === 'part' ? '零件' : '部件'}</td>
              <td className="p-2">{m.track_mode === 'batch' ? '批次' : '数量'}</td>
              <td className="p-2">{m.safety_stock ?? '-'}</td>
              <td className="p-2 text-center">
                <button onClick={() => setEditing(m)} className="text-blue-500">编辑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 新建/编辑非 PDM 物料 */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-96 space-y-3">
            <h3 className="font-medium">{editing.id ? '编辑物料' : '新建物料'}</h3>
            <input placeholder="编码" value={editing.code || ''} disabled={!!editing.id}
              onChange={(e) => setEditing({ ...editing, code: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="名称" value={editing.name || ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <input placeholder="单位" value={editing.unit || ''}
              onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <select value={editing.track_mode || 'quantity'}
              onChange={(e) => setEditing({ ...editing, track_mode: e.target.value as any })}
              className="w-full border px-2 py-1 rounded text-sm">
              <option value="quantity">按数量</option>
              <option value="batch">按批次</option>
            </select>
            <input placeholder="安全库存（选填）" type="number" value={editing.safety_stock ?? ''}
              onChange={(e) => setEditing({ ...editing, safety_stock: e.target.value ? Number(e.target.value) : null })}
              className="w-full border px-2 py-1 rounded text-sm" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm">取消</button>
              <button onClick={saveStandalone} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 从 PDM 启用 */}
      {pdmMode && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white p-5 rounded w-[32rem] space-y-3">
            <h3 className="font-medium">从 PDM 零件/部件启用库存</h3>
            <div className="flex gap-2">
              <input placeholder="搜索零件/部件" value={pdmKeyword}
                onChange={(e) => setPdmKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchPdm()}
                className="flex-1 border px-2 py-1 rounded text-sm" />
              <button onClick={searchPdm} className="px-3 py-1 bg-blue-500 text-white text-sm rounded">搜索</button>
            </div>
            <div className="max-h-60 overflow-auto border rounded">
              {pdmResults.map((r) => (
                <div key={`${r.entity_type}-${r.id}`} className="flex justify-between p-2 border-t text-sm">
                  <span>[{r.entity_type === 'part' ? '零件' : '部件'}] {r.code} {r.name}</span>
                  <button onClick={() => enablePdm(r)} className="text-green-600">启用</button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setPdmMode(false)} className="px-3 py-1 text-sm">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
