# 前端外观配置扩展与树形统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将字体样式与背景色 token 化并纳入多主题（3 浅色 + 1 深色），统一树形结构的展开折叠符号与缩进量。

**Architecture:** 三层扩展——① `index.css` 新增字体组/背景组/树组 CSS 变量 + 主题覆盖集（forest/warm 背景预设 + dark 深色全量变量集 + 深色灰阶补偿块）；② `components/ui/TreeToggle.tsx` 共享展开折叠组件（SVG chevron + 旋转动画）；③ 存量收敛（26 处树符号 → TreeToggle、12 处缩进公式 → `--ui-tree-indent`、桌面+移动高频表面类 → `var(--ui-*)`）。字号档位用 `@layer utilities` 同名覆盖 `text-xs/sm/base` 实现零业务改动。

**Tech Stack:** React 18 + TypeScript + Tailwind CSS 3 + Vite 5 + Vitest（node 环境）+ CSS 变量

**Spec:** `docs/superpowers/specs/2026-08-22-frontend-appearance-config-design.md`（计划从 spec 论证，执行者两者都读）

## Global Constraints

- 验收门：每任务 `cd frontend && npm run build` PASS；涉及逻辑的任务 `cd frontend && npm run test` PASS（node 环境，`src/**/*.test.ts`）
- 颜色/字体/背景值只允许出现在 `index.css`（:root 与 `html[data-theme=...]` 覆盖块）；业务代码只用 `var(--ui-*)` 引用或保持豁免硬编码
- 徽标语义色在浅色主题间稳定；深色下用深色版变量（色相保持）
- 树形符号 `▶▼▾▸` 业务代码最终 0 处（TreeToggle 内部除外）；缩进步长统一 `--ui-tree-indent: 14px`
- 提交信息中文 `type: 描述` 风格
- 豁免类（diff 行底色 red-50/green-50、时间线点、状态色、toast、进度条、头像、选中态 tab 等）保留硬编码并登记
- `frontend/src/mobile/components/MobileCardList.tsx`（未提交并行工作）与 `_verify_status.py`（未跟踪）禁止触碰
- Sandbox 提示：subagent 沙箱可能阻止 `npm run build`（esbuild EPERM）——记录错误并报"请控制器复跑"，禁止重试或绕过

---

### Task 1: index.css :root 变量层（字体组/背景组/树组）

**Files:**
- Modify: `frontend/src/index.css`（`:root` 块末尾追加）

**Interfaces:**
- Produces: 16 个新变量供 Task 2/3/4 与后续所有任务引用（`--ui-font-family`、`--ui-font-scale`、`--ui-font-size-sm/base/lg`、`--ui-line-height`、`--ui-bg-page/surface/subtle/hover`、`--ui-border`、`--ui-text-primary/secondary/tertiary`、`--ui-tree-indent`）

- [ ] **Step 1: 在 `:root` 末尾（`--ui-input-disabled-text` 行后）追加变量块**

```css
  /* ===== 外观配置 ui 变量 ===== */
  /* 字体组 */
  --ui-font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  --ui-font-scale: 1;
  --ui-font-size-sm: 12px;
  --ui-font-size-base: 14px;
  --ui-font-size-lg: 16px;
  --ui-line-height: 1.5;
  /* 背景组 */
  --ui-bg-page: #f5f5f5;
  --ui-bg-surface: #ffffff;
  --ui-bg-subtle: #f9fafb;
  --ui-bg-hover: #f3f4f6;
  --ui-border: #e5e7eb;
  --ui-text-primary: #111827;
  --ui-text-secondary: #6b7280;
  --ui-text-tertiary: #9ca3af;
  /* 树组 */
  --ui-tree-indent: 14px;
```

- [ ] **Step 2: build 验证**

Run: `cd frontend && npm run build`
Expected: PASS（exit 0，仅既有 chunk 警告）

- [ ] **Step 3: 提交**

```bash
git add frontend/src/index.css
git commit -m "style: 外观配置变量层（字体/背景/树缩进 token）"
```

---

### Task 2: 浅色主题预设（forest/warm 背景微差）

**Files:**
- Modify: `frontend/src/index.css`（现有 `html[data-theme='forest']` / `html[data-theme='warm']` 块内追加）

**Interfaces:**
- Consumes: Task 1 变量
- Produces: forest/warm 两主题的背景预设（供 Task 11 验收四主题切换）

- [ ] **Step 1: 两个主题覆盖块追加背景组变量**

在现有 forest 块末尾（`--color-primary` 行后）追加：

```css
  /* 背景预设（浅色主题微差） */
  --ui-bg-page: #f4f7f5;
  --ui-bg-surface: #ffffff;
  --ui-bg-subtle: #f0f5f1;
  --ui-bg-hover: #e8efe9;
  --ui-border: #e2e8e4;
  --ui-text-secondary: #5b6b60;
  --ui-text-tertiary: #8fa094;
```

在 warm 块末尾同样追加：

```css
  /* 背景预设（浅色主题微差） */
  --ui-bg-page: #faf7f5;
  --ui-bg-surface: #fffdfb;
  --ui-bg-subtle: #f6f1ed;
  --ui-bg-hover: #efe7e1;
  --ui-border: #ece3dd;
  --ui-text-secondary: #6e6158;
  --ui-text-tertiary: #a3948a;
```

（`--ui-text-primary` 两主题保持 :root 值 `#111827`，不覆盖。）

- [ ] **Step 2: build 验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/index.css
git commit -m "style: 森林绿/酒红主题背景预设"
```

---

### Task 3: 深色主题变量集 + 灰阶补偿块

**Files:**
- Modify: `frontend/src/index.css`（`html[data-theme='warm']` 块后追加）

**Interfaces:**
- Produces: `html[data-theme='dark']` 全量深色变量集 + 深色灰阶补偿规则（Task 10 注册 dark 主题后生效）

- [ ] **Step 1: 追加深色变量集与补偿块**

```css
/* ===== 深色主题（黑夜模式） ===== */
html[data-theme='dark'] {
  /* 背景组 */
  --ui-bg-page: #0f172a;  --ui-bg-surface: #1e293b;
  --ui-bg-subtle: #334155; --ui-bg-hover: #475569;
  --ui-border: #334155;
  --ui-text-primary: #f8fafc; --ui-text-secondary: #cbd5e1; --ui-text-tertiary: #94a3b8;
  /* 徽标 9 组深色版（bg 半透明、text 亮色，色相保持） */
  --ui-blue-bg: rgba(59,130,246,.15);   --ui-blue-text: #93c5fd;
  --ui-orange-bg: rgba(249,115,22,.15); --ui-orange-text: #fdba74;
  --ui-green-bg: rgba(34,197,94,.15);   --ui-green-text: #86efac;
  --ui-red-bg: rgba(239,68,68,.15);     --ui-red-text: #fca5a5;
  --ui-gray-bg: rgba(148,163,184,.18);  --ui-gray-text: #cbd5e1;
  --ui-amber-bg: rgba(245,158,11,.15);  --ui-amber-text: #fcd34d;
  --ui-teal-bg: rgba(20,184,166,.15);   --ui-teal-text: #5eead4;
  --ui-purple-bg: rgba(168,85,247,.15); --ui-purple-text: #d8b4fe;
  --ui-indigo-bg: rgba(99,102,241,.15); --ui-indigo-text: #c7d2fe;
  /* 按钮 */
  --ui-btn-primary-bg: #0284c7; --ui-btn-primary-hover: #0369a1;
  --ui-btn-primary-active: #075985; --ui-btn-primary-text: #ffffff;
  --ui-btn-secondary-bg: #1e293b; --ui-btn-secondary-hover: #334155;
  --ui-btn-secondary-border: #475569; --ui-btn-secondary-text: #e2e8f0;
  --ui-btn-ghost-bg: #334155; --ui-btn-ghost-hover: #475569;
  --ui-btn-ghost-text: #e2e8f0;
  --ui-btn-danger-bg: #dc2626; --ui-btn-danger-hover: #ef4444;
  --ui-btn-danger-active: #b91c1c; --ui-btn-danger-text: #ffffff;
  --ui-btn-success-bg: #16a34a; --ui-btn-success-hover: #22c55e;
  --ui-btn-success-text: #ffffff;
  --ui-btn-dark-bg: #475569; --ui-btn-dark-hover: #64748b;
  --ui-btn-dark-text: #ffffff;
  --ui-btn-link-text: #38bdf8; --ui-btn-link-hover: #7dd3fc;
  /* 表单 */
  --ui-input-bg: #0f172a; --ui-input-border: #475569;
  --ui-input-text: #e2e8f0; --ui-input-placeholder: #64748b;
  --ui-input-focus-ring: #38bdf8; --ui-input-focus-border: #38bdf8;
  --ui-input-disabled-bg: #1e293b; --ui-input-disabled-text: #64748b;
  /* 树缩进/字体组不覆盖（与主题无关） */
}

/* 深色灰阶补偿块（specificity (0,2,0) > Tailwind 类 (0,1,0)，仅深色生效） */
html[data-theme='dark'] .text-gray-800,
html[data-theme='dark'] .text-gray-700 { color: #cbd5e1; }
html[data-theme='dark'] .text-gray-600,
html[data-theme='dark'] .text-gray-500 { color: #94a3b8; }
html[data-theme='dark'] .text-gray-400 { color: #94a3b8; }
html[data-theme='dark'] .text-gray-300 { color: #64748b; }
html[data-theme='dark'] .bg-gray-50 { background-color: #334155; }
html[data-theme='dark'] .bg-gray-100 { background-color: #334155; }
html[data-theme='dark'] .bg-gray-200 { background-color: #475569; }
html[data-theme='dark'] .border-gray-100,
html[data-theme='dark'] .border-gray-200,
html[data-theme='dark'] .border-gray-300 { border-color: #334155; }
html[data-theme='dark'] .hover\:bg-gray-50:hover { background-color: #334155; }
html[data-theme='dark'] .hover\:bg-gray-100:hover { background-color: #334155; }
html[data-theme='dark'] .hover\:bg-gray-200:hover { background-color: #475569; }
```

- [ ] **Step 2: 验证 divide 灰线类在深色下的表现**

`divide-gray-100/200` 生成在子元素 `> :not([hidden]) ~ :not([hidden])` 上；若深色下分隔线仍为浅色，追加：

```css
html[data-theme='dark'] .divide-gray-100 > :not([hidden]) ~ :not([hidden]),
html[data-theme='dark'] .divide-gray-200 > :not([hidden]) ~ :not([hidden]) { border-color: #334155; }
```

验证方式：build 后人工检查 dist CSS 中 divide 类选择器结构（grep `divide-gray`）。

- [ ] **Step 3: build 验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/index.css
git commit -m "style: 深色主题变量集与灰阶补偿块"
```

---

### Task 4: 字体机制（utilities 覆盖 + body 应用 + dist 顺序实测）

**Files:**
- Modify: `frontend/src/index.css`（body 规则 + 文件末尾追加 `@layer utilities`）

**Interfaces:**
- Consumes: Task 1 字体变量
- Produces: 字号档位运行时切换机制（零业务改动）；**本任务必须先实测 dist CSS 顺序再定稿**

- [ ] **Step 1: 改写 body 规则**

将现有 body 规则改为：

```css
body {
  font-family: var(--ui-font-family);
  font-size: calc(var(--ui-font-size-lg) * var(--ui-font-scale));
  line-height: var(--ui-line-height);
  color: var(--ui-text-primary);
  background-color: var(--ui-bg-page);
}
```

（注意：`--color-text`/`--color-bg` 定义保留但 body 不再引用；`--ui-bg-page` 与 `--color-bg` 同值 `#f5f5f5`，body 底色观感不变。）

- [ ] **Step 2: 追加 utilities 覆盖**

在 `index.css` 文件末尾追加：

```css
/* 字号档位：Tailwind 固定值类改为读 var，主题可整体缩放（浅色值 = 原值） */
@layer utilities {
  .text-xs   { font-size: var(--ui-font-size-sm); }
  .text-sm   { font-size: var(--ui-font-size-base); }
  .text-base { font-size: var(--ui-font-size-lg); }
}
```

- [ ] **Step 3: build 后实测 dist CSS 顺序（关键风险验证）**

Run: `cd frontend && npm run build`
Then: `grep -o '\.text-xs{[^}]*}' frontend/dist/assets/*.css`

检查规则体：若 `.text-xs` 最终为 `font-size: var(--ui-font-size-sm)`（即我们的覆盖在 Tailwind 之后生效）→ 通过；若为 `font-size:.75rem`（原生在覆盖之后）→ **对三个类加 `!important`**（`font-size: var(--ui-font-size-sm) !important;` 等）并重跑 build 复验。同时确认 `text-sm`/`text-base` 同理。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/index.css
git commit -m "style: 字号档位 utilities 覆盖与 body 字体变量化"
```

---

### Task 5: TreeToggle 共享组件

**Files:**
- Create: `frontend/src/components/ui/TreeToggle.tsx`
- Test: `frontend/src/components/ui/TreeToggle.test.ts`（如组件导出纯常量则测常量；否则跳过单测，build + 人工验收）

**Interfaces:**
- Produces: `TreeToggle`（default export，forwardRef），props 供 Task 6/7 全部存量收敛使用：

```ts
interface TreeToggleProps {
  expanded: boolean;
  onClick?: () => void;
  loading?: boolean;   // 显示 ⋯ 动画替代 chevron
  leaf?: boolean;      // 无子节点：透明占位保持对齐，不响应点击
  size?: 'sm' | 'md';  // sm: 图标 w-3.5 h-3.5 / 点区 w-4 h-4；md: w-4 h-4 / w-5 h-5
  title?: string;
  disabled?: boolean;
}
```

- [ ] **Step 1: 创建组件**

```tsx
import { forwardRef } from 'react';

interface TreeToggleProps {
  expanded: boolean;
  onClick?: () => void;
  loading?: boolean;
  leaf?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  disabled?: boolean;
}

const TreeToggle = forwardRef<HTMLButtonElement, TreeToggleProps>(
  ({ expanded, onClick, loading, leaf, size = 'md', title, disabled }, ref) => {
    const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
    const hitSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    if (leaf) {
      return <span className={`${hitSize} inline-flex items-center justify-center shrink-0`} aria-hidden="true" />;
    }
    return (
      <button
        ref={ref}
        type="button"
        title={title}
        disabled={disabled || loading}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        aria-expanded={expanded}
        className={`${hitSize} inline-flex items-center justify-center shrink-0 rounded text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-input-focus-ring)]`}
      >
        {loading ? (
          <span className="text-xs animate-pulse">⋯</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${iconSize} transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </button>
    );
  }
);
TreeToggle.displayName = 'TreeToggle';
export default TreeToggle;
```

- [ ] **Step 2: 可选单测（组件导出纯常量才测；无则跳过）**

组件不导出纯函数常量，跳过单测（node 环境无 jsdom 测渲染），验收依赖 build + Task 6/7 集成 + Task 11 人工验收。

- [ ] **Step 3: build 验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/ui/TreeToggle.tsx
git commit -m "feat: 树形展开折叠共享组件 TreeToggle（SVG chevron + 旋转动画）"
```

---

### Task 6: 桌面树形收敛（符号 + 缩进）

**Files:** Modify（逐个读取确认行号后替换，清单来自 spec 现状调查，行号可能偏移）:
- `frontend/src/components/ArchiveTreeModal.tsx`（:44 符号、:42 缩进 `16 + depth*20`）
- `frontend/src/components/AssemblyPartPicker.tsx`（:338）
- `frontend/src/components/Configuration/ConfigItemPicker.tsx`（:160）
- `frontend/src/components/Configuration/ConfigurationCreateModal.tsx`（:589）
- `frontend/src/components/Configuration/ProfileCompareModal.tsx`（:171）
- `frontend/src/components/Configuration/ConfigurationDetailModal.tsx`（:193/240/282）
- `frontend/src/components/ECO/ECOCreateModal.tsx`（:823）
- `frontend/src/components/ECO/ECOEditView.tsx`（:101）
- `frontend/src/components/ECO/ECODetailModal.tsx`（:534）
- `frontend/src/components/ECR/ECRBomImpactView.tsx`（:264）
- `frontend/src/pages/Board.tsx`（:658 符号、:653 缩进 `depth*16+8`）
- `frontend/src/pages/BOM/BomWhereUsedTree.tsx`（:152）
- `frontend/src/components/PartDetailModal.tsx`（:358 缩进 `8 + level*12`）
- `frontend/src/components/Configuration/ConfigItemDetailModal.tsx`（:252 缩进）
- `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`（:882 缩进 `8 + row.level*12`）
- `frontend/src/components/STPViewer/CompareTreePanel.tsx`（:53/70/117 缩进 `8 + indent`）
- `frontend/src/components/STPViewer/ModelTreePanel.tsx`（:73 缩进）

**Interfaces:**
- Consumes: Task 5 `TreeToggle`
- Produces: 桌面树符号/缩进统一（`--ui-tree-indent` 生效）

- [ ] **Step 1: 逐文件替换符号**

规则：`{expanded ? '▼' : '▶'}` 类三元 → `<TreeToggle expanded={expanded} onClick={toggle} size={行高紧凑? 'sm' : 'md'} />`；保留原 onClick（含 `e.stopPropagation()` 的改为 TreeToggle 内部已 stopPropagation，onClick 只传原逻辑）；无子节点条件渲染处用 `leaf` prop（如 `hasChildren ? <TreeToggle …/> : <TreeToggle leaf …/>` 或条件不渲染但用 leaf 占位保对齐）。加载态 `⋯` → `loading` prop。删除原符号 span/button 的尺寸/颜色类（TreeToggle 自带）。

- [ ] **Step 2: 缩进公式统一**

- `depth*16+8` → `paddingLeft: 8 + depth * var(--ui-tree-indent)`（表格型基准 8 保持，步长换 token）
- `16 + depth*20` → `paddingLeft: 16 + depth * var(--ui-tree-indent)`
- `8 + level*12` → `paddingLeft: 8 + (level - 1) * var(--ui-tree-indent)`（保持原基准语义）
- `8 + row.level*12` → `paddingLeft: 8 + row.level * var(--ui-tree-indent)`
- `8 + indent`（CompareTreePanel/ModelTreePanel，indent 为外部传入）→ 保持公式，indent 计算处改用 `level * var(--ui-tree-indent)` 语义（读文件确认 indent 来源后对齐）

TS 中 `var(--x)` 用于内联 style 时写字符串 `\`paddingLeft: 8 + depth * var(--ui-tree-indent)\``。

- [ ] **Step 3: build + 自检**

Run: `cd frontend && npm run build`
Expected: PASS；grep 桌面 src（`--include=*.tsx`，排除 components/ui/）`▼|▶|▾|▸` 预期 0 处（TaskEditModal `▶ 开始任务` 与 DocumentTab `▾` 属豁免文案，保留并登记）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components frontend/src/pages
git commit -m "style: 桌面树形展开折叠符号与缩进统一（TreeToggle + tree-indent token）"
```

---

### Task 7: 移动端树形收敛

**Files:** Modify:
- `frontend/src/mobile/components/BomTree.tsx`（:115 符号+loading、:169/174/179 缩进）
- `frontend/src/mobile/components/ConfigTree.tsx`（:85 符号+loading、:130/135/140 缩进）
- `frontend/src/mobile/pages/BomComparePage.tsx`（:510）
- `frontend/src/mobile/pages/BoardPage.tsx`（:297）
- `frontend/src/mobile/pages/Project/TaskRowCells.tsx`（:39/43）
- `frontend/src/mobile/pages/UsersListPage.tsx`（:305）
- `frontend/src/mobile/pages/ProjectsPage.tsx`（:112 `•` 叶子 → leaf 占位）
- `frontend/src/mobile/pages/GanttPage.tsx`（:162/169 缩进 `t.depth*10`）

**Interfaces:**
- Consumes: Task 5 `TreeToggle`
- Produces: 移动树符号/缩进统一

- [ ] **Step 1: 逐文件替换符号**（同 Task 6 规则；移动端行高紧凑用 `size="sm"` 处保留原紧凑观感）

- [ ] **Step 2: 缩进公式统一**

- BomTree/ConfigTree：`(depth+1)*INDENT + BTN` → 保持公式结构，`INDENT` 常量值改为 `var(--ui-tree-indent)` 语义（读文件确认 INDENT 定义后统一为 14px 或 `var(--ui-tree-indent)`；BTN 常量保持）
- GanttPage：`t.depth*10` → `t.depth * var(--ui-tree-indent)`

- [ ] **Step 3: build + 自检**

Run: `cd frontend && npm run build`
Expected: PASS；grep mobile（排除 components/ui/）`▼|▶|▾|▸|⋯|•` 树上下文 0 处。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/mobile
git commit -m "style: 移动端树形展开折叠符号与缩进统一"
```

---

### Task 8: 桌面背景类替换 A（零部件/图文档/BOM/构型/ECR/ECO）

**Files:** Modify: `frontend/src/components/`（PartDetailModal/、DocumentDetailModal/、BOMTreeTable、BomWhereUsedTree、PartCompareModal、PartWhereUsedTab、DocWhereUsedTab、EntityEditModal、EntityDocumentSection、VersionHistory、VersionSelectModal、PartDetailContent、AssemblyDetailContent、DocumentDetailContent、AssemblyPartPicker、DocumentPicker、ECPicker、Configuration/、ECR/、ECO/、CADWorkspace/ 等）与 `frontend/src/pages/`（PartsPage、Documents、EC、Configuration、BOM/）

**Interfaces:**
- Consumes: Task 1 背景变量
- Produces: 桌面 A 组文件高频表面类 token 化（Task 11 验收深色无大面积残留的前提）

- [ ] **Step 1: grep 生成清单**

Run（在 `frontend/src`）:
```
--include=*.tsx --include=*.ts -e 'bg-white' -e 'bg-gray-50' -e 'hover:bg-gray-100' -e 'hover:bg-gray-50' -e 'border-gray-200' -e 'text-gray-900' -e 'text-gray-600' -e 'text-gray-500' -e 'text-gray-400'
```
按本任务文件清单过滤。

- [ ] **Step 2: 按映射表替换（仅本任务文件）**

| 原类 | 替换为 |
|---|---|
| `bg-white` | `bg-[var(--ui-bg-surface)]` |
| `bg-gray-50` | `bg-[var(--ui-bg-subtle)]` |
| `hover:bg-gray-100` / `hover:bg-gray-50` | `hover:bg-[var(--ui-bg-hover)]` |
| `border-gray-200` | `border-[var(--ui-border)]` |
| `text-gray-900` | `text-[var(--ui-text-primary)]` |
| `text-gray-600` / `text-gray-500` | `text-[var(--ui-text-secondary)]` |
| `text-gray-400` | `text-[var(--ui-text-tertiary)]` |

**豁免（保留并登记）**：`bg-red-50`/`bg-green-50` 等状态色 diff 行、时间线点 `bg-*-500`、toast 色、进度条、头像、`bg-gray-100` 次级面（如 tab 未选中/输入禁用以外的次级面——逐处判断）、`text-gray-700`/`text-gray-800`（未 token 化强调色）、`divide-gray-*`、`bg-white/` 半透明（逐处判断）、`components/ui/` 与 `constants/` 内部（本轮不动）。每处豁免在提交说明/报告登记（文件:行+理由）。

- [ ] **Step 3: build + 自检**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components frontend/src/pages
git commit -m "style: 背景表面类 token 化（零部件/图文档/BOM/构型/ECR/ECO）"
```

---

### Task 9: 桌面背景类替换 B（库存/项目/用户/看板/通知/设置/数据/杂项/共享组件）

**Files:** Modify: `frontend/src/components/`（Inventory/、Modal、Toast、Loading、NotificationBell、ImportPreviewModal、ArchiveTreeModal、FeishuBindPanel、WechatBindPanel、CustomFieldInput、assistant/、STPViewer/ 面板、PartAttachmentBucket、ComponentAttachmentBucket 等）与 `frontend/src/pages/`（Inventory、Project/、Users、Logs、Notifications、Settings、DataManagement、Board、Dashboard/、Help、PendingApproval、Login、ForcePasswordChange、FeishuCallback、WechatCallback）与 `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: Task 1 背景变量
- Produces: 桌面 B 组文件 token 化

- [ ] **Step 1: 同 Task 8 Step 1 grep，按本任务文件清单过滤**

- [ ] **Step 2: 同 Task 8 Step 2 映射表替换（豁免登记）**

注意：Login/FeishuCallback/WechatCallback/ForcePasswordChange 与共享组件（Modal/Toast/Layout）也替换；`components/ui/` 内部不替换。

- [ ] **Step 3: build + 自检**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components frontend/src/pages
git commit -m "style: 背景表面类 token 化（库存/项目/用户/看板/设置/共享组件）"
```

---

### Task 10: 移动端背景替换 + dark 主题注册 + 选择器分组

**Files:**
- Modify: `frontend/src/mobile/`（全部 .tsx/.ts，规则同 Task 8/9）
- Modify: `frontend/src/lib/theme.ts`（THEMES 加 dark）
- Modify: `frontend/src/lib/theme.test.ts`（THEMES 断言更新）
- Modify: `frontend/index.html`（防闪烁脚本允许集合）
- Modify: `frontend/src/pages/Settings.tsx`（主题选择 UI 分组）
- Modify: `frontend/src/mobile/pages/MorePage.tsx`（主题选择 UI 分组）

**Interfaces:**
- Consumes: Task 3 深色 CSS、Task 1 背景变量
- Produces: dark 主题可切换；移动端背景 token 化

- [ ] **Step 1: mobile/ 背景类替换（同 Task 8 映射 + 豁免登记）**

- [ ] **Step 2: theme.ts 注册 dark**

THEMES 追加：

```ts
{ key: 'dark', label: '深色', desc: '黑夜模式，暗色护眼界面', swatch: '#111827' },
```

`isThemeKey` 由 THEMES 驱动自动覆盖，无需改动逻辑。

- [ ] **Step 3: theme.test.ts 更新**

在 `THEMES 包含 default 且至少 3 个主题` 用例中把 `>= 3` 改为 `>= 4`，并新增断言：

```ts
expect(THEMES.some((t) => t.key === 'dark')).toBe(true);
expect(isThemeKey('dark')).toBe(true);
```

- [ ] **Step 4: index.html 防闪烁脚本允许集合加 'dark'**

```js
if (t === 'forest' || t === 'warm' || t === 'dark') {
```

- [ ] **Step 5: Settings.tsx / MorePage.tsx 主题选择 UI 分组**

将现有 THEMES.map 平铺改为分组渲染：`浅色` 组（default/forest/warm）+ `深色` 组（dark），组间加分组标签（`<div className="text-xs text-[var(--ui-text-tertiary)] mb-2">浅色</div>` 等）；选中高亮/交互不变。

- [ ] **Step 6: 测试 + build**

Run: `cd frontend && npm run test`
Expected: PASS（含更新后的 theme 测试）
Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add frontend/src/mobile frontend/src/lib frontend/index.html frontend/src/pages/Settings.tsx
git commit -m "feat: 深色主题注册与移动端背景 token 化，主题选择按浅色/深色分组"
```

---

### Task 11: 全量验收

**Files:**
- Modify: `docs/superpowers/plans/2026-08-22-frontend-appearance-config.md`（追加「## 验收记录 (2026-08-22)」）
- Modify: `docs/superpowers/specs/2026-08-22-frontend-appearance-config-design.md`（如有结论性补充）

**Interfaces:**
- Consumes: Task 1-10 全部产出
- Produces: 验收记录提交

- [ ] **Step 1: build + test**

Run: `cd frontend && npm run build` → PASS；`cd frontend && npm run test` → PASS

- [ ] **Step 2: grep 校验**

Run（`frontend/src`，排除 `components/ui/` 与 `constants/`）:
1. `▼|▶|▾|▸` → 预期 0 处（豁免：TaskEditModal `▶ 开始任务`、DocumentTab `▾` 下拉，登记）
2. `bg-white|bg-gray-50|hover:bg-gray-100|hover:bg-gray-50|border-gray-200|text-gray-900|text-gray-600|text-gray-500|text-gray-400` → 剩余命中逐条分类：豁免（diff 行、状态色、未 token 灰阶、ui/ 内部）登记，非豁免 FAIL 上报
3. `var\(--ui-tree-indent\)` 应出现于全部树组件

- [ ] **Step 3: 四主题逐页抽查（代码级）**

- 桌面：零部件/图文档/ECR/ECO/构型/库存/项目/用户/看板/通知/设置/数据管理/日志/登录 各页 Badge/Button/Input 正常；`data-theme` 切换时（在 DevTools 手动设 `document.documentElement.dataset.theme='dark'`）检查：页面底/卡片/文字/边框/表格斑马纹/弹窗/表单/徽标均深色适配；状态色（diff 行/时间线点/toast）保持语义色（预期）
- 移动：零部件/图文档/EC/构型/库存/项目/任务/通知/更多/看板 同上
- 树：全部树组件展开/折叠正常（旋转动画、loading、leaf 占位、表格对齐不破坏）
- 三浅色主题预设（forest/warm 背景微差）肉眼/代码确认生效

- [ ] **Step 4: 豁免登记汇总 + 验收记录**

将 Step 2 分类结果与豁免登记（Task 8/9/10 累计）整理进计划文档「## 验收记录 (2026-08-22)」：build/test 结果、grep 汇总、四主题抽查表、豁免清单、深色残余说明。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/plans/2026-08-22-frontend-appearance-config.md docs/superpowers/specs/2026-08-22-frontend-appearance-config-design.md
git commit -m "docs: 外观配置与树形统一验收通过，补充验收记录"
```

---

## Self-Review 记录

- **Spec 覆盖**：字体组/背景组/树组变量（T1）、浅色预设（T2）、深色集+灰阶补偿（T3）、字体 utilities+dist 实测（T4）、TreeToggle（T5）、桌面树（T6）、移动树（T7）、背景 A/B（T8/T9）、移动背景+dark 注册+UI 分组（T10）、验收（T11）——spec 全部章节有对应任务；二期预留（字号独立项、深色残余状态色）明确不在本轮。
- **占位符扫描**：无 TBD/TODO；Task 6/7 行号来自 spec 现状调查（实施时以读文件为准，计划已注明）。
- **类型一致性**：`TreeToggle` props（expanded/onClick/loading/leaf/size/title/disabled）在 T5 定义、T6/T7 消费，一致；变量名 `--ui-tree-indent`/`--ui-bg-surface` 等在 T1 定义、T2/T3/T4/T6-T11 引用，一致；主题 key `'dark'` 在 T3 CSS 与 T10 注册一致。

---

## 验收记录 (2026-08-22)

**验收范围**：Task 1-10b 全部产出（CSS 变量 + 3 浅色预设 + 深色集与灰阶补偿 + 字体 utilities + TreeToggle + 桌面/移动树收敛 + 背景 A/B 替换 + dark 注册 + 选择器分组 + 清单外残留补做）。
**验收性质**：代码级（无浏览器环境，视觉渲染未实测，见 §4 与 §6）。

### 1. 构建与测试

| 项 | 结果 |
|---|---|
| `cd frontend && npm run build` | **PASS**（`tsc && vite build`，1206 modules，✓ built in 11.78s；仅既有 chunk>500kB 与 StpViewerPage 动态/静态双导入警告，非新增错误） |
| `cd frontend && npm run test` | **PASS**（Vitest run，24 测试文件 / **162 用例全部通过**，含 theme.test.ts 3 例；1.96s） |

### 2. grep 校验汇总（`frontend/src`，排除 `components/ui/`、`constants/`）

#### 2a. 树符号 `▼|▶|▾|▸`（字面字符）→ 3 处，全为豁免文案
- `pages/Project/TaskEditModal.tsx:690` `▶ 开始任务`、`:705` `▶ 恢复任务`
- `components/Inventory/DocumentTab.tsx:135` `+ 新建单据 ▾`
- ⚠️ **补充发现（字面 grep 漏检）**：`components/BOMTreeTable.tsx:145/:212` 以 `'\u25BC'`/`'\u25B6'` 转义渲染 ▼/▶ 树符号——真实遗留，见 §7 违规 #1。

#### 2b. 目标表面类（9 类含变体）→ 10 处 / 3 文件，全部归类，非豁免 FAIL = 0
- `index.css:148-158`（6 处）— 深色灰阶补偿规则定义（设计，豁免）
- `components/ECR/ECRReviewPanel.tsx:111`（1 处）`bg-white/60` — Task 8 豁免注释框
- `mobile/components/MobileCardList.tsx:17/19/20`（3 处）`bg-white`/`text-gray-900`/`text-gray-500` — 并行未提交工作文件，非本计划产物（不视为违规）

#### 2c. `var(--ui-tree-indent)` → 33 处 / 17 文件；清单 15 组件中 13 个已用
- ✓ PartCompareModal / PartDetailModal / ConfigItemDetailModal / CADBOMMatchTable / CompareTreePanel / ModelTreePanel / BomTree / ConfigTree / BomComparePage / BoardPage / ProjectsPage / GanttPage / Board
- ✗ **BOMTreeTable** — 无该变量（层级列用 `'-'.repeat(level)` 连字符徽标表达层级，无像素缩进）→ §7 违规 #2
- ✗ **BomWhereUsedTree** — 无该变量（扁平反查表，行内展示父项，无深度缩进布局；符号已转 TreeToggle）→ §7 清单偏差 #3

### 3. 四主题逐页抽查（代码级）

- **THEMES 4 条目** ✓：`src/lib/theme.ts`（default 默认蓝 / forest 森林绿 / warm 酒红 / dark 深色，各含 label+swatch）
- **主题选择器分组** ✓：Settings.tsx:471-480（浅色 default/forest/warm + 深色 dark 两组）、MorePage.tsx:74-85（同两组）
- **Badge/Button/Input 组件化**（bg sweep 无回归）✓：
  - 桌面：零部件 PartsPage ✓ / 图文档 Documents ✓ / ECR+ECO（EC.tsx→ECRList/ECOList）✓ / 构型（Configuration.tsx→ConfigurationList）✓ / 库存（Inventory.tsx→WarehouseTab）✓ / 项目 Projects ✓ / 用户 Users ✓ / 看板 Board ✓ / 通知 Notifications ✓（原生 `<button>` 为既有设计，非本计划回归；类已 token 化）/ 设置 Settings ✓ / 数据管理 DataManagement ✓ / 日志 Logs ✓ / 登录 Login ✓ / 阅读器 OfficeReader ✓（sheet 页签原生 button 为既有设计；bg 已 token 化）
  - 移动：零部件 PartsListPage/PartDetailPage ✓ / 图文档 DocumentsListPage/DocumentDetailPage ✓ / EC EcPage ✓ / 构型 ConfigurationItemsPage/ConfigurationProfilesPage/ConfigItemDetailPage ✓ / 库存 InventoryPage ✓ / 项目 ProjectsPage ✓ / 任务 TaskDetailPage/GanttPage ✓ / 通知 NotificationsPage ✓ / 更多 MorePage ✓（含主题分组）/ 看板 BoardPage ✓
- **树组件**：TreeToggle 22 文件消费（SVG chevron、`rotate-90` 旋转动画、`loading ⋯`、leaf 占位、内部 stopPropagation、aria-expanded）✓；缩进统一 `--ui-tree-indent: 14px`（BOMTreeTable/BomWhereUsedTree 除外，见 2c）
- **三浅色主题预设** ✓：index.css `:root`（默认背景组）+ `html[data-theme='forest']`（:79-86 背景预设）+ `html[data-theme='warm']`（:97-103 背景预设）均生效

### 4. 深色模式（代码级）

- `html[data-theme='dark']` 块（index.css:107-143）覆盖：**背景组**（bg-page/surface/subtle/hover、border、text-primary/secondary/tertiary）、**徽标 9 组深色版**（blue/orange/green/red/gray/amber/teal/purple/indigo，半透明 bg + 亮色 text，色相保持）、**按钮**（primary/secondary/ghost/danger/success/dark/link 全 variant）、**表单**（input bg/border/text/placeholder/focus-ring/focus-border/disabled）✓
- **灰阶补偿块**（index.css:146-164）：text-gray-300/400/500/600/700/800、bg-gray-50/100/200、border-gray-100/200/300、hover:bg-gray-50/100/200、divide-gray-100/200 ✓（specificity (0,2,0) > Tailwind 类 (0,1,0)）
- **表面 token 应用**：`bg-[var(--ui-bg-surface)]` 全 src 214 处（桌面 + 移动均 >0）✓
- ⚠️ 实际视觉渲染（斑马纹/弹窗/表单/徽标可读性）无法在无浏览器环境验证——记录为**代码级验收**；需控制器/PM 用 DevTools `document.documentElement.dataset.theme='dark'` 逐页确认。

### 5. 豁免登记（汇总，Task 5/6/7/8/9/10/10b 累计 + 本次确认）

| 类别 | 明细 |
|---|---|
| 树符号豁免文案 | TaskEditModal:690/705、DocumentTab:135 |
| 半透明注释框 | ECRReviewPanel:111 `bg-white/60` |
| `bg-gray-100` 次级面 | ProfileEditModal:1023,1056、ECRAffectedItemPicker:188、assistant/cards/TableCard:9、MessageList:27、ModelTreePanel:112、Board:794、PendingApproval:49、Settings:531,593、Help:61、tiles:69、DeliverableModal:208、SharedLeftPanel:54,94、MarkdownReader:105、OfficeReader:65 等 |
| 状态色/装饰 | diff 行（green/red/yellow/orange/blue-50）、时间线点 bg-*-500、toast 变体（Toast:68-71）、进度条（bg-gray-200 轨道 + bg-blue-500 填充）、头像 bg-primary-600、未读角标 bg-red-500、选中/未读行 bg-blue-50、bg-primary-50/600、语义文字 text-red/green/blue/amber/primary-*、Layout 同步点 |
| 未 token 灰阶（深色由补偿块覆盖） | text-gray-300/700/800、hover:text-gray-700、border-gray-100/300、divide-gray-50/100/200、border-gray-50、bg-gray-200/300（树列线、toggle 悬停、时间线连接线、resize 手柄）、hover:bg-gray-200 |
| 遮罩 | bg-black/30、/40、/20、bg-gray-900/20、/85（弹窗/3D 覆盖层） |
| 3D/非 UI 表面 | StpViewerPage:469,499、BomComparePage:552 `bg-gray-100` |
| 非本计划产物 | MobileCardList.tsx（并行工作，3 处目标类）、_verify_status.py（未跟踪）——未触碰、未纳入提交 |

### 6. QA 注意点处置（代码级确认）

| 注意点 | 结论 |
|---|---|
| ProfileEditModal:708 hover subtle（T8 minor） | 现为 `hover:bg-[var(--ui-bg-subtle)]`（已 token 化，代码合规）；深色下 subtle(#334155) 与 hover(#475569) 反馈对比度偏弱，建议后续统一为 hover token（minor，不阻断） |
| text-gray-300 深色层级（T3 minor） | 补偿值 #64748b 比 gray-400/500/600 的 #94a3b8 暗（层级反转，brief verbatim 值）；text-gray-300 主要用于禁用/装饰态，代码级未见混乱；若视觉 QA 发现层级混乱再调值 |
| OfficeReader:77 border-b 无着色（T10b） | 确认（pre-existing，fallback currentColor），无风险 |
| useHeaderTabs:33 text-gray-800 深色对比 | 深色补偿 → #cbd5e1 覆盖 ✓ |
| MorePage 深色组单按钮全宽（T10） | 确认：深色组 1 个 flex-1 按钮拉伸全宽，视觉不对称（cosmetic，代码级记录） |

### 7. 遗留违规（上报控制器，本验收不改代码）

1. **`frontend/src/components/BOMTreeTable.tsx:145、:212`** — `'\u25BC'`/`'\u25B6'` 转义渲染 ▼/▶ 树符号，未转 TreeToggle（违反计划「树形符号业务代码最终 0 处（TreeToggle 内部除外）」约束）；Task 6 及历次 grep 仅查字面字符而漏检；为活代码（`components/AssemblyDetailContent.tsx:82` 零部件详情 BOM 页）。建议二期或小 fix 任务处理。
2. **`frontend/src/components/BOMTreeTable.tsx`** — 无 `var(--ui-tree-indent)`（层级列用连字符徽标，无像素缩进），grep(c) 清单偏差（与 #1 同源）。
3. **`frontend/src/pages/BOM/BomWhereUsedTree.tsx`** — 无 `var(--ui-tree-indent)`（扁平反查表无深度缩进布局；符号已转 TreeToggle），grep(c) 清单偏差（疑为 spec 清单机械收录，可评估豁免）。

### 8. 验收结论

- 构建/测试双 PASS（162 用例）；grep 表面类残留仅限豁免清单；树符号字面 0 处非豁免；四主题代码级抽查通过；深色变量块 + 灰阶补偿 + 表面 token 应用齐备。
- 除 §7 3 处树形收敛清单偏差（1 处为真实遗留）外，计划目标全部达成。**验收结论：通过（DONE_WITH_CONCERNS，BOMTreeTable 树符号遗留报控制器）**。
