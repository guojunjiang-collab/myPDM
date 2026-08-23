import { useEffect, useState, useMemo } from 'react';
import { useInventoryStore } from '../../stores/inventory';
import { useDataStore } from '../../stores/data';
import { inventoryApi } from '../../services/inventoryApi';
import { partsApi } from '../../services/api';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import { toast } from '../Toast';
import Badge from '../ui/Badge';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SortableTh from '../ui/SortableTh';
import MaterialDetail from './MaterialDetail';
import PartDetailModal from '../PartDetailModal';
import type { InvMaterial } from '../../types';
import { useTableSort } from '../../hooks/useTableSort';

// ECR 式卡片字段样式
const cardCls = 'bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]';
const cardLabelCls = 'block text-xs text-[var(--ui-text-secondary)] mb-0.5';

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

  // 保存 loading/错误（阶段2c 补缺口）
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveStandalone = async () => {
    if (!editing) return;
    setSaving(true); setSaveError(null);
    try {
      if (editing.id) await inventoryApi.updateMaterial(editing.id, editing);
      else await inventoryApi.createMaterial(editing);
      setEditing(null);
      await reload();
    } catch (err: any) {
      setSaveError(err?.response?.data?.detail || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
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
      toast.error(err?.response?.data?.detail || '启用失败，请重试');
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

  // 客户端排序
  const { sortedData: sortedMaterials, sortField, sortDirection, handleSort } = useTableSort<any>(filteredMaterials);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input type="text" placeholder="搜索编码/名称/规格..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0" />
        <div className="flex-1" />
        {canEdit() && (
          <>
            <Button variant="success" onClick={() => setPdmMode(true)}>从 PDM 启用</Button>
            <Button onClick={() => setEditing({ code: '', name: '', track_mode: 'quantity', unit: '个' } as any)}>+ 新建物料</Button>
          </>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">编码</SortableTh>
              <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">名称</SortableTh>
              <SortableTh sortKey="spec" active={sortField === 'spec'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">规格型号</SortableTh>
              <SortableTh sortKey="unit" active={sortField === 'unit'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">单位</SortableTh>
              <SortableTh sortKey="source_type" active={sortField === 'source_type'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">来源</SortableTh>
              <SortableTh sortKey="track_mode" active={sortField === 'track_mode'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">追踪</SortableTh>
              <SortableTh sortKey="safety_stock" active={sortField === 'safety_stock'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left">安全库存</SortableTh>
              <SortableTh align="right">操作</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : sortedMaterials.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">无匹配结果</td></tr>
            ) : sortedMaterials.map((m) => (
              <tr key={m.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setDetail(m)}>
                <td className="px-4 py-3 text-sm font-medium">{m.code}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.name}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.spec || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.unit || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.source_type === 'standalone' ? '非PDM' : m.source_type === 'part' ? '零件' : '部件'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.track_mode === 'batch' ? '批次' : '数量'}</td>
                <td className="px-4 py-3 text-sm font-medium">{m.safety_stock ?? '-'}</td>
                <td className="px-4 py-3 text-right text-sm space-x-3">
                  {canEdit() && (
                    <Button variant="link" size="xs" onClick={(e) => { e.stopPropagation(); setEditing(m); }}>编辑</Button>
                  )}
                  {isAdmin() && (
                    <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteId(m.id); }}>删除</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 新建/编辑非 PDM 物料 */}
      <Modal open={!!editing} title={editing?.id ? '编辑物料' : '新建物料'} onClose={() => { setEditing(null); setSaveError(null); }} width="3xl">
        {editing && (
          <div className="space-y-4">
            {saveError && <Alert tone="danger">{saveError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              {editingIsPdm ? (
                <div className="col-span-2">
                  <label className={cardLabelCls}>PDM 关联零部件</label>
                  <div className="rounded-lg border border-[var(--ui-border)] overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">类型</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">件号</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">名称</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">规格型号</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">版本</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                          onClick={() => editing.ref_entity_id && viewEntity((editing.ref_entity_type || editing.source_type) as 'part' | 'assembly', editing.ref_entity_id)}>
                          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{editing.source_type === 'part' ? '零件' : '部件'}</td>
                          <td className="px-3 py-2 text-sm font-medium text-primary-600">{editingPdm?.code || editing.code}</td>
                          <td className="px-3 py-2 text-sm">{editingPdm?.name || editing.name}</td>
                          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{editingPdm?.spec || editing.spec || '-'}</td>
                          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{editingPdm?.version || '-'}</td>
                          <td className="px-3 py-2">
                            {editingPdm ? <Badge status={editingPdm.status} /> : '-'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-[var(--ui-text-tertiary)] mt-1">点击上方行可查看零部件详情。</p>
                </div>
              ) : (
                <div className={`${cardCls} col-span-2`}>
                  <label className={cardLabelCls}>来源</label>
                  <div className="text-sm text-gray-700">非PDM（独立物料）</div>
                </div>
              )}
              <div className={cardCls}>
                <label className={cardLabelCls}>编码</label>
                <Input placeholder="物料编码" value={editing.code || ''} disabled={!!editing.id}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })} size="xs" />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>名称</label>
                <Input placeholder="物料名称" value={editing.name || ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} size="xs" />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>规格型号</label>
                <Input placeholder="规格型号（选填）" value={editing.spec || ''}
                  onChange={(e) => setEditing({ ...editing, spec: e.target.value })} size="xs" />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>单位</label>
                <Input placeholder="如 个 / kg / m" value={editing.unit || ''}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })} size="xs" />
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>追踪方式</label>
                <Select value={editing.track_mode || 'quantity'}
                  onChange={(e) => setEditing({ ...editing, track_mode: e.target.value as any })} size="xs">
                  <option value="quantity">按数量</option>
                  <option value="batch">按批次</option>
                </Select>
              </div>
              <div className={cardCls}>
                <label className={cardLabelCls}>安全库存（选填）</label>
                <Input placeholder="低于则预警" type="number" value={editing.safety_stock ?? ''}
                  onChange={(e) => setEditing({ ...editing, safety_stock: e.target.value ? Number(e.target.value) : null })} size="xs" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-[var(--ui-border)]">
              <Button variant="secondary" className="mt-3" onClick={() => setEditing(null)} disabled={saving}>取消</Button>
              <Button className="mt-3" onClick={saveStandalone} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 从 PDM 启用 */}
      <Modal open={pdmMode} title="从 PDM 零件/部件启用库存" onClose={() => setPdmMode(false)} width="full">
        <div className="space-y-3">
          <Input placeholder="输入编码 / 名称 / 规格型号，边输入边搜索..." value={pdmKeyword} autoFocus
            onChange={(e) => setPdmKeyword(e.target.value)} />
          <div className="max-h-80 overflow-auto rounded-lg border border-[var(--ui-border)]">
            {pdmLoading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
            ) : pdmResults.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">无匹配结果</div>
            ) : (
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">编号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">名称</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-24 whitespace-nowrap">版本</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">规格型号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-24 whitespace-nowrap">状态</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-24 whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pdmResults.map((r) => (
                    <tr key={`${r.entity_type}-${r.id}`} className="hover:bg-[var(--ui-bg-hover)]">
                      <td className="px-3 py-2 text-sm font-medium">{r.code}</td>
                      <td className="px-3 py-2 text-sm">{r.name}</td>
                      <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)] w-24 whitespace-nowrap">{r.version || '-'}</td>
                      <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{r.spec || '-'}</td>
                      <td className="px-3 py-2 w-24 whitespace-nowrap">
                        <Badge status={r.status} />
                      </td>
                      <td className="px-3 py-2 text-right w-24 whitespace-nowrap">
                        <Button variant="link" size="xs" onClick={() => enablePdm(r)}>启用</Button>
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
