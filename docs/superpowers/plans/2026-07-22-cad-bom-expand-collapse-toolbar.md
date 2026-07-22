# CAD BOM 匹配「展开层级」工具栏控件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 BOM 匹配列表工具栏加一个「展开层级」下拉,按层级批量展开/折叠整棵装配树,手动偏离时回显"自定义"。

**Architecture:** 折叠状态复用现有 `collapsedPaths: Set<string>`。把"给定目标层级 → 计算应折叠节点集合"的纯逻辑抽到独立模块 `expandLevel.ts`(可单测),组件只做下拉渲染与状态接线。

**Tech Stack:** React + TypeScript,Vitest(单测),Tailwind(样式)。

设计依据:`docs/superpowers/specs/2026-07-22-cad-bom-expand-collapse-toolbar-design.md`

---

## File Structure

- **Create** `frontend/src/components/CADWorkspace/expandLevel.ts` — 纯函数 `maxLevelOf(rows)`、`buildCollapsedForLevel(rows, k)`。
- **Create** `frontend/src/components/CADWorkspace/expandLevel.test.ts` — Vitest 单测。
- **Modify** `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx` — 引入模块、新增 `expandSel` 状态与 `applyExpandSel`、`toggleCollapse` 末尾置 `'custom'`、汇总栏渲染 `<select>`。

---

## Task 1: 层级折叠纯逻辑模块(TDD)

**Files:**
- Create: `frontend/src/components/CADWorkspace/expandLevel.ts`
- Test: `frontend/src/components/CADWorkspace/expandLevel.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/components/CADWorkspace/expandLevel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maxLevelOf, buildCollapsedForLevel } from './expandLevel';
import type { BOMRow } from './CADBOMMatchTable';

function makeRow(overrides: Partial<BOMRow>): BOMRow {
  return {
    instance_name: '', part_number: '', path: '', level: 0, is_assembly: false,
    quantity: 1, instances: [], doc_path: '', builtin: {}, user_properties: {},
    pdm_match: null, match_status: 'unknown', checkout_status: null, ...overrides,
  };
}

// 树:0(根,有子) → 1(有子) → 2(叶) ; 另一根 0b(叶)
const tree = [
  makeRow({ path: 'a', level: 0 }),
  makeRow({ path: 'a.1', level: 1 }),
  makeRow({ path: 'a.1.2', level: 2 }),
  makeRow({ path: 'b', level: 0 }),
];

describe('maxLevelOf', () => {
  it('返回最大 level', () => {
    expect(maxLevelOf(tree)).toBe(2);
  });
  it('空数组返回 0', () => {
    expect(maxLevelOf([])).toBe(0);
  });
});

describe('buildCollapsedForLevel', () => {
  it('k=0 全部折叠:所有有子节点的行都折叠', () => {
    const s = buildCollapsedForLevel(tree, 0);
    expect([...s].sort()).toEqual(['a', 'a.1']);
  });
  it('k=Infinity 全部展开:空集合', () => {
    expect(buildCollapsedForLevel(tree, Infinity).size).toBe(0);
  });
  it('k=1 只折叠 level>=1 的有子节点', () => {
    const s = buildCollapsedForLevel(tree, 1);
    expect([...s]).toEqual(['a.1']);
  });
  it('k=2 无 level>=2 的有子节点 → 空集合(等价全展开)', () => {
    expect(buildCollapsedForLevel(tree, 2).size).toBe(0);
  });
  it('叶子节点永不进入集合', () => {
    const s = buildCollapsedForLevel(tree, 0);
    expect(s.has('a.1.2')).toBe(false);
    expect(s.has('b')).toBe(false);
  });
  it('空数组返回空集合', () => {
    expect(buildCollapsedForLevel([], 0).size).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/CADWorkspace/expandLevel.test.ts`
Expected: FAIL —— 无法解析 `./expandLevel`(模块不存在)。

- [ ] **Step 3: 实现模块**

创建 `frontend/src/components/CADWorkspace/expandLevel.ts`:

```ts
import type { BOMRow } from './CADBOMMatchTable';

/** 当前行集合的最大层级(0 基);空集合返回 0 */
export function maxLevelOf(rows: BOMRow[]): number {
  return rows.length ? Math.max(...rows.map(r => r.level)) : 0;
}

/**
 * 计算"展开到层级 k"对应的应折叠节点 path 集合。
 * 语义:所有 level >= k 且有子节点的行折叠 → 可见层为 0..k。
 * k=0 全部折叠;k=Infinity 全部展开(返回空集合)。
 * "有子节点"由相邻行判断:下一行 level 更深即为其子(依赖扁平化后的前序顺序)。
 */
export function buildCollapsedForLevel(rows: BOMRow[], k: number): Set<string> {
  const collapsed = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const hasChild = i < rows.length - 1 && rows[i + 1].level > rows[i].level;
    if (hasChild && rows[i].level >= k) collapsed.add(rows[i].path);
  }
  return collapsed;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/CADWorkspace/expandLevel.test.ts`
Expected: PASS —— 8 个断言全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/CADWorkspace/expandLevel.ts frontend/src/components/CADWorkspace/expandLevel.test.ts
git commit -m "feat: CAD BOM匹配层级折叠纯逻辑buildCollapsedForLevel+单测"
```

---

## Task 2: 接线到 CADBOMMatchTable

**Files:**
- Modify: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`

组件本身无单测(与既有 CADBOMMatchTable 一致),本任务以 `tsc` 构建通过为验收,行为在 CATIA 桥接环境手测。

- [ ] **Step 1: 引入模块**

在文件顶部 import 区(现有 `import { flattenTree } from './flattenTree';` 之后)加:

```ts
import { maxLevelOf, buildCollapsedForLevel } from './expandLevel';
```

- [ ] **Step 2: 新增 expandSel 状态**

在 `const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());` 之后加:

```ts
  // 工具栏「展开层级」下拉的受控值:'collapsed' | 'all' | 数字字符串 | 'custom'
  const [expandSel, setExpandSel] = useState<string>('all');
```

- [ ] **Step 3: toggleCollapse 末尾置 'custom'**

把现有 `toggleCollapse` 改为(新增最后一行 `setExpandSel('custom')`):

```ts
  const toggleCollapse = (path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    setExpandSel('custom'); // 手动增删偏离批量层级 → 下拉显示"自定义"
  };
```

- [ ] **Step 4: 新增 maxLevel 派生与 applyExpandSel**

在 `toggleCollapse` 定义之后、`visibleRows` 定义之前加:

```ts
  const maxLevel = maxLevelOf(rows);
  const applyExpandSel = (value: string) => {
    setExpandSel(value);
    if (value === 'custom') return;
    const k = value === 'all' ? Infinity : value === 'collapsed' ? 0 : Number(value);
    setCollapsedPaths(buildCollapsedForLevel(rows, k));
  };
```

- [ ] **Step 5: 汇总栏渲染下拉**

在汇总栏中,把状态药丸块之后的 `<div className="flex-1" />` 这一行**前面**插入下拉(即位于药丸右侧、`flex-1` 撑开之前,属左侧视图控制组):

找到:

```tsx
        <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已签出 {totalCheckedOut}</span>
        <div className="flex-1" />
```

改为:

```tsx
        <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已签出 {totalCheckedOut}</span>
        <label className="flex items-center gap-1 text-xs text-gray-600 ml-1">
          展开层级
          <select
            value={expandSel}
            disabled={maxLevel === 0}
            onChange={e => applyExpandSel(e.target.value)}
            className="border border-gray-300 rounded px-1.5 py-1 text-xs disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="collapsed">全部折叠</option>
            {Array.from({ length: Math.max(0, maxLevel - 1) }, (_, i) => i + 1).map(k => (
              <option key={k} value={String(k)}>L{k}</option>
            ))}
            <option value="all">全部展开</option>
            {expandSel === 'custom' && <option value="custom">自定义</option>}
          </select>
        </label>
        <div className="flex-1" />
```

- [ ] **Step 6: 类型检查 + 构建**

Run: `cd frontend && npm run build`
Expected: `tsc` 无报错,`vite build` 成功产出 dist。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: CAD BOM匹配工具栏「展开层级」下拉(L1/L2…/全部展开折叠/自定义)"
```

---

## Task 3: 部署与手测

**Files:** 无代码改动(部署 + 验证)

- [ ] **Step 1: 构建并热更新 nginx**

Run:
```bash
cd frontend && npm run build && docker exec bom_nginx nginx -s reload
```
Expected: 构建成功,nginx reload 无报错。

- [ ] **Step 2: 手测清单(CATIA 桥接环境,浏览器 Ctrl+F5 强刷)**

- [ ] 多层装配:依次选 全部折叠 / L1 / L2 / 全部展开,可见行随层级正确增减。
- [ ] 选 L2 后手动折叠某行 → 下拉变"自定义";再选 L2 → 恢复到该层级。
- [ ] 单层 BOM(maxLevel=0):下拉禁用、置灰。
- [ ] 批量折叠/展开后,左右两表行高仍对齐、右区横向滚动抬头仍同步。

---

## Self-Review

**Spec coverage:**
- 下拉控件 + 位置(汇总栏左侧)→ Task 2 Step 5 ✓
- 层号语义 Lk=显示到第 k 层、全部折叠/全部展开 → Task 1 `buildCollapsedForLevel` + 测试 ✓
- 选项按 maxLevel 动态生成、L(maxLevel-1) 封顶 → Task 2 Step 5 `Array.from({length: maxLevel-1})` ✓
- 方案 A "自定义"回显 → Task 2 Step 3(toggle 置 custom)+ Step 5(条件渲染 option)✓
- 禁用条件 maxLevel===0 → Task 2 Step 5 `disabled` ✓
- 单趟 O(n)、相邻行判子、避免 indexOf → Task 1 实现 ✓
- 行高同步随 visibleRows 自动触发、不额外处理 → 无需任务(现有 effect 依赖 visibleRows)✓

**Placeholder scan:** 无 TBD/TODO;每个改码步骤均含完整代码。

**Type consistency:** `maxLevelOf`/`buildCollapsedForLevel` 签名在 Task 1 定义,Task 2 调用一致;`expandSel` 取值域('collapsed'|'all'|数字串|'custom')在 Step 2/3/4/5 一致;`applyExpandSel` 的 k 映射与 `buildCollapsedForLevel` 语义一致(0=全折叠,Infinity=全展开)。
