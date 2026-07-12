import { useEffect, useState, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useDataStore } from '../../stores/data';
import { inventoryApi } from '../../services/inventoryApi';
import { partsApi } from '../../services/api';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import MaterialDetail from './MaterialDetail';
import PartDetailModal from '../PartDetailModal';
import type { InvMaterial } from '../../types';

// ECR 式卡片字段样式
const cardCls = 'bg-gray-50 rounded-lg px-3 py-2 border border-gray-100';
const cardLabelCls = 'block text-xs text-gray-500 mb-0.5';
const cardInputCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

// PDM 零件/部件状态徽标（与零件管理一致）
const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

export default function MaterialTab() {
  const { materials, loadMaterials } = useInventoryStore();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<InvMaterial> | null>(null);
  const [pdmMode, setPdmMode] = useState(false);
  const [pdmKeyword, setPdmKeyword] = useState('');
  const [detail, setDetail] = useState<InvMaterial | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 零部件详情：通过 PartDetailModal 查看（ref_entity_id 存储的是 master_id）
  const [viewMasterId, setViewMasterId] = useState<string | null>(null);

  const viewEntity = (_type: 'part' | 'assembly', id: string) => {
    setViewMasterId(id);
  };

  // PDM 零件/部件来自全局 DataStore（已全量预加载），客户端即时过滤
  const storeComponents = useDataStore((s) => s.parts);
  const syncAll = useDataStore((s) => s.syncAll);

  // PDM 搜索结果（直接调用后端，避免依赖全局 store 的缓存/结构差异）
  const [pdmResults, setPdmResults] = useState<any[]>([]);
  const [pdmLoading, setPdmLoading] = useState(false);

  // 正在编辑的物料是否来自 PDM，及其关联零部件（用于编辑弹窗体现来源）
  const editingIsPdm = !!editing && !!editing.source_type && editing.source_type !== 'standalone';
  const editingPdm = editingIsPdm && editing!.ref_entity_id
    ? storeComponents.find((c: any) => (c.master_id || c.id) === editing!.ref_entity_id)
    : null;

  const reload = async (s?: string) => {
    setLoading(true);
    try { await loadMaterials(s); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await inventoryApi.deleteMaterial(deleteId);
      setDeleteId(null);
      await reload(search);
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail || '删除失败，请重试');
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  // 打开「从 PDM 启用」时刷新零部件缓存（不依赖 length，避免旧格式持久化数据导致列表为空）
  useEffect(() => {
    if (pdmMode) {
      syncAll();
    }
  }, [pdmMode, syncAll]);

  const saveStandalone = async () => {
    if (!editing) return;
    if (editing.id) await inventoryApi.updateMaterial(editing.id, editing);
    else await inventoryApi.createMaterial(editing);
    setEditing(null);
    await reload();
  };

  // 打开弹窗或关键词变化时，直接向后端查询 PDM 零部件（防抖）
  useEffect(() => {
    if (!pdmMode) return;
    let cancelled = false;
    setPdmLoading(true);
    const timer = setTimeout(async () => {
      try {
        const kw = pdmKeyword.trim();
        const res = await partsApi.list({
          page_size: 50,
          show_all_versions: true,
          ...(kw ? { search: kw } : {}),
        });
        const items = Array.isArray(res) ? res : (res?.items || []);
        if (!cancelled) {
          setPdmResults(items.map((x: any) => ({
            id: x.master_id || x.id,
            code: x.code,
            name: x.name,
            spec: x.spec,
            version: x.version,
            status: x.status,
            entity_type: x.type === 'assembly' ? 'assembly' : 'part',
          })));
        }
      } catch {
        if (!cancelled) setPdmResults([]);
      } finally {
        if (!cancelled) setPdmLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pdmMode, pdmKeyword]);

  const enablePdm = async (r: { id: string; entity_type: string }) => {
    try {
      await inventoryApi.enableFromPdm({ entity_type: r.entity_type, entity_id: r.id, track_mode: 'quantity' });
      setPdmMode(false); setPdmKeyword('');
      await reload();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '启用失败，请重试');
    }
  };

  // 客户端即时过滤（边输入边搜索）：编码/名称/规格型号
  const filteredMaterials = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return materials;
    return materials.filter((m) =>
      (m.code || '').toLowerCase().includes(kw) ||
      (m.name || '').toLowerCase().includes(kw) ||
      (m.spec || '').toLowerCase().includes(kw));
  }, [materials, search]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <input type="text" placeholder="搜索编码/名称/规格..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
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
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">编码</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">规格型号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">单位</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">来源</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">追踪</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">安全库存</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : filteredMaterials.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : filteredMaterials.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetail(m)}>
                <td className="px-4 py-3 text-sm font-medium">{m.code}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.name}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.spec || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.unit || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.source_type === 'standalone' ? '非PDM' : m.source_type === 'part' ? '零件' : '部件'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.track_mode === 'batch' ? '批次' : '数量'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.safety_stock ?? '-'}</td>
                <td className="px-4 py-3 text-right text-sm space-x-3">
                  {canEdit() && (
                    <button onClick={(e) => { e.stopPropagation(); setEditing(m); }} className="text-primary-600 hover:text-primary-800">编辑</button>
                  )}
                  {isAdmin() && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(m.id); }} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑非 PDM 物料 */}
      <Modal open={!!editing} title={editing?.id ? '编辑物料' : '新建物料'} onClose={() => setEditing(null)} width="3xl">
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {editingIsPdm ? (
                <div className="col-span-2">
                  <label className={cardLabelCls}>PDM 关联零部件</label>
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">类型</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">件号</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格型号</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">版本</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => editing.ref_entity_id && viewEntity((editing.ref_entity_type || editing.source_type) as 'part' | 'assembly', editing.ref_entity_id)}>
                          <td className="px-3 py-2 text-sm text-gray-500">{editing.source_type === 'part' ? '零件' : '部件'}</td>
                          <td className="px-3 py-2 text-sm font-medium text-primary-600">{editingPdm?.code || editing.code}</td>
                          <td className="px-3 py-2 text-sm">{editingPdm?.name || editing.name}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">{editingPdm?.spec || editing.spec || '-'}</td>
                          <td className="px-3 py-2 text-sm text-gray-500">{editingPdm?.version || '-'}</td>
                          <td className="px-3 py-2">
                            {editingPdm ? (
                              <span className={`px-2 py-1 text-xs rounded-full ${statusTag(editingPdm.status).cls}`}>
                                {statusTag(editingPdm.status).label}
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">点击上方行可查看零部件详情。</p>
                </div>
              ) : (
                <div className={`${cardCls} col-span-2`}>
                  <label className={cardLabelCls}>来源</label>
                  <div className="text-sm text-gray-700">非PDM（独立物料）</div>
                </div>
              )}
              <div className={cardCls}>
                <label className={cardLabelCls}>编码</label>
                <input placeholder="物料编码" value={editing.code || ''} disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })} className={cardInputCls} />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>名称</label>
                <input placeholder="物料名称" value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={cardInputCls} />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>规格型号</label>
                <input placeholder="规格型号（选填）" value={editing.spec || ''}
                  onChange={(e) => setEditing({ ...editing, spec: e.target.value })} className={cardInputCls} />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>单位</label>
                <input placeholder="如 个 / kg / m" value={editing.unit || ''}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })} className={cardInputCls} />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>追踪方式</label>
                <select value={editing.track_mode || 'quantity'}
                  onChange={(e) => setEditing({ ...editing, track_mode: e.target.value as any })} className={cardInputCls}>
                  <option value="quantity">按数量</option>
                  <option value="batch">按批次</option>
                </select>
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>安全库存（选填）</label>
                <input placeholder="低于则预警" type="number" value={editing.safety_stock ?? ''}
                  onChange={(e) => setEditing({ ...editing, safety_stock: e.target.value ? Number(e.target.value) : null })} className={cardInputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-gray-200">
              <button onClick={() => setEditing(null)} className="mt-3 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={saveStandalone} className="mt-3 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">保存</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 从 PDM 启用 */}
      <Modal open={pdmMode} title="从 PDM 零件/部件启用库存" onClose={() => setPdmMode(false)} width="full">
        <div className="space-y-3">
          <input placeholder="输入编码 / 名称 / 规格型号，边输入边搜索..." value={pdmKeyword} autoFocus
            onChange={(e) => setPdmKeyword(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200">
            {pdmLoading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">加载中...</div>
            ) : pdmResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">无匹配结果</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">编号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-24 whitespace-nowrap">版本</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格型号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-24 whitespace-nowrap">状态</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 w-24 whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pdmResults.map((r) => (
                    <tr key={`${r.entity_type}-${r.id}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm font-medium">{r.code}</td>
                      <td className="px-3 py-2 text-sm">{r.name}</td>
                      <td className="px-3 py-2 text-sm text-gray-500 w-24 whitespace-nowrap">{r.version || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{r.spec || '-'}</td>
                      <td className="px-3 py-2 w-24 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${statusTag(r.status as string).cls}`}>
                          {statusTag(r.status as string).label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right w-24 whitespace-nowrap">
                        <button onClick={() => enablePdm(r)} className="text-green-600 hover:text-green-800">启用</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </Modal>

      {/* 物料详情 */}
      {detail && <MaterialDetail material={detail} onClose={() => setDetail(null)} onViewEntity={viewEntity} />}

      {/* 零部件详情（通过 PartDetailModal 查看，ref_entity_id 存储的是 master_id） */}
      <PartDetailModal
        masterId={viewMasterId || ''}
        open={viewMasterId !== null}
        onClose={() => setViewMasterId(null)}
      />

      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? '无法删除' : '删除物料'}
        content={deleteError || '确认删除该物料？删除后不影响已有库存流水记录。'}
        confirmText={deleteError ? '知道了' : '删除'}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />
    </div>
  );
}
