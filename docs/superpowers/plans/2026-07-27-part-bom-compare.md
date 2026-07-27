# 零部件 BOM 对比功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在零部件管理界面新增「BOM 对比」弹窗，替代 BOM 工具页的对比 Tab，交互模式与构型配置对比一致。

**Architecture:** 前端新建 `PartCompareModal` 弹窗组件，复用现有 `bomApi.compare` 后端 API（零后端改动）；PartsPage 加按钮入口；BOM 工具页移除对比 Tab，只保留 BOM 树。

**Tech Stack:** React + TypeScript + Tailwind；测试用 vitest；沿用现有组件（`Modal`、`PartDetailModal`）。

## Global Constraints

- 沿用现有前端风格：`primary-*` 配色、共享 `Modal`、统一表格/工具栏；所有 UI 文案用中文。
- TypeScript 严格模式（`noUnusedLocals`/`noUnusedParameters`）：不留未使用的 import/变量。
- 无后端改动；不新增后端接口。
- 复用 `POST /api/bom/compare`（`bomApi.compare`），权限 `bom:compare` 已有。
- 对比维度精简为 4 字段：件号(code)、版本(version)、状态(status)、数量(quantity)。
- 弹窗高度 75vh，表格区域 flex-1 自适应填满，表头 sticky，内容滚动。
- 组件层不写单元测试，验收以 `tsc --noEmit` + `vite build` + 手测为准。

---

### Task 1: `PartCompareModal` 对比弹窗组件

**Files:**
- Create: `frontend/src/components/PartCompareModal.tsx`

**Interfaces:**
- Consumes:
  - `partsApi.list({ page_size: 200, show_all_versions: true })` → `res.items: PartListItem[]`
  - `bomApi.compare(leftRevisionId, rightRevisionId)` → `{ data: BOMCompareResponse }`
  - `BOMCompareResponse` 类型（`frontend/src/types/index.ts:382-387`）：含 `left_assembly`, `right_assembly`, `comparison: BOMCompareNode[]`, `summary`
  - `BOMCompareNode` 类型（`frontend/src/types/index.ts:343-379`）：含 `key`, `level`, `sort`, `path`, `change_type`, `left`, `right`
  - 现有组件 `Modal`（`height="75vh"`）、`PartDetailModal`（`masterId`+`revisionId`+`open`+`onClose`）
- Produces: 默认导出 React 组件 `PartCompareModal`，props：`{ open: boolean; onClose: () => void }`。

- [ ] **Step 1: 创建组件文件并编写完整代码**

创建 `frontend/src/components/PartCompareModal.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import PartDetailModal from './PartDetailModal';
import { partsApi, bomApi } from '../services/api';
import type { PartListItem, BOMCompareNode, BOMCompareResponse } from '../types';

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
  internal: 'bg-yellow-50',
  none: '',
};

function changeText(node: BOMCompareNode): string {
  if (node.change_type === 'add') return '新增';
  if (node.change_type === 'delete') return '删除';
  if (node.change_type === 'modify' || node.change_type === 'internal') {
    const l = node.left, r = node.right;
    const segs: string[] = [];
    if ((l?.detail.version || '') !== (r?.detail.version || ''))
      segs.push(`版本 ${l?.detail.version || '-'}→${r?.detail.version || '-'}`);
    if ((l?.detail.status || '') !== (r?.detail.status || ''))
      segs.push(`状态 ${statusLabel(l?.detail.status)}→${statusLabel(r?.detail.status)}`);
    if ((l?.quantity ?? null) !== (r?.quantity ?? null))
      segs.push(`数量 ${l?.quantity ?? '-'}→${r?.quantity ?? '-'}`);
    if (node.change_type === 'internal') segs.push('子项变化');
    return segs.join('、') || '内部变更';
  }
  return '';
}

/** 可搜索的零部件选择器（仅显示部件） */
function PartPicker({ label, options, valueId, onPick }: {
  label: string;
  options: PartListItem[];
  valueId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.revision_id === valueId) || null;
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
          placeholder="搜索件号或名称..."
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
            {filtered.map((o) => (
              <button
                key={o.revision_id}
                type="button"
                onMouseDown={() => { onPick(o.revision_id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="font-medium">{o.code}</span>
                <span className="text-gray-500 truncate">{o.name}</span>
                <span className="ml-auto text-gray-400 text-xs">{o.version}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PartCompareModal({ open, onClose }: Props) {
  const [options, setOptions] = useState<PartListItem[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<BOMCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [detail, setDetail] = useState<{ masterId: string; revisionId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(null); setRightId(null); setResult(null); setError(''); setOnlyDiff(false);
    partsApi.list({ page_size: 200, show_all_versions: true })
      .then((res) => setOptions((res.items || []).filter((i: PartListItem) => i.type === 'assembly')))
      .catch(() => setOptions([]));
  }, [open]);

  const leftPart = options.find((o) => o.revision_id === leftId) || null;
  const rightPart = options.find((o) => o.revision_id === rightId) || null;

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true); setError('');
    try {
      const res = await bomApi.compare(leftId, rightId);
      setResult(res.data);
      const rootKeys = res.data.comparison.filter((n: BOMCompareNode) => n.level === 0).map((n: BOMCompareNode) => n.key);
      setExpanded(new Set(rootKeys));
    } catch (err) {
      console.error('BOM对比失败', err);
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

  /** 扁平节点列表 → 树形结构 */
  const nodeTree = useMemo(() => {
    if (!result) return [];
    const list = result.comparison.filter((n) => n.change_type !== 'none' || !onlyDiff);
    if (onlyDiff) return list.filter((n: BOMCompareNode) => n.change_type !== 'none');
    return list;
  }, [result, onlyDiff]);

  /** 按 path 父子关系构建，需要知道一个节点的子节点是否展开 */
  const visibleNodes = useMemo(() => {
    if (!result) return [];
    const allNodes = onlyDiff
      ? result.comparison.filter((n: BOMCompareNode) => n.change_type !== 'none')
      : result.comparison;
    const out: BOMCompareNode[] = [];
    const level0Paths = new Set(allNodes.filter((n: BOMCompareNode) => n.level === 0).map((n: BOMCompareNode) => n.key));
    const hasChildren = (parentPath: string) => {
      if (level0Paths.has(parentPath) && allNodes.find((n: BOMCompareNode) => n.key === parentPath)?.level === 0) {
        return allNodes.some((n: BOMCompareNode) => n.path.startsWith(parentPath + '/') && n.path.split('/').length === parentPath.split('/').length + 1);
      }
      return allNodes.some((n: BOMCompareNode) => n.path.startsWith(parentPath + '/') && n.path.split('/').length === parentPath.split('/').length + 1);
    };
    const walk = (parentPath: string | null, parentExpanded: boolean) => {
      for (const n of allNodes) {
        const isRoot = parentPath === null && n.level === 0;
        const isChild = parentPath !== null && n.path.startsWith(parentPath + '/') && n.path.split('/').length === parentPath.split('/').length + 1;
        if (!isRoot && !isChild) continue;
        out.push(n);
        if (hasChildren(n.key) && expanded.has(n.key)) {
          walk(n.key, true);
        }
      }
    };
    walk(null, true);
    return out;
  }, [result, onlyDiff, expanded]);

  const summaryBar = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    return (
      <div className="flex flex-wrap gap-4 mb-3 p-3 bg-gray-50 rounded-lg border text-sm">
        <span>
          新增 <span className="text-green-600 font-medium">{s.added}</span>　
          删除 <span className="text-red-600 font-medium">{s.deleted}</span>　
          修改 <span className="text-yellow-600 font-medium">{s.modified}</span>
          {s.internal_changes > 0 && <>　内部变更 <span className="text-yellow-600 font-medium">{s.internal_changes}</span></>}
        </span>
      </div>
    );
  }, [result]);

  const identical = result && result.summary.added === 0 && result.summary.deleted === 0 && result.summary.modified === 0 && result.summary.internal_changes === 0;

  return (
    <>
      <Modal open={open} onClose={onClose} title="BOM 对比" width="3xl" height="75vh">
        <div className="flex flex-col h-full space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <PartPicker label="左部件" options={options} valueId={leftId} onPick={setLeftId} />
            <PartPicker label="右部件" options={options} valueId={rightId} onPick={setRightId} />
          </div>
          {(leftPart || rightPart) && (
            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>{leftPart ? <>{leftPart.code} · {leftPart.name} · 版本 {leftPart.version} · {statusLabel(leftPart.status)}</> : ''}</div>
              <div>{rightPart ? <>{rightPart.code} · {rightPart.name} · 版本 {rightPart.version} · {statusLabel(rightPart.status)}</> : ''}</div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={handleCompare} disabled={!leftId || !rightId || loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm">
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

          {result && result.comparison.length === 0 && (
            <div className="text-sm text-gray-500 text-center py-6">两侧 BOM 均为空</div>
          )}
          {identical && (
            <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">两个部件 BOM 一致</div>
          )}
          {result && result.comparison.length > 0 && (
            <>
              {summaryBar}
              <div className="flex-1 min-h-0 border rounded-lg overflow-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col className="w-40" />
                  </colgroup>
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-xs font-medium text-gray-600 border-b">
                      <th className="px-2 py-2 text-left">层级</th>
                      <th colSpan={4} className="px-2 py-2 text-left border-r border-gray-200">左部件 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th colSpan={4} className="px-2 py-2 text-left">右部件 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-2 text-left">变更</th>
                    </tr>
                    <tr className="text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1" />
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-center">版本</th>
                      <th className="px-2 py-1 text-center">状态</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-center">版本</th>
                      <th className="px-2 py-1 text-center">状态</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNodes.map((n) => {
                      const l = n.left, r = n.right;
                      const versionChanged = (l?.detail.version || '') !== (r?.detail.version || '');
                      const statusChanged = (l?.detail.status || '') !== (r?.detail.status || '');
                      const qtyChanged = (l?.quantity ?? null) !== (r?.quantity ?? null);
                      const hasChildren = nodeTree.some((c: BOMCompareNode) =>
                        c.path.startsWith(n.path + '/') && c.path.split('/').length === n.path.split('/').length + 1
                      );
                      const isExpanded = expanded.has(n.key);
                      return (
                        <tr key={n.key} className={`${rowBg[n.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
                          onClick={() => {
                            const side = n.right || n.left;
                            if (side?.child_master_id && side?.child_revision_id) {
                              setDetail({ masterId: side.child_master_id, revisionId: side.child_revision_id });
                            }
                          }}>
                          <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {'-'.repeat(n.level)}{n.level}
                            {hasChildren && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
                                className="ml-1 text-gray-400 hover:text-gray-600">{isExpanded ? '▼' : '▶'}</button>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs font-medium">{l?.detail.code || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{l?.detail.version || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{statusLabel(l?.detail.status)}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{l?.quantity ?? '-'}</td>
                          <td className="w-px bg-gray-200 p-0" />
                          <td className={`px-2 py-2 text-xs font-medium ${versionChanged ? 'bg-yellow-100' : ''}`}>{r?.detail.code || '-'}</td>
                          <td className={`px-2 py-2 text-xs text-center ${versionChanged ? 'bg-yellow-100' : 'text-gray-500'}`}>{r?.detail.version || '-'}</td>
                          <td className={`px-2 py-2 text-xs text-center ${statusChanged ? 'bg-yellow-100' : 'text-gray-500'}`}>{statusLabel(r?.detail.status)}</td>
                          <td className={`px-2 py-2 text-xs text-center ${qtyChanged ? 'bg-yellow-100' : 'text-gray-500'}`}>{r?.quantity ?? '-'}</td>
                          <td className="w-px bg-gray-200 p-0" />
                          <td className="px-2 py-2 text-xs text-gray-700">{changeText(n)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {detail && (
        <PartDetailModal
          masterId={detail.masterId}
          revisionId={detail.revisionId}
          open={!!detail}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json`
Expected: 无报错。如有类型不匹配，按实际类型调整。

- [ ] **Step 3: 运行构建**

Run: `cd frontend && npx vite build`
Expected: 构建成功。

- [ ] **Step 4: 运行回归测试**

Run: `cd frontend && npx vitest run src/lib/profileCompare.test.ts`
Expected: 10/10 通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/PartCompareModal.tsx
git commit -m "feat(parts): 零部件BOM对比弹窗 PartCompareModal"
```

---

### Task 2: `PartsPage` 接入入口按钮

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`

**Interfaces:**
- Consumes: `PartCompareModal`（Task 1，默认导出，props `{ open, onClose }`）。

- [ ] **Step 1: 加 import**

在 `frontend/src/pages/PartsPage.tsx` 顶部 import 区（`import { CADWorkspaceModal }` 之后）加：

```tsx
import PartCompareModal from '../components/PartCompareModal';
```

- [ ] **Step 2: 加弹窗开关 state**

在组件内其他弹窗 state 附近（`const [showCreateModal, setShowCreateModal] = useState(false);` 下方）加：

```tsx
  const [showCompareModal, setShowCompareModal] = useState(false);
```

- [ ] **Step 3: 加工具栏按钮**

在「CAD入口」按钮之后、`<div className="flex-1" />` 之前插入：

```tsx
        <button
          onClick={() => setShowCompareModal(true)}
          className="px-4 py-2 border border-primary-600 text-primary-600 rounded-lg hover:bg-primary-50 text-sm"
        >
          ⇄ BOM对比
        </button>
```

- [ ] **Step 4: 挂载弹窗**

在 return JSX 末尾、`<CADWorkspaceModal>` 之后、`</div>` 之前，与其他弹窗并列加：

```tsx
      <PartCompareModal open={showCompareModal} onClose={() => setShowCompareModal(false)} />
```

插入位置：在 `{showCADWorkspace && (<CADWorkspaceModal .../>)}` 之后，`<PartDetailModal .../>` 之前。

- [ ] **Step 5: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: tsc 无报错；build 成功。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/PartsPage.tsx
git commit -m "feat(parts): 零部件管理界面接入BOM对比入口"
```

---

### Task 3: `BOM` 工具页移除对比 Tab

**Files:**
- Modify: `frontend/src/pages/BOM/BOM.tsx`

**Interfaces:**
- 无新依赖。

- [ ] **Step 1: 简化 BOM 页面为单模式**

将 `frontend/src/pages/BOM/BOM.tsx` 改为直接渲染 `BOMTreePanel`，移除 Tab 切换逻辑。

完整替换文件内容为：

```tsx
import { useState } from 'react';
import PartDetailModal from '../../components/PartDetailModal';
import BOMTreePanel from './BOMTreePanel';

export default function BOM() {
  const [detail, setDetail] = useState<{ masterId: string; revisionId?: string } | null>(null);

  const handleViewEntity = (masterId: string, revisionId?: string) => {
    if (!masterId) return;
    setDetail({ masterId, revisionId });
  };

  return (
    <div>
      <BOMTreePanel onViewEntity={handleViewEntity} />
      {detail && (
        <PartDetailModal
          open={!!detail}
          masterId={detail.masterId}
          revisionId={detail.revisionId}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: tsc 无报错；build 成功。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/BOM/BOM.tsx
git commit -m "refactor(bom): 移除BOM工具页对比Tab，只保留BOM树"
```

---

## Self-Review

**Spec coverage：**
- 零部件 BOM 对比弹窗：Task 1。✅
- PartsPage 按钮入口：Task 2。✅
- BOM 工具页移除对比 Tab：Task 3。✅
- 复用后端 API / 无后端改动：全部 Task 零后端改动。✅
- 对比维度精简 4 字段：Task 1 表头只有件号/版本/状态/数量。✅
- 弹窗 75vh + flex-1 表格：Task 1 Modal height="75vh" + flex-1 min-h-0。✅
- 行点击 → PartDetailModal：Task 1 用 child_master_id + child_revision_id。✅
- 仅显示差异 / 差色背景 / 展开折叠：Task 1。✅
- 树形结构（扁平→树）：Task 1 visibleNodes 按 path 父子关系渲染。✅
- 边界（空/相同/失败）：Task 1 处理了 comparison.length===0、identical、错误。✅
- 回归测试：Task 1 Step 4。✅

**Placeholder scan：** 无 TBD/TODO/占位。✅

**Type consistency：** `BOMCompareNode`、`BOMCompareResponse`、`PartListItem` 引用正确；`partsApi.list`、`bomApi.compare` 签名与现有代码一致。✅
