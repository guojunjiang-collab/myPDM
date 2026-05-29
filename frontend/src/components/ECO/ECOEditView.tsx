import { useEffect, useState, useCallback } from 'react';
import { ecrApi, assemblyPartsApi, partsApi, assembliesApi } from '../../services/api';
import type { BomImpactNode } from '../../types';
import { ECOActionBadge } from './ECOStatusBadge';
import AssemblyPartPicker from '../AssemblyPartPicker';
import { toast } from '../Toast';

interface MutableNode extends BomImpactNode {
  _targetQty?: number;
  _desc?: string;
  _affectedCode?: string;
  _affectedName?: string;
}

interface Props {
  ecrId?: string | null;
  onEcrLinked: (ecrId: string) => void;
  onBomChange?: (data: { up: MutableNode[]; down: MutableNode[] }) => void;
  readOnly?: boolean;
  executionItems?: any[];
  resetKey?: number;
  hideResetButton?: boolean;
  ecoId?: string;
  ecoStatus?: string;  // 'draft' | 'reviewing' | 'approved' | 'executing' | 'completed'
  canExecute?: boolean;
  onExecuteUpgrade?: (itemId: string) => void;
  onExecuteRelease?: (itemId: string) => void;
  onExecuteFreeze?: (itemId: string) => void;
  onExecutePublish?: (itemId: string) => void;
  onCheckedChange?: (ids: string[]) => void;
  onViewItem?: (entityType: string, entityId: string) => void;
  onEditItem?: (entityType: string, entityId: string) => void;
}

const ROW_BG: Record<string, string> = {
  upgrade: 'bg-blue-50', qty_change: 'bg-orange-50', delete: 'bg-red-50',
  add_existing: 'bg-green-50', add_new: 'bg-green-50',
};

const th = 'px-2 py-2 text-left text-xs font-semibold text-gray-500 border-b border-gray-200 whitespace-nowrap';
const td = 'px-2 py-1.5 text-xs text-gray-700 border-b border-gray-100';

const ACTIONS = ['no_change', 'upgrade', 'qty_change', 'delete', 'add_existing'] as const;

function ActionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-xs border border-gray-300 rounded px-1 py-1 bg-white focus:ring-1 focus:ring-primary-500">
      {ACTIONS.map(a => <option key={a} value={a}>{a==='no_change'?'不变':a==='upgrade'?'升版':a==='qty_change'?'数量':a==='delete'?'删除':a==='add_existing'?'新增':a}</option>)}
    </select>
  );
}

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
    if (n.action === 'delete') return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: 0 };
    if (n.action === 'qty_change') return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: n._targetQty ?? n.quantity };
    if (n.action === 'upgrade') return { code: n.entity_code || '-', name: n.entity_name || '', ver: nextVer(n.entity_version || 'A'), qty: n.quantity };
    return { code: n.entity_code || '-', name: n.entity_name || '', ver: n.entity_version || '-', qty: n.quantity };
  }
  return {
    code: n.action === 'delete' ? '(删除)' : n.entity_code || '-',
    name: n.action === 'delete' ? '(已移除)' : n.entity_name || '',
    ver: n.action === 'upgrade' ? nextVer(n.entity_version || 'A') : (n.entity_version || '-'),
    qty: (n.action === 'qty_change' || n.action === 'add_existing') ? (n._targetQty ?? n.quantity) : n.quantity,
  };
}

function cloneNodes(ecrData: any): { up: MutableNode[]; down: MutableNode[] } {
  const up: MutableNode[] = []; const down: MutableNode[] = [];
  if (!ecrData) return { up, down };
  (ecrData.affected_items || []).forEach((ai: any) => {
    const bi = ai.bom_impact || {};
    (bi.upward_chain || []).forEach((n: BomImpactNode) => up.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity, _affectedCode: ai.entity_code, _affectedName: ai.entity_name }));
    (bi.downward_items || []).forEach((n: BomImpactNode) => down.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity, _affectedCode: ai.entity_code, _affectedName: ai.entity_name }));
  });
  return { up, down };
}

// ── Editable upward table ──
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
              {displayOnly ? <ECOActionBadge action={n.action||'no_change'} /> : <ActionSelect value={n.action||'no_change'} onChange={v => onUpdate(i, { action: v as any })} />}
            </td>
            <td className={td}>
              {n.action === 'delete' ? <span className="text-red-500 text-xs">—</span>
              : n.action !== 'qty_change' ? <span className="text-xs">{n._targetQty ?? n.quantity}</span>
              : displayOnly ? <span className="text-xs">{n._targetQty ?? n.quantity}</span>
              : <input type="number" value={n._targetQty ?? n.quantity} min={1} onChange={e => onUpdate(i, { _targetQty: parseInt(e.target.value)||1 })} className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" />}
            </td>
            <td className={td}>
              {displayOnly ? <span className="text-gray-600">{(n._desc ?? n.change_description) || '-'}</span>
              : <input type="text" value={(n._desc ?? n.change_description) || ''} placeholder="说明" onChange={e => onUpdate(i, { _desc: e.target.value })} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Editable downward table ──
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
              {n.action === 'delete' ? <span className="text-red-500 text-xs">—</span>
              : (n.action !== 'qty_change' && n.action !== 'add_existing' && n.action !== 'add_new') ? <span className="text-xs">{n._targetQty ?? n.quantity}</span>
              : displayOnly ? <span className="text-xs">{n._targetQty ?? n.quantity}</span>
              : <input type="number" value={n._targetQty ?? n.quantity} min={1} onChange={e => onUpdate(i, { _targetQty: parseInt(e.target.value)||1 })} className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" />}
            </td>
            <td className={td}>
              {displayOnly ? <span className="text-gray-600">{(n._desc ?? n.change_description) || '-'}</span>
              : <input type="text" value={(n._desc ?? n.change_description) || ''} placeholder="说明" onChange={e => onUpdate(i, { _desc: e.target.value })} className="w-full border border-gray-300 rounded px-1 py-0.5 text-xs" />}
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

// ── Read-only tables ──
function ReadOnlyUpward({ rows, execMap, canExec, ecoStatus, onUpgrade, onRelease, onFreeze, onPublish, checkedIds, onToggleCheck, onViewItem, onEditItem }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; onUpgrade?: (id: string) => void; onRelease?: (id: string) => void; onFreeze?: (id: string) => void; onPublish?: (id: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={`${th} w-12`}>层级</th><th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 7 : 5} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          const r = resultRow(n, true);
          const exec = getExec(n.entity_id || '');
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'part';
          const handleRowClick = () => {
            if (!canExec || !exec?.new_entity_status) return;
            // 已发布或已冻结：弹出详情
            if (exec.new_entity_status === 'released' || exec.new_entity_status === 'frozen') {
              onViewItem?.(entityType, exec.new_entity_id || entityId);
            } else if (exec.new_entity_status === 'draft') {
              // 已升版：弹出编辑
              onEditItem?.(entityType, exec.new_entity_id || entityId);
            }
          };
          return (
            <tr key={i} className={`${ROW_BG[n.action||'']} ${exec?.new_entity_status ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}>
              <td className={td}><span className="text-gray-400">{n.level != null ? '-'.repeat(n.level)+n.level : '-'}</span></td>
              <td className={td}>{r.code}</td>
              <td className={td}><span className="truncate block">{r.name}</span></td>
              <td className={`${td} ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td>
              <td className={`${td} ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
              {canExec && (
                <>
                  <td className={td}>
                    {exec?.new_entity_status === 'released' ? <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">已发布</span>
                    : exec?.new_entity_status === 'frozen' ? <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">已冻结</span>
                    : exec?.new_entity_status === 'draft' ? <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">已升版</span>
                    : <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">未执行</span>}
                  </td>
              <td className={td}>
                <div className="flex items-center gap-1">
                  {ecoStatus === 'draft' ? (
                    // 草稿阶段
                    exec?.new_entity_status === 'draft' ? (
                      // 已升版：还原 + 冻结
                      <>
                        <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                        <button onClick={(e) => { e.stopPropagation(); onFreeze?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600">冻结</button>
                      </>
                    ) : exec?.new_entity_status === 'frozen' ? (
                      // 已冻结：还原
                      <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                    ) : !exec?.new_entity_status ? (
                      // 未执行：升版
                      <button onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">升版</button>
                    ) : null
                  ) : ecoStatus === 'executing' ? (
                    // 执行阶段
                    exec?.new_entity_status === 'frozen' ? (
                      // 已冻结：发布
                      <button onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-green-500 text-white rounded hover:bg-green-600">发布</button>
                    ) : null
                  ) : null}
                </div>
              </td>
            </>
          )}
        </tr>
      );
    })}</tbody>
  </table>
</div>);}

function ReadOnlyDownward({ rows, execMap, canExec, ecoStatus, onUpgrade, onRelease, onFreeze, onPublish, checkedIds, onToggleCheck, onViewItem, onEditItem }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; onUpgrade?: (id: string) => void; onRelease?: (id: string) => void; onFreeze?: (id: string) => void; onPublish?: (id: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>编码</th><th className={th}>名称</th><th className={th}>版本</th><th className={th}>用量</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 6 : 4} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          if (n.action === 'delete') return (<tr key={i} className={ROW_BG[n.action||'']}><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td>{canExec && <><td className={td}>-</td><td className={td}>-</td></>}</tr>);
          const r = resultRow(n);
          const exec = getExec(n.entity_id || '');
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'part';
          const handleRowClick = () => {
            if (!canExec || !exec?.new_entity_status) return;
            if (exec.new_entity_status === 'released' || exec.new_entity_status === 'frozen') {
              onViewItem?.(entityType, exec.new_entity_id || entityId);
            } else if (exec.new_entity_status === 'draft') {
              onEditItem?.(entityType, exec.new_entity_id || entityId);
            }
          };
          return (<tr key={i} className={`${ROW_BG[n.action||'']} ${exec?.new_entity_status ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}><td className={td}>{r.code}</td><td className={td}><span className="truncate block">{r.name}</span></td><td className={`${td} ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td><td className={`${td} ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
          {canExec && (
            <>
              <td className={td}>
                {exec?.new_entity_status === 'released' ? <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">已发布</span>
                : exec?.new_entity_status === 'frozen' ? <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">已冻结</span>
                : exec?.new_entity_status === 'draft' ? <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">已升版</span>
                : <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">未执行</span>}
              </td>
              <td className={td}>
                <div className="flex items-center gap-1">
                  {ecoStatus === 'draft' ? (
                    exec?.new_entity_status === 'draft' ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                        <button onClick={(e) => { e.stopPropagation(); onFreeze?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600">冻结</button>
                      </>
                    ) : exec?.new_entity_status === 'frozen' ? (
                      <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                    ) : !exec?.new_entity_status ? (
                      <button onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">升版</button>
                    ) : null
                  ) : ecoStatus === 'executing' ? (
                    exec?.new_entity_status === 'frozen' ? (
                      <button onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || ''); }}
                        className="px-1.5 py-0.5 text-xs bg-green-500 text-white rounded hover:bg-green-600">发布</button>
                    ) : null
                  ) : null}
                </div>
              </td>
            </>
          )}
          </tr>);
        })}</tbody>
      </table>
    </div>
  );
}

// ── Affected items table ──
function AffectedTable({ rows, execMap, canExec, ecoStatus, onUpgrade, onRelease, onFreeze, onPublish, onViewItem, onEditItem, checkedIds, onToggleCheck }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; onUpgrade?: (id: string) => void; onRelease?: (id: string) => void; onFreeze?: (id: string) => void; onPublish?: (id: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>编码</th><th className={th}>名称</th><th className={th}>当前版本</th><th className={th}>变更后版本</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 6 : 4} className="text-xs text-gray-400 text-center py-6">无</td></tr>
        : rows.map((n, i) => {
          const exec = getExec(n.entity_id || '');
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'part';
          const handleRowClick = () => {
            if (!canExec || !exec?.new_entity_status) return;
            if (exec.new_entity_status === 'released' || exec.new_entity_status === 'frozen') {
              onViewItem?.(entityType, exec.new_entity_id || entityId);
            } else if (exec.new_entity_status === 'draft') {
              onEditItem?.(entityType, exec.new_entity_id || entityId);
            }
          };
          return (
          <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${exec?.new_entity_status ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={td}>{n.entity_version || '-'}</td>
            <td className={`${td} text-blue-600 font-semibold`}>{nextVer(n.entity_version || 'A')}</td>
            {canExec && (
              <>
                <td className={td}>
                  {exec?.new_entity_status === 'released' ? <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">已发布</span>
                  : exec?.new_entity_status === 'frozen' ? <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700">已冻结</span>
                  : exec?.new_entity_status === 'draft' ? <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">已升版</span>
                  : <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">未执行</span>}
                </td>
                <td className={td}>
                  <div className="flex items-center gap-1">
                    {ecoStatus === 'draft' ? (
                      exec?.new_entity_status === 'draft' ? (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                            className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                          <button onClick={(e) => { e.stopPropagation(); onFreeze?.(exec?.id || ''); }}
                            className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded hover:bg-orange-600">冻结</button>
                        </>
                      ) : exec?.new_entity_status === 'frozen' ? (
                        <button onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">还原</button>
                      ) : !exec?.new_entity_status ? (
                        <button onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">升版</button>
                      ) : null
                    ) : ecoStatus === 'executing' ? (
                      exec?.new_entity_status === 'frozen' ? (
                        <button onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || ''); }}
                          className="px-1.5 py-0.5 text-xs bg-green-500 text-white rounded hover:bg-green-600">发布</button>
                      ) : null
                    ) : null}
                  </div>
                </td>
              </>
            )}
          </tr>
        )})}</tbody>
      </table>
    </div>
  );
}

export function ECOEditView({ ecrId, onEcrLinked, onBomChange, readOnly, executionItems, resetKey, hideResetButton, ecoId, ecoStatus, canExecute, onExecuteUpgrade, onExecuteRelease, onExecuteFreeze, onExecutePublish, onCheckedChange, onViewItem, onEditItem }: Props) {
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
  const [checkedExecIds, setCheckedExecIds] = useState<Set<string>>(new Set());

  const toggleChecked = (execItemId: string) => {
    setCheckedExecIds(prev => {
      const next = new Set(prev);
      next.has(execItemId) ? next.delete(execItemId) : next.add(execItemId);
      onCheckedChange?.(Array.from(next));
      return next;
    });
  };

  useEffect(() => {
    if (!ecrId) { setEcrData(null); setLocalUp([]); setLocalDown([]); setLocalAffected([]); return; }
    setLoading(true);
    ecrApi.get(ecrId).then(r => {
      setEcrData(r.data);
      const { up, down } = cloneNodes(r.data);
      // Merge saved execution items (composite key: entity_id|_affectedCode)
      if (executionItems && executionItems.length > 0) {
        const savedMap = new Map<string, any>();
        executionItems.forEach((ei: any) => {
          const affCode = ei.detail?._affectedCode || '';
          const key = ei.entity_id || ei.entity_code;
          if (!key) return;
          savedMap.set(key + '|' + affCode, ei);      // composite key for per-group match
          if (!affCode) savedMap.set(key, ei);         // backward compat: fallback without _affectedCode
        });
        const lookup = (n: any) => {
          const compKey = (n.entity_id || n.entity_code || '') + '|' + (n._affectedCode || '');
          return savedMap.get(compKey) || savedMap.get(n.entity_id) || savedMap.get(n.entity_code);
        };
        down.forEach((n: any) => {
          const saved = lookup(n);
          if (!saved) return;
          if (saved.action && saved.action !== 'add_existing' && saved.action !== 'add_new') {
            n.action = saved.action;
          }
          if (saved?.detail?._targetQty != null) n._targetQty = saved.detail._targetQty;
          if (saved?.detail?._desc) n._desc = saved.detail._desc;
        });
        up.forEach((n: any) => {
          const saved = lookup(n);
          if (!saved) return;
          if (saved?.detail?._targetQty != null) n._targetQty = saved.detail._targetQty;
          if (saved.action) n.action = saved.action;
        });
        // Restore manually added items that were saved but may not be in the ECR analysis
        const allKeys = new Set<string>();
        up.forEach((n: any) => {
          if (n.entity_id) allKeys.add(n.entity_id + '|' + (n._affectedCode || ''));
          if (n.entity_code) allKeys.add(n.entity_code + '|' + (n._affectedCode || ''));
        });
        down.forEach((n: any) => {
          if (n.entity_id) allKeys.add(n.entity_id + '|' + (n._affectedCode || ''));
          if (n.entity_code) allKeys.add(n.entity_code + '|' + (n._affectedCode || ''));
        });
        executionItems.forEach((ei: any) => {
          const affCode = ei.detail?._affectedCode || '';
          const key = ei.entity_id || ei.entity_code;
          if (!key) return;
          const compKey = key + '|' + affCode;
          if (!allKeys.has(compKey) && (ei.action === 'add_existing' || ei.action === 'add_new')) {
            const parentAff = r.data.affected_items?.find((a: any) => a.entity_id === ei.parent_entity_id);
            down.push({ entity_type: ei.entity_type || 'part', entity_id: ei.entity_id || '', entity_code: ei.entity_code || '', entity_name: ei.entity_name || '', entity_version: ei.entity_version || 'A', quantity: 0, _targetQty: ei.detail?._targetQty || 1, action: 'add_existing', _desc: ei.detail?._desc || '', parent_entity_id: ei.parent_entity_id || undefined, level: 1, _affectedCode: parentAff?.entity_code || ei.detail?._affectedCode, _affectedName: parentAff?.entity_name || ei._affectedName } as any);
          }
        });
      }
      setLocalUp(up); setLocalDown(down);
      const affected: MutableNode[] = (r.data.affected_items || []).map((ai: any) => ({
        entity_type: ai.entity_type, entity_id: ai.entity_id, entity_code: ai.entity_code || '', entity_name: ai.entity_name || '', entity_version: ai.entity_version || '',
        action: ai.change_type || 'no_change', change_description: ai.change_description || '', quantity: 1, _targetQty: 1, _desc: ai.change_description || '',
      }));
      setLocalAffected(affected);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [ecrId, executionItems]);

  const updateUp = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalUp(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);
  const updateDown = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalDown(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);

  useEffect(() => { onBomChange?.({ up: localUp, down: localDown }); }, [localUp, localDown, onBomChange]);

  // 构建执行项映射 entity_id → execution item
  const [liveExecMap, setLiveExecMap] = useState<Map<string, any>>(new Map());
  const [autoLinkedItems, setAutoLinkedItems] = useState<Map<string, string>>(new Map());
  const execMap = new Map<string, any>();
  (executionItems || []).forEach((ei: any) => {
    if (ei.entity_id) execMap.set(ei.entity_id, ei);
  });
  // 合并自动关联的新版本
  autoLinkedItems.forEach((newId, originalId) => {
    const existing = execMap.get(originalId);
    if (existing && !existing.new_entity_id) {
      execMap.set(originalId, { ...existing, new_entity_id: newId });
    }
  });
  // 合并实时状态（优先使用 liveExecMap 中的状态）
  liveExecMap.forEach((val, key) => {
    const existing = execMap.get(key);
    if (existing) {
      execMap.set(key, { ...existing, new_entity_status: val.status });
    }
  });

  // 加载执行项涉及的零部件实时状态
  useEffect(() => {
    if (!executionItems || executionItems.length === 0) return;
    const newEntityIds = executionItems
      .filter((ei: any) => ei.new_entity_id)
      .map((ei: any) => ({ id: ei.new_entity_id, type: ei.entity_type }));
    
    // 检查所有没有 new_entity_id 的执行项，自动关联已存在的新版本
    const upgradeItems = executionItems
      .filter((ei: any) => !ei.new_entity_id && ei.entity_id && ei.entity_type)
      .map((ei: any) => ({ id: ei.entity_id, type: ei.entity_type, code: ei.entity_code }));

    const promises: Promise<any>[] = [];

    // 获取已有 new_entity_id 的状态
    if (newEntityIds.length > 0) {
      promises.push(
        Promise.allSettled(
          newEntityIds.map(async ({ id, type }: { id: string; type: string }) => {
            const api = type === 'assembly' ? assembliesApi : partsApi;
            const r = await api.get(id);
            return { id, status: r.data.status };
          })
        )
      );
    }

    // 检查升级项是否有对应的新版本存在
    if (upgradeItems.length > 0) {
      promises.push(
        Promise.allSettled(
          upgradeItems.map(async ({ id, type, code }: { id: string; type: string; code: string }) => {
            const api = type === 'assembly' ? assembliesApi : partsApi;
            // 获取原实体信息
            const original = await api.get(id);
            // 搜索同编码的其他版本
            const listApi = type === 'assembly' ? assembliesApi : partsApi;
            const list = await listApi.list({ search: code, page_size: 100 });
            const items = list.data?.items || list.data || [];
            // 找到同编码但不同ID的最新版本（即升版后的实体）
            const newVersion = items.find((item: any) => item.code === code && item.id !== id);
            if (newVersion) {
              return { originalId: id, newId: newVersion.id, status: newVersion.status };
            }
            return null;
          })
        )
      );
    }

    Promise.all(promises).then(results => {
      const statusMap = new Map<string, any>();
      const linkMap = new Map<string, string>(); // originalId -> newId

      // 处理已有 new_entity_id 的状态
      if (results[0]) {
        (results[0] as any[]).forEach(r => {
          if (r.status === 'fulfilled' && r.value) {
            statusMap.set(r.value.id, { status: r.value.status });
          }
        });
      }

      // 处理自动关联的新版本
      if (results[1]) {
        (results[1] as any[]).forEach(r => {
          if (r.status === 'fulfilled' && r.value) {
            linkMap.set(r.value.originalId, r.value.newId);
            statusMap.set(r.value.newId, { status: r.value.status });
          }
        });
      }

      setLiveExecMap(statusMap);
      setAutoLinkedItems(linkMap);
    });
  }, [executionItems]);

  useEffect(() => {
    if (resetKey && resetKey > 0) resetToEcr();
  }, [resetKey]);

  const resetToEcr = useCallback(() => {
    if (!ecrData) return;
    const { up, down } = cloneNodes(ecrData);
    setLocalUp(up); setLocalDown(down);
    const affected: MutableNode[] = (ecrData.affected_items || []).map((ai: any) => ({
      entity_type: ai.entity_type, entity_id: ai.entity_id, entity_code: ai.entity_code || '', entity_name: ai.entity_name || '', entity_version: ai.entity_version || '',
      action: ai.change_type || 'no_change', change_description: ai.change_description || '', quantity: 1, _targetQty: 1, _desc: ai.change_description || '',
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
    <div>
      {!ecrId && <p className="text-xs text-gray-400 text-center py-4">未关联 ECR，无法显示变更分析</p>}
      {ecrId && loading && <p className="text-xs text-gray-400 text-center py-4">加载中...</p>}
      {ecrId && !loading && ecrData && (<>
        <div className="flex items-center justify-end mb-2">
          {!readOnly && !hideResetButton && <button onClick={resetToEcr} className="text-xs px-3 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-50">还原</button>}
        </div>

        {/* Per-group analysis cards */}
        {localAffected.map(ai => {
          const upRows = localUp.filter(n => (n as any)._affectedCode === ai.entity_code && (n.level ?? 0) > 0);
          const downRows = localDown.filter(n => (n as any)._affectedCode === ai.entity_code);
          return (
            <div key={ai.entity_id || ai.entity_code} className="bg-gray-50/50 rounded-lg border border-gray-200 p-3 mb-4">
              <div className="text-xs font-semibold text-gray-700 mb-2">📦 受影响物料: {ai.entity_code} - {ai.entity_name}</div>
              <AffectedTable rows={[ai]} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} />

              {/* Upward chain */}
              {upRows.length > 0 && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📊 向上溯源链</div>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableUpward rows={upRows} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={upRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>) : (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableUpward rows={upRows} onUpdate={(i, patch) => { const origIdx = localUp.indexOf(upRows[i]); if (origIdx >= 0) updateUp(origIdx, patch); }} /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={upRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>)}
                </div>
              </>)}

              {/* Downward items */}
              {ai.entity_type === 'assembly' && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📋 向下子项</div>
                <div className="grid grid-cols-2 gap-4">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableDownward rows={downRows} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={downRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>) : (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableDownward rows={downRows} onUpdate={(i, patch) => { const origIdx = localDown.indexOf(downRows[i]); if (origIdx >= 0) updateDown(origIdx, patch); }} onRemove={(i) => { const origIdx = localDown.indexOf(downRows[i]); if (origIdx >= 0) setLocalDown(prev => prev.filter((_, idx) => idx !== origIdx)); }} /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={downRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>)}
                </div>
                {!readOnly && (
                  <div className="mt-2 flex gap-2 items-center">
                    <span className="text-xs text-gray-400">+ 添加子项到本部件</span>
                    <button onClick={async () => { setPickerParentId(ai.entity_id || ai.entity_code || ''); setPickerOpen(true); }} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">添加子项</button>
                  </div>
                )}
              </>)}
            </div>
          );
        })}

        {/* Orphan group */}
        {(() => {
          const orphanUp = localUp.filter(n => !(n as any)._affectedCode && (n.level ?? 0) > 0);
          const orphanDown = localDown.filter(n => !(n as any)._affectedCode);
          if (orphanUp.length === 0 && orphanDown.length === 0) return null;
          return (
            <div className="bg-gray-50/50 rounded-lg border border-gray-200 p-3 mb-4">
              <div className="text-xs font-semibold text-gray-700 mb-2">📦 其他/手动新增</div>
              {orphanUp.length > 0 && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📊 向上溯源链</div>
                <div className="grid grid-cols-2 gap-4">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableUpward rows={orphanUp} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={orphanUp} /></div>
                  </>) : null}
                </div>
              </>)}
              {orphanDown.length > 0 && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📋 向下子项</div>
                <div className="grid grid-cols-2 gap-4">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableDownward rows={orphanDown} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={orphanDown} /></div>
                  </>) : (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableDownward rows={orphanDown} onUpdate={(i, patch) => { const origIdx = localDown.indexOf(orphanDown[i]); if (origIdx >= 0) updateDown(origIdx, patch); }} onRemove={(i) => { const origIdx = localDown.indexOf(orphanDown[i]); if (origIdx >= 0) setLocalDown(prev => prev.filter((_, idx) => idx !== origIdx)); }} /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={orphanDown} /></div>
                  </>)}
                </div>
              </>)}
            </div>
          );
        })()}
      </>)}
      {ecrId && !loading && !ecrData && <p className="text-xs text-gray-400 text-center py-4">未找到 ECR</p>}

      <AssemblyPartPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
        onConfirm={async (items) => {
          for (const item of items) {
            let code = ''; let name = ''; let ver = '';
            if (item.child_type === 'part' || item.child_type === 'component') {
              try { const r = await partsApi.get(item.child_id); code = r.data.code; name = r.data.name; ver = r.data.version || 'A'; } catch {}
            } else {
              try { const r = await assembliesApi.get(item.child_id); code = r.data.code; name = r.data.name; ver = r.data.version || 'A'; } catch {}
            }
            const parentAffected = localAffected.find(a => a.entity_id === pickerParentId || a.entity_code === pickerParentId);
            setLocalDown(prev => [...prev, { entity_type: 'part', entity_id: item.child_id, entity_code: code, entity_name: name, entity_version: ver, quantity: 0, action: 'add_existing', parent_entity_id: pickerParentId || undefined, _targetQty: item.quantity || 1, _affectedCode: (parentAffected as any)?.entity_code, _affectedName: (parentAffected as any)?.entity_name } as any]);
          }
          setPickerOpen(false);
          toast.success(`已添加 ${items.length} 项`);
        }}
      />
    </div>
  );
}
