# BOM 3D 对比 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 BOM 对比弹窗加「3D对比」入口，进入 STPViewer 后把左右两版装配叠加在同一场景里按变更着色，左侧配左右并排、行对齐的双 BOM 树。

**Architecture:** STPViewer 新增第四种数据源模式 `compare`。所有对比逻辑先落在三个纯函数模块（建树 / 渲染规则 / 差异过滤）并用 vitest 锁死，再由 `viewerStore` 的可选 `compare` 分片串起 UI。后端零改动，数据来自 5 个现成 GET。

**Tech Stack:** React 18 + TypeScript + Vite、three.js + @react-three/fiber、zustand、TailwindCSS、vitest。

**设计文档：** [docs/superpowers/specs/2026-08-01-bom-3d-compare-design.md](../specs/2026-08-01-bom-3d-compare-design.md)

## Global Constraints

- 后端与数据库**零改动**。不新增接口、不新增权限点。
- 现有三种预览模式（单件 `?id&token` / 装配 `?assembly=` / 配置清单 `?config-profile=`）行为必须**逐字节不变**。`viewerStore.compare === null` 时所有既有代码路径不受影响。
- 不修改 `ModelTreePanel.tsx`、`useSceneVisualState.ts`、`AssemblyModelLoader.tsx`、`ModelLoader.tsx`——它们服务其余三种模式。
- 所有命令在 `frontend/` 目录下执行。测试 `npm test`（vitest run），构建 `npm run build`（tsc && vite build），lint `npm run lint`（`--max-warnings 0`）。
- UI 沿用现有前端风格：`primary-*` 配色、Tailwind、中文文案。差异配色与 `PartCompareModal` 保持一致：新增 `bg-green-50`、删除 `bg-red-50`、修改 `bg-yellow-50`。
- 3D 变更色（Three.js 材质 hex）：未变 `0xB4B2A9`、修改 `0xEF9F27`、新增 `0x639922`、删除 `0xE24B4A`。
- 幽灵透明度默认 `0.12`，滑块范围 `0.02–0.5`，步长 `0.01`。
- 坐标不做任何对齐补偿，两侧实例矩阵原样使用。
- 提交信息末尾附：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 已确认的代码事实（实现时依赖，勿再猜）

1. `BOMCompareNode.key` 与 `path` 相同，值是**件号链**，形如 `/GB-101`、`/GB-110/GB-115`（首字符是 `/`）。父节点 path = 自身 path 去掉最后一段；`level` 从 0 起（0 = 根装配的直接子项）。
2. `BOMCompareNode.left.id` / `right.id` 是 **bom_item 的 id**，与 `AssemblyInstance.bom_path` 末段对应。
3. 后端 `compare_bom_trees` **只产出** `none` / `add` / `delete` / `modify`，**从不产出 `internal`**。`internal`（子项变化）必须在前端建树时派生。
4. `AssemblyInstance.bom_path` 末段：单实例是 `{bom_item_id}`，多实例展开是 `{bom_item_id}:{idx}`。
5. `AssemblyTreeNode` 有 `bom_item_id`、`instance_index?`、`is_leaf`、`children`。
6. `AssemblyInstance` 形如 `{ part_code, bom_path: string[], matrix: number[16], glb_urls: { coarse, normal, fine } }`（见 `services/api.ts`）。
7. `viewerStore` 已有 `expandedIds: Set<string>`、`hiddenParts: Set<string>`（按 mesh uuid），对比模式直接复用，不另起炉灶。

## File Structure

**新增（`frontend/src/components/STPViewer/` 下）**

| 文件 | 职责 |
|---|---|
| `compareTypes.ts` | 对比模式的全部类型定义，无逻辑 |
| `buildCompareTree.ts` | 纯函数：`BOMCompareResponse` + 两侧装配树 → 配对树 `CompareNode` |
| `compareRenderRules.ts` | 纯函数：(变更类型, 显示模式) → 画哪侧/什么颜色/是否幽灵 |
| `compareTreeFilter.ts` | 纯函数：`仅显示差异` 剪枝 |
| `CompareModelLoader.tsx` | 加载两侧实例、按规则摆位着色、mesh uuid 回填 store |
| `useCompareVisualState.ts` | 把 store 的对比视觉态施加到场景（选中/幽灵/显隐/线框） |
| `CompareTreePanel.tsx` | 左右并排、行对齐的双树面板 |

**修改**

| 文件 | 改动 |
|---|---|
| `frontend/src/stores/viewerStore.ts` | 增加可选 `compare` 分片与其 actions |
| `frontend/src/components/STPViewer/ViewerCanvas.tsx` | `ViewerSource` 增加 `kind: 'compare'` 分支 |
| `frontend/src/pages/STPViewer.tsx` | 新增 compare 模式：解析参数、并发拉数据、渲染面板与提示条 |
| `frontend/src/components/STPViewer/Toolbar.tsx` | 对比专属控件组；对比模式禁用「上色」 |
| `frontend/src/components/PartCompareModal.tsx` | 「🧊 3D对比」入口按钮 |

---

### Task 1: 类型定义与配对树构建

**Files:**
- Create: `frontend/src/components/STPViewer/compareTypes.ts`
- Create: `frontend/src/components/STPViewer/buildCompareTree.ts`
- Test: `frontend/src/components/STPViewer/buildCompareTree.test.ts`

**Interfaces:**
- Consumes: `BOMCompareResponse` / `BOMCompareNode`（`src/types/index.ts`）、`AssemblyTreeNode`（`src/services/api.ts`）
- Produces:
  - `type ChangeType = 'none' | 'add' | 'delete' | 'modify' | 'internal'`
  - `type DisplayMode = 'both' | 'left' | 'right'`
  - `type Side = 'left' | 'right'`
  - `interface CompareSide { bomItemId: string; code: string; name: string; version: string; quantity: number | null; meshUuids: string[]; hasModel: boolean }`
  - `interface CompareNode { key: string; parentKey: string | null; level: number; changeType: ChangeType; left: CompareSide | null; right: CompareSide | null; children: CompareNode[] }`
  - `function buildCompareTree(result: BOMCompareResponse, leftTree: AssemblyTreeNode[], rightTree: AssemblyTreeNode[]): CompareNode`

- [ ] **Step 1: 写类型文件**

`frontend/src/components/STPViewer/compareTypes.ts`：

```ts
/** BOM 对比 3D 模式的共享类型。纯类型文件，不放逻辑。 */

/** 变更类型。internal（子项变化）后端不产出，由 buildCompareTree 派生。 */
export type ChangeType = 'none' | 'add' | 'delete' | 'modify' | 'internal';

/** 场景显示模式：叠加 / 只看左 / 只看右 */
export type DisplayMode = 'both' | 'left' | 'right';

export type Side = 'left' | 'right';

/** 配对行中的单侧数据 */
export interface CompareSide {
  /** bom_item id，与 AssemblyInstance.bom_path 末段对应；根节点为空串 */
  bomItemId: string;
  code: string;
  name: string;
  version: string;
  quantity: number | null;
  /** 该侧此节点(含子树)关联的 mesh uuid，由加载器增量回填 */
  meshUuids: string[];
  /** 该侧是否存在 3D 模型；false 时树中灰显并标"无模型" */
  hasModel: boolean;
}

/** 配对树节点：一行 = 一个节点，行内左右两格分别渲染 left / right */
export interface CompareNode {
  /** 稳定唯一 key，取自 BOMCompareNode.key（件号链）；根节点为 'ROOT' */
  key: string;
  parentKey: string | null;
  /** 与后端一致，0 = 根装配的直接子项；根节点为 -1 */
  level: number;
  changeType: ChangeType;
  left: CompareSide | null;
  right: CompareSide | null;
  children: CompareNode[];
}
```

- [ ] **Step 2: 写失败测试**

`frontend/src/components/STPViewer/buildCompareTree.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildCompareTree } from './buildCompareTree';
import type { CompareNode } from './compareTypes';
import type { BOMCompareResponse, BOMCompareNode } from '../../types';
import type { AssemblyTreeNode } from '../../services/api';

const side = (bomItemId: string, code: string, version = 'V1', quantity = 1) => ({
  id: bomItemId,
  child_type: 'part',
  child_id: 'm-' + code,
  child_master_id: 'm-' + code,
  child_revision_id: 'r-' + code,
  quantity,
  detail: { code, name: code + '名', spec: '', version, status: 'released' },
});

const cmp = (over: Partial<BOMCompareNode>): BOMCompareNode => ({
  key: '/A', level: 0, sort: '0', path: '/A', change_type: 'none',
  left: null, right: null, ...over,
});

const resp = (comparison: BOMCompareNode[]): BOMCompareResponse => ({
  left_assembly: { id: 'L', code: 'ASM', name: '总成', spec: '', version: 'V1', status: 'released' },
  right_assembly: { id: 'R', code: 'ASM', name: '总成', spec: '', version: 'V2', status: 'released' },
  comparison,
  summary: { total: 0, added: 0, deleted: 0, modified: 0, internal_changes: 0, unchanged: 0 },
});

const asmNode = (over: Partial<AssemblyTreeNode>): AssemblyTreeNode => ({
  bom_item_id: 'x', part_code: 'X', part_name: '', quantity: 1,
  instance_count: 1, is_leaf: true, children: [], ...over,
});

/** 深度优先找到指定 key 的节点 */
function find(root: CompareNode, key: string): CompareNode | null {
  if (root.key === key) return root;
  for (const c of root.children) {
    const hit = find(c, key);
    if (hit) return hit;
  }
  return null;
}

describe('buildCompareTree', () => {
  it('把扁平 comparison 按 path 还原成树，根节点为 ROOT', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/A', path: '/A', level: 0, left: side('b1', 'A'), right: side('b1r', 'A') }),
        cmp({ key: '/A/B', path: '/A/B', level: 1, left: side('b2', 'B'), right: side('b2r', 'B') }),
      ]),
      [], [],
    );

    expect(root.key).toBe('ROOT');
    expect(root.parentKey).toBeNull();
    expect(root.level).toBe(-1);
    expect(root.children.map((c) => c.key)).toEqual(['/A']);
    expect(root.children[0].children.map((c) => c.key)).toEqual(['/A/B']);
    expect(find(root, '/A/B')!.parentKey).toBe('/A');
  });

  it('支持任意深度（5 层），不丢节点', () => {
    const paths = ['/A', '/A/B', '/A/B/C', '/A/B/C/D', '/A/B/C/D/E'];
    const root = buildCompareTree(
      resp(paths.map((p, i) => cmp({
        key: p, path: p, level: i,
        left: side('b' + i, p.split('/').pop()!),
        right: side('b' + i + 'r', p.split('/').pop()!),
      }))),
      [], [],
    );
    expect(find(root, '/A/B/C/D/E')).not.toBeNull();
    expect(find(root, '/A/B/C/D/E')!.parentKey).toBe('/A/B/C/D');
    expect(find(root, '/A/B/C/D/E')!.level).toBe(4);
  });

  it('填充 add / delete / modify / none 四种类型的左右两侧', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/ADD', path: '/ADD', change_type: 'add', right: side('br', 'ADD') }),
        cmp({ key: '/DEL', path: '/DEL', change_type: 'delete', left: side('bl', 'DEL') }),
        cmp({ key: '/MOD', path: '/MOD', change_type: 'modify', left: side('bl2', 'MOD', 'V1'), right: side('br2', 'MOD', 'V2') }),
        cmp({ key: '/SAME', path: '/SAME', change_type: 'none', left: side('bl3', 'SAME'), right: side('br3', 'SAME') }),
      ]),
      [], [],
    );

    expect(find(root, '/ADD')!.left).toBeNull();
    expect(find(root, '/ADD')!.right!.bomItemId).toBe('br');
    expect(find(root, '/DEL')!.right).toBeNull();
    expect(find(root, '/DEL')!.left!.bomItemId).toBe('bl');
    expect(find(root, '/MOD')!.left!.version).toBe('V1');
    expect(find(root, '/MOD')!.right!.version).toBe('V2');
    expect(find(root, '/SAME')!.changeType).toBe('none');
  });

  it('派生 internal：自身未变但子孙有差异的节点标为 internal', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/G', path: '/G', level: 0, change_type: 'none', left: side('g', 'G'), right: side('gr', 'G') }),
        cmp({ key: '/G/X', path: '/G/X', level: 1, change_type: 'add', right: side('xr', 'X') }),
        cmp({ key: '/H', path: '/H', level: 0, change_type: 'none', left: side('h', 'H'), right: side('hr', 'H') }),
        cmp({ key: '/H/Y', path: '/H/Y', level: 1, change_type: 'none', left: side('y', 'Y'), right: side('yr', 'Y') }),
      ]),
      [], [],
    );
    expect(find(root, '/G')!.changeType).toBe('internal');
    expect(find(root, '/H')!.changeType).toBe('none');
    // 根节点同理：有差异子孙 → internal
    expect(root.changeType).toBe('internal');
  });

  it('根节点两侧版本不同时标为 modify', () => {
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'none', left: side('a', 'A'), right: side('ar', 'A') })]),
      [], [],
    );
    // left_assembly V1 vs right_assembly V2
    expect(root.changeType).toBe('modify');
    expect(root.left!.code).toBe('ASM');
    expect(root.right!.version).toBe('V2');
  });

  it('从装配树回填 hasModel：树里有该 bom_item 的叶子才算有模型', () => {
    const leftAsm: AssemblyTreeNode[] = [asmNode({ bom_item_id: 'bl', part_code: 'A' })];
    const rightAsm: AssemblyTreeNode[] = [];
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'modify', left: side('bl', 'A'), right: side('br', 'A') })]),
      leftAsm, rightAsm,
    );
    expect(find(root, '/A')!.left!.hasModel).toBe(true);
    expect(find(root, '/A')!.right!.hasModel).toBe(false);
  });

  it('多实例零件：装配树里的 "{bom_item_id}:{idx}" 也算该 bom_item 有模型', () => {
    const leftAsm: AssemblyTreeNode[] = [
      asmNode({ bom_item_id: 'bl', instance_index: 0, part_code: 'A' }),
      asmNode({ bom_item_id: 'bl', instance_index: 1, part_code: 'A' }),
    ];
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'none', left: side('bl', 'A', 'V1', 2), right: side('bl', 'A', 'V1', 2) })]),
      leftAsm, leftAsm,
    );
    expect(find(root, '/A')!.left!.hasModel).toBe(true);
    expect(find(root, '/A')!.left!.quantity).toBe(2);
  });

  it('子节点在 comparison 中先于父节点出现时也能正确挂载', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/P/C', path: '/P/C', level: 1, change_type: 'none', left: side('c', 'C'), right: side('cr', 'C') }),
        cmp({ key: '/P', path: '/P', level: 0, change_type: 'none', left: side('p', 'P'), right: side('pr', 'P') }),
      ]),
      [], [],
    );
    expect(find(root, '/P')!.children.map((c) => c.key)).toEqual(['/P/C']);
  });

  it('父节点缺失的孤儿节点挂到 ROOT 下，不丢数据', () => {
    const root = buildCompareTree(
      resp([cmp({ key: '/GONE/C', path: '/GONE/C', level: 1, change_type: 'add', right: side('c', 'C') })]),
      [], [],
    );
    expect(root.children.map((c) => c.key)).toEqual(['/GONE/C']);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- buildCompareTree`
Expected: FAIL —— `Failed to resolve import "./buildCompareTree"`

- [ ] **Step 4: 实现 buildCompareTree**

`frontend/src/components/STPViewer/buildCompareTree.ts`：

```ts
import type { BOMCompareResponse, BOMCompareNode } from '../../types';
import type { AssemblyTreeNode } from '../../services/api';
import type { CompareNode, CompareSide, ChangeType } from './compareTypes';

/**
 * 收集装配树中出现过的 bom_item_id（含多实例展开节点）。
 * 多实例节点的 key 是 "{bom_item_id}:{idx}"，但这里只关心"该 bom_item 有没有模型"，
 * 所以统一收 bom_item_id 本身。
 */
function collectBomItemIds(tree: AssemblyTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: AssemblyTreeNode[]) => {
    for (const n of nodes) {
      if (n.bom_item_id) ids.add(n.bom_item_id);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(tree || []);
  return ids;
}

function toSide(
  raw: BOMCompareNode['left'],
  modelIds: Set<string>,
): CompareSide | null {
  if (!raw) return null;
  return {
    bomItemId: raw.id || '',
    code: raw.detail.code || '',
    name: raw.detail.name || '',
    version: raw.detail.version || '',
    quantity: raw.quantity ?? null,
    meshUuids: [],
    hasModel: modelIds.has(raw.id || ''),
  };
}

/** path 的父路径：'/A/B/C' → '/A/B'；'/A' → '' */
function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

/**
 * 把 BOM 对比结果 + 两侧装配树构建成配对树。
 *
 * 配对树是"一棵树承载左右两版"：一行 = 一个 CompareNode，
 * 行内左右两格分别渲染 left / right，缺失侧渲染占位。
 * 展开/滚动联动因此是结构性的，不需要任何同步代码。
 *
 * 注意：后端只产出 none/add/delete/modify，internal（子项变化）在此派生。
 */
export function buildCompareTree(
  result: BOMCompareResponse,
  leftTree: AssemblyTreeNode[],
  rightTree: AssemblyTreeNode[],
): CompareNode {
  const leftModelIds = collectBomItemIds(leftTree);
  const rightModelIds = collectBomItemIds(rightTree);

  const la = result.left_assembly;
  const ra = result.right_assembly;
  const rootChanged = (la?.version || '') !== (ra?.version || '') || (la?.status || '') !== (ra?.status || '');

  const root: CompareNode = {
    key: 'ROOT',
    parentKey: null,
    level: -1,
    changeType: rootChanged ? 'modify' : 'none',
    left: la ? { bomItemId: '', code: la.code, name: la.name, version: la.version, quantity: null, meshUuids: [], hasModel: leftModelIds.size > 0 } : null,
    right: ra ? { bomItemId: '', code: ra.code, name: ra.name, version: ra.version, quantity: null, meshUuids: [], hasModel: rightModelIds.size > 0 } : null,
    children: [],
  };

  // 第一遍：建节点（顺序无关，父可能后于子出现）
  const byKey = new Map<string, CompareNode>();
  byKey.set('ROOT', root);
  for (const n of result.comparison) {
    byKey.set(n.key, {
      key: n.key,
      parentKey: null,
      level: n.level,
      changeType: n.change_type as ChangeType,
      left: toSide(n.left, leftModelIds),
      right: toSide(n.right, rightModelIds),
      children: [],
    });
  }

  // 第二遍：按 path 前缀挂载。父不存在（数据不完整）时挂到 ROOT，避免丢节点。
  for (const n of result.comparison) {
    const node = byKey.get(n.key)!;
    const pKey = parentPath(n.path);
    const parent = (pKey && byKey.get(pKey)) || root;
    node.parentKey = parent.key === 'ROOT' ? 'ROOT' : parent.key;
    parent.children.push(node);
  }

  // 第三遍：后序派生 internal —— 自身未变但子孙有差异
  const derive = (node: CompareNode): boolean => {
    let childChanged = false;
    for (const c of node.children) {
      if (derive(c)) childChanged = true;
    }
    if (node.changeType === 'none' && childChanged) node.changeType = 'internal';
    return node.changeType !== 'none';
  };
  derive(root);

  return root;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- buildCompareTree`
Expected: PASS，9 个用例全绿

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/compareTypes.ts frontend/src/components/STPViewer/buildCompareTree.ts frontend/src/components/STPViewer/buildCompareTree.test.ts
git commit -m "feat(3d-compare): 配对树类型与构建纯函数"
```

---

### Task 2: 渲染规则纯函数

**Files:**
- Create: `frontend/src/components/STPViewer/compareRenderRules.ts`
- Test: `frontend/src/components/STPViewer/compareRenderRules.test.ts`

**Interfaces:**
- Consumes: `ChangeType`、`DisplayMode`（Task 1 的 `compareTypes.ts`）
- Produces:
  - `const CHANGE_COLORS: Record<ChangeType, number>`
  - `interface RenderDecision { drawLeft: boolean; drawRight: boolean; color: number; leftGhost: boolean }`
  - `function renderDecision(changeType: ChangeType, mode: DisplayMode): RenderDecision`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/STPViewer/compareRenderRules.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { renderDecision, CHANGE_COLORS } from './compareRenderRules';

describe('renderDecision - 叠加模式', () => {
  it('未变件只画左侧一份（避免重合几何 z-fighting），灰色', () => {
    const d = renderDecision('none', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: false, color: 0xB4B2A9, leftGhost: false });
  });

  it('修改件两侧都画，左侧(旧版)为幽灵、右侧(新版)为实体，黄色', () => {
    const d = renderDecision('modify', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: true, color: 0xEF9F27, leftGhost: true });
  });

  it('新增件只有右侧，绿色实体', () => {
    const d = renderDecision('add', 'both');
    expect(d).toEqual({ drawLeft: false, drawRight: true, color: 0x639922, leftGhost: false });
  });

  it('删除件只有左侧，红色实体', () => {
    const d = renderDecision('delete', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: false, color: 0xE24B4A, leftGhost: false });
  });

  it('internal 是分组行，本身不渲染', () => {
    const d = renderDecision('internal', 'both');
    expect(d.drawLeft).toBe(false);
    expect(d.drawRight).toBe(false);
  });
});

describe('renderDecision - 只看左', () => {
  it('未变件画左侧', () => {
    expect(renderDecision('none', 'left')).toMatchObject({ drawLeft: true, drawRight: false });
  });

  it('修改件只画左侧，且不再是幽灵（此时它是唯一一份）', () => {
    expect(renderDecision('modify', 'left')).toMatchObject({ drawLeft: true, drawRight: false, leftGhost: false });
  });

  it('新增件在左侧不存在，什么都不画', () => {
    expect(renderDecision('add', 'left')).toMatchObject({ drawLeft: false, drawRight: false });
  });

  it('删除件画左侧', () => {
    expect(renderDecision('delete', 'left')).toMatchObject({ drawLeft: true, drawRight: false });
  });
});

describe('renderDecision - 只看右', () => {
  it('未变件改画右侧（否则切到只看右时未变件会全消失）', () => {
    expect(renderDecision('none', 'right')).toMatchObject({ drawLeft: false, drawRight: true });
  });

  it('修改件只画右侧', () => {
    expect(renderDecision('modify', 'right')).toMatchObject({ drawLeft: false, drawRight: true, leftGhost: false });
  });

  it('新增件画右侧', () => {
    expect(renderDecision('add', 'right')).toMatchObject({ drawLeft: false, drawRight: true });
  });

  it('删除件在右侧不存在，什么都不画', () => {
    expect(renderDecision('delete', 'right')).toMatchObject({ drawLeft: false, drawRight: false });
  });
});

describe('CHANGE_COLORS', () => {
  it('四种变更色与设计文档一致', () => {
    expect(CHANGE_COLORS.none).toBe(0xB4B2A9);
    expect(CHANGE_COLORS.modify).toBe(0xEF9F27);
    expect(CHANGE_COLORS.add).toBe(0x639922);
    expect(CHANGE_COLORS.delete).toBe(0xE24B4A);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- compareRenderRules`
Expected: FAIL —— 无法解析 `./compareRenderRules`

- [ ] **Step 3: 实现**

`frontend/src/components/STPViewer/compareRenderRules.ts`：

```ts
import type { ChangeType, DisplayMode } from './compareTypes';

/** 3D 场景中的变更配色（Three.js 材质 hex） */
export const CHANGE_COLORS: Record<ChangeType, number> = {
  none: 0xB4B2A9,      // 灰：未变
  modify: 0xEF9F27,    // 黄：修改
  add: 0x639922,       // 绿：新增
  delete: 0xE24B4A,    // 红：删除
  internal: 0xB4B2A9,  // 分组行不渲染，占位
};

export interface RenderDecision {
  drawLeft: boolean;
  drawRight: boolean;
  color: number;
  /** 左侧那份是否降为幽灵透明度（仅叠加模式下的 modify） */
  leftGhost: boolean;
}

/**
 * 决定某个变更类型在某显示模式下画哪一侧、什么颜色。
 *
 * 叠加模式的核心取舍：未变件左右几何完全重合，只画一份避免 z-fighting；
 * modify 件两侧都画（旧版半透明 + 新版实体），这是叠加相对分屏唯一不可替代的价值。
 */
export function renderDecision(changeType: ChangeType, mode: DisplayMode): RenderDecision {
  const color = CHANGE_COLORS[changeType];

  // 分组行本身没有几何，由其子项各自渲染
  if (changeType === 'internal') {
    return { drawLeft: false, drawRight: false, color, leftGhost: false };
  }

  if (mode === 'left') {
    // 左侧存在的：none / modify / delete
    const exists = changeType !== 'add';
    return { drawLeft: exists, drawRight: false, color, leftGhost: false };
  }

  if (mode === 'right') {
    // 右侧存在的：none / modify / add
    const exists = changeType !== 'delete';
    return { drawLeft: false, drawRight: exists, color, leftGhost: false };
  }

  // 叠加
  switch (changeType) {
    case 'none':
      return { drawLeft: true, drawRight: false, color, leftGhost: false };
    case 'modify':
      return { drawLeft: true, drawRight: true, color, leftGhost: true };
    case 'add':
      return { drawLeft: false, drawRight: true, color, leftGhost: false };
    case 'delete':
      return { drawLeft: true, drawRight: false, color, leftGhost: false };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- compareRenderRules`
Expected: PASS，14 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/STPViewer/compareRenderRules.ts frontend/src/components/STPViewer/compareRenderRules.test.ts
git commit -m "feat(3d-compare): 渲染规则纯函数（画哪侧/什么色/是否幽灵）"
```

---

### Task 3: 「仅显示差异」剪枝纯函数

**Files:**
- Create: `frontend/src/components/STPViewer/compareTreeFilter.ts`
- Test: `frontend/src/components/STPViewer/compareTreeFilter.test.ts`

**Interfaces:**
- Consumes: `CompareNode`（Task 1）
- Produces: `function filterCompareTree(root: CompareNode, onlyDiff: boolean): CompareNode`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/STPViewer/compareTreeFilter.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { filterCompareTree } from './compareTreeFilter';
import type { CompareNode, ChangeType } from './compareTypes';

const n = (key: string, changeType: ChangeType, children: CompareNode[] = []): CompareNode => ({
  key, parentKey: null, level: 0, changeType,
  left: null, right: null, children,
});

const keys = (node: CompareNode): string[] => [node.key, ...node.children.flatMap(keys)];

describe('filterCompareTree', () => {
  it('onlyDiff=false 时原样返回同一棵树', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    expect(filterCompareTree(root, false)).toBe(root);
  });

  it('剪掉纯未变子树', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    expect(keys(filterCompareTree(root, true))).toEqual(['ROOT', '/B']);
  });

  it('保留含差异子孙的未变父节点（作为路径上下文）', () => {
    const root = n('ROOT', 'internal', [
      n('/G', 'internal', [n('/G/X', 'add'), n('/G/Y', 'none')]),
      n('/H', 'none', [n('/H/Z', 'none')]),
    ]);
    const out = filterCompareTree(root, true);
    expect(keys(out)).toEqual(['ROOT', '/G', '/G/X']);
  });

  it('ROOT 始终保留，即使全无差异', () => {
    const root = n('ROOT', 'none', [n('/A', 'none')]);
    const out = filterCompareTree(root, true);
    expect(out.key).toBe('ROOT');
    expect(out.children).toEqual([]);
  });

  it('不修改原树（返回新对象）', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    const out = filterCompareTree(root, true);
    expect(root.children).toHaveLength(2);
    expect(out).not.toBe(root);
  });

  it('modify / delete 与 add 一样被保留', () => {
    const root = n('ROOT', 'internal', [n('/A', 'modify'), n('/B', 'delete'), n('/C', 'none')]);
    expect(keys(filterCompareTree(root, true))).toEqual(['ROOT', '/A', '/B']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- compareTreeFilter`
Expected: FAIL —— 无法解析 `./compareTreeFilter`

- [ ] **Step 3: 实现**

`frontend/src/components/STPViewer/compareTreeFilter.ts`：

```ts
import type { CompareNode } from './compareTypes';

/**
 * 「仅显示差异」剪枝：隐藏 change_type === 'none' 的纯未变子树，
 * 但保留含差异子孙的父节点（否则差异项会失去路径上下文）。
 *
 * 返回新树，不修改入参。onlyDiff=false 时直接返回原引用（避免无谓重渲染）。
 */
export function filterCompareTree(root: CompareNode, onlyDiff: boolean): CompareNode {
  if (!onlyDiff) return root;

  const prune = (node: CompareNode): CompareNode | null => {
    const children = node.children
      .map(prune)
      .filter((c): c is CompareNode => c !== null);
    if (node.changeType === 'none' && children.length === 0) return null;
    return { ...node, children };
  };

  const children = root.children
    .map(prune)
    .filter((c): c is CompareNode => c !== null);
  return { ...root, children };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- compareTreeFilter`
Expected: PASS，6 个用例全绿

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/STPViewer/compareTreeFilter.ts frontend/src/components/STPViewer/compareTreeFilter.test.ts
git commit -m "feat(3d-compare): 仅显示差异剪枝纯函数"
```

---

### Task 4: viewerStore 对比分片

**Files:**
- Modify: `frontend/src/stores/viewerStore.ts`
- Test: `frontend/src/stores/viewerStore.compare.test.ts`

**Interfaces:**
- Consumes: `CompareNode`、`DisplayMode`、`Side`（Task 1）
- Produces（挂在 `useViewerStore` 上）：
  - `compare: CompareSlice | null`，其中
    `interface CompareSlice { tree: CompareNode; nodeMap: Map<string, CompareNode>; meshOwner: Map<string, { key: string; side: Side }>; displayMode: DisplayMode; onlyDiff: boolean; ghostOpacity: number; selectedKey: string | null; leftMissing: boolean; rightMissing: boolean }`
  - `setCompareTree(tree: CompareNode, opts: { leftMissing: boolean; rightMissing: boolean }): void`
  - `mergeCompareMeshes(key: string, side: Side, meshUuids: string[]): void`
  - `selectCompareKey(key: string | null): void`
  - `selectCompareByMesh(meshUuid: string): void`
  - `setDisplayMode(mode: DisplayMode): void`
  - `setOnlyDiff(v: boolean): void`
  - `setGhostOpacity(v: number): void`

> 复用现有 `expandedIds`（展开态）与 `hiddenParts`（按 mesh uuid 显隐），不新增平行状态。

- [ ] **Step 1: 写失败测试**

`frontend/src/stores/viewerStore.compare.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './viewerStore';
import type { CompareNode } from '../components/STPViewer/compareTypes';

const side = (bomItemId: string) => ({
  bomItemId, code: bomItemId, name: '', version: 'V1',
  quantity: 1, meshUuids: [] as string[], hasModel: true,
});

/** ROOT → /G → /G/X 三层树 */
const makeTree = (): CompareNode => {
  const leaf: CompareNode = {
    key: '/G/X', parentKey: '/G', level: 1, changeType: 'modify',
    left: side('bl'), right: side('br'), children: [],
  };
  const group: CompareNode = {
    key: '/G', parentKey: 'ROOT', level: 0, changeType: 'internal',
    left: side('gl'), right: side('gr'), children: [leaf],
  };
  return {
    key: 'ROOT', parentKey: null, level: -1, changeType: 'internal',
    left: side(''), right: side(''), children: [group],
  };
};

describe('viewerStore compare 分片', () => {
  beforeEach(() => useViewerStore.getState().reset());

  it('默认 compare 为 null，既有模式不受影响', () => {
    expect(useViewerStore.getState().compare).toBeNull();
  });

  it('setCompareTree 建立 nodeMap 并记录缺模型标记', () => {
    useViewerStore.getState().setCompareTree(makeTree(), { leftMissing: false, rightMissing: true });
    const c = useViewerStore.getState().compare!;
    expect(c.nodeMap.size).toBe(3);
    expect(c.nodeMap.get('/G/X')!.changeType).toBe('modify');
    expect(c.rightMissing).toBe(true);
    expect(c.displayMode).toBe('both');
    expect(c.onlyDiff).toBe(false);
    expect(c.ghostOpacity).toBe(0.12);
    expect(c.selectedKey).toBeNull();
  });

  it('mergeCompareMeshes 把 mesh 并入指定侧并向上聚合到祖先', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['m1', 'm2']);

    const c = useViewerStore.getState().compare!;
    expect(c.nodeMap.get('/G/X')!.left!.meshUuids).toEqual(['m1', 'm2']);
    expect(c.nodeMap.get('/G')!.left!.meshUuids).toEqual(['m1', 'm2']);
    expect(c.nodeMap.get('ROOT')!.left!.meshUuids).toEqual(['m1', 'm2']);
    // 右侧不受影响
    expect(c.nodeMap.get('/G/X')!.right!.meshUuids).toEqual([]);
  });

  it('mergeCompareMeshes 去重，重复调用不累加', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['m1']);
    s.mergeCompareMeshes('/G/X', 'left', ['m1', 'm3']);
    expect(useViewerStore.getState().compare!.nodeMap.get('/G/X')!.left!.meshUuids).toEqual(['m1', 'm3']);
  });

  it('selectCompareByMesh 反查配对行并展开所有祖先', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'right', ['mr1']);
    s.selectCompareByMesh('mr1');

    const st = useViewerStore.getState();
    expect(st.compare!.selectedKey).toBe('/G/X');
    expect(st.expandedIds.has('/G')).toBe(true);
    expect(st.expandedIds.has('ROOT')).toBe(true);
  });

  it('selectCompareByMesh 对未知 mesh 无副作用', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.selectCompareByMesh('unknown');
    expect(useViewerStore.getState().compare!.selectedKey).toBeNull();
  });

  it('显示模式 / 仅显示差异 / 幽灵透明度可设置', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.setDisplayMode('right');
    s.setOnlyDiff(true);
    s.setGhostOpacity(0.3);
    const c = useViewerStore.getState().compare!;
    expect(c.displayMode).toBe('right');
    expect(c.onlyDiff).toBe(true);
    expect(c.ghostOpacity).toBe(0.3);
  });

  it('compare 为 null 时调用对比 actions 不抛错', () => {
    const s = useViewerStore.getState();
    expect(() => {
      s.setDisplayMode('left');
      s.setOnlyDiff(true);
      s.mergeCompareMeshes('/G/X', 'left', ['m1']);
      s.selectCompareKey('/G/X');
      s.selectCompareByMesh('m1');
    }).not.toThrow();
    expect(useViewerStore.getState().compare).toBeNull();
  });

  it('reset 清空 compare 分片', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    useViewerStore.getState().reset();
    expect(useViewerStore.getState().compare).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- viewerStore.compare`
Expected: FAIL —— `setCompareTree is not a function`

- [ ] **Step 3: 实现 store 分片**

在 `frontend/src/stores/viewerStore.ts` 顶部加导入：

```ts
import type { CompareNode, DisplayMode, Side } from '../components/STPViewer/compareTypes';
```

在 `ViewerState` 接口中，`streamProgress` 声明之后加入分片定义与 actions 声明：

```ts
  /** BOM 3D 对比分片；null 表示非对比模式（其余三种预览模式均为 null） */
  compare: {
    tree: CompareNode;
    nodeMap: Map<string, CompareNode>;
    /** mesh uuid → 所属配对行与侧别，供 3D 点选反查 */
    meshOwner: Map<string, { key: string; side: Side }>;
    displayMode: DisplayMode;
    onlyDiff: boolean;
    ghostOpacity: number;
    selectedKey: string | null;
    leftMissing: boolean;
    rightMissing: boolean;
  } | null;
```

```ts
  setCompareTree: (tree: CompareNode, opts: { leftMissing: boolean; rightMissing: boolean }) => void;
  mergeCompareMeshes: (key: string, side: Side, meshUuids: string[]) => void;
  selectCompareKey: (key: string | null) => void;
  selectCompareByMesh: (meshUuid: string) => void;
  setDisplayMode: (mode: DisplayMode) => void;
  setOnlyDiff: (v: boolean) => void;
  setGhostOpacity: (v: number) => void;
```

在 `initialState` 中加入：

```ts
  compare: null as ViewerState['compare'],
```

在 store 实现里加入 actions（放在 `setStreamProgress` 之后）：

```ts
  setCompareTree: (tree, opts) => {
    const nodeMap = new Map<string, CompareNode>();
    const visit = (n: CompareNode) => {
      nodeMap.set(n.key, n);
      n.children.forEach(visit);
    };
    visit(tree);
    set({
      compare: {
        tree,
        nodeMap,
        meshOwner: new Map(),
        displayMode: 'both',
        onlyDiff: false,
        ghostOpacity: 0.12,
        selectedKey: null,
        leftMissing: opts.leftMissing,
        rightMissing: opts.rightMissing,
      },
      expandedIds: new Set(['ROOT']),
      hiddenParts: new Set(),
    });
  },

  // 流式加载：把某侧某行的 mesh uuid 增量并入该节点及其所有祖先的同侧
  // （祖先聚合供组级显隐/高亮），并把 meshOwner 指向该行。
  mergeCompareMeshes: (key, side, meshUuids) => {
    const c = get().compare;
    if (!c || meshUuids.length === 0) return;
    const node = c.nodeMap.get(key);
    if (!node) return;

    let cur: CompareNode | null = node;
    while (cur) {
      const target = cur[side];
      if (target) {
        const merged = new Set(target.meshUuids);
        for (const u of meshUuids) merged.add(u);
        target.meshUuids = Array.from(merged);
      }
      cur = cur.parentKey ? c.nodeMap.get(cur.parentKey) ?? null : null;
    }

    const meshOwner = new Map(c.meshOwner);
    for (const u of meshUuids) meshOwner.set(u, { key, side });
    // 浅拷贝 tree 触发面板重渲染
    set({ compare: { ...c, tree: { ...c.tree }, meshOwner } });
  },

  selectCompareKey: (key) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, selectedKey: key } });
  },

  selectCompareByMesh: (meshUuid) => {
    const c = get().compare;
    if (!c) return;
    const owner = c.meshOwner.get(meshUuid);
    if (!owner) return;
    // 沿 parentKey 上溯展开所有祖先；expanded 自带去重，兼作环路防护
    const expanded = new Set(get().expandedIds);
    let p = c.nodeMap.get(owner.key)?.parentKey ?? null;
    while (p && !expanded.has(p)) {
      expanded.add(p);
      p = c.nodeMap.get(p)?.parentKey ?? null;
    }
    set({ compare: { ...c, selectedKey: owner.key }, expandedIds: expanded });
  },

  setDisplayMode: (mode) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, displayMode: mode } });
  },

  setOnlyDiff: (v) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, onlyDiff: v } });
  },

  setGhostOpacity: (v) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: { ...c, ghostOpacity: v } });
  },
```

`reset()` 已经展开 `...initialState`，其中 `compare: null`，无需额外改动。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- viewerStore.compare`
Expected: PASS，9 个用例全绿

- [ ] **Step 5: 跑全量测试确保未破坏既有行为**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add frontend/src/stores/viewerStore.ts frontend/src/stores/viewerStore.compare.test.ts
git commit -m "feat(3d-compare): viewerStore 可选 compare 分片"
```

---

### Task 5: 对比场景加载器

**Files:**
- Create: `frontend/src/components/STPViewer/CompareModelLoader.tsx`

**Interfaces:**
- Consumes: `renderDecision` / `CHANGE_COLORS`（Task 2）、`mergeCompareMeshes` / `selectCompareByMesh`（Task 4）、`AssemblyInstance`（`services/api.ts`）
- Produces: `function CompareModelLoader(props: { leftInstances: AssemblyInstance[]; rightInstances: AssemblyInstance[] }): JSX.Element`

> 参照 `AssemblyModelLoader.tsx` 同构实现。差异：加载两组实例、颜色来自变更类型而非自动上色、mesh 回填带 side。
> **不要修改 `AssemblyModelLoader.tsx`**。

- [ ] **Step 1: 实现加载器**

`frontend/src/components/STPViewer/CompareModelLoader.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useViewerStore } from '../../stores/viewerStore';
import { useCompareVisualState } from './useCompareVisualState';
import { renderDecision } from './compareRenderRules';
import type { CompareNode, Side } from './compareTypes';
import type { AssemblyInstance } from '../../services/api';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

async function fetchGlbBuffer(url: string): Promise<ArrayBuffer> {
  const maxTries = 60; // 最多 ~120 秒
  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(url);
    if (resp.status === 200) return await resp.arrayBuffer();
    if (resp.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    throw new Error(`GLB 加载失败: ${resp.status}`);
  }
  throw new Error('GLB 转换超时');
}

// 按 url 缓存：左右两版共用的零件 GLB url 相同，只下载一次
const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    const p = fetchGlbBuffer(url)
      .then((buf) => loader.parseAsync(buf, ''))
      .then((g) => g.scene)
      .catch((err) => {
        sceneCache.delete(url);
        throw err;
      });
    sceneCache.set(url, p);
  }
  return sceneCache.get(url)!;
}

// STEP(Z-up) → three(Y-up)
const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/** 实例 bom_path 末段 "{bomItemId}" 或 "{bomItemId}:{idx}" → bomItemId */
function bomItemIdOf(inst: AssemblyInstance): string {
  const last = inst.bom_path[inst.bom_path.length - 1] || '';
  const i = last.indexOf(':');
  return i >= 0 ? last.slice(0, i) : last;
}

/** bomItemId → 配对行 key（按侧别建索引） */
function indexByBomItem(tree: CompareNode, side: Side): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (n: CompareNode) => {
    const s = n[side];
    if (s && s.bomItemId) map.set(s.bomItemId, n.key);
    n.children.forEach(visit);
  };
  visit(tree);
  return map;
}

interface Props {
  leftInstances: AssemblyInstance[];
  rightInstances: AssemblyInstance[];
}

/**
 * 对比场景加载器：把左右两版实例按变更规则加载进同一场景。
 *
 * 坐标不做任何对齐补偿——两侧矩阵原样使用（设计决定）。
 * 未变件只画左侧一份以避免重合几何 z-fighting；modify 件两侧都画。
 */
export function CompareModelLoader({ leftInstances, rightInstances }: Props) {
  const mergeCompareMeshes = useViewerStore((s) => s.mergeCompareMeshes);
  const selectCompareByMesh = useViewerStore((s) => s.selectCompareByMesh);
  const setModelScale = useViewerStore((s) => s.setModelScale);
  const setLoadingState = useViewerStore((s) => s.setLoadingState);
  const setStreamProgress = useViewerStore((s) => s.setStreamProgress);
  const setInitialState = useViewerStore((s) => s.setInitialState);
  const resetViewTrigger = useViewerStore((s) => s.resetViewTrigger);
  const measureMode = useViewerStore((s) => s.measureMode);

  const groupRef = useRef<THREE.Group>(null);
  const [rootGroup] = useState(() => new THREE.Group());
  // mesh uuid → 是否为"叠加模式下的 modify 左侧"（幽灵候选），供视觉态使用
  const ghostCandidates = useRef<Set<string>>(new Set());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();
  const userInteracted = useRef(false);

  useCompareVisualState(groupRef, ghostCandidates);

  useEffect(() => {
    const el = gl.domElement;
    const mark = () => { userInteracted.current = true; };
    el.addEventListener('pointerdown', mark);
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', mark);
      el.removeEventListener('wheel', mark);
    };
  }, [gl]);

  useEffect(() => {
    let cancelled = false;
    userInteracted.current = false;
    rootGroup.matrixAutoUpdate = false;
    rootGroup.matrix.copy(Z_UP_TO_Y_UP);
    rootGroup.clear();
    ghostCandidates.current = new Set();

    const compare = useViewerStore.getState().compare;
    if (!compare) return;
    const tree = compare.tree;
    const leftIndex = indexByBomItem(tree, 'left');
    const rightIndex = indexByBomItem(tree, 'right');

    setLoadingState('ready');

    const fitToView = (preBBox?: THREE.Box3) => {
      if (!groupRef.current) return;
      groupRef.current.scale.setScalar(1);
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.updateMatrixWorld(true);
      const box = preBBox ? preBBox.clone() : new THREE.Box3().setFromObject(rootGroup);
      if (box.isEmpty()) return;
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z);
      const scale = maxDim > 0.001 ? 16 / maxDim : 1;
      setModelScale(scale / 1000);
      const center = box.getCenter(new THREE.Vector3());
      groupRef.current.scale.setScalar(scale);
      groupRef.current.position.copy(center.multiplyScalar(-scale));
      setInitialState({
        groupScale: scale,
        groupPos: [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z],
        camPos: [5, 5, 5],
        camTarget: [0, 0, 0],
      });
    };

    // 用两侧全部实例位置预取景，避免首个小零件定标导致大件穿过近裁剪面
    const all = [...leftInstances, ...rightInstances];
    if (all.length > 0) {
      const roughBox = new THREE.Box3();
      for (const inst of all) {
        const p = new THREE.Vector3(inst.matrix[3], inst.matrix[7], inst.matrix[11]);
        p.applyMatrix4(Z_UP_TO_Y_UP);
        roughBox.expandByPoint(p);
      }
      const diag = roughBox.getSize(new THREE.Vector3()).length();
      if (diag < 0.001) {
        roughBox.expandByPoint(new THREE.Vector3(1, 1, 1));
        roughBox.expandByPoint(new THREE.Vector3(-1, -1, -1));
      }
      roughBox.expandByScalar(diag * 0.15);
      fitToView(roughBox);
    }

    // 逐实例排队：先左后右，保证 modify 的旧版先落位
    const queue: { inst: AssemblyInstance; side: Side }[] = [
      ...leftInstances.map((inst) => ({ inst, side: 'left' as Side })),
      ...rightInstances.map((inst) => ({ inst, side: 'right' as Side })),
    ];

    (async () => {
      let loaded = 0;
      setStreamProgress({ loaded: 0, total: queue.length });

      for (const { inst, side } of queue) {
        const bomItemId = bomItemIdOf(inst);
        const key = (side === 'left' ? leftIndex : rightIndex).get(bomItemId);
        if (!key) { loaded++; setStreamProgress({ loaded, total: queue.length }); continue; }
        const node = compare.nodeMap.get(key);
        if (!node) { loaded++; setStreamProgress({ loaded, total: queue.length }); continue; }

        // 两侧实例一律加载入场，由 useCompareVisualState 按当前 displayMode 控制 visible，
        // 这样切换显示模式不需要重新下载模型。
        // 这里只取 color（与模式无关）与 leftGhost（叠加模式下 modify 的旧版）。
        const decision = renderDecision(node.changeType, 'both');

        let coarse: THREE.Group, normal: THREE.Group, fine: THREE.Group;
        try {
          [coarse, normal, fine] = await Promise.all([
            loadScene(inst.glb_urls.coarse),
            loadScene(inst.glb_urls.normal),
            loadScene(inst.glb_urls.fine),
          ]);
        } catch (err) {
          console.warn(`对比零件加载失败，已跳过: ${inst.part_code}`, err);
          loaded++;
          setStreamProgress({ loaded, total: queue.length });
          continue;
        }
        if (cancelled) return;

        const lod = new THREE.LOD();
        const fineC = cloneSkeleton(fine) as THREE.Group;
        const normalC = cloneSkeleton(normal) as THREE.Group;
        const coarseC = cloneSkeleton(coarse) as THREE.Group;

        // 每个 mesh 独立材质并直接染成变更色（对比模式不走自动上色）
        for (const g of [fineC, normalC, coarseC]) {
          g.traverse((c) => {
            const m = c as THREE.Mesh;
            if (m.isMesh && m.material && !Array.isArray(m.material)) {
              m.material = (m.material as THREE.Material).clone();
              const std = m.material as THREE.MeshStandardMaterial;
              if (std.color) std.color.setHex(decision.color);
            }
          });
        }

        const size = new THREE.Box3().setFromObject(fineC).getSize(new THREE.Vector3()).length() || 1;
        lod.addLevel(fineC, 0);
        lod.addLevel(normalC, size * 4);
        lod.addLevel(coarseC, size * 12);

        lod.matrixAutoUpdate = false;
        lod.matrix.fromArray(inst.matrix).transpose(); // 行主序→three 列主序
        // 侧别与变更类型写进 userData，供视觉态按显示模式取舍
        lod.userData.compareSide = side;
        lod.userData.compareKey = key;
        lod.userData.changeType = node.changeType;

        rootGroup.add(lod);

        const uuids: string[] = [];
        lod.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            uuids.push(c.uuid);
            c.userData.compareSide = side;
            c.userData.compareKey = key;
            c.userData.changeType = node.changeType;
          }
        });
        if (decision.leftGhost && side === 'left') {
          uuids.forEach((u) => ghostCandidates.current.add(u));
        }
        mergeCompareMeshes(key, side, uuids);

        loaded++;
        setStreamProgress({ loaded, total: queue.length });
      }

      if (cancelled) return;
      setStreamProgress(null);
      if (!userInteracted.current) fitToView();
      setLoadingState('ready');
    })();

    return () => { cancelled = true; rootGroup.clear(); setStreamProgress(null); };
  }, [leftInstances, rightInstances, rootGroup, mergeCompareMeshes, setModelScale, setLoadingState, setStreamProgress, setInitialState]);

  // 重置：恢复到加载时的初始视角和大小
  useEffect(() => {
    if (resetViewTrigger === 0 || !groupRef.current) return;
    const { initGroupScale, initGroupPos } = useViewerStore.getState();
    groupRef.current.scale.setScalar(initGroupScale);
    groupRef.current.position.set(...initGroupPos);
  }, [resetViewTrigger]);

  const handlePointerDown = (e: any) => { pointerDown.current = { x: e.clientX, y: e.clientY }; };

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (measureMode !== 'off') { pointerDown.current = null; return; }
    if (pointerDown.current) {
      const dx = e.clientX - pointerDown.current.x;
      const dy = e.clientY - pointerDown.current.y;
      pointerDown.current = null;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) return;
    }
    if (e.object?.uuid) selectCompareByMesh(e.object.uuid);
  };

  return (
    <group ref={groupRef}>
      <primitive object={rootGroup} onPointerDown={handlePointerDown} onClick={handleClick} />
    </group>
  );
}
```

- [ ] **Step 2: 类型检查（此时 useCompareVisualState 尚不存在，预期报错）**

Run: `npx tsc --noEmit`
Expected: 仅报 `Cannot find module './useCompareVisualState'`——Task 6 补上。不要为此改动本文件。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/STPViewer/CompareModelLoader.tsx
git commit -m "feat(3d-compare): 对比场景加载器（两侧实例按变更着色摆位）"
```

---

### Task 6: 对比视觉态 hook

**Files:**
- Create: `frontend/src/components/STPViewer/useCompareVisualState.ts`

**Interfaces:**
- Consumes: `viewerStore.compare`（Task 4）、`renderDecision`（Task 2）、`CompareModelLoader` 写入的 `mesh.userData.{compareSide, compareKey, changeType}`（Task 5）
- Produces: `function useCompareVisualState(groupRef: RefObject<THREE.Object3D | null>, ghostCandidates: MutableRefObject<Set<string>>): void`

> **不要修改 `useSceneVisualState.ts`**。两者语义已分叉（单选 vs 配对选、单一色源 vs 变更色源），强行合并会得到满是 `if (compare)` 的函数。

- [ ] **Step 1: 实现 hook**

`frontend/src/components/STPViewer/useCompareVisualState.ts`：

```ts
import { useEffect, type RefObject, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';
import { renderDecision } from './compareRenderRules';
import type { ChangeType, Side } from './compareTypes';

/**
 * 对比模式的视觉态施加：按显示模式 / 仅显示差异 / 选中 / 幽灵透明度 / 显隐 / 线框
 * 逐 mesh 计算 visible 与 opacity。
 *
 * 与 useSceneVisualState 并列而非合并：对比模式是"配对选中 + 变更色源"，
 * 语义与单件/装配模式的"单选 + 自动上色"已分叉。
 *
 * @param groupRef 场景根 Object3D
 * @param ghostCandidates 叠加模式下 modify 件左侧(旧版)的 mesh uuid 集合
 */
export function useCompareVisualState(
  groupRef: RefObject<THREE.Object3D | null>,
  ghostCandidates: MutableRefObject<Set<string>>,
) {
  const compare = useViewerStore((s) => s.compare);
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const wireframe = useViewerStore((s) => s.wireframe);
  const isolateMode = useViewerStore((s) => s.isolateMode);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !compare) return;

    const { displayMode, onlyDiff, ghostOpacity, selectedKey, nodeMap } = compare;

    // 选中行涉及的 mesh（左右两侧一起）
    const selected = new Set<string>();
    if (selectedKey) {
      const node = nodeMap.get(selectedKey);
      node?.left?.meshUuids.forEach((u) => selected.add(u));
      node?.right?.meshUuids.forEach((u) => selected.add(u));
    }

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const side = mesh.userData.compareSide as Side | undefined;
      const changeType = mesh.userData.changeType as ChangeType | undefined;
      if (!side || !changeType) return;

      // 1) 显示模式决定这份该不该出现在场景里
      const decision = renderDecision(changeType, displayMode);
      const wanted = side === 'left' ? decision.drawLeft : decision.drawRight;

      // 2) 手动显隐（树上的眼睛按钮）优先级最高
      mesh.visible = wanted && !hiddenParts.has(mesh.uuid);
      if (!mesh.visible) return;

      const mat = mesh.material;
      if (Array.isArray(mat)) return; // 多材质 mesh：跳过样式处理
      const std = mat as THREE.MeshStandardMaterial;
      std.wireframe = wireframe;

      // 3) 透明度：选中实体高亮 > 幽灵（未变件/旧版/隔离） > 实体
      const isSelected = selected.has(mesh.uuid);
      const ghostByModify = displayMode === 'both' && ghostCandidates.current.has(mesh.uuid);
      const ghostByOnlyDiff = onlyDiff && changeType === 'none';
      const ghostByIsolate = isolateMode && selectedKey !== null && !isSelected;
      const ghost = ghostByModify || ghostByOnlyDiff || ghostByIsolate;

      if (isSelected) {
        if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        if (ghost) {
          std.transparent = true; std.opacity = ghostOpacity; std.depthWrite = false;
        } else {
          std.transparent = false; std.opacity = 1; std.depthWrite = true;
        }
      }
      std.needsUpdate = true;
    });
  }, [groupRef, ghostCandidates, compare, hiddenParts, wireframe, isolateMode]);
}
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误（Task 5 的 import 现已可解析）

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/STPViewer/useCompareVisualState.ts
git commit -m "feat(3d-compare): 对比视觉态 hook（显示模式/幽灵/选中/显隐）"
```

---

### Task 7: 左右并排对齐双树面板

**Files:**
- Create: `frontend/src/components/STPViewer/CompareTreePanel.tsx`

**Interfaces:**
- Consumes: `viewerStore.compare`（Task 4）、`filterCompareTree`（Task 3）、`CompareNode` / `CompareSide` / `Side`（Task 1）
- Produces: `function CompareTreePanel(): JSX.Element | null`

> 关键：**两侧渲染在同一行的两个格子里**，展开按钮每行只有一个。行对齐、展开联动、滚动联动因此是结构性的，无需同步代码。

- [ ] **Step 1: 实现面板**

`frontend/src/components/STPViewer/CompareTreePanel.tsx`：

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { filterCompareTree } from './compareTreeFilter';
import type { CompareNode, CompareSide, ChangeType, Side } from './compareTypes';

const ROW_BG: Record<ChangeType, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-yellow-50',
  none: '',
};

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="currentColor"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
      {visible ? <circle cx="8" cy="8" r="2" /> : <path d="M2 2l12 12" strokeLinecap="round" />}
    </svg>
  );
}

/** 单侧格子：缺失侧渲染虚线占位 */
function SideCell({ side, node, which }: { side: CompareSide | null; node: CompareNode; which: Side }) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleCompareSideVisibility);

  if (!side) {
    return (
      <div className="flex-1 min-w-0 px-2 py-0.5">
        <div className="border border-dashed border-gray-300 rounded text-gray-300 text-xs text-center leading-5">—</div>
      </div>
    );
  }

  const visible = side.meshUuids.length === 0 ? true : side.meshUuids.some((u) => !hiddenParts.has(u));
  const noModel = !side.hasModel;
  const label = [side.code, side.version, side.name].filter(Boolean).join('_');

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5">
      {side.meshUuids.length > 0 ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMeshes(node.key, which); }}
          className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-400'}`}
          title={visible ? '隐藏' : '显示'}
        >
          <EyeIcon visible={visible} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span
        className={`truncate flex-1 text-xs
          ${noModel ? 'text-gray-400 italic' : 'text-gray-700'}
          ${visible ? '' : 'text-gray-300 line-through'}`}
        title={label}
      >
        {label}
        {side.quantity !== null && <span className="text-gray-400 ml-1">×{side.quantity}</span>}
        {noModel && <span className="text-gray-400 ml-1">(无模型)</span>}
      </span>
    </div>
  );
}

function Row({ node, depth }: { node: CompareNode; depth: number }) {
  const expandedIds = useViewerStore((s) => s.expandedIds);
  const toggleExpanded = useViewerStore((s) => s.toggleExpanded);
  const selectedKey = useViewerStore((s) => s.compare?.selectedKey ?? null);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);

  const expanded = expandedIds.has(node.key);
  const selected = selectedKey === node.key;
  const hasChildren = node.children.length > 0;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected && rowRef.current) rowRef.current.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <li>
      <div
        ref={rowRef}
        onClick={() => selectCompareKey(node.key)}
        className={`flex items-stretch cursor-pointer select-none border-b border-gray-50 transition-colors
          ${selected ? 'ring-1 ring-inset ring-primary-400 bg-primary-50' : `${ROW_BG[node.changeType]} hover:brightness-95`}`}
      >
        {/* 展开按钮每行只有一个，作用于整行 —— 左右联动是结构性的 */}
        <div className="shrink-0 flex items-center" style={{ paddingLeft: 4 + depth * 12 }}>
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.key); }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200/60"
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="w-4" />
          )}
        </div>
        <SideCell side={node.left} node={node} which="left" />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell side={node.right} node={node} which="right" />
      </div>

      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => <Row key={c.key} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function CompareTreePanel() {
  const compare = useViewerStore((s) => s.compare);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);

  const view = useMemo(
    () => (compare ? filterCompareTree(compare.tree, compare.onlyDiff) : null),
    [compare],
  );

  if (!compare || !view) return null;

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-500">BOM 对比树</span>
        <button
          onClick={() => selectCompareKey(null)}
          className="text-sm text-gray-400 hover:text-primary-600 transition-colors"
        >
          取消选中
        </button>
      </div>

      <div className="flex items-stretch text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-200">
        <span className="shrink-0 w-5" />
        <span className="flex-1 min-w-0 px-2 py-1 truncate">
          左 · {compare.tree.left?.code || '-'} {compare.tree.left?.version || ''}
          {compare.leftMissing && <span className="text-gray-400 ml-1">(无模型)</span>}
        </span>
        <span className="w-px bg-gray-200" />
        <span className="flex-1 min-w-0 px-2 py-1 truncate">
          右 · {compare.tree.right?.code || '-'} {compare.tree.right?.version || ''}
          {compare.rightMissing && <span className="text-gray-400 ml-1">(无模型)</span>}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <ul>
          <Row node={view} depth={0} />
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 补 store action `toggleCompareSideVisibility`**

面板用到了一个 Task 4 未定义的 action。在 `frontend/src/stores/viewerStore.ts` 的 `ViewerState` 中加声明：

```ts
  toggleCompareSideVisibility: (key: string, side: Side) => void;
```

并在实现中加入（放在 `setGhostOpacity` 之后）：

```ts
  // 切换某配对行某一侧的显隐（作用于该侧 meshUuids，与既有 hiddenParts 同一套机制）
  toggleCompareSideVisibility: (key, side) => {
    const c = get().compare;
    if (!c) return;
    const node = c.nodeMap.get(key);
    const uuids = node?.[side]?.meshUuids ?? [];
    if (uuids.length === 0) return;
    const hidden = new Set(get().hiddenParts);
    const allHidden = uuids.every((u) => hidden.has(u));
    if (allHidden) uuids.forEach((u) => hidden.delete(u));
    else uuids.forEach((u) => hidden.add(u));
    set({ hiddenParts: hidden });
  },
```

- [ ] **Step 3: 为新 action 补测试**

追加到 `frontend/src/stores/viewerStore.compare.test.ts`（在最后一个 `it` 之后、`describe` 闭合之前）：

```ts
  it('toggleCompareSideVisibility 只隐藏指定侧的 mesh，再次调用恢复', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['ml']);
    s.mergeCompareMeshes('/G/X', 'right', ['mr']);

    s.toggleCompareSideVisibility('/G/X', 'left');
    expect(useViewerStore.getState().hiddenParts.has('ml')).toBe(true);
    expect(useViewerStore.getState().hiddenParts.has('mr')).toBe(false);

    useViewerStore.getState().toggleCompareSideVisibility('/G/X', 'left');
    expect(useViewerStore.getState().hiddenParts.has('ml')).toBe(false);
  });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- viewerStore.compare`
Expected: PASS，10 个用例全绿

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/CompareTreePanel.tsx frontend/src/stores/viewerStore.ts frontend/src/stores/viewerStore.compare.test.ts
git commit -m "feat(3d-compare): 左右并排对齐的双 BOM 树面板"
```

---

### Task 8: 画布与页面接线

**Files:**
- Modify: `frontend/src/components/STPViewer/ViewerCanvas.tsx`
- Modify: `frontend/src/pages/STPViewer.tsx`

**Interfaces:**
- Consumes: `CompareModelLoader`（Task 5）、`CompareTreePanel`（Task 7）、`buildCompareTree`（Task 1）、`setCompareTree`（Task 4）
- Produces: `ViewerSource` 新增 `{ kind: 'compare'; leftInstances: AssemblyInstance[]; rightInstances: AssemblyInstance[] }`

- [ ] **Step 1: ViewerCanvas 增加 compare 分支**

在 `frontend/src/components/STPViewer/ViewerCanvas.tsx` 中：

导入加一行：

```tsx
import { CompareModelLoader } from './CompareModelLoader';
```

`ViewerSource` 联合类型追加一项：

```tsx
  | { kind: 'compare'; leftInstances: AssemblyInstance[]; rightInstances: AssemblyInstance[] };
```

把 `<Suspense>` 里的三元改成显式分支（保持既有两种模式的行为不变）：

```tsx
          {source.kind === 'single' ? (
            <ModelLoader url={source.url} code={source.code} version={source.version} name={source.name} />
          ) : source.kind === 'compare' ? (
            <CompareModelLoader leftInstances={source.leftInstances} rightInstances={source.rightInstances} />
          ) : (
            <AssemblyModelLoader instances={source.instances} tree={source.tree} applyZUp={source.applyZUp ?? true} displayTree={source.displayTree} />
          )}
```

> `PartHighlighter` 依赖 `selectedNodeId`，对比模式下该值恒为 null，因此它不会产生任何效果——保持原样即可，不要改它。

- [ ] **Step 2: STPViewer 页面加 compare 模式**

在 `frontend/src/pages/STPViewer.tsx` 中：

导入追加：

```tsx
import { CompareTreePanel } from '../components/STPViewer/CompareTreePanel';
import { buildCompareTree } from '../components/STPViewer/buildCompareTree';
import { bomApi } from '../services/api';
import type { BOMCompareResponse } from '../types';
```

参数解析处（`const partName = ...` 之后）追加：

```tsx
  const compareLeftId = params.get('compare-left');
  const compareRightId = params.get('compare-right');
```

状态声明处追加：

```tsx
  const [cmpLeftInstances, setCmpLeftInstances] = useState<AssemblyInstance[]>([]);
  const [cmpRightInstances, setCmpRightInstances] = useState<AssemblyInstance[]>([]);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const setCompareTree = useViewerStore((s) => s.setCompareTree);
  const compareSlice = useViewerStore((s) => s.compare);
```

在主 `useEffect` 中，`if (assemblyRevId) {...}` 分支**之前**插入 compare 分支：

```tsx
    if (compareLeftId && compareRightId) {
      setState('loading');
      Promise.all([
        bomApi.compare(compareLeftId, compareRightId),
        assemblyViewerApi.instances(compareLeftId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareLeftId).catch(() => [] as AssemblyTreeNode[]),
        assemblyViewerApi.instances(compareRightId).catch(() => [] as AssemblyInstance[]),
        assemblyViewerApi.tree(compareRightId).catch(() => [] as AssemblyTreeNode[]),
      ])
        .then(([cmpRes, li, lt, ri, rt]) => {
          const result = cmpRes.data as BOMCompareResponse;
          const tree = buildCompareTree(result, lt, rt);
          setCompareTree(tree, { leftMissing: li.length === 0, rightMissing: ri.length === 0 });
          setCmpLeftInstances(li);
          setCmpRightInstances(ri);
          setState('ready');
        })
        .catch(() => { setCmpError('对比数据加载失败，请关闭后重试'); setState('error'); });
      return;
    }
```

前置态判断处（`if (assemblyRevId) {...} else {...}` 之前）插入：

```tsx
  if (compareLeftId && compareRightId) {
    if (cmpError) return <div className="w-screen h-screen flex items-center justify-center text-red-500">{cmpError}</div>;
    if (state !== 'ready') return <div className="w-screen h-screen flex items-center justify-center text-gray-500">加载对比数据...</div>;
  }
```

> 注意：现有代码里 `if (assemblyRevId) {...} else {...}` 的 else 分支会在 `state === 'checking'` 时返回"加载中"，因此 compare 分支必须**先于**它 return，否则会被 else 分支拦截。

渲染部分——树面板条件追加 compare，并在 `<ViewerCanvas>` 选择处加分支：

```tsx
      {(asmTree.length > 0 || !!configDisplayTree || !!(compareLeftId && compareRightId) ||
        (!assemblyRevId && !configProfileId && !compareLeftId && loadingState === 'ready')) && (
        <>
          <div style={{ width: treeWidth }} className="shrink-0 h-full">
            {compareLeftId && compareRightId ? <CompareTreePanel /> : <ModelTreePanel />}
          </div>
```

`<ViewerCanvas>` 分支（放在 `configProfileId` 判断之前）：

```tsx
            if (compareLeftId && compareRightId) {
              return <ViewerCanvas source={{ kind: 'compare', leftInstances: cmpLeftInstances, rightInstances: cmpRightInstances }} />;
            }
```

在 `<Toolbar />` 下方、`<div className="flex-1 relative">` 之前插入缺模型提示条：

```tsx
          {compareSlice && compareSlice.leftMissing !== compareSlice.rightMissing && (
            <div className="px-4 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs text-yellow-800">
              {compareSlice.leftMissing ? '左部件' : '右部件'}尚无 3D 模型，仅显示{compareSlice.leftMissing ? '右' : '左'}侧
            </div>
          )}
```

两侧都缺时的兜底，加在画布容器内（与 `<ViewCube />` 同级）：

```tsx
          {compareLeftId && compareRightId && cmpLeftInstances.length === 0 && cmpRightInstances.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center text-gray-500 pointer-events-none">
              两个部件均无 3D 模型
            </div>
          )}
```

进度角标条件放宽到 compare 模式：把现有

```tsx
      {assemblyRevId && streamProgress && streamProgress.loaded < streamProgress.total && (
```

改为

```tsx
      {(assemblyRevId || (compareLeftId && compareRightId)) && streamProgress && streamProgress.loaded < streamProgress.total && (
```

- [ ] **Step 3: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 均无错误

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/STPViewer/ViewerCanvas.tsx frontend/src/pages/STPViewer.tsx
git commit -m "feat(3d-compare): STPViewer 接入 compare 模式与双树面板"
```

---

### Task 9: 工具栏对比控件组

**Files:**
- Modify: `frontend/src/components/STPViewer/Toolbar.tsx`

**Interfaces:**
- Consumes: `viewerStore.compare`、`setDisplayMode` / `setOnlyDiff` / `setGhostOpacity`（Task 4）

- [ ] **Step 1: 加入对比控件组并禁用「上色」**

在 `frontend/src/components/STPViewer/Toolbar.tsx` 中：

在 `const onAutoColor = ...` 之后追加：

```tsx
  const compare = vs.compare;
  const setDisplayMode = vs.setDisplayMode;
  const setOnlyDiff = vs.setOnlyDiff;
  const setGhostOpacity = vs.setGhostOpacity;
  const DISPLAY_MODES = [
    { value: 'both' as const, label: '叠加' },
    { value: 'left' as const, label: '只看左' },
    { value: 'right' as const, label: '只看右' },
  ];
```

在最外层 `<div className="flex items-center gap-3 ...">` 的**第一个子元素位置**（剖切按钮组之前）插入：

```tsx
      {compare && (
        <>
          <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
            {DISPLAY_MODES.map((m, i) => (
              <button
                key={m.value}
                onClick={() => setDisplayMode(m.value)}
                className={`px-2.5 py-1.5 text-sm font-medium transition-colors
                  ${compare.displayMode === m.value ? 'bg-primary-50 text-primary-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}
                  ${i > 0 ? 'border-l border-gray-200' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={compare.onlyDiff}
              onChange={(e) => setOnlyDiff(e.target.checked)}
              className="accent-primary-500"
            />
            仅显示差异
          </label>

          <div className="flex items-center gap-2 text-sm text-gray-500 shrink-0">
            <span className="font-medium">幽灵</span>
            <input
              type="range"
              min={0.02}
              max={0.5}
              step={0.01}
              value={compare.ghostOpacity}
              onChange={(e) => setGhostOpacity(Number(e.target.value))}
              className="w-16 h-1 accent-primary-500"
              title="淡出零件的不透明度"
            />
            <span className="tabular-nums text-gray-400 w-8">{compare.ghostOpacity.toFixed(2)}</span>
          </div>

          <div className="w-px h-5 bg-gray-200 shrink-0" />
        </>
      )}
```

把「上色」按钮改为对比模式下禁用：

```tsx
      <button
        onClick={onAutoColor}
        disabled={!!compare}
        title={compare ? '对比模式下按变更类型着色' : undefined}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${compare
            ? 'text-gray-300 cursor-not-allowed border border-transparent'
            : autoColor
              ? 'bg-blue-50 text-blue-600 border border-blue-200'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        上色
      </button>
```

- [ ] **Step 2: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 均无错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/STPViewer/Toolbar.tsx
git commit -m "feat(3d-compare): 工具栏显示模式/仅显示差异/幽灵透明度控件"
```

---

### Task 10: BOM 对比弹窗入口按钮

**Files:**
- Modify: `frontend/src/components/PartCompareModal.tsx`

**Interfaces:**
- Consumes: 组件内已有的 `leftId` / `rightId`（均为 revision id）

- [ ] **Step 1: 加入按钮**

在 `frontend/src/components/PartCompareModal.tsx` 的按钮行中，`开始对比` 按钮之后、`仅显示差异` 复选框之前插入：

```tsx
            <button
              onClick={() => window.open(`/stp-viewer?compare-left=${leftId}&compare-right=${rightId}`, '_blank')}
              disabled={!leftId || !rightId}
              title="在新标签页中叠加对比两个部件的 3D 模型"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              🧊 3D对比
            </button>
```

> 不要求先点「开始对比」——新页面自己拉取 compare 数据。

- [ ] **Step 2: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 均无错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/PartCompareModal.tsx
git commit -m "feat(3d-compare): BOM 对比弹窗加 3D对比 入口"
```

---

### Task 11: 全量校验与手动验收

**Files:** 无代码改动（如发现问题则回到对应 Task 的文件修复）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS，其中新增 `buildCompareTree` 9 例、`compareRenderRules` 14 例、`compareTreeFilter` 6 例、`viewerStore.compare` 10 例

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 error 0 warning（配置为 `--max-warnings 0`）

- [ ] **Step 3: 构建**

Run: `npm run build`
Expected: 成功产出 dist

- [ ] **Step 4: 手动验收（对照设计文档验收标准逐条走）**

启动开发服务器：

```bash
npm run dev
```

逐条勾选：

- [ ] 零部件管理 → BOM 对比 → 选中左右两个部件，「🧊 3D对比」按钮可点，新标签打开
- [ ] 左侧呈现左右并排、行对齐的两棵树；增删项对侧显示虚线占位 `—`
- [ ] 点行首箭头，左右两侧同时展开/折叠；滚动天然同步
- [ ] 3D 中新增件绿、删除件红、修改件黄（旧版半透明+新版实体）、未变件灰
- [ ] 切到「只看左」：仅左侧实例可见（含未变件与删除件），新增件消失
- [ ] 切到「只看右」：仅右侧实例可见（含未变件与新增件），删除件消失
- [ ] 勾「仅显示差异」：树中未变行消失、含差异子孙的父行保留；3D 中未变件变幽灵而非消失
- [ ] 拖动幽灵滑块，所有淡出零件不透明度实时跟随
- [ ] 点树中任一格 → 两侧行同时高亮、滚动进视野；3D 中左右对应实例同时高亮
- [ ] 点 3D 模型 → 对应配对行选中、祖先自动展开
- [ ] 树中眼睛按钮可单独隐藏某一侧的某个件
- [ ] 剖切 X/Y/Z、测量、爆炸、重置、平行/透视、线框均可用；「上色」置灰且有 tooltip
- [ ] 用一个未导入装配 STEP 的部件做右侧：顶部出现黄色提示条，两棵树仍完整，3D 只显示左侧
- [ ] 回归：`?assembly=<revId>`、`?config-profile=<id>`、附件 STP 预览三种入口行为与改动前一致

- [ ] **Step 5: 提交（若有修复）**

```bash
git add -A
git commit -m "fix(3d-compare): 手动验收问题修复"
```

---

## 完成后

实现完成、验收通过后，使用 `superpowers:finishing-a-development-branch` 决定如何合入（当前分支 `feat/cad_compare`，主分支 `V1.3.1_CHANGE_CONFIG`）。
