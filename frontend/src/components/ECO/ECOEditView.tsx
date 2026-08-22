import { useEffect, useState, useCallback } from 'react';
import { ecrApi, ecoApi, partsApi } from '../../services/api';
import type { BomImpactNode } from '../../types';
import { ECOActionBadge } from './ECOStatusBadge';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
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
  onExecuteUpgrade?: (itemId: string, entityInfo?: { entity_type: string; entity_id: string; entity_code: string; entity_name: string; action: string }) => void;
  onExecuteRelease?: (itemId: string, newEntityId?: string) => void;
  onExecuteFreeze?: (itemId: string, newEntityId?: string) => void;
  onExecutePublish?: (itemId: string, newEntityId?: string) => void;
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

// ─── 向上溯源树：保持父→子→孙层级相邻，兄弟按件号排序，支持按层展开 ───
interface UpwardTreeNode { node: MutableNode; children: UpwardTreeNode[]; }
interface UpRowMeta { hasChildren: boolean; expanded: boolean; key: string; }

// 只对同级兄弟排序（不改变输入顺序——树的父子嵌套依赖输入的 level 序列）
function sortUpwardSiblings(nodes: UpwardTreeNode[]): void {
  nodes.sort((a, b) => (a.node.entity_code || '').localeCompare(b.node.entity_code || '', 'zh-CN'));
  for (const n of nodes) sortUpwardSiblings(n.children);
}

function buildUpwardTree(items: MutableNode[]): UpwardTreeNode[] {
  const roots: UpwardTreeNode[] = [];
  const stack: UpwardTreeNode[] = [];
  for (const item of items) {
    const treeNode: UpwardTreeNode = { node: item, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1].node.level ?? 0) >= (item.level ?? 0)) stack.pop();
    if (stack.length > 0) stack[stack.length - 1].children.push(treeNode);
    else roots.push(treeNode);
    stack.push(treeNode);
  }
  sortUpwardSiblings(roots);
  return roots;
}

// 前序遍历展平为可见行：默认仅展开 1 层级（根=level1 可见，更深层折叠），更多由 expandedKeys 控制
function computeVisibleUpward(
  items: MutableNode[], expandedKeys: Set<string>, aiCode: string,
): { visible: MutableNode[]; meta: Map<MutableNode, UpRowMeta> } {
  const tree = buildUpwardTree(items);
  const visible: MutableNode[] = [];
  const meta = new Map<MutableNode, UpRowMeta>();
  const keyOf = (n: MutableNode) => `${aiCode}:${n.entity_id}:${n.level}`;
  const walk = (nodes: UpwardTreeNode[]) => {
    for (const t of nodes) {
      const key = keyOf(t.node);
      const hasChildren = t.children.length > 0;
      const expanded = expandedKeys.has(key);
      meta.set(t.node, { hasChildren, expanded, key });
      visible.push(t.node);
      if (hasChildren && expanded) walk(t.children);
    }
  };
  walk(tree);
  return { visible, meta };
}

// 层级单元格：有子项时显示展开/折叠按钮，缩进用 level 表示
function LevelCell({ n, meta, onToggle }: { n: MutableNode; meta?: Map<MutableNode, UpRowMeta>; onToggle?: (key: string) => void }) {
  const m = meta?.get(n);
  return (
    <td className={td}>
      <span className="text-gray-400 inline-flex items-center gap-0.5">
        {m?.hasChildren ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle?.(m.key); }}
            className="text-gray-500 hover:text-gray-700 w-3 leading-none">{m.expanded ? '▼' : '▶'}</button>
        ) : <span className="inline-block w-3" />}
        {n.level != null ? '-'.repeat(n.level) + n.level : '-'}
      </span>
    </td>
  );
}

const UPWARD_ACTIONS = ['no_change', 'upgrade', 'qty_change', 'delete'] as const;
const DOWNWARD_ACTIONS = ['no_change', 'upgrade', 'qty_change', 'delete', 'add_existing'] as const;

function ActionSelect({ value, onChange, variant = 'downward' }: { value: string; onChange: (v: string) => void; variant?: 'upward' | 'downward' }) {
  const actions = variant === 'upward' ? UPWARD_ACTIONS : DOWNWARD_ACTIONS;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-xs border border-gray-300 rounded px-1 py-1 bg-white focus:ring-1 focus:ring-primary-500">
      {actions.map(a => <option key={a} value={a}>{a==='no_change'?'不变':a==='upgrade'?'升版':a==='qty_change'?'数量':a==='delete'?'删除':a==='add_existing'?'新增':a}</option>)}
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

// ── 辅助：判断是否需要显示"不变更"状态 ──
function isUnchanged(n: MutableNode, isUpward: boolean): boolean {
  // 向上溯源链：仅 action=no_change 时不变更
  if (isUpward) return n.action === 'no_change';
  // 向下子项：action=no_change 或 qty_change 时不变更
  return n.action === 'no_change' || n.action === 'qty_change';
}

// ── 辅助：判断是否自动视为"已升版"（向下子项中的"新增"操作）──
function isAutoUpgraded(n: MutableNode): boolean {
  return n.action === 'add_existing';
}

// ── 渲染变更状态 Badge ──
function StatusBadge({ status }: { status: string | undefined }) {
  // draft（已升版）为 ECO 执行语境下的业务文案，单独处理；released/frozen 走 part 域
  if (status === 'draft') return <Badge tone="blue" label="已升版" />;
  if (!status) return <Badge tone="gray" label="未执行" />;
  return <Badge status={status} />;
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
    (bi.upward_chain || []).forEach((n: BomImpactNode) => up.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity, _desc: n.change_description || '', _affectedCode: ai.entity_code, _affectedName: ai.entity_name }));
    (bi.downward_items || []).forEach((n: BomImpactNode) => down.push({ ...n, _targetQty: n.quantity_change?.to ?? n.quantity, _desc: n.change_description || '', _affectedCode: ai.entity_code, _affectedName: ai.entity_name }));
  });
  return { up, down };
}

// ── Editable upward table ──
function EditableUpward({ rows, onUpdate, displayOnly = false, meta, onToggle }: { rows: MutableNode[]; onUpdate: (i: number, patch: Partial<MutableNode>) => void; displayOnly?: boolean; meta?: Map<MutableNode, UpRowMeta>; onToggle?: (key: string) => void }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50">
          <th className={`${th} w-12`}>层级</th><th className={th}>件号</th><th className={th}>名称</th><th className={`${th} text-center`}>版本</th><th className={`${th} text-center`}>用量</th>
          <th className={`${th} w-20 text-center`}>操作</th><th className={`${th} w-16 text-center`}>目标用量</th><th className={th}>说明</th>
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={8} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => (
          <tr key={i} className={ROW_BG[n.action||''] || (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
            <LevelCell n={n} meta={meta} onToggle={onToggle} />
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={`${td} text-center`}>{n.entity_version || '-'}</td>
            <td className={`${td} text-center`}>{n.quantity}</td>
            <td className={`${td} text-center`}>
              {displayOnly ? <ECOActionBadge action={n.action||'no_change'} /> : <ActionSelect variant="upward" value={n.action||'no_change'} onChange={v => onUpdate(i, { action: v as any })} />}
            </td>
            <td className={`${td} text-center`}>
              {n.action === 'delete' ? <span className="text-red-500 text-xs">—</span>
              : n.action === 'qty_change' && !displayOnly ? <input type="number" value={n._targetQty ?? (n.quantity_change?.to ?? n.quantity)} min={1} onChange={e => onUpdate(i, { _targetQty: parseInt(e.target.value)||1 })} className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-center" />
              : <span className="text-xs">{n._targetQty ?? (n.quantity_change?.to ?? n.quantity)}</span>}
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
          <th className={th}>件号</th><th className={th}>名称</th><th className={`${th} text-center`}>版本</th><th className={`${th} text-center`}>用量</th>
          <th className={`${th} w-20 text-center`}>操作</th><th className={`${th} w-16 text-center`}>目标用量</th><th className={th}>说明</th>
          {onRemove && <th className={`${th} w-10`}></th>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={onRemove ? 8 : 7} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => (
          <tr key={i} className={ROW_BG[n.action||''] || (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={`${td} text-center`}>{n.entity_version || '-'}</td>
            <td className={`${td} text-center`}>{n.quantity}</td>
            <td className={`${td} text-center`}>
              {displayOnly ? <ECOActionBadge action={n.action||'no_change'} /> : <ActionSelect value={n.action||'no_change'} onChange={v => onUpdate(i, { action: v as any })} />}
            </td>
            <td className={`${td} text-center`}>
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
              <td className={td}><Button variant="danger" size="xs" onClick={() => onRemove(i)} title="移除">✕</Button></td>
            )}
            {onRemove && !(n.action === 'add_new' || n.action === 'add_existing') && <td className={td}></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ── Read-only tables ──
function ReadOnlyUpward({ rows, execMap, canExec, ecoStatus, ecoId, onUpgrade, onRelease, onFreeze, onPublish, checkedIds, onToggleCheck, onViewItem, onEditItem, meta, onToggle }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; ecoId?: string; onUpgrade?: (id: string, entityInfo?: { entity_type: string; entity_id: string; entity_code: string; entity_name: string; action: string }) => void; onRelease?: (id: string, newEntityId?: string) => void; onFreeze?: (id: string, newEntityId?: string) => void; onPublish?: (id: string, newEntityId?: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void; meta?: Map<MutableNode, UpRowMeta>; onToggle?: (key: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={`${th} w-12`}>层级</th><th className={th}>件号</th><th className={th}>名称</th><th className={`${th} text-center`}>版本</th><th className={`${th} text-center`}>用量</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28 text-center`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 7 : 5} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          const r = resultRow(n, true);
          const exec = getExec(n.entity_id || '');
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'component';
          const unchanged = isUnchanged(n, true);
          const handleRowClick = () => {
            if (!canExec || unchanged || !exec?.new_entity_status) return;
            // 已发布或已冻结：弹出详情
            if (exec.new_entity_status === 'released' || exec.new_entity_status === 'frozen') {
              onViewItem?.(entityType, exec.new_entity_id || entityId);
            } else if (exec.new_entity_status === 'draft') {
              // 已升版：弹出编辑
              onEditItem?.(entityType, exec.new_entity_id || entityId);
            }
          };
          return (
            <tr key={i} className={`${ROW_BG[n.action||'']} ${!unchanged && exec?.new_entity_status ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}>
              <LevelCell n={n} meta={meta} onToggle={onToggle} />
              <td className={td}>{r.code}</td>
              <td className={td}><span className="truncate block">{r.name}</span></td>
              <td className={`${td} text-center ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td>
              <td className={`${td} text-center ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
              {canExec && (
                <>
                  <td className={td}>
                    {unchanged ? <Badge tone="gray" label="不变更" />
                    : <StatusBadge status={exec?.new_entity_status} />}
                  </td>
                  <td className={`${td} text-center`}>
                {!unchanged && (
                  <div className="flex items-center gap-1">
                    {ecoStatus === 'draft' ? (
                      // 草稿阶段
                      exec?.new_entity_status === 'draft' ? (
                        // 已升版：还原 + 冻结
                        <>
                          <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || '', exec?.new_entity_id); }}>还原</Button>
                          <Button variant="dark" size="xs" onClick={(e) => { e.stopPropagation(); onFreeze?.(exec?.id || '', exec?.new_entity_id); }}>冻结</Button>
                        </>
                      ) : exec?.new_entity_status === 'frozen' ? (
                        // 已冻结：解冻
                        <Button variant="dark" size="xs" onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || '', exec?.new_entity_id); }}>解冻</Button>
                      ) : !exec?.new_entity_status ? (
                        // 未执行：升版
                        <Button size="xs" onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || '', { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code || '', entity_name: n.entity_name || '', action: n.action || 'upgrade' }); }}>升版</Button>
                      ) : null
                    ) : ecoStatus === 'executing' ? (
                      // 执行阶段
                      exec?.new_entity_status === 'frozen' ? (
                        // 已冻结：发布
                        <Button variant="success" size="xs" onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || '', exec?.new_entity_id); }}>发布</Button>
                      ) : null
                    ) : null}
                  </div>
                )}
              </td>
            </>
          )}
        </tr>
      );
    })}</tbody>
  </table>
</div>);}

function ReadOnlyDownward({ rows, execMap, canExec, ecoStatus, ecoId, onUpgrade, onRelease, onFreeze, onPublish, checkedIds, onToggleCheck, onViewItem, onEditItem }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; ecoId?: string; onUpgrade?: (id: string, entityInfo?: { entity_type: string; entity_id: string; entity_code: string; entity_name: string; action: string }) => void; onRelease?: (id: string, newEntityId?: string) => void; onFreeze?: (id: string, newEntityId?: string) => void; onPublish?: (id: string, newEntityId?: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>件号</th><th className={th}>名称</th><th className={`${th} text-center`}>版本</th><th className={`${th} text-center`}>用量</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28 text-center`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 6 : 4} className="text-xs text-gray-400 text-center py-6">无数据</td></tr>
        : rows.map((n, i) => {
          if (n.action === 'delete') return (<tr key={i} className={ROW_BG[n.action||'']}><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td><td className={`${td} text-gray-300`}>-</td>{canExec && <><td className={td}>-</td><td className={td}>-</td></>}</tr>);
          const r = resultRow(n);
          const exec = getExec(n.entity_id || '');
          const unchanged = isUnchanged(n, false);
          const autoUpgraded = isAutoUpgraded(n) && !exec?.new_entity_status;
          const effStatus = autoUpgraded ? 'draft' : exec?.new_entity_status;
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'component';
          const handleRowClick = () => {
            if (!canExec || unchanged || !effStatus) return;
            if (effStatus === 'released' || effStatus === 'frozen') {
              onViewItem?.(entityType, exec?.new_entity_id || entityId);
            } else if (effStatus === 'draft') {
              onEditItem?.(entityType, exec?.new_entity_id || entityId);
            }
          };
          return (<tr key={i} className={`${ROW_BG[n.action||'']} ${!unchanged && effStatus ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}><td className={td}>{r.code}</td><td className={td}><span className="truncate block">{r.name}</span></td><td className={`${td} text-center ${n.action === 'upgrade' ? 'text-blue-600 font-semibold' : ''}`}>{r.ver}</td><td className={`${td} text-center ${n.action === 'qty_change' ? 'text-orange-600 font-semibold' : ''}`}>{r.qty}</td>
          {canExec && (
            <>
              <td className={td}>
                {unchanged ? <Badge tone="gray" label="不变更" />
                : <StatusBadge status={effStatus} />}
              </td>
              <td className={`${td} text-center`}>
                {!unchanged && (
                  <div className="flex items-center gap-1">
                    {ecoStatus === 'draft' ? (
                      effStatus === 'draft' ? (
                        // 新增的零部件：隐藏"还原"按钮，避免误删
                        n.action === 'add_existing' ? (
                          <Button variant="dark" size="xs" onClick={async (e) => {
                            e.stopPropagation();
                            let itemId = exec?.id || '';
                            if (!itemId && ecoId) {
                              const created = await ecoApi.addExecutionItem(ecoId, { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code, entity_name: n.entity_name, action: 'add_existing', source: 'manual' });
                              itemId = created.data?.id;
                            }
                            onFreeze?.(itemId, n.entity_id);
                          }}>冻结</Button>
                        ) : (
                          <>
                            <Button variant="danger" size="xs" onClick={async (e) => {
                              e.stopPropagation();
                              let itemId = exec?.id || '';
                              if (!itemId && ecoId) {
                                const created = await ecoApi.addExecutionItem(ecoId, { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code, entity_name: n.entity_name, action: 'add_existing', source: 'manual' });
                                itemId = created.data?.id;
                              }
                              onRelease?.(itemId, n.entity_id);
                            }}>还原</Button>
                            <Button variant="dark" size="xs" onClick={async (e) => {
                              e.stopPropagation();
                              let itemId = exec?.id || '';
                              if (!itemId && ecoId) {
                                const created = await ecoApi.addExecutionItem(ecoId, { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code, entity_name: n.entity_name, action: 'add_existing', source: 'manual' });
                                itemId = created.data?.id;
                              }
                              onFreeze?.(itemId, n.entity_id);
                            }}>冻结</Button>
                          </>
                        )
                      ) : effStatus === 'frozen' ? (
                        <Button variant="dark" size="xs" onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || '', exec?.new_entity_id); }}>解冻</Button>
                      ) : !effStatus ? (
                        <Button size="xs" onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || '', { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code || '', entity_name: n.entity_name || '', action: n.action || 'upgrade' }); }}>升版</Button>
                      ) : null
                    ) : ecoStatus === 'executing' ? (
                      effStatus === 'frozen' ? (
                        <Button variant="success" size="xs" onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || '', exec?.new_entity_id); }}>发布</Button>
                      ) : null
                    ) : null}
                  </div>
                )}
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
function AffectedTable({ rows, execMap, canExec, ecoStatus, ecoId, onUpgrade, onRelease, onFreeze, onPublish, onViewItem, onEditItem, checkedIds, onToggleCheck }: { rows: MutableNode[]; execMap?: Map<string, any>; canExec?: boolean; ecoStatus?: string; ecoId?: string; onUpgrade?: (id: string, entityInfo?: { entity_type: string; entity_id: string; entity_code: string; entity_name: string; action: string }) => void; onRelease?: (id: string, newEntityId?: string) => void; onFreeze?: (id: string, newEntityId?: string) => void; onPublish?: (id: string, newEntityId?: string) => void; onViewItem?: (entityType: string, entityId: string) => void; onEditItem?: (entityType: string, entityId: string) => void; checkedIds?: Set<string>; onToggleCheck?: (id: string) => void }) {
  const getExec = (entityId: string) => execMap?.get(entityId);
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead><tr className="bg-gray-50"><th className={th}>件号</th><th className={th}>名称</th><th className={th}>当前版本</th><th className={th}>变更后版本</th>
        {canExec && <><th className={`${th} w-20`}>变更状态</th><th className={`${th} w-28`}>操作</th></>}
        </tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={canExec ? 6 : 4} className="text-xs text-gray-400 text-center py-6">无</td></tr>
        : rows.map((n, i) => {
          const exec = getExec(n.entity_id || '');
          const effStatus = exec?.new_entity_status;
          const entityId = exec?.new_entity_id || n.entity_id || '';
          const entityType = n.entity_type || 'component';
          const handleRowClick = () => {
            if (!canExec || !effStatus) return;
            if (effStatus === 'released' || effStatus === 'frozen') {
              onViewItem?.(entityType, exec.new_entity_id || entityId);
            } else if (effStatus === 'draft') {
              onEditItem?.(entityType, exec.new_entity_id || entityId);
            }
          };
          return (
          <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${effStatus ? 'cursor-pointer hover:opacity-80' : ''}`} onClick={handleRowClick}>
            <td className={td}>{n.entity_code||'-'}</td>
            <td className={td}><span className="truncate block">{n.entity_name}</span></td>
            <td className={td}>{n.entity_version || '-'}</td>
            <td className={`${td} text-blue-600 font-semibold`}>{nextVer(n.entity_version || 'A')}</td>
            {canExec && (
              <>
                <td className={td}>
                  <StatusBadge status={effStatus} />
                </td>
                <td className={td}>
                  <div className="flex items-center gap-1">
                    {ecoStatus === 'draft' ? (
                      effStatus === 'draft' ? (
                        <>
                          <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || '', exec?.new_entity_id); }}>还原</Button>
                          <Button variant="dark" size="xs" onClick={(e) => { e.stopPropagation(); onFreeze?.(exec?.id || '', exec?.new_entity_id); }}>冻结</Button>
                        </>
                      ) : effStatus === 'frozen' ? (
                        <Button variant="dark" size="xs" onClick={(e) => { e.stopPropagation(); onRelease?.(exec?.id || '', exec?.new_entity_id); }}>解冻</Button>
                      ) : !effStatus ? (
                        <Button size="xs" onClick={(e) => { e.stopPropagation(); onUpgrade?.(exec?.id || '', { entity_type: n.entity_type || 'component', entity_id: n.entity_id, entity_code: n.entity_code || '', entity_name: n.entity_name || '', action: 'upgrade' }); }}>升版</Button>
                      ) : null
                    ) : ecoStatus === 'executing' ? (
                      effStatus === 'frozen' ? (
                        <Button variant="success" size="xs" onClick={(e) => { e.stopPropagation(); onPublish?.(exec?.id || '', exec?.new_entity_id); }}>发布</Button>
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
  // 向上溯源链展开状态：默认空集 = 仅展开 1 层级（根/直接父项可见），更深层由用户手动展开
  const [expandedUp, setExpandedUp] = useState<Set<string>>(() => new Set());
  const toggleUp = useCallback((key: string) => {
    setExpandedUp((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleChecked = (execItemId: string) => {
    setCheckedExecIds(prev => {
      const next = new Set(prev);
      next.has(execItemId) ? next.delete(execItemId) : next.add(execItemId);
      onCheckedChange?.(Array.from(next));
      return next;
    });
  };

  // ECR 数据加载（仅 ecrId 变化时触发）
  useEffect(() => {
    if (!ecrId) { setEcrData(null); setLocalUp([]); setLocalDown([]); setLocalAffected([]); return; }
    setLoading(true);
    ecrApi.get(ecrId).then(r => {
      setEcrData(r.data);
      const affected: MutableNode[] = (r.data.affected_items || []).map((ai: any) => ({
        entity_type: ai.entity_type, entity_id: ai.entity_id, entity_code: ai.entity_code || '', entity_name: ai.entity_name || '', entity_version: ai.entity_version || '',
        action: ai.change_type || 'no_change', change_description: ai.change_description || '', quantity: 1, _targetQty: 1, _desc: ai.change_description || '',
      }));
      setLocalAffected(affected);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [ecrId]);

  // 执行项合并到 ECR 分析数据（executionItems 变化时增量更新，不重新加载 ECR）
  useEffect(() => {
    if (!ecrData) return;
    const { up, down } = cloneNodes(ecrData);
    if (executionItems && executionItems.length > 0) {
      const savedMap = new Map<string, any>();
      executionItems.forEach((ei: any) => {
        const affCode = ei.detail?._affectedCode || '';
        const key = ei.entity_id || ei.entity_code;
        if (!key) return;
        savedMap.set(key + '|' + affCode, ei);
        if (!affCode) savedMap.set(key, ei);
      });
      const lookup = (n: any) => {
        const compKey = (n.entity_id || n.entity_code || '') + '|' + (n._affectedCode || '');
        return savedMap.get(compKey) || savedMap.get(n.entity_id) || savedMap.get(n.entity_code);
      };
      down.forEach((n: any) => {
        const saved = lookup(n);
        if (!saved) return;
        if (saved.action && saved.action !== 'add_existing' && saved.action !== 'add_new') n.action = saved.action;
        if (saved?.detail?._targetQty != null) n._targetQty = saved.detail._targetQty;
        if (saved?.detail?._desc) n._desc = saved.detail._desc;
      });
      up.forEach((n: any) => {
        const saved = lookup(n);
        if (!saved) return;
        if (saved?.detail?._targetQty != null) n._targetQty = saved.detail._targetQty;
        if (saved?.detail?._desc) n._desc = saved.detail._desc;
        if (saved.action) n.action = saved.action;
      });
      const allKeys = new Set<string>();
      up.forEach((n: any) => { if (n.entity_id) allKeys.add(n.entity_id + '|' + (n._affectedCode || '')); if (n.entity_code) allKeys.add(n.entity_code + '|' + (n._affectedCode || '')); });
      down.forEach((n: any) => { if (n.entity_id) allKeys.add(n.entity_id + '|' + (n._affectedCode || '')); if (n.entity_code) allKeys.add(n.entity_code + '|' + (n._affectedCode || '')); });
      executionItems.forEach((ei: any) => {
        const affCode = ei.detail?._affectedCode || '';
        const key = ei.entity_id || ei.entity_code;
        if (!key) return;
        const compKey = key + '|' + affCode;
        if (!allKeys.has(compKey) && (ei.action === 'add_existing' || ei.action === 'add_new')) {
          const parentAff = ecrData.affected_items?.find((a: any) => a.entity_id === ei.parent_entity_id);
          down.push({ entity_type: ei.entity_type || 'component', entity_id: ei.entity_id || '', entity_code: ei.entity_code || '', entity_name: ei.entity_name || '', entity_version: ei.entity_version || 'A', quantity: 0, _targetQty: ei.detail?._targetQty || 1, action: 'add_existing', _desc: ei.detail?._desc || '', parent_entity_id: ei.parent_entity_id || undefined, level: 1, _affectedCode: parentAff?.entity_code || ei.detail?._affectedCode, _affectedName: parentAff?.entity_name || ei._affectedName } as any);
        }
      });
    }
    setLocalUp(up); setLocalDown(down);
  }, [ecrData]);

  const updateUp = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalUp(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);
  const updateDown = useCallback((i: number, patch: Partial<MutableNode>) => {
    setLocalDown(prev => prev.map((n, idx) => idx === i ? { ...n, ...patch } : n));
  }, []);

  useEffect(() => { onBomChange?.({ up: localUp, down: localDown }); }, [localUp, localDown, onBomChange]);

  // 构建执行项映射 entity_id → execution item
  const [liveExecData, setLiveExecData] = useState<Map<string, { status: string; newId: string }>>(new Map());
  const execMap = new Map<string, any>();
  (executionItems || []).forEach((ei: any) => {
    if (ei.entity_id) execMap.set(ei.entity_id, ei);
  });
  // 合并自动检测结果：仅当 API 未返回 new_entity_id 时，用检测结果补充
  liveExecData.forEach((val, key) => {
    const existing = execMap.get(key);
    if (existing && !existing.new_entity_id) {
      execMap.set(key, { ...existing, new_entity_id: val.newId, new_entity_status: val.status, _auto_linked: true });
    } else if (existing && !existing.new_entity_status) {
      execMap.set(key, { ...existing, new_entity_status: val.status });
    }
  });

  // 加载执行项涉及的零部件实时状态（仅显示用途）
  useEffect(() => {
    if (!executionItems || executionItems.length === 0) return;

    const dedupMap = new Map<string, { entity_id: string; entity_type: string; entity_code: string }>();
    executionItems.forEach((ei: any) => {
      if (ei.entity_code && !dedupMap.has(ei.entity_code)) {
        dedupMap.set(ei.entity_code, { entity_id: ei.entity_id, entity_type: ei.entity_type, entity_code: ei.entity_code });
      }
    });

    const entries = Array.from(dedupMap.values());
    if (entries.length === 0) return;

    Promise.allSettled(
      entries.map(async ({ entity_id, entity_code }) => {
        try {
          // entity_id 为 PartRevision.id，获取其所属 master 的全部版本
          const revision = await partsApi.getRevision(entity_id);
          if (!revision?.master_id) return null;
          const revisions = await partsApi.revisions(revision.master_id);
          const { items } = (revisions as any) || {};
          if (!items || items.length === 0) return null;
          // 查找除自身外的最新版本（状态非 draft 表示已升版/冻结/发布）
          const other = items.find((r: any) => r.id !== entity_id && r.status && r.status !== 'draft');
          if (other) return { entity_id, status: other.status, newId: other.id };
          return null;
        } catch { return null; }
      })
    ).then(results => {
      const dataMap = new Map<string, { status: string; newId: string }>();
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) {
          dataMap.set(r.value.entity_id, { status: r.value.status, newId: r.value.newId });
        }
      });
      setLiveExecData(dataMap);
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
          {!readOnly && !hideResetButton && <Button variant="secondary" size="xs" onClick={resetToEcr}>还原</Button>}
        </div>

        {/* Per-group analysis cards */}
        {localAffected.map(ai => {
          const byCode = (a: any, b: any) => (a.entity_code || '').localeCompare(b.entity_code || '', 'zh-CN');
          // 向上溯源链：按 chain 原始顺序建树（兄弟按件号排序），再按展开状态展平为可见行
          const upFiltered = localUp.filter(n => (n as any)._affectedCode === ai.entity_code && (n.level ?? 0) > 0);
          const { visible: upVisible, meta: upMeta } = computeVisibleUpward(upFiltered, expandedUp, ai.entity_code || '');
          const downRows = localDown.filter(n => (n as any)._affectedCode === ai.entity_code).sort(byCode);
          return (
            <div key={ai.entity_id || ai.entity_code} className="bg-gray-50/50 rounded-lg border border-gray-200 p-3 mb-4">
              <div className="text-xs font-semibold text-gray-700 mb-2">📦 受影响物料: {ai.entity_code} - {ai.entity_name}</div>
              <AffectedTable rows={[ai]} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} ecoId={ecoId} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} />

              {/* Upward chain */}
              {upFiltered.length > 0 && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📊 向上溯源链</div>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableUpward rows={upVisible} meta={upMeta} onToggle={toggleUp} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={upVisible} meta={upMeta} onToggle={toggleUp} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} ecoId={ecoId} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>) : (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableUpward rows={upVisible} meta={upMeta} onToggle={toggleUp} onUpdate={(i, patch) => { const origIdx = localUp.indexOf(upVisible[i]); if (origIdx >= 0) updateUp(origIdx, patch); }} /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyUpward rows={upVisible} meta={upMeta} onToggle={toggleUp} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} ecoId={ecoId} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>)}
                </div>
              </>)}

              {/* Downward items */}
              {(ai.entity_type === 'assembly' || ai.entity_type === 'component') && (<>
                <div className="text-xs font-semibold text-gray-600 mt-3 mb-1">📋 向下子项</div>
                <div className="grid grid-cols-2 gap-4">
                  {readOnly ? (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估</div><EditableDownward rows={downRows} onUpdate={() => {}} displayOnly /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={downRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} ecoId={ecoId} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>) : (<>
                    <div><div className="text-xs text-gray-500 mb-1">ECR 评估（可编辑）</div><EditableDownward rows={downRows} onUpdate={(i, patch) => { const origIdx = localDown.indexOf(downRows[i]); if (origIdx >= 0) updateDown(origIdx, patch); }} onRemove={(i) => { const origIdx = localDown.indexOf(downRows[i]); if (origIdx >= 0) setLocalDown(prev => prev.filter((_, idx) => idx !== origIdx)); }} /></div>
                    <div><div className="text-xs text-gray-500 mb-1">ECO 执行后</div><ReadOnlyDownward rows={downRows} execMap={execMap} canExec={canExecute} ecoStatus={ecoStatus} ecoId={ecoId} onUpgrade={onExecuteUpgrade} onRelease={onExecuteRelease} onFreeze={onExecuteFreeze} onPublish={onExecutePublish} onViewItem={onViewItem} onEditItem={onEditItem} checkedIds={checkedExecIds} onToggleCheck={toggleChecked} /></div>
                  </>)}
                </div>
                {!readOnly && (
                  <div className="mt-2 flex gap-2 items-center">
                    <span className="text-xs text-gray-400">+ 添加子项到本部件</span>
                    <Button size="xs" onClick={async () => { setPickerParentId(ai.entity_id || ai.entity_code || ''); setPickerOpen(true); }}>添加子项</Button>
                  </div>
                )}
              </>)}
            </div>
          );
        })}

      </>)}
      {ecrId && !loading && !ecrData && <p className="text-xs text-gray-400 text-center py-4">未找到 ECR</p>}

      <AssemblyPartPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
        onConfirm={async (items) => {
          for (const item of items) {
            let code = ''; let name = ''; let ver = '';
            try {
              const rev = await partsApi.getRevision(item.child_id);
              const m = await partsApi.get(rev.master_id);
              code = m.code; name = m.name; ver = rev.version || 'A';
            } catch {}
            const parentAffected = localAffected.find(a => a.entity_id === pickerParentId || a.entity_code === pickerParentId);
            setLocalDown(prev => [...prev, { entity_type: item.child_type === 'assembly' || item.child_type === 'component' ? 'assembly' : 'part', entity_id: item.child_id, entity_code: code, entity_name: name, entity_version: ver, quantity: 0, action: 'add_existing', parent_entity_id: pickerParentId || undefined, _targetQty: item.quantity || 1, _affectedCode: (parentAffected as any)?.entity_code, _affectedName: (parentAffected as any)?.entity_name } as any]);
          }
          setPickerOpen(false);
          toast.success(`已添加 ${items.length} 项`);
        }}
      />
    </div>
  );
}
