# 构型配置对比功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在构型配置列表页新增「配置对比」功能，以树形结构展示两个构型配置正式清单的新增/删除/修改差异。

**Architecture:** 纯前端实现。核心是纯函数 `diffProfileTrees`（输入两棵已有的 `config_tree`，输出嵌套对比树 + 汇总），由 `ProfileCompareModal` 弹窗渲染为可展开树表；入口是 `ProfileList` 工具栏的一个按钮。无后端改动。

**Tech Stack:** React + TypeScript + Tailwind；测试用 vitest；沿用项目现有组件（`Modal`、`ProfileStatusBadge`、`PartDetailModal`、`ConfigurationDetailModal`）。

## Global Constraints

- 沿用现有前端风格：`primary-*` 配色、共享 `Modal`、统一表格/工具栏；所有 UI 文案用中文。
- TypeScript 严格模式（`noUnusedLocals`/`noUnusedParameters`）：不留未使用的 import/变量。
- 无后端改动；不新增后端接口。
- 差异维度固定为：零部件的 版本/数量/状态；构型项自身的 数量；构型项按子项变化卷积。
- 正式清单口径：`is_selected || is_required` 的构型项节点与零部件（必选项纳入）。
- 根节点按“位置”匹配（每个配置单根）；非根节点/零部件按 code-path/件号匹配。

---

### Task 1: 纯函数 `diffProfileTrees` + 单元测试

**Files:**
- Create: `frontend/src/lib/profileCompare.ts`
- Test: `frontend/src/lib/profileCompare.test.ts`

**Interfaces:**
- Consumes: `ConfigTreeNode`、`ConfigTreePart`（来自 `frontend/src/types/index.ts`）。
- Produces（供 Task 2 使用）:
  - `diffProfileTrees(left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileCompareResult`
  - 类型 `ChangeType`、`PartSide`、`ConfigItemSide`、`ProfileComparePart`、`ProfileCompareNode`、`ProfileCompareCounts`、`ProfileCompareSummary`、`ProfileCompareResult`（见 Step 3）。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/lib/profileCompare.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { diffProfileTrees } from './profileCompare';
import type { ConfigTreeNode, ConfigTreePart } from '../types';

function part(code: string, over: Partial<ConfigTreePart> = {}): ConfigTreePart {
  return {
    id: 'p-' + code, item_id: 'm-' + code, item_type: 'part',
    item_code: code, item_name: code + '名', item_version: 'A', item_status: 'released',
    is_required: false, is_selected: true, quantity: 1, source_type: 'manual',
    ...over,
  };
}
function node(code: string, over: Partial<ConfigTreeNode> = {}): ConfigTreeNode {
  return {
    id: 'n-' + code, code, name: code + '构型', is_required: false, is_selected: true,
    quantity: 1, parts: [], children: [], ...over,
  };
}

describe('diffProfileTrees', () => {
  it('完全相同 → 全 none', () => {
    const left = node('ROOT', { parts: [part('P1'), part('P2')] });
    const right = node('ROOT', { parts: [part('P1'), part('P2')] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.change_type).toBe('none');
    expect(r.summary.part).toEqual({ add: 0, delete: 0, modify: 0, none: 2 });
    expect(r.summary.config_item).toEqual({ add: 0, delete: 0, modify: 0, none: 1 });
  });

  it('零部件版本变化 → part modify 且父构型项 modify(卷积)', () => {
    const left = node('ROOT', { parts: [part('P1', { item_version: 'A' })] });
    const right = node('ROOT', { parts: [part('P1', { item_version: 'B' })] });
    const r = diffProfileTrees(left, right);
    const p = r.root!.parts[0];
    expect(p.change_type).toBe('modify');
    expect(p.changed_fields).toEqual(['version']);
    expect(r.root!.change_type).toBe('modify');
  });

  it('零部件数量/状态变化 → modify 且字段正确', () => {
    const left = node('ROOT', { parts: [part('P1', { quantity: 1, item_status: 'released' })] });
    const right = node('ROOT', { parts: [part('P1', { quantity: 3, item_status: 'draft' })] });
    const p = diffProfileTrees(left, right).root!.parts[0];
    expect(p.change_type).toBe('modify');
    expect(p.changed_fields).toEqual(['quantity', 'status']);
  });

  it('零部件单侧新增/删除', () => {
    const left = node('ROOT', { parts: [part('P1')] });
    const right = node('ROOT', { parts: [part('P1'), part('P2')] });
    const add = diffProfileTrees(left, right).root!.parts.find(p => (p.right?.item_code || p.left?.item_code) === 'P2')!;
    expect(add.change_type).toBe('add');
    const del = diffProfileTrees(right, left).root!.parts.find(p => (p.left?.item_code || p.right?.item_code) === 'P2')!;
    expect(del.change_type).toBe('delete');
  });

  it('构型项单侧新增 → 节点及其零部件 add，父节点卷积 modify', () => {
    const left = node('ROOT');
    const right = node('ROOT', { children: [node('C1', { parts: [part('P1')] })] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.children[0].change_type).toBe('add');
    expect(r.root!.children[0].parts[0].change_type).toBe('add');
    expect(r.root!.change_type).toBe('modify');
  });

  it('构型项数量变化 → 构型项 modify(quantity)', () => {
    const left = node('ROOT', { children: [node('C1', { quantity: 1 })] });
    const right = node('ROOT', { children: [node('C1', { quantity: 2 })] });
    const c = diffProfileTrees(left, right).root!.children[0];
    expect(c.change_type).toBe('modify');
    expect(c.changed_fields).toEqual(['quantity']);
  });

  it('未选项(is_selected=false)被剔除', () => {
    const left = node('ROOT', { parts: [part('P1'), part('P2', { is_selected: false })] });
    const right = node('ROOT', { parts: [part('P1')] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.parts.map(p => p.left?.item_code || p.right?.item_code)).toEqual(['P1']);
    expect(r.root!.change_type).toBe('none');
  });

  it('某侧树为 null → 另一侧全 add；两侧 null → root null', () => {
    const right = node('ROOT', { parts: [part('P1')], children: [node('C1', { parts: [part('P2')] })] });
    const r = diffProfileTrees(null, right);
    expect(r.root!.change_type).toBe('add');
    expect(r.root!.parts[0].change_type).toBe('add');
    expect(r.root!.children[0].change_type).toBe('add');
    expect(r.summary.part.add).toBe(2);
    expect(diffProfileTrees(null, null).root).toBeNull();
  });

  it('code-path 匹配：同构型号在不同父级下不被错配', () => {
    const left = node('ROOT', { children: [node('A', { children: [node('X', { parts: [part('PX', { item_version: 'A' })] })] })] });
    const right = node('ROOT', { children: [node('B', { children: [node('X', { parts: [part('PX', { item_version: 'B' })] })] })] });
    const r = diffProfileTrees(left, right);
    const codes = r.root!.children.map(c => ({ code: c.left?.code || c.right?.code, t: c.change_type }));
    expect(codes).toEqual([{ code: 'A', t: 'delete' }, { code: 'B', t: 'add' }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/lib/profileCompare.test.ts`
Expected: FAIL（`profileCompare.ts` 不存在，无法解析 `diffProfileTrees`）。

- [ ] **Step 3: 实现纯函数**

创建 `frontend/src/lib/profileCompare.ts`：

```ts
import type { ConfigTreeNode, ConfigTreePart } from '../types';

export type ChangeType = 'add' | 'delete' | 'modify' | 'none';

export interface PartSide {
  item_id: string;
  item_code: string;
  item_name: string;
  item_type: string;
  item_version?: string;
  item_status?: string;
  quantity?: number;
}
export interface ConfigItemSide {
  id: string;
  code: string;
  name: string;
  quantity?: number;
}
export interface ProfileComparePart {
  key: string;
  change_type: ChangeType;
  changed_fields?: ('version' | 'quantity' | 'status')[];
  left?: PartSide | null;
  right?: PartSide | null;
}
export interface ProfileCompareNode {
  key: string;
  change_type: ChangeType;
  changed_fields?: 'quantity'[];
  left?: ConfigItemSide | null;
  right?: ConfigItemSide | null;
  parts: ProfileComparePart[];
  children: ProfileCompareNode[];
}
export interface ProfileCompareCounts { add: number; delete: number; modify: number; none: number; }
export interface ProfileCompareSummary {
  config_item: ProfileCompareCounts;
  part: ProfileCompareCounts;
}
export interface ProfileCompareResult {
  root: ProfileCompareNode | null;
  summary: ProfileCompareSummary;
}

const isNodeIncluded = (n: ConfigTreeNode): boolean => n.is_selected || n.is_required;
const isPartIncluded = (p: ConfigTreePart): boolean =>
  (p.is_selected || p.is_required) && p.item_type !== 'config_item';
const byCode = (a: string, b: string): number => a.localeCompare(b, 'zh-CN', { numeric: true });

function groupByCode<T>(arr: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of arr) {
    const k = keyFn(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function partToSide(p: ConfigTreePart): PartSide {
  return {
    item_id: p.item_id, item_code: p.item_code, item_name: p.item_name,
    item_type: p.item_type, item_version: p.item_version, item_status: p.item_status,
    quantity: p.quantity,
  };
}
function nodeToSide(n: ConfigTreeNode): ConfigItemSide {
  return { id: n.id, code: n.code, name: n.name, quantity: n.quantity };
}

function comparePart(key: string, left?: ConfigTreePart, right?: ConfigTreePart): ProfileComparePart {
  if (left && !right) return { key, change_type: 'delete', left: partToSide(left), right: null };
  if (!left && right) return { key, change_type: 'add', left: null, right: partToSide(right) };
  const l = left!, r = right!;
  const changed: ('version' | 'quantity' | 'status')[] = [];
  if ((l.item_version || '') !== (r.item_version || '')) changed.push('version');
  if ((l.quantity ?? null) !== (r.quantity ?? null)) changed.push('quantity');
  if ((l.item_status || '') !== (r.item_status || '')) changed.push('status');
  return {
    key,
    change_type: changed.length ? 'modify' : 'none',
    changed_fields: changed.length ? changed : undefined,
    left: partToSide(l),
    right: partToSide(r),
  };
}

function comparePartsOfNode(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileComparePart[] {
  const leftParts = (left?.parts || []).filter(isPartIncluded);
  const rightParts = (right?.parts || []).filter(isPartIncluded);
  const lByCode = groupByCode(leftParts, (p) => p.item_code);
  const rByCode = groupByCode(rightParts, (p) => p.item_code);
  const codes = [...new Set([...lByCode.keys(), ...rByCode.keys()])].sort(byCode);
  const out: ProfileComparePart[] = [];
  for (const code of codes) {
    const ls = lByCode.get(code) || [];
    const rs = rByCode.get(code) || [];
    const n = Math.max(ls.length, rs.length);
    for (let i = 0; i < n; i++) {
      out.push(comparePart(`${path}::part::${code}#${i}`, ls[i], rs[i]));
    }
  }
  return out;
}

function compareChildren(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileCompareNode[] {
  const leftKids = (left?.children || []).filter(isNodeIncluded);
  const rightKids = (right?.children || []).filter(isNodeIncluded);
  const lByCode = new Map(leftKids.map((c) => [c.code, c] as const));
  const rByCode = new Map(rightKids.map((c) => [c.code, c] as const));
  const codes = [...new Set([...lByCode.keys(), ...rByCode.keys()])].sort(byCode);
  return codes.map((code) =>
    compareNode(`${path}/${code}`, lByCode.get(code) || null, rByCode.get(code) || null)
  );
}

function compareNode(path: string, left: ConfigTreeNode | null, right: ConfigTreeNode | null): ProfileCompareNode {
  const parts = comparePartsOfNode(path, left, right);
  const children = compareChildren(path, left, right);

  let change_type: ChangeType;
  let changed_fields: 'quantity'[] | undefined;

  if (left && !right) change_type = 'delete';
  else if (!left && right) change_type = 'add';
  else {
    const qtyChanged = (left!.quantity ?? null) !== (right!.quantity ?? null);
    const descendantChanged =
      parts.some((p) => p.change_type !== 'none') ||
      children.some((c) => c.change_type !== 'none');
    if (qtyChanged) changed_fields = ['quantity'];
    change_type = qtyChanged || descendantChanged ? 'modify' : 'none';
  }

  return {
    key: path,
    change_type,
    changed_fields,
    left: left ? nodeToSide(left) : null,
    right: right ? nodeToSide(right) : null,
    parts,
    children,
  };
}

function summarize(root: ProfileCompareNode | null): ProfileCompareSummary {
  const s: ProfileCompareSummary = {
    config_item: { add: 0, delete: 0, modify: 0, none: 0 },
    part: { add: 0, delete: 0, modify: 0, none: 0 },
  };
  const walk = (n: ProfileCompareNode) => {
    s.config_item[n.change_type]++;
    for (const p of n.parts) s.part[p.change_type]++;
    for (const c of n.children) walk(c);
  };
  if (root) walk(root);
  return s;
}

/**
 * 对比两个构型配置的正式清单（仅已选项）。
 * 根节点按位置匹配（每个配置单根）；子节点/零部件按 code-path/件号匹配。
 */
export function diffProfileTrees(
  left: ConfigTreeNode | null,
  right: ConfigTreeNode | null,
): ProfileCompareResult {
  const l = left && isNodeIncluded(left) ? left : null;
  const r = right && isNodeIncluded(right) ? right : null;
  let root: ProfileCompareNode | null = null;
  if (l || r) {
    const rootCode = r?.code ?? l?.code ?? 'ROOT';
    root = compareNode(rootCode, l, r);
  }
  return { root, summary: summarize(root) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/lib/profileCompare.test.ts`
Expected: PASS（9 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/profileCompare.ts frontend/src/lib/profileCompare.test.ts
git commit -m "feat(config): 构型配置对比纯函数 diffProfileTrees + 单测"
```

---

### Task 2: `ProfileCompareModal` 对比弹窗组件

**Files:**
- Create: `frontend/src/components/Configuration/ProfileCompareModal.tsx`

**Interfaces:**
- Consumes:
  - `diffProfileTrees` 与类型 `ProfileCompareNode`/`ProfileComparePart`（Task 1）。
  - `configurationProfileApi.list({ page_size })` → `res.data.items: ConfigurationProfile[]`。
  - `configurationProfileApi.get(id)` → `res.data: ConfigurationProfileDetail`（含 `config_tree`）。
  - 现有组件 `Modal`、`ProfileStatusBadge`、`PartDetailModal`、`ConfigurationDetailModal`。
- Produces（供 Task 3）: 默认导出 React 组件 `ProfileCompareModal`，props：`{ open: boolean; onClose: () => void }`。

- [ ] **Step 1: 创建组件**

创建 `frontend/src/components/Configuration/ProfileCompareModal.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import ProfileStatusBadge from './ProfileStatusBadge';
import PartDetailModal from '../PartDetailModal';
import ConfigurationDetailModal from './ConfigurationDetailModal';
import { configurationProfileApi } from '../../services/api';
import { diffProfileTrees } from '../../lib/profileCompare';
import type { ProfileCompareNode, ProfileComparePart, ProfileCompareResult } from '../../lib/profileCompare';
import type { ConfigurationProfile } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
const statusLabel = (s?: string) => (s ? STATUS_LABEL[s] || s : '-');

const rowBg: Record<string, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  none: '',
};

function partChangeText(p: ProfileComparePart): string {
  if (p.change_type === 'add') return '新增';
  if (p.change_type === 'delete') return '删除';
  if (p.change_type === 'modify') {
    const f = p.changed_fields || [];
    const segs: string[] = [];
    if (f.includes('version')) segs.push(`版本 ${p.left?.item_version || '-'}→${p.right?.item_version || '-'}`);
    if (f.includes('quantity')) segs.push(`数量 ${p.left?.quantity ?? '-'}→${p.right?.quantity ?? '-'}`);
    if (f.includes('status')) segs.push(`状态 ${statusLabel(p.left?.item_status)}→${statusLabel(p.right?.item_status)}`);
    return segs.join('、');
  }
  return '';
}
function nodeChangeText(n: ProfileCompareNode): string {
  if (n.change_type === 'add') return '新增';
  if (n.change_type === 'delete') return '删除';
  if (n.change_type === 'modify') {
    if (n.changed_fields?.includes('quantity')) return `数量 ${n.left?.quantity ?? '-'}→${n.right?.quantity ?? '-'}`;
    return '子项变化';
  }
  return '';
}

/** 可搜索的配置选择器 */
function ProfilePicker({ label, options, valueId, onPick }: {
  label: string;
  options: ConfigurationProfile[];
  valueId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === valueId) || null;
  const filtered = options
    .filter((o) => !q.trim() || `${o.code} ${o.name}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 50);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={open ? q : selected ? `${selected.code} - ${selected.name}` : ''}
          placeholder="搜索配置编号或名称..."
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={() => { onPick(o.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="font-medium">{o.code}</span>
                <span className="text-gray-500">{o.name}</span>
                <span className="ml-auto"><ProfileStatusBadge status={o.status} /></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfileCompareModal({ open, onClose }: Props) {
  const [options, setOptions] = useState<ConfigurationProfile[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<ProfileCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [partMasterId, setPartMasterId] = useState<string | null>(null);
  const [configItemId, setConfigItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(null); setRightId(null); setResult(null); setError(''); setOnlyDiff(false);
    configurationProfileApi.list({ page_size: 100 })
      .then((res) => setOptions(res.data.items || []))
      .catch(() => setOptions([]));
  }, [open]);

  const leftProfile = options.find((o) => o.id === leftId) || null;
  const rightProfile = options.find((o) => o.id === rightId) || null;

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true); setError('');
    try {
      const [lr, rr] = await Promise.all([
        configurationProfileApi.get(leftId),
        configurationProfileApi.get(rightId),
      ]);
      const res = diffProfileTrees(lr.data.config_tree || null, rr.data.config_tree || null);
      setResult(res);
      setExpanded(res.root ? new Set([res.root.key]) : new Set());
    } catch {
      setError('对比失败，请重试');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const openDetail = (rowType: 'part' | 'config_item', node: ProfileCompareNode | ProfileComparePart) => {
    if (rowType === 'part') {
      const side = (node as ProfileComparePart).right || (node as ProfileComparePart).left;
      if (side) setPartMasterId(side.item_id);
    } else {
      const side = (node as ProfileCompareNode).right || (node as ProfileCompareNode).left;
      if (side) setConfigItemId(side.id);
    }
  };

  const renderNode = (n: ProfileCompareNode, level: number): React.ReactNode[] => {
    if (onlyDiff && n.change_type === 'none') return [];
    const rows: React.ReactNode[] = [];
    const hasChildren = n.parts.length > 0 || n.children.length > 0;
    const isExpanded = expanded.has(n.key);
    const l = n.left, r = n.right;
    rows.push(
      <tr key={n.key} className={`${rowBg[n.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
        onClick={() => openDetail('config_item', n)}>
        <td className="px-2 py-1 text-xs text-gray-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {'-'.repeat(level)}{level}
          {hasChildren && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
              className="ml-1 text-gray-400 hover:text-gray-600">{isExpanded ? '▼' : '▶'}</button>
          )}
        </td>
        <td className="px-2 py-1 text-xs font-medium">{l?.code || '-'}</td>
        <td className="px-2 py-1 text-xs text-gray-600">{l?.name || '-'}</td>
        <td className="px-2 py-1 text-xs text-center text-gray-500">{l?.quantity ?? '-'}</td>
        <td className="w-px bg-gray-200 p-0" />
        <td className="px-2 py-1 text-xs font-medium">{r?.code || '-'}</td>
        <td className="px-2 py-1 text-xs text-gray-600">{r?.name || '-'}</td>
        <td className={`px-2 py-1 text-xs text-center ${n.changed_fields?.includes('quantity') ? 'bg-yellow-100' : 'text-gray-500'}`}>{r?.quantity ?? '-'}</td>
        <td className="w-px bg-gray-200 p-0" />
        <td className="px-2 py-1 text-xs text-gray-700">{nodeChangeText(n)}</td>
      </tr>
    );
    if (isExpanded) {
      for (const p of n.parts) {
        if (onlyDiff && p.change_type === 'none') continue;
        const pl = p.left, pr = p.right;
        const chg = new Set(p.changed_fields || []);
        rows.push(
          <tr key={p.key} className={`${rowBg[p.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
            onClick={() => openDetail('part', p)}>
            <td className="px-2 py-1 text-xs text-gray-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{'-'.repeat(level + 1)}</td>
            <td className="px-2 py-1 text-xs font-mono text-gray-600">{pl?.item_code || '-'}</td>
            <td className="px-2 py-1 text-xs text-gray-600">{pl?.item_name || '-'}</td>
            <td className="px-2 py-1 text-xs text-center text-gray-500">{pl?.quantity ?? '-'}</td>
            <td className="w-px bg-gray-200 p-0" />
            <td className={`px-2 py-1 text-xs font-mono ${chg.has('version') ? 'bg-yellow-100' : 'text-gray-600'}`}>
              {pr?.item_code || '-'}{pr?.item_version ? ` (${pr.item_version})` : ''}
            </td>
            <td className="px-2 py-1 text-xs text-gray-600">{pr?.item_name || '-'}</td>
            <td className={`px-2 py-1 text-xs text-center ${chg.has('quantity') ? 'bg-yellow-100' : 'text-gray-500'}`}>{pr?.quantity ?? '-'}</td>
            <td className="w-px bg-gray-200 p-0" />
            <td className="px-2 py-1 text-xs text-gray-700">{partChangeText(p)}</td>
          </tr>
        );
      }
      for (const c of n.children) rows.push(...renderNode(c, level + 1));
    }
    return rows;
  };

  const summaryBar = useMemo(() => {
    if (!result) return null;
    const { config_item: ci, part: pt } = result.summary;
    return (
      <div className="flex flex-wrap gap-4 mb-3 p-3 bg-gray-50 rounded-lg border text-sm">
        <span>构型项：<span className="text-green-600">新增 {ci.add}</span>　<span className="text-red-600">删除 {ci.delete}</span>　<span className="text-yellow-600">修改 {ci.modify}</span></span>
        <span>零部件：<span className="text-green-600">新增 {pt.add}</span>　<span className="text-red-600">删除 {pt.delete}</span>　<span className="text-yellow-600">修改 {pt.modify}</span></span>
      </div>
    );
  }, [result]);

  const identical = result && result.root &&
    result.summary.config_item.add === 0 && result.summary.config_item.delete === 0 && result.summary.config_item.modify === 0 &&
    result.summary.part.add === 0 && result.summary.part.delete === 0 && result.summary.part.modify === 0;

  return (
    <>
      <Modal open={open} onClose={onClose} title="构型配置对比" width="3xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <ProfilePicker label="左配置" options={options} valueId={leftId} onPick={setLeftId} />
            <ProfilePicker label="右配置" options={options} valueId={rightId} onPick={setRightId} />
          </div>
          {(leftProfile || rightProfile) && (
            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>{leftProfile ? <>状态 <ProfileStatusBadge status={leftProfile.status} /> · 架次 {leftProfile.effectivity_start || '-'} ~ {leftProfile.effectivity_end || '-'}</> : ''}</div>
              <div>{rightProfile ? <>状态 <ProfileStatusBadge status={rightProfile.status} /> · 架次 {rightProfile.effectivity_start || '-'} ~ {rightProfile.effectivity_end || '-'}</> : ''}</div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={handleCompare} disabled={!leftId || !rightId || loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {loading ? '对比中...' : '开始对比'}
            </button>
            {result && (
              <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                仅显示差异
              </label>
            )}
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          {result && !result.root && (
            <div className="text-sm text-gray-500 text-center py-6">两侧均无正式配置清单</div>
          )}
          {identical && (
            <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">两配置正式清单一致</div>
          )}
          {result && result.root && (
            <>
              {summaryBar}
              <div className="border rounded-lg overflow-auto max-h-[60vh]">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-xs font-medium text-gray-600 border-b">
                      <th className="px-2 py-2 text-left w-14">层级</th>
                      <th colSpan={3} className="px-2 py-2 text-left border-r border-gray-200">左配置</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th colSpan={3} className="px-2 py-2 text-left">右配置</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-2 text-left w-40">变更</th>
                    </tr>
                    <tr className="text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1" />
                      <th className="px-2 py-1 text-left">构型号/件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">构型号/件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">说明</th>
                    </tr>
                  </thead>
                  <tbody>{renderNode(result.root, 0)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {partMasterId && (
        <PartDetailModal masterId={partMasterId} open={!!partMasterId} onClose={() => setPartMasterId(null)} />
      )}
      {configItemId && (
        <ConfigurationDetailModal itemId={configItemId} onClose={() => setConfigItemId(null)} />
      )}
    </>
  );
}
```

> 说明：本组件按 spec「组件层不写重测试」的约定，验收以 `tsc --noEmit` + 全量 build + 手测为准。

- [ ] **Step 2: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。若报 `ConfigurationDetailModal`/`PartDetailModal` props 不符，按其真实 props 签名调整（`ConfigurationDetailModal` 用 `itemId` + `onClose`；`PartDetailModal` 用 `masterId` + `open` + `onClose`）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Configuration/ProfileCompareModal.tsx
git commit -m "feat(config): 构型配置对比弹窗 ProfileCompareModal(树形对比表)"
```

---

### Task 3: 接入 `ProfileList` 入口按钮

**Files:**
- Modify: `frontend/src/components/Configuration/ProfileList.tsx`

**Interfaces:**
- Consumes: `ProfileCompareModal`（Task 2，默认导出，props `{ open, onClose }`）。

- [ ] **Step 1: 加 import**

在 `frontend/src/components/Configuration/ProfileList.tsx` 顶部 import 区加：

```tsx
import ProfileCompareModal from './ProfileCompareModal';
```

- [ ] **Step 2: 加弹窗开关 state**

在组件内已有弹窗 state 附近（`const [createOpen, setCreateOpen] = useState(false);` 下方）加：

```tsx
  const [compareOpen, setCompareOpen] = useState(false);
```

- [ ] **Step 3: 加工具栏按钮**

在工具栏 `<div className="flex-1" />` 之后、`{canEdit() && (...新建配置...)}` 之前插入：

```tsx
        <button
          onClick={() => setCompareOpen(true)}
          className="px-4 py-2 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 text-sm"
        >
          ⇄ 配置对比
        </button>
```

- [ ] **Step 4: 挂载弹窗**

在 return 的 JSX 末尾、最外层 `</div>` 之前（与其它弹窗如 `<ConfirmModal .../>` 并列）加：

```tsx
      <ProfileCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
```

- [ ] **Step 5: 类型检查 + 全量构建**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: tsc 无报错；build 成功。

- [ ] **Step 6: 手动验证**

启动前端，进入「构型管理 → 构型配置」→ 点「⇄ 配置对比」→ 选两个配置（含非生效状态）→「开始对比」，确认：
- 树表按构型项层级展开/折叠，默认展开根；
- 新增(绿)/删除(红)/修改(黄) 底色正确，零部件版本/数量/状态差异高亮，变更列文案正确；
- 「仅显示差异」隐藏无变化行；
- 点零部件行弹零部件详情，点构型项行弹构型项详情；
- 两侧选同一配置显示「清单一致」。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/Configuration/ProfileList.tsx
git commit -m "feat(config): 构型配置列表页接入配置对比入口"
```

---

## Self-Review

**Spec coverage：**
- 对比两个 Profile：Task 2 选择器 + `handleCompare`。✅
- 正式清单(仅已选)：Task 1 `isNodeIncluded`/`isPartIncluded`。✅
- 来源不限状态：Task 2 用 `configurationProfileApi.list` 全量、`ProfilePicker` 不按状态过滤。✅
- 差异维度(版本/数量/状态 + 构型项数量 + 卷积)：Task 1 `comparePart`/`compareNode`。✅
- 入口在列表页按钮：Task 3。✅
- 树形输出与渲染：Task 1 嵌套结构 + Task 2 `renderNode` 递归。✅
- 边界(null 树/相同/未选剔除/重复件号)：Task 1 覆盖并测试；相同 → Task 2 `identical` 提示。✅
- 行点详情、仅看差异、汇总条：Task 2。✅
- 测试与验收命令：Task 1 vitest；Task 3 tsc+build。✅

**Placeholder scan：** 无 TBD/TODO/“类似上文”；所有代码步骤含完整代码。✅

**Type consistency：** `diffProfileTrees` 签名、`ProfileCompareNode/Part` 字段（`change_type`/`changed_fields`/`left`/`right`/`parts`/`children`/`key`）在 Task 1 定义、Task 2 使用处一致；`configurationProfileApi.list`→`res.data.items`、`get`→`res.data.config_tree` 与现有 `ProfileList`/`ProfileEditModal` 用法一致。✅
