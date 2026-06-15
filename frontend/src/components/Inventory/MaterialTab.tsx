import { useEffect, useState, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useDataStore } from '../../stores/data';
import { inventoryApi } from '../../services/inventoryApi';
import { canEdit } from '../../stores/auth';
import { Modal } from '../Modal';
import type { InvMaterial } from '../../types';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function MaterialTab() {
  const { materials, loadMaterials } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<InvMaterial> | null>(null);
  const [pdmMode, setPdmMode] = useState(false);
  const [pdmKeyword, setPdmKeyword] = useState('');

  // PDM 零件/部件来自全局 DataStore（已全量预加载），客户端即时过滤
  const storeParts = useDataStore((s) => s.parts);
  const storeAssemblies = useDataStore((s) => s.assemblies);
  const syncAll = useDataStore((s) => s.syncAll);

  const reload = async (s?: string) => {
    setLoading(true);
    try { await loadMaterials(s); } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  // 打开「从 PDM 启用」时，若 store 尚未加载则拉一次
  useEffect(() => {
    if (pdmMode && storeParts.length === 0 && storeAssemblies.length === 0) {
      syncAll();
    }
  }, [pdmMode, storeParts.length, storeAssemblies.length, syncAll]);

  const saveStandalone = async () => {
    if (!editing) return;
    if (editing.id) await inventoryApi.updateMaterial(editing.id, editing);
    else await inventoryApi.createMaterial(editing);
    setEditing(null);
    await reload(search);
  };

  const pdmResults = useMemo(() => {
    const kw = pdmKeyword.trim().toLowerCase();
    if (!kw) return [];
    const match = (x: any) => (x.code || '').toLowerCase().includes(kw) || (x.name || '').toLowerCase().includes(kw);
    const parts = storeParts.filter(match).slice(0, 50)
      .map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'part' as const }));
    const asms = storeAssemblies.filter(match).slice(0, 50)
      .map((x: any) => ({ id: x.id, code: x.code, name: x.name, entity_type: 'assembly' as const }));
    return [...parts, ...asms];
  }, [pdmKeyword, storeParts, storeAssemblies]);

  const enablePdm = async (r: { id: string; entity_type: string }) => {
    try {
      await inventoryApi.enableFromPdm({ entity_type: r.entity_type, entity_id: r.id, track_mode: 'quantity' });
      setPdmMode(false); setPdmKeyword('');
      await reload(search);
    } catch (err: any) {
      alert(err?.response?.data?.detail || '启用失败，请重试');
    }
  };

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4">
        <input type="text" placeholder="搜索编码/名称..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && reload(search)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
        <div className="flex-1" />
        {canEdit() && (
          <>
            <button onClick={() => setPdmMode(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">从 PDM 启用</button>
            <button onClick={() => setEditing({ code: '', name: '', track_mode: 'quantity', unit: '个' } as any)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建物料</button>
          </>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">编码</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">单位</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">来源</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">追踪</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">安全库存</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : materials.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium">{m.code}</td>
                <td className="px-4 py-3 text-sm">{m.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{m.unit || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{m.source_type === 'standalone' ? '非PDM' : m.source_type === 'part' ? '零件' : '部件'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{m.track_mode === 'batch' ? '批次' : '数量'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{m.safety_stock ?? '-'}</td>
                <td className="px-4 py-3 text-right">
                  {canEdit() && (
                    <button onClick={() => setEditing(m)} className="text-primary-600 hover:text-primary-800">编辑</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑非 PDM 物料 */}
      <Modal open={!!editing} title={editing?.id ? '编辑物料' : '新建物料'} onClose={() => setEditing(null)} width="md">
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">编码</label>
              <input placeholder="物料编码" value={editing.code || ''} disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">名称</label>
              <input placeholder="物料名称" value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">单位</label>
              <input placeholder="如 个 / kg / m" value={editing.unit || ''}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">追踪方式</label>
              <select value={editing.track_mode || 'quantity'}
                onChange={(e) => setEditing({ ...editing, track_mode: e.target.value as any })} className={inputCls}>
                <option value="quantity">按数量</option>
                <option value="batch">按批次</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">安全库存（选填）</label>
              <input placeholder="低于则预警" type="number" value={editing.safety_stock ?? ''}
                onChange={(e) => setEditing({ ...editing, safety_stock: e.target.value ? Number(e.target.value) : null })} className={inputCls} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={saveStandalone} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">保存</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 从 PDM 启用 */}
      <Modal open={pdmMode} title="从 PDM 零件/部件启用库存" onClose={() => setPdmMode(false)} width="lg">
        <div className="space-y-3">
          <input placeholder="输入零件/部件编码或名称，边输入边搜索..." value={pdmKeyword} autoFocus
            onChange={(e) => setPdmKeyword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 divide-y divide-gray-200">
            {!pdmKeyword.trim() ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">输入关键词搜索 PDM 零件/部件</div>
            ) : pdmResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">无匹配结果</div>
            ) : pdmResults.map((r) => (
              <div key={`${r.entity_type}-${r.id}`} className="flex justify-between items-center px-4 py-2 text-sm hover:bg-gray-50">
                <span><span className="text-gray-400">[{r.entity_type === 'part' ? '零件' : '部件'}]</span> {r.code} {r.name}</span>
                <button onClick={() => enablePdm(r)} className="text-green-600 hover:text-green-800">启用</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
