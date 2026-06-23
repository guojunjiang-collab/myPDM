import { useEffect, useState, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useDataStore } from '../../stores/data';
import { inventoryApi } from '../../services/inventoryApi';
import { partsApi, assembliesApi, customFieldsApi } from '../../services/api';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import MaterialDetail from './MaterialDetail';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import type { InvMaterial, CustomFieldDefinition, CustomFieldValue } from '../../types';

// ECR 式卡片字段样式
const cardCls = 'bg-gray-50 rounded-lg px-3 py-2 border border-gray-100';
const cardLabelCls = 'block text-xs text-gray-500 mb-0.5';
const cardInputCls = 'w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

// PDM 零件/部件状态中文（与零件管理一致）
const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废',
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

  // 零部件详情（与物料详情同级，避免被父弹窗 transform 限制宽度）
  const [entity, setEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [entityData, setEntityData] = useState<any>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityDefs, setEntityDefs] = useState<CustomFieldDefinition[]>([]);
  const [entityValues, setEntityValues] = useState<Record<string, any>>({});

  const viewEntity = async (type: 'part' | 'assembly', id: string) => {
    setEntity({ type, id });
    setEntityData(null); setEntityLoading(true); setEntityDefs([]); setEntityValues({});
    try {
      const api = type === 'part' ? partsApi : assembliesApi;
      const res = await api.get(id);
      setEntityData(res.data);
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setEntityDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setEntityValues(vals);
        } catch { /* 自定义字段可选 */ }
      }
    } catch { setEntityData(null); }
    finally { setEntityLoading(false); }
  };

  // PDM 零件/部件来自全局 DataStore（已全量预加载），客户端即时过滤
  const storeParts = useDataStore((s) => s.parts);
  const storeAssemblies = useDataStore((s) => s.assemblies);
  const syncAll = useDataStore((s) => s.syncAll);

  // 正在编辑的物料是否来自 PDM，及其关联零部件（用于编辑弹窗体现来源）
  const editingIsPdm = !!editing && !!editing.source_type && editing.source_type !== 'standalone';
  const editingPdm = editingIsPdm && editing!.ref_entity_id
    ? (editing!.source_type === 'part' ? storeParts : storeAssemblies).find((e: any) => e.id === editing!.ref_entity_id)
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
    await reload();
  };

  const pdmResults = useMemo(() => {
    const kw = pdmKeyword.trim().toLowerCase();
    if (!kw) return [];
    const match = (x: any) =>
      (x.code || '').toLowerCase().includes(kw) ||
      (x.name || '').toLowerCase().includes(kw) ||
      (x.spec || '').toLowerCase().includes(kw);
    const pick = (x: any, entity_type: 'part' | 'assembly') => ({
      id: x.id, code: x.code, name: x.name, spec: x.spec, version: x.version, status: x.status, entity_type,
    });
    const parts = storeParts.filter(match).slice(0, 50).map((x: any) => pick(x, 'part'));
    const asms = storeAssemblies.filter(match).slice(0, 50).map((x: any) => pick(x, 'assembly'));
    return [...parts, ...asms];
  }, [pdmKeyword, storeParts, storeAssemblies]);

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
                          <td className="px-3 py-2 text-sm text-gray-500">{editingPdm ? (STATUS_LABEL[editingPdm.status] || editingPdm.status) : '-'}</td>
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
            {!pdmKeyword.trim() ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">输入关键词搜索 PDM 零件/部件</div>
            ) : pdmResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">无匹配结果</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">类型</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">编号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">版本</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格型号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">状态</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pdmResults.map((r) => (
                    <tr key={`${r.entity_type}-${r.id}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-500">{r.entity_type === 'part' ? '零件' : '部件'}</td>
                      <td className="px-3 py-2 text-sm font-medium">{r.code}</td>
                      <td className="px-3 py-2 text-sm">{r.name}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{r.version || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{r.spec || '-'}</td>
                      <td className="px-3 py-2 text-sm text-gray-500">{STATUS_LABEL[r.status as string] || r.status || '-'}</td>
                      <td className="px-3 py-2 text-right">
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

      {/* 零部件详情（同级，宽度同零件/部件管理） */}
      <Modal open={!!entity} title={entity ? (entity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setEntity(null)} width="full">
        {entityLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !entityData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : entity?.type === 'part' ? (
          <PartDetailContent part={entityData} customFieldDefs={entityDefs} customFieldValues={entityValues} />
        ) : (
          <AssemblyDetailContent assembly={entityData} customFieldDefs={entityDefs} customFieldValues={entityValues}
            onSubItemClick={(item: any) => viewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
        )}
      </Modal>

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
