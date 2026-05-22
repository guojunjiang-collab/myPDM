import { useEffect, useState, useCallback } from 'react';
import { ecrApi, assemblyPartsApi, partsApi, assembliesApi } from '../../services/api';
import type { BomImpactNode } from '../../types';
import { ECOActionBadge } from './ECOStatusBadge';
import AssemblyPartPicker from '../AssemblyPartPicker';
import { toast } from '../Toast';

interface Props {
  ecrId?: string | null;
  onEcrLinked: (ecrId: string) => void;
  onBomChange?: (data: { up: MutableNode[]; down: MutableNode[] }) => void;
  readOnly?: boolean;
  executionItems?: any[];
}

interface MutableNode extends BomImpactNode {
  _targetQty?: number;
  _desc?: string;
}

const ACTIONS = ['no_change', 'upgrade', 'qty_change', 'delete', 'add_existing'] as const;

const ROW_BG: Record<string, string> = {
  upgrade: 'bg-blue-50', qty_change: 'bg-orange-50', delete: 'bg-red-50',
  add_existing: 'bg-green-50', add_new: 'bg-green-50',
};

const th = 'px-2 py-2 text-left text-xs font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap';
const td = 'px-2 py-1.5 text-xs text-gray-700 border-b border-gray-100';

const tblWrap = 'overflow-x-auto border border-gray-200 rounded-lg';

// Clone ECR nodes into mutable array
function cloneNodes(ecrData: any): { up: MutableNode[]; down: MutableNode[] } {
  const up: MutableNode[] = []; const down: MutableNode[] = [];
  if (!ecrData) return { up, down };
  (ecrData.affected_items || []).forEach((ai: any) => {
    const bi = ai.bom_impact || {};
    (bi.upward_chain || []).forEach((n: BomImpactNode) => up.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity }));
    (bi.downward_items || []).forEach((n: BomImpactNode) => down.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity }));
  });
  return { up, down };
}

function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-xs border border-gray-300 rounded px-1 py-1 bg-white focus:ring-1 focus:ring-primary-500">
      {ACTIONS.map(a => <option key={a} value={a}>{a === 'no_change' ? '不变' : a === 'upgrade' ? '升版' : a === 'qty_change' ? '数量' : a === 'delete' ? '删除' : a === 'add_existing' ? '新增' : a}</option>)}
    </select>
  );
}

// ── Helpers ──
function nextVer(v: string): string {
  if (!v) return 'A';
  const c = [...v.toUpperCase()];
  let i = c.length - 1;
  while (i >= 0) {
    if (c[i] === 'Z') { c[i] = 'A'; i--; }
    else { c[i] = String.fromCharCode(c[i].charCodeAt(0) + 1); return c.join(''); }
  }
  return 'A' + c.join('');
}

function resultRow(n: MutableNode, isUpward = false) {
  if (isUpward) {
    // Upward chain rules
    if (n.action === 'delete') {
      // Parent no longer uses this child → upgrade + quantity=0
      return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: 0 };
    }
    if (n.action === 'qty_change') {
      // Child quantity changed → parent upgrades + quantity changes
      return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: n._targetQty ?? n.quantity };
    }
    if (n.action === 'upgrade') {
      // Parent follows child upgrade
      return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: n.quantity };
    }
    // no_change: parent continues using old version child
    return { code: n.entity_code || '-', name: n.entity_name || '', ver: n.entity_version || '-', qty: n.quantity };
  }
  // Downward / affected items
  return {
    code: n.action === 'delete' ? '(删除)' : n.entity_code || '-',
    name: n.action === 'delete' ? '(已移除)' : n.entity_name || '',
    ver: n.action === 'upgrade' ? nextVer(n.entity_version || 'A') : (n.entity_version || '-'),
    qty: (n.action === 'qty_change' || n.action === 'add_existing') ? (n._targetQty ?? n.quantity) : n.quantity,
  };
}

// ── Editable upward table (left) ──
function EditableUpward({ rows, onUpdate, displayOnly = false }: { rows: MutableNode[]; onUpdate: (i: number, patch: Partial<MutableNode>) => void; displayOnly?: boolean }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50">
          <th className={`${th} w-12`}>层级</th><th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th>
          <th className={`${th} w-20 text-center`}>操作</th><th className={`${th} w-16`}>目标用量</th><th className={th}>说明</th>
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={8} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => (
          <tr key={i} className={ROW_BG[n.action||''] || (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
            <td className={td}><span className="text-gray-400">{n.level != null ? '-'.repeat(n.level)+n.level : '-'}</span></td>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={td}>{n.entity_version || '-'}</td>
            <td className={td}>{n.quantity}</td>
            <td className={`${td} text-center`}>
              {displayOnly ? <ECOActionBadge action={n.action||'no_change'} /> : <ActionSelect value={n.action||'no_change'} onChange={v => onUpdate(i, { action: v as 'upgrade'|'qty_change'|'delete'|'no_change' })} />}
            </td>
            <td className={td}>
              {n.action === 'qty_change' ? (
                displayOnly ? <span className="text-orange-600 font-semibold">{n._targetQty ?? n.quantity}</span>
                : <input type="number" value={n._targetQty ?? n.quantity} min={1}
                    onChange={e => onUpdate(i, { _targetQty: parseInt(e.target.value)||1 })}
                    className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" />
              ) : n.action === 'delete' ? <span className="text-red-500 text-xs">—</span> : <span className="text-gray-400 text-xs">—</span>}
            </td>
            <td className={td}>
              {displayOnly ? <span className="text-gray-600">{(n._desc ?? n.change_description) || '-'}</span>
              : <input type="text" value={(n._desc ?? n.change_description) || ''} placeholder="说明"
                  onChange={e => onUpdate(i, { _desc: e.target.value })}
                  className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Editable downward table (left) ──
function EditableDownward({ rows, onUpdate, displayOnly = false, onRemove }: { rows: MutableNode[]; onUpdate: (i: number, patch: Partial<MutableNode>) => void; displayOnly?: boolean; onRemove?: (i: number) => void }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50">
          <th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th>
          <th className={`${th} w-20 text-center`}>操作</th><th className={`${th} w-16`}>目标用量</th><th className={th}>说明</th>
          {onRemove && <th className={`${th} w-10`}></th>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={onRemove ? 8 : 7} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => (
          <tr key={i} className={ROW_BG[n.action||''] || (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={td}>{n.entity_version || '-'}</td>
            <td className={td}>{n.quantity}</td>
            <td className={`${td} text-center`}>
              {displayOnly ? <ECOActionBadge action={n.action||'no_change'} /> : <ActionSelect value={n.action||'no_change'} onChange={v => onUpdate(i, { action: v as any })} />}
            </td>
            <td className={td}>
              {(n.action === 'qty_change' || n.action === 'add_existing' || n.action === 'add_new') ? (
                displayOnly ? <span className="text-orange-600 font-semibold">{n._targetQty ?? 1}</span>
                : <input type="number" value={n._targetQty ?? 1} min={1}
                    onChange={e => onUpdate(i, { _targetQty: parseInt(e.target.value)||1 })}
                    className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" />
              ) : n.action === 'delete' ? <span className="text-red-500 text-xs">—</span> : <span className="text-gray-400 text-xs">—</span>}
            </td>
            <td className={td}>
              {displayOnly ? <span className="text-gray-600">{(n._desc ?? n.change_description) || '-'}</span>
              : <input type="text" value={(n._desc ?? n.change_description) || ''} placeholder="说明"
                  onChange={e => onUpdate(i, { _desc: e.target.value })}
                  className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />}
            </td>
            {onRemove && (n.action === 'add_new' || n.action === 'add_existing') && (
              <td className={td}><button onClick={() => onRemove(i)} className="text-red-400 hover:text-red-600 text-xs" title="移除">✕</button></td>
            )}
            {onRemove && !(n.action === 'add_new' || n.action === 'add_existing') && <td className={td}></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Read-only tables (right) ──
function ReadOnlyUpward({ rows }: { rows: MutableNode[] }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={`${th} w-12`}>层级</th><th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          const r = resultRow(n, true);
          return (
            <tr key={i} className={ROW_BG[n.action||'']}>
              <td className={td}><span className="text-gray-400">{n.level != null ? '-'.repeat(n.level)+n.level : '-'}</span></td>
              <td className={td}>{r.code}</td>
              <td className={td}><span className="truncate block">{r.name}</span></td>
              <td className={`${td} ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td>
              <td className={`${td} ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function ReadOnlyDownward({ rows }: { rows: MutableNode[] }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={4} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          if (n.action === 'delete') {
            return (
              <tr key={i} className={ROW_BG[n.action||'']}>
                <td className={`${td} text-gray-300`}>-</td>
                <td className={`${td} text-gray-300`}>-</td>
                <td className={`${td} text-gray-300`}>-</td>
                <td className={`${td} text-gray-300`}>-</td>
              </tr>
            );
          }
          const r = resultRow(n);
          return (
            <tr key={i} className={ROW_BG[n.action||'']}>
              <td className={td}>{r.code}</td>
              <td className={td}><span className="truncate block">{r.name}</span></td>
              <td className={`${td} ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td>
              <td className={`${td} ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

// ── Affected items tables (always upgrade, no action column) ──
function AffectedTable({ rows }: { rows: MutableNode[] }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>编码</th><th className={th}>名称</th><th className={th}>当前版本</th><th className={th}>变更后版本</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={4} className="text-xs text-gray-400 text-center py-6">无</td></tr>
        : rows.map((n, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={td}>{n.entity_version || '-'}</td>
            <td className={`${td} text-blue-600 font-semibold`}>{nextVer(n.entity_version || 'A')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Main ──
export function ECOEditView({ ecrId, onEcrLinked, onBomChange, readOnly, executionItems }: Props) {
  const [ecrData, setEcrData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [localUp, setLocalUp] = useState<MutableNode[]>([]);
  const [localDown, setLocalDown] = useState<MutableNode[]>([]);
  const [localAffected, setLocalAffected] = useState<MutableNode[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerParentId, setPickerParentId] = useState<string | null>(null);

  useEffect(() => {
    if (!ecrId) { setEcrData(null); setLocalUp([]); setLocalDown([]); setLocalAffected([]); return; }
    setLoading(true);
    ecrApi.get(ecrId).then(r => {
      setEcrData(r.data);
      const { up, down } = cloneNodes(r.data);
      // Merge ALL saved execution items (preserving user edits)
      if (executionItems && executionItems.length > 0) {
        const savedMap = new Map<string, any>();
        executionItems.forEach((ei: any) => {
          const key = ei.entity_id || ei.entity_code;
          if (key) savedMap.set(key, ei);
        });
        // Update existing items from saved data
        down.forEach((n: any) => {
          const saved = savedMap.get(n.entity_id) || savedMap.get(n.entity_code);
          if (saved && saved.action && saved.action !== 'add_existing' && saved.action !== 'add_new') {
            n.action = saved.action;
            if (saved.action === 'qty_change' && saved.quantity_change?.to) n._targetQty = saved.quantity_change.to;
            if (saved._targetQty) n._targetQty = saved._targetQty;
          }
          if (saved?.detail?._desc) n._desc = saved.detail._desc;
          if (saved?.detail?._targetQty) n._targetQty = saved.detail._targetQty;
        });
        // Also try to match upward chain items
        up.forEach((n: any) => {
          const saved = savedMap.get(n.entity_id);
          if (saved && saved.action && saved.action !== 'add_existing' && saved.action !== 'add_new') {
            n.action = saved.action;
            if (saved._targetQty) n._targetQty = saved._targetQty;
            if (saved.detail?._targetQty) n._targetQty = saved.detail._targetQty;
          }
        });
        // Add items from saved data that don't exist in ECR data
        const ecrIds = new Set(down.map((d: any) => d.entity_id || d.entity_code));
        executionItems.forEach((ei: any) => {
          const key = ei.entity_id || ei.entity_code;
          if (key && !ecrIds.has(key) && (ei.action === 'add_existing' || ei.action === 'add_new' || !ei.action)) {
            down.push({
              entity_type: ei.entity_type || 'part',
              entity_id: ei.entity_id || '',
              entity_code: ei.entity_code || '',
              entity_name: ei.entity_name || '',
              entity_version: ei.entity_version || 'A',
              quantity: 0,
              _targetQty: ei.detail?._targetQty || 1,
              action: 'add_existing',
              _desc: ei.detail?._desc || '',
              parent_entity_id: ei.parent_entity_id || undefined,
              level: 1,
            } as any);
          }
        });
      }
      setLocalUp(up); setLocalDown(down);
      // Extract affected items
      const affected: MutableNode[] = (r.data.affected_items || []).map((ai: any) => ({
        entity_type: ai.entity_type,
        entity_id: ai.entity_id,
        entity_code: ai.entity_code || '',
        entity_name: ai.entity_name || '',
        entity_version: ai.entity_version || '',
        action: ai.change_type || 'no_change',
        change_description: ai.change_description || '',
        quantity: 1,
        _targetQty: 1,
        _desc: ai.change_description || '',
      }));
      setLocalAffected(affected);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [ecrId]);

  const updateUp = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalUp(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);
  const updateDown = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalDown(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);

  // Notify parent of BOM changes
  useEffect(() => { onBomChange?.({ up: localUp, down: localDown }); }, [localUp, localDown, onBomChange]);

  const resetToEcr = useCallback(() => {
    if (!ecrData) return;
    const { up, down } = cloneNodes(ecrData);
    setLocalUp(up);
    setLocalDown(down);
    const affected: MutableNode[] = (ecrData.affected_items || []).map((ai: any) => ({
      entity_type: ai.entity_type,
      entity_id: ai.entity_id,
      entity_code: ai.entity_code || '',
      entity_name: ai.entity_name || '',
      entity_version: ai.entity_version || '',
      action: ai.change_type || 'no_change',
      change_description: ai.change_description || '',
      quantity: 1,
      _targetQty: 1,
      _desc: ai.change_description || '',
    }));
    setLocalAffected(affected);
    toast.success('已还原为 ECR 原始状态');
  }, [ecrData]);

  const search = async () => {
    if (!searchText.trim()) return;
    setSearching(true);
    try { const r = await ecrApi.list({ search: searchText.trim(), page_size: 10 }); setResults(r.data?.items || r.data || []); }
    catch { toast.error('搜索失败'); }
    finally { setSearching(false); }
  };

  return (
    <div className="space-y-6">
      {!ecrId && (
        <p className="text-xs text-gray-400 text-center py-4">未关联 ECR，无法显示变更分析</p>
      )}

      {ecrId && loading && <p className="text-xs text-gray-400 text-center py-4">加载中...</p>}

      {ecrId && !loading && ecrData && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-800">ECR {ecrData.ecr_number} 变更分析</h4>
            {!readOnly && <button onClick={resetToEcr} className="text-xs px-3 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">还原（恢复 ECR 原始状态）</button>}
          </div>

          {/* Affected items — separate section above upward chain */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1.5">受影响物料</div>
            <AffectedTable rows={localAffected} />
          </div>

          {/* Upward chain */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1.5">向上溯源链</div>
            <div className="grid grid-cols-2 gap-4">
              {readOnly ? (
                <>
                  <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableUpward rows={localUp.filter(n => (n.level ?? 0) > 0)} onUpdate={() => {}} displayOnly /></div>
                  <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={localUp.filter(n => (n.level ?? 0) > 0)} /></div>
                </>
              ) : (
                <>
                  <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableUpward rows={localUp.filter(n => (n.level ?? 0) > 0)} onUpdate={(i, patch) => {
                    const filtered = localUp.filter(n => (n.level ?? 0) > 0);
                    const origIdx = localUp.indexOf(filtered[i]);
                    if (origIdx >= 0) updateUp(origIdx, patch);
                  }} /></div>
                  <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={localUp.filter(n => (n.level ?? 0) > 0)} /></div>
                </>
              )}
            </div>
          </div>

          {/* Downward items */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1.5">向下子项</div>
            <div className="grid grid-cols-2 gap-4">
              {readOnly ? (
                <>
                  <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableDownward rows={localDown} onUpdate={() => {}} displayOnly /></div>
                  <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={localDown} /></div>
                </>
              ) : (
                <>
                  <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableDownward rows={localDown} onUpdate={updateDown} onRemove={(i) => setLocalDown(prev => prev.filter((_, idx) => idx !== i))} /></div>
                  <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={localDown} /></div>
                  {!readOnly && localAffected.some(a => a.entity_type === 'assembly') && (
                  <div className="mt-2 flex gap-2 items-center">
                    <span className="text-xs text-gray-500 mr-1">向下子项新增:</span>
                    <button onClick={async () => {
                      const parents = localAffected.filter(a => a.entity_type === 'assembly');
                      if (parents.length === 0) { toast.error('没有可添加子项的部件'); return; }
                      setPickerParentId(parents[0].entity_id || parents[0].entity_code || '');
                      setPickerOpen(true);
                    }} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">添加子项</button>
                  </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {ecrId && !loading && !ecrData && <p className="text-xs text-gray-400 text-center py-4">未找到 ECR</p>}

      <AssemblyPartPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={async (items) => {
          for (const item of items) {
            let code = ''; let name = ''; let ver = '';
            if (item.child_type === 'part' || item.child_type === 'component') {
              try { const r = await partsApi.get(item.child_id); code = r.data.code; name = r.data.name; ver = r.data.version || 'A'; } catch {}
            } else {
              try { const r = await assembliesApi.get(item.child_id); code = r.data.code; name = r.data.name; ver = r.data.version || 'A'; } catch {}
            }
            setLocalDown(prev => [...prev, { entity_type: 'part', entity_id: item.child_id, entity_code: code, entity_name: name, entity_version: ver, quantity: 0, action: 'add_existing', parent_entity_id: pickerParentId || undefined, _targetQty: item.quantity || 1 } as any]);
          }
          setPickerOpen(false);
          toast.success(`已添加 ${items.length} 项`);
        }}
      />
    </div>
  );
}
