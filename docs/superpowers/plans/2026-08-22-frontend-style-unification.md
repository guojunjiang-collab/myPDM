# 前端风格统一（徽标/按钮/表单）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将散落在 20+ 文件的内联状态徽标映射与 85+ 处按钮样式，收拢为"单一事实源映射表 + 公共 ui 组件 + CSS 变量"三层结构，全量替换桌面与移动端存量，视觉统一且为多套风格预留基础。

**Architecture:** 三层结构——① `src/constants/badges.ts` 语义映射表（状态域 → {label, tone}，单一事实源）；② `src/components/ui/` 公共组件（Badge/Button/Input/Select/Textarea），颜色全部走 `var(--ui-*)` CSS 变量（默认值在 `index.css` `:root`，`html[data-theme]` 可整体覆盖，为多风格预留）；③ 桌面/移动端全部存量调用替换为组件，删除各处重复 map。

**Tech Stack:** React 18 + TypeScript + Vite + TailwindCSS 3（任意值语法 `bg-[var(--x)]`）+ Vitest（node 环境，仅 `src/**/*.test.ts`，无 jsdom/testing-library）。

**Spec:** `docs/superpowers/specs/2026-08-22-frontend-style-unification-design.md`

---

## Global Constraints

（所有任务必须遵守，不再重复）

- **颜色唯一来源**：业务代码禁止再出现 `bg-blue-100`、`bg-primary-600`、`bg-red-500` 等状态/按钮色类；颜色只允许存在于 `index.css` 的 `:root` 变量定义、`badgeMeta.ts`、`buttonMeta.ts`、`badges.ts`。
- **徽标规格**：统一胶囊 `rounded-full`、`px-2 py-0.5 text-xs inline-flex items-center font-medium`（即 Badge 默认 `size="sm"`）；计数小徽标 `size="xs"` = `px-1.5 py-0.5 text-[11px]`。
- **按钮禁用态**：统一 `disabled:opacity-50 disabled:cursor-not-allowed`（link 变体除外）。
- **验收门**：每个任务结尾 `cd frontend && npm run build` 必须通过；涉及纯函数的任务 `cd frontend && npm run test` 必须通过。
- **提交信息**：中文 `type: 描述` 风格（如 `style: PartsPage 状态徽标改用 Badge 组件`）。
- **Tailwind 任意值类名**：`bg-[var(--ui-blue-bg)]` 这类写法是静态字符串，JIT 正常扫描，无需 safelist。
- 移动端与桌面端共用同一 `ui/` 组件；移动端按钮尺寸用 `size="touch"`（`h-11 px-4 text-sm rounded-lg`，触控 ≥44px）。

---

## File Structure

**新增：**
- `frontend/src/constants/badges.ts` — 语义映射表（20 个状态域）+ `resolveBadge` 解析函数。
- `frontend/src/constants/badges.test.ts` — 映射表单测。
- `frontend/src/components/ui/badgeMeta.ts` — tone → CSS 变量类名映射（`BADGE_TONE_CLASS`）。
- `frontend/src/components/ui/badgeMeta.test.ts` — 类名映射单测。
- `frontend/src/components/ui/buttonMeta.ts` — 按钮 variant/size → 类名（`BTN_VARIANT_CLASS`/`BTN_SIZE_CLASS`/`BTN_BASE_CLASS`）。
- `frontend/src/components/ui/buttonMeta.test.ts` — 按钮类名单测。
- `frontend/src/components/ui/Badge.tsx` — 胶囊徽标组件。
- `frontend/src/components/ui/Button.tsx` — 按钮组件（7 variant × 5 size）。
- `frontend/src/components/ui/Input.tsx` / `Select.tsx` / `Textarea.tsx` — 表单组件（`size="md"|"xs"`）。

**修改：**
- `frontend/src/index.css` — `:root` 追加 `--ui-*` 变量集（40+ 个）。
- `frontend/src/constants/index.ts` — `ROLE_OPTIONS` 补 `unverified`。
- 桌面徽标/按钮：`pages/`、`components/` 下约 50 个文件（各任务列出确切清单）。
- 移动端徽标/按钮：`src/mobile/` 下约 20 个文件（Task 12/16 列出）。

---

## Phase A — 基础设施（纯新增，零行为变化）

### Task 1: CSS 变量集

**Files:**
- Modify: `frontend/src/index.css`（在 `:root` 块中追加）

- [ ] **Step 1: 追加变量集**

在 `frontend/src/index.css` 现有 `:root { ... }` 块内、`--color-danger` 之后追加：

```css
  /* ===== 风格统一 ui 变量（默认风格；html[data-theme] 可整体覆盖） ===== */
  /* 徽标 tone（9 组，值 = 现状 Tailwind 色阶） */
  --ui-blue-bg: #dbeafe;   --ui-blue-text: #1e40af;
  --ui-orange-bg: #ffedd5; --ui-orange-text: #9a3412;
  --ui-green-bg: #dcfce7;  --ui-green-text: #166534;
  --ui-red-bg: #fee2e2;    --ui-red-text: #991b1b;
  --ui-gray-bg: #f3f4f6;   --ui-gray-text: #374151;
  --ui-amber-bg: #fef3c7;  --ui-amber-text: #92400e;
  --ui-teal-bg: #ccfbf1;   --ui-teal-text: #115e59;
  --ui-purple-bg: #f3e8ff; --ui-purple-text: #6b21a8;
  --ui-indigo-bg: #e0e7ff; --ui-indigo-text: #3730a3;

  /* 按钮 variant */
  --ui-btn-primary-bg: #0284c7;      --ui-btn-primary-hover: #0369a1;
  --ui-btn-primary-active: #075985;  --ui-btn-primary-text: #ffffff;
  --ui-btn-secondary-bg: #ffffff;    --ui-btn-secondary-hover: #f9fafb;
  --ui-btn-secondary-border: #d1d5db; --ui-btn-secondary-text: #374151;
  --ui-btn-ghost-bg: #f3f4f6;        --ui-btn-ghost-hover: #e5e7eb;
  --ui-btn-ghost-text: #374151;
  --ui-btn-danger-bg: #dc2626;       --ui-btn-danger-hover: #b91c1c;
  --ui-btn-danger-active: #991b1b;
  --ui-btn-success-bg: #16a34a;      --ui-btn-success-hover: #15803d;
  --ui-btn-dark-bg: #6b7280;         --ui-btn-dark-hover: #4b5563;
  --ui-btn-link-text: #0284c7;       --ui-btn-link-hover: #075985;

  /* 表单 */
  --ui-input-bg: #ffffff;            --ui-input-border: #d1d5db;
  --ui-input-text: #374151;          --ui-input-placeholder: #9ca3af;
  --ui-input-focus-ring: #38bdf8;    --ui-input-focus-border: #0ea5e9;
  --ui-input-disabled-bg: #f3f4f6;   --ui-input-disabled-text: #6b7280;
```

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`
Expected: PASS（变量不参与编译，仅验证无语法破坏）

- [ ] **Step 3: 提交**

```bash
git add frontend/src/index.css
git commit -m "style: index.css 新增 ui 语义 CSS 变量集（默认风格）"
```

---

### Task 2: 语义映射表 `badges.ts` + 单测

**Files:**
- Create: `frontend/src/constants/badges.ts`
- Create: `frontend/src/constants/badges.test.ts`
- Modify: `frontend/src/constants/index.ts`（`ROLE_OPTIONS` 补 `unverified`）

**Interfaces:**
- Produces: `BadgeTone`（9 值）、`BadgeDomain`（18 值）、`BadgeDef {label: string; tone: BadgeTone}`、`BADGE_DOMAINS: Record<BadgeDomain, Record<string, BadgeDef>>`、`resolveBadge(status: string | undefined, domain: BadgeDomain, fallback?: {label?: string; tone?: BadgeTone}): BadgeDef`

- [ ] **Step 1: 写失败测试**

`frontend/src/constants/badges.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BADGE_DOMAINS, resolveBadge, BADGE_TONES } from './badges';

describe('badges 映射表', () => {
  it('数据生命周期 part domain 四态齐全且色值正确', () => {
    const d = BADGE_DOMAINS.part;
    expect(d.draft).toEqual({ label: '草稿', tone: 'blue' });
    expect(d.frozen).toEqual({ label: '冻结', tone: 'orange' });
    expect(d.released).toEqual({ label: '发布', tone: 'green' });
    expect(d.obsolete).toEqual({ label: '作废', tone: 'red' });
  });

  it('role domain 含 unverified', () => {
    expect(BADGE_DOMAINS.role.unverified).toEqual({ label: '未验证', tone: 'amber' });
  });

  it('resolveBadge 未知状态灰底兜底并保留原值', () => {
    expect(resolveBadge('weird', 'part')).toEqual({ label: 'weird', tone: 'gray' });
  });

  it('resolveBadge 空状态回退 fallback', () => {
    expect(resolveBadge(undefined, 'part', { label: '—', tone: 'gray' })).toEqual({ label: '—', tone: 'gray' });
  });

  it('所有 domain 的 tone 值都在 BADGE_TONES 内', () => {
    for (const [domain, map] of Object.entries(BADGE_DOMAINS)) {
      for (const [status, def] of Object.entries(map)) {
        expect(BADGE_TONES.includes(def.tone), `${domain}.${status} tone=${def.tone}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npm run test`
Expected: FAIL（`./badges` 模块不存在）

- [ ] **Step 3: 写实现**

`frontend/src/constants/badges.ts`：
```ts
// 前端风格统一 —— 徽标语义映射单一事实源
// 业务代码只写语义（<Badge status="released" />），颜色只在这里与 badgeMeta.ts 中出现。

export const BADGE_TONES = ['blue', 'orange', 'green', 'red', 'gray', 'amber', 'teal', 'purple', 'indigo'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export type BadgeDomain =
  | 'part' | 'ecr' | 'eco' | 'profile' | 'inventoryDoc' | 'priority' | 'action' | 'exec'
  | 'checkout' | 'required' | 'entity' | 'match' | 'role' | 'user' | 'project' | 'task' | 'decision';

export interface BadgeDef { label: string; tone: BadgeTone }

// A. 数据生命周期（part/document/configItem/material 共用）
const PART_STATUS: Record<string, BadgeDef> = {
  draft: { label: '草稿', tone: 'blue' },
  frozen: { label: '冻结', tone: 'orange' },
  released: { label: '发布', tone: 'green' },
  obsolete: { label: '作废', tone: 'red' },
};

const FLOW_STATUS = { // 审批流程：draft=灰（未提交），刻意与数据 draft=蓝 区分
  draft: { label: '草稿', tone: 'gray' },
  reviewing: { label: '审核中', tone: 'blue' },
  approved: { label: '已批准', tone: 'green' },
  rejected: { label: '已驳回', tone: 'red' },
};

export const BADGE_DOMAINS: Record<BadgeDomain, Record<string, BadgeDef>> = {
  part: PART_STATUS,
  ecr: FLOW_STATUS,
  eco: {
    ...FLOW_STATUS,
    executing: { label: '执行中', tone: 'amber' },
    completed: { label: '已完成', tone: 'teal' },
  },
  profile: {
    draft: { label: '草稿', tone: 'gray' },
    reviewing: { label: '评审中', tone: 'blue' },
    active: { label: '生效中', tone: 'green' },
    rejected: { label: '已驳回', tone: 'red' },
  },
  inventoryDoc: {
    draft: { label: '草稿', tone: 'gray' },
    reviewing: { label: '评审中', tone: 'blue' },
    approved: { label: '已批准', tone: 'green' },
    posted: { label: '已过账', tone: 'teal' },
    rejected: { label: '已驳回', tone: 'red' },
    cancelled: { label: '已取消', tone: 'gray' },
  },
  priority: {
    urgent: { label: '紧急', tone: 'red' },
    high: { label: '高', tone: 'orange' },
    normal: { label: '普通', tone: 'blue' },
    low: { label: '低', tone: 'gray' },
  },
  action: {
    create: { label: '新建', tone: 'green' },
    add_new: { label: '新建', tone: 'green' },
    add_existing: { label: '新增', tone: 'teal' },
    upgrade: { label: '升版', tone: 'blue' },
    qty_change: { label: '数量变更', tone: 'orange' },
    delete: { label: '删除', tone: 'red' },
    no_change: { label: '不变', tone: 'gray' },
  },
  exec: {
    pending: { label: '待执行', tone: 'gray' },
    in_progress: { label: '执行中', tone: 'amber' },
    completed: { label: '已完成', tone: 'green' },
    failed: { label: '失败', tone: 'red' },
  },
  checkout: {
    not_checked_out: { label: '未签出', tone: 'gray' },
    checked_out: { label: '已签出', tone: 'blue' },
    other_checked_out: { label: '他人签出', tone: 'amber' },
  },
  required: {
    required: { label: '必选', tone: 'blue' },
    optional: { label: '可选', tone: 'gray' },
  },
  entity: {
    part: { label: '零件', tone: 'gray' },
    assembly: { label: '装配', tone: 'blue' },
    configuration: { label: '构型项', tone: 'purple' },
    document: { label: '图文档', tone: 'indigo' },
  },
  match: {
    matched: { label: '已匹配', tone: 'green' },
    new: { label: '可新建', tone: 'amber' },
    conflict: { label: '冲突', tone: 'red' },
    unknown: { label: '未知', tone: 'gray' },
  },
  role: {
    admin: { label: '管理员', tone: 'red' },
    engineer: { label: '工程师', tone: 'blue' },
    production: { label: '生产人员', tone: 'green' },
    guest: { label: '访客', tone: 'gray' },
    unverified: { label: '未验证', tone: 'amber' },
  },
  user: {
    active: { label: '正常', tone: 'green' },
    disabled: { label: '禁用', tone: 'red' },
  },
  project: {
    '待启动': { label: '待启动', tone: 'gray' },
    '进行中': { label: '进行中', tone: 'blue' },
    '已完成': { label: '已完成', tone: 'green' },
    '已暂停': { label: '已暂停', tone: 'amber' },
    '已归档': { label: '已归档', tone: 'gray' },
  },
  task: {
    '未开始': { label: '未开始', tone: 'gray' },
    '进行中': { label: '进行中', tone: 'blue' },
    '已完成': { label: '已完成', tone: 'green' },
    '挂起': { label: '挂起', tone: 'amber' },
  },
  decision: {
    approved: { label: '同意', tone: 'green' },
    rejected: { label: '驳回', tone: 'red' },
  },
};

export function resolveBadge(
  status: string | undefined,
  domain: BadgeDomain,
  fallback?: { label?: string; tone?: BadgeTone },
): BadgeDef {
  if (status) {
    const hit = BADGE_DOMAINS[domain][status];
    if (hit) return hit;
    return { label: status, tone: 'gray' }; // 未知值灰底兜底，保留原值
  }
  return { label: fallback?.label ?? '', tone: fallback?.tone ?? 'gray' };
}
```

`frontend/src/constants/index.ts` 的 `ROLE_OPTIONS` 追加（值序放 `guest` 前）：
```ts
  { value: 'unverified', label: '未验证', color: 'amber' },
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd frontend && npm run test`
Expected: PASS（5 个用例）

- [ ] **Step 5: 构建 + 提交**

Run: `cd frontend && npm run build` → PASS

```bash
git add frontend/src/constants/badges.ts frontend/src/constants/badges.test.ts frontend/src/constants/index.ts
git commit -m "feat: 新增徽标语义映射表 badges.ts（20 状态域单一事实源）并补 ROLE_OPTIONS unverified"
```

---

### Task 3: 类名元数据 `badgeMeta.ts` / `buttonMeta.ts` + 单测

**Files:**
- Create: `frontend/src/components/ui/badgeMeta.ts`
- Create: `frontend/src/components/ui/badgeMeta.test.ts`
- Create: `frontend/src/components/ui/buttonMeta.ts`
- Create: `frontend/src/components/ui/buttonMeta.test.ts`

**Interfaces:**
- Produces: `BADGE_TONE_CLASS: Record<BadgeTone, {bg: string; text: string}>`；`BTN_BASE_CLASS: string`、`BTN_VARIANT_CLASS: Record<ButtonVariant, string>`、`BTN_SIZE_CLASS: Record<ButtonSize, string>`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/ui/badgeMeta.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BADGE_TONE_CLASS } from './badgeMeta';
import { BADGE_TONES } from '../../constants/badges';

describe('BADGE_TONE_CLASS', () => {
  it('每个 tone 都有 bg 与 text 且为 CSS 变量任意值类', () => {
    for (const tone of BADGE_TONES) {
      const c = BADGE_TONE_CLASS[tone];
      expect(c.bg).toMatch(/^bg-\[var\(--ui-.*-bg\)\]$/);
      expect(c.text).toMatch(/^text-\[var\(--ui-.*-text\)\]$/);
    }
  });
});
```

`frontend/src/components/ui/buttonMeta.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BTN_VARIANT_CLASS, BTN_SIZE_CLASS } from './buttonMeta';

describe('按钮类名元数据', () => {
  it('7 个 variant 全部有类名', () => {
    const variants = ['primary', 'secondary', 'danger', 'success', 'ghost', 'dark', 'link'];
    for (const v of variants) {
      expect(BTN_VARIANT_CLASS[v]).toBeTruthy();
    }
  });
  it('5 个 size 全部有类名', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'touch'];
    for (const s of sizes) expect(BTN_SIZE_CLASS[s]).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npm run test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`frontend/src/components/ui/badgeMeta.ts`:
```ts
import type { BadgeTone } from '../../constants/badges';

/** tone → CSS 变量类名（颜色唯一真源之一；多风格切换只改 index.css 变量） */
export const BADGE_TONE_CLASS: Record<BadgeTone, { bg: string; text: string }> = {
  blue:   { bg: 'bg-[var(--ui-blue-bg)]',   text: 'text-[var(--ui-blue-text)]' },
  orange: { bg: 'bg-[var(--ui-orange-bg)]', text: 'text-[var(--ui-orange-text)]' },
  green:  { bg: 'bg-[var(--ui-green-bg)]',  text: 'text-[var(--ui-green-text)]' },
  red:    { bg: 'bg-[var(--ui-red-bg)]',    text: 'text-[var(--ui-red-text)]' },
  gray:   { bg: 'bg-[var(--ui-gray-bg)]',   text: 'text-[var(--ui-gray-text)]' },
  amber:  { bg: 'bg-[var(--ui-amber-bg)]',  text: 'text-[var(--ui-amber-text)]' },
  teal:   { bg: 'bg-[var(--ui-teal-bg)]',   text: 'text-[var(--ui-teal-text)]' },
  purple: { bg: 'bg-[var(--ui-purple-bg)]', text: 'text-[var(--ui-purple-text)]' },
  indigo: { bg: 'bg-[var(--ui-indigo-bg)]', text: 'text-[var(--ui-indigo-text)]' },
};

export const BADGE_BASE_CLASS = 'inline-flex items-center whitespace-nowrap rounded-full font-medium';
export const BADGE_SIZE_CLASS = {
  sm: 'px-2 py-0.5 text-xs',
  xs: 'px-1.5 py-0.5 text-[11px]',
} as const;
```

`frontend/src/components/ui/buttonMeta.ts`:
```ts
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'dark' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'touch';

export const BTN_BASE_CLASS =
  'inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const BTN_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:   'bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] active:bg-[var(--ui-btn-primary-active)]',
  secondary: 'border border-[var(--ui-btn-secondary-border)] bg-[var(--ui-btn-secondary-bg)] text-[var(--ui-btn-secondary-text)] hover:bg-[var(--ui-btn-secondary-hover)]',
  danger:    'bg-[var(--ui-btn-danger-bg)] text-white hover:bg-[var(--ui-btn-danger-hover)] active:bg-[var(--ui-btn-danger-active)]',
  success:   'bg-[var(--ui-btn-success-bg)] text-white hover:bg-[var(--ui-btn-success-hover)]',
  ghost:     'bg-[var(--ui-btn-ghost-bg)] text-[var(--ui-btn-ghost-text)] hover:bg-[var(--ui-btn-ghost-hover)]',
  dark:      'bg-[var(--ui-btn-dark-bg)] text-white hover:bg-[var(--ui-btn-dark-hover)]',
  link:      'text-[var(--ui-btn-link-text)] hover:text-[var(--ui-btn-link-hover)] hover:underline',
};

export const BTN_SIZE_CLASS: Record<ButtonSize, string> = {
  xs:    'px-2.5 py-1 text-xs rounded',
  sm:    'px-3 py-1.5 text-xs rounded-lg',
  md:    'px-4 py-2 text-sm rounded-lg',
  lg:    'px-5 py-2.5 text-sm rounded-lg',
  touch: 'h-11 px-4 text-sm rounded-lg',
};
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd frontend && npm run test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ui/badgeMeta.ts frontend/src/components/ui/badgeMeta.test.ts frontend/src/components/ui/buttonMeta.ts frontend/src/components/ui/buttonMeta.test.ts
git commit -m "feat: ui 徽标/按钮类名元数据（CSS 变量驱动）"
```

---

### Task 4: Badge 组件

**Files:**
- Create: `frontend/src/components/ui/Badge.tsx`

**Interfaces:**
- Consumes: `resolveBadge`、`BADGE_DOMAINS`（badges.ts）、`BADGE_TONE_CLASS`/`BADGE_BASE_CLASS`/`BADGE_SIZE_CLASS`（badgeMeta.ts）
- Produces: `<Badge status={string} domain={BadgeDomain} />` 或 `<Badge tone={BadgeTone} label={ReactNode} />`，`size?: 'sm'|'xs'`，`className?: string`

- [ ] **Step 1: 写组件**

```tsx
import type { ReactNode } from 'react';
import { resolveBadge, type BadgeDomain, type BadgeTone } from '../../constants/badges';
import { BADGE_BASE_CLASS, BADGE_SIZE_CLASS, BADGE_TONE_CLASS } from './badgeMeta';

interface BadgeProps {
  /** 语义状态值；与 tone+label 二选一 */
  status?: string;
  /** status 的语义域，默认 'part' */
  domain?: BadgeDomain;
  /** 直接指定颜色（与 status 二选一） */
  tone?: BadgeTone;
  /** 直接指定文案（与 status 二选一） */
  label?: ReactNode;
  size?: 'sm' | 'xs';
  className?: string;
}

export default function Badge({ status, domain = 'part', tone, label, size = 'sm', className }: BadgeProps) {
  const def = status !== undefined ? resolveBadge(status, domain) : { label, tone: tone ?? ('gray' as BadgeTone) };
  const c = BADGE_TONE_CLASS[def.tone ?? 'gray'];
  return (
    <span className={`${BADGE_BASE_CLASS} ${BADGE_SIZE_CLASS[size]} ${c.bg} ${c.text} ${className ?? ''}`}>
      {def.label}
    </span>
  );
}
```

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ui/Badge.tsx
git commit -m "feat: 新增 Badge 胶囊徽标组件"
```

---

### Task 5: Button / Input / Select / Textarea 组件

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Input.tsx`
- Create: `frontend/src/components/ui/Select.tsx`
- Create: `frontend/src/components/ui/Textarea.tsx`

**Interfaces:**
- Consumes: `BTN_BASE_CLASS`/`BTN_VARIANT_CLASS`/`BTN_SIZE_CLASS`（buttonMeta.ts）
- Produces: `<Button variant size ...原生属性 />`；`<Input size="md"|"xs" ... />`、`<Select size ...>{children}</Select>`、`<Textarea size ... />`

- [ ] **Step 1: 写组件**

`Button.tsx`：
```tsx
import type { ButtonHTMLAttributes } from 'react';
import { BTN_BASE_CLASS, BTN_SIZE_CLASS, BTN_VARIANT_CLASS, type ButtonSize, type ButtonVariant } from './buttonMeta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = `${BTN_BASE_CLASS} ${BTN_VARIANT_CLASS[variant]} ${BTN_SIZE_CLASS[size]} ${className}`.trim();
  return <button type={type} className={cls} {...rest} />;
}
```

`Input.tsx`：
```tsx
import type { InputHTMLAttributes } from 'react';

export const INPUT_BASE_CLASS =
  'w-full rounded-lg border border-[var(--ui-input-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-input-text)] placeholder:text-[var(--ui-input-placeholder)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-input-focus-ring)] focus:border-[var(--ui-input-focus-border)] disabled:bg-[var(--ui-input-disabled-bg)] disabled:text-[var(--ui-input-disabled-text)]';
const INPUT_SIZE_CLASS = { md: '', xs: '!px-2 !py-1 !text-xs' } as const;

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: 'md' | 'xs';
}

export default function Input({ size = 'md', className = '', ...rest }: InputProps) {
  return <input className={`${INPUT_BASE_CLASS} ${INPUT_SIZE_CLASS[size]} ${className}`.trim()} {...rest} />;
}
```

`Select.tsx`（children 为 `<option>`，与 Input 同款类名）：
```tsx
import type { SelectHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  size?: 'md' | 'xs';
}

export default function Select({ size = 'md', className = '', children, ...rest }: SelectProps) {
  return (
    <select className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!px-2 !py-1 !text-xs' : ''} ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}
```

`Textarea.tsx`（同款类名）：
```tsx
import type { TextareaHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'md' | 'xs';
}

export default function Textarea({ size = 'md', className = '', ...rest }: TextareaProps) {
  return <textarea className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!px-2 !py-1 !text-xs' : ''} ${className}`.trim()} {...rest} />;
}
```

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ui/Button.tsx frontend/src/components/ui/Input.tsx frontend/src/components/ui/Select.tsx frontend/src/components/ui/Textarea.tsx
git commit -m "feat: 新增 Button/Input/Select/Textarea 公共组件"
```

---

## Phase B — 状态徽标全量替换（桌面）

> 替换总规则（所有徽标任务通用）：
> 1. 删除文件内联的 `STATUS_MAP`/`STATUS_TAG`/`statusTag`/`roleTag` 等映射常量与 `cls`/`class` 字段。
> 2. 引入 `import Badge from '../../components/ui/Badge';`（相对路径按文件层级调整）。
> 3. 渲染处改为 `<Badge status={值} domain={域} />`；类型徽标用 `<Badge tone label />`；计数用 `<Badge tone="gray" label={n} size="xs" />`。
> 4. 徽标容器上的 `px-* py-* text-xs rounded(-full)` 类全部删除（Badge 自带）。
> 5. 未知值兜底逻辑删除（resolveBadge 已兜底）。

### Task 6: 零部件模块徽标（桌面）

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`（STATUS_TAG + 装配类型紫→蓝修复）、`frontend/src/components/PartDetailModal.tsx`、`frontend/src/components/PartDetailContent.tsx`、`frontend/src/components/AssemblyDetailContent.tsx`、`frontend/src/components/EntityEditModal.tsx`（三目状态色）、`frontend/src/components/VersionHistory.tsx`、`frontend/src/components/VersionSelectModal.tsx`、`frontend/src/components/AssemblyPartPicker.tsx`、`frontend/src/components/PartDetailModal/PartWhereUsedTab.tsx`（计数 + 必选/可选）、`frontend/src/components/BOMTreeTable.tsx`、`frontend/src/pages/BOM/BomWhereUsedTree.tsx`

**替换示例（代表性 before/after）：**

状态徽标（`PartsPage.tsx`）：
```tsx
// 旧
const STATUS_TAG: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};
<span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_TAG[item.status]?.cls || 'bg-gray-100 text-gray-800'}`}>
  {STATUS_TAG[item.status]?.label || item.status}
</span>
// 新
<Badge status={item.status} />
```

类型徽标（`PartsPage.tsx` 行 281，紫色→蓝，冲突修复 #1）：
```tsx
// 旧
<span className={`px-2 py-1 text-xs rounded-full ${item.type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
  {item.type === 'assembly' ? '部件' : '零件'}
</span>
// 新
<Badge tone={item.type === 'assembly' ? 'blue' : 'gray'} label={item.type === 'assembly' ? '部件' : '零件'} />
```

计数徽标（`PartWhereUsedTab.tsx`）：
```tsx
// 旧
<span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{count}</span>
// 新
<Badge tone="gray" label={count} size="xs" />
```

必选/可选（`PartWhereUsedTab.tsx` 行 87，冲突修复 #2）：
```tsx
// 旧（绿/橙 或 蓝/绿 视文件）
<span className={`text-xs px-2 py-0.5 rounded ${r.is_required ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{r.is_required ? '必选' : '可选'}</span>
// 新（统一 必选=蓝、可选=灰）
<Badge tone={r.is_required ? 'blue' : 'gray'} label={r.is_required ? '必选' : '可选'} />
```

- [ ] **Step 1: 按上面示例逐一替换本组文件全部状态/类型/计数徽标**

搜索模式（每个文件逐一排查）：`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-gray-100 text-gray-6|7|8`、`bg-purple-100`、`rounded-full`（徽标上下文）、`is_required`/`isAssembly`/`type === 'assembly'`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/PartsPage.tsx frontend/src/components/PartDetailModal.tsx frontend/src/components/PartDetailContent.tsx frontend/src/components/AssemblyDetailContent.tsx frontend/src/components/EntityEditModal.tsx frontend/src/components/VersionHistory.tsx frontend/src/components/VersionSelectModal.tsx frontend/src/components/AssemblyPartPicker.tsx frontend/src/components/PartDetailModal/PartWhereUsedTab.tsx frontend/src/components/BOMTreeTable.tsx frontend/src/pages/BOM/BomWhereUsedTree.tsx
git commit -m "style: 零部件模块状态/类型/必选徽标改用 Badge 组件"
```

---

### Task 7: 图文档模块徽标（桌面）

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`、`frontend/src/components/DocumentDetailModal.tsx`、`frontend/src/components/DocumentDetailContent.tsx`、`frontend/src/components/DocumentPicker.tsx`、`frontend/src/components/DocumentDetailModal/DocWhereUsedTab.tsx`（计数）、`frontend/src/components/EntityDocumentSection.tsx`

- [ ] **Step 1: 按 Task 6 的替换规则替换本组全部徽标**

搜索模式：`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-gray-100`、`rounded-full`（徽标上下文）。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/Documents.tsx frontend/src/components/DocumentDetailModal.tsx frontend/src/components/DocumentDetailContent.tsx frontend/src/components/DocumentPicker.tsx frontend/src/components/DocumentDetailModal/DocWhereUsedTab.tsx frontend/src/components/EntityDocumentSection.tsx
git commit -m "style: 图文档模块状态徽标改用 Badge 组件"
```

---

### Task 8: 构型模块徽标（桌面）

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationList.tsx`、`frontend/src/components/Configuration/ConfigurationDetailModal.tsx`、`frontend/src/components/Configuration/ConfigItemDetailModal.tsx`、`frontend/src/components/Configuration/ConfigItemPicker.tsx`、`frontend/src/components/Configuration/ConfigurationCreateModal.tsx`、`frontend/src/components/Configuration/ProfileEditModal.tsx`、`frontend/src/components/Configuration/ProfileStatusBadge.tsx`、`frontend/src/components/Configuration/ProfileReviewPanel.tsx`

**ProfileStatusBadge.tsx 特殊处理**：该文件是"构型概要状态"专用组件，其内联映射（draft/reviewing/active/rejected）改为内部消费 `BADGE_DOMAINS.profile` 并渲染 `<Badge status domain="profile" />`，对外 props 不变（`status`），**保留该文件**（其他文件仍 import 它）：
```tsx
import Badge from '../ui/Badge';

export default function ProfileStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="profile" />;
}
```
其余组件同样处理（`ECRStatusBadge`/`ECOStatusBadge` 在 Task 9 同理）。

- [ ] **Step 1: 按 Task 6 规则替换本组全部徽标 + 改造 ProfileStatusBadge**

搜索模式：`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-purple-100`、`bg-gray-100`、`is_required`、`isAssembly`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Configuration/
git commit -m "style: 构型模块徽标改用 Badge 组件（含 ProfileStatusBadge 内部改造）"
```

---

### Task 9: ECR/ECO 模块徽标（桌面）

**Files:**
- Modify: `frontend/src/components/ECR/ECRStatusBadge.tsx`、`frontend/src/components/ECO/ECOStatusBadge.tsx`、`frontend/src/components/ECR/ECRDetailModal.tsx`、`frontend/src/components/ECR/ECRCreateModal.tsx`、`frontend/src/components/ECR/ECRReviewPanel.tsx`、`frontend/src/components/ECR/ECRBomImpactView.tsx`、`frontend/src/components/ECR/ECRAffectedItemPicker.tsx`、`frontend/src/components/ECO/ECODetailModal.tsx`、`frontend/src/components/ECO/ECOCreateModal.tsx`、`frontend/src/components/ECO/ECOEditView.tsx`、`frontend/src/components/ECO/ECOList.tsx`、`frontend/src/components/ECR/ECRList.tsx`

**ECRStatusBadge.tsx 改造**（保留文件，内部消费映射表；priority 同文件内一并处理）：
```tsx
import Badge from '../ui/Badge';

export default function ECRStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="ecr" />;
}
```
**ECOStatusBadge.tsx 改造**：`domain="eco"`；文件内 priority（`domain="priority"`）、action（`domain="action"`）、execStatus（`domain="exec"`）三个映射一并改为消费对应 domain 并渲染 Badge，对外导出结构保持不变（`{status,priority,action,execStatus}` 各自返回 `<Badge>`）。

`ECRBomImpactView.tsx` 的 `ACTION_CONFIG` → `BADGE_DOMAINS.action`；`ECOEditView.tsx` 行 144-147 的内联三目 → `<Badge status={status} domain="eco" />`（注意该处 `draft` 文案是"已升版"，属业务特例：`<Badge tone="blue" label="已升版" />`）。

- [ ] **Step 1: 按规则替换本组全部徽标 + 改造两个 StatusBadge 包装组件**

搜索模式：`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-yellow-100`、`bg-teal-100`、`bg-amber-100`、`bg-gray-100`、`isAssembly`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/ECR/ frontend/src/components/ECO/
git commit -m "style: ECR/ECO 模块徽标改用 Badge 组件（yellow 收敛 amber）"
```

---

### Task 10: 库存模块徽标（桌面）

**Files:**
- Modify: `frontend/src/components/Inventory/MaterialTab.tsx`、`frontend/src/components/Inventory/DocumentTab.tsx`、`frontend/src/components/Inventory/DocumentDetail.tsx`、`frontend/src/components/Inventory/DocumentEditModal.tsx`

**冲突修复 #3（库存单据 approved 色）**：`DocumentTab.tsx` 行 21-23 与 `DocumentDetail.tsx` 行 13-15 的 `approved: 'bg-primary-100 text-primary-700'` → `domain="inventoryDoc"`（`approved` 自动变绿）；`reviewing` 原 `amber` → 自动变蓝；`draft` 灰、`cancelled` 灰保持不变。

- [ ] **Step 1: 替换本组全部徽标（含 approved/reviewing 色修复）**

搜索模式：`bg-primary-100`、`bg-amber-100`、`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-gray-100`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Inventory/
git commit -m "style: 库存模块徽标改用 Badge 组件（approved 蓝→绿、reviewing 琥珀→蓝）"
```

---

### Task 11: 用户/角色/看板/杂项徽标（桌面）

**Files:**
- Modify: `frontend/src/pages/Users.tsx`（roleTag/statusTag）、`frontend/src/components/Layout.tsx`（行 188 角色三目 + 行 189 角色名映射）、`frontend/src/pages/Board.tsx`（STATUS_TAG + 类型 tab）、`frontend/src/pages/Dashboard/MyTodosTile.tsx`（TYPE_TAG）、`frontend/src/pages/Dashboard/MyTasksTile.tsx`（STATUS_CLS 任务状态）、`frontend/src/components/ImportPreviewModal.tsx`、`frontend/src/pages/Help.tsx`（行 322-334 文档示例徽标）、`frontend/src/pages/PendingApproval.tsx`（如有角色展示）

**Users.tsx 特殊处理**：`roleTag`/`statusTag` 改为消费映射表并渲染 Badge：
```tsx
import Badge from '../components/ui/Badge';

const RoleTag = ({ role }: { role: string }) => <Badge status={role} domain="role" />;
const StatusTag = ({ status }: { status: string }) => <Badge status={status} domain="user" />;
```
（原 `roleTag(u.role).cls`/`.label` 的调用处同步改为 `<RoleTag role={u.role} />`、`<StatusTag status={u.status} />`；行 797 的纯文本 `{u.role}` 保持文本不变，仅列表/组内徽标替换。）

**Layout.tsx** 行 188-189：角色徽标改为 `<Badge status={user?.role ?? 'guest'} domain="role" />`（`unverified` 自动 amber；`guest` 自动灰）。

**MyTasksTile.tsx**（任务状态 50 级 → 100 级收敛）：`STATUS_CLS` 删除，改 `<Badge status={t.status} domain="task" />`（自动 100 级蓝/绿/琥珀）。

**MyTodosTile.tsx**：`TYPE_TAG` 改为 `<Badge status={it.type} domain="entity" />`（type 为 part/document/configuration，`assembly` 自动蓝）。

- [ ] **Step 1: 替换本组全部徽标**

搜索模式：`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-yellow-100`、`bg-gray-100`、`bg-blue-50`、`bg-green-50`、`bg-amber-50`（任务状态上下文）。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/Users.tsx frontend/src/components/Layout.tsx frontend/src/pages/Board.tsx frontend/src/pages/Dashboard/ frontend/src/components/ImportPreviewModal.tsx frontend/src/pages/Help.tsx frontend/src/pages/PendingApproval.tsx
git commit -m "style: 用户/角色/看板/仪表盘徽标改用 Badge 组件（任务状态 50→100 级收敛）"
```

---

## Phase C — 移动端徽标替换

### Task 12: 移动端全部徽标

**Files:**
- Delete: `frontend/src/mobile/components/StatusBadge.tsx`（退役）
- Modify: `frontend/src/mobile/components/BomTree.tsx`、`frontend/src/mobile/components/ConfigTree.tsx`、`frontend/src/mobile/pages/PartsListPage.tsx`、`frontend/src/mobile/pages/DocumentsListPage.tsx`、`frontend/src/mobile/pages/ConfigurationItemsPage.tsx`、`frontend/src/mobile/pages/ConfigurationProfilesPage.tsx`、`frontend/src/mobile/pages/PartDetailPage.tsx`、`frontend/src/mobile/pages/DocumentDetailPage.tsx`、`frontend/src/mobile/pages/ConfigItemDetailPage.tsx`、`frontend/src/mobile/pages/EcPage.tsx`、`frontend/src/mobile/pages/InventoryPage.tsx`、`frontend/src/mobile/pages/ProjectsPage.tsx`、`frontend/src/mobile/pages/TaskDetailPage.tsx`、`frontend/src/mobile/pages/UsersListPage.tsx`、`frontend/src/mobile/pages/PartBomPage.tsx`、`frontend/src/mobile/pages/PartWhereUsedTab.tsx`、`frontend/src/mobile/pages/DocWhereUsedTab.tsx`、`frontend/src/mobile/pages/BoardPage.tsx`、`frontend/src/mobile/pages/DashboardPage.tsx`、`frontend/src/mobile/pages/NotificationsPage.tsx`

**替换规则**：
1. 各页面删除 `STATUS_MAP`/`ROLE_MAP` 等内联 map，`StatusBadge` import 改为 `import Badge from '../../components/ui/Badge'`（相对路径按层级调整，如 `mobile/pages/` → `../../components/ui/Badge`）。
2. `<StatusBadge status={x} map={...} />` → `<Badge status={x} />` 或对应 domain。
3. 计数徽标 `px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600` → `<Badge tone="gray" label={n} size="xs" />`。
4. 版本徽标（`px-1.5 py-0.5 rounded-lg text-xs bg-primary-50 text-primary-600`）**保持现状不动**（版本非状态语义，不在本次范围）。
5. `UsersListPage.tsx` 的 `disabled: '停用'`（灰）→ `<Badge status="disabled" domain="user" />`（自动红，冲突修复）。

- [ ] **Step 1: 按规则替换移动端全部徽标并删除 StatusBadge.tsx**

搜索模式：`STATUS_MAP`、`StatusBadge`、`bg-blue-100`、`bg-orange-100`、`bg-green-100`、`bg-red-100`、`bg-yellow-100`、`bg-gray-100 text-gray-6|7|8`、`rounded-full`（徽标上下文）。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/mobile/
git commit -m "style: 移动端徽标全量改用 Badge 组件（StatusBadge 退役）"
```

---

## Phase D — 按钮全量替换（桌面 + 移动端）

> 替换总规则（所有按钮任务通用）：
> 1. `import Button from '../components/ui/Button';`（相对路径按层级调整）。
> 2. 按变体映射替换，**语义映射表**：

| 现状类名（搜索模式） | 新写法 |
|---|---|
| `bg-primary-600 text-white ... rounded-lg ... text-sm px-4 py-2` | `<Button variant="primary" size="md">` |
| `bg-primary-600 ... px-3 py-1(text-sm 或 text-xs) rounded(无 lg)` | `<Button variant="primary" size="sm">` |
| `px-2 py-1 text-xs bg-primary-600`（表格行内） | `<Button variant="primary" size="xs">` |
| `px-5 py-2.5` 大按钮 | `<Button variant="primary" size="lg">` |
| `border border-gray-300 rounded(-lg) ... hover:bg-gray-50`（取消/浏览） | `<Button variant="secondary" size="md\|sm">` |
| `bg-gray-100 text-gray-700 hover:bg-gray-200`（筛选） | `<Button variant="ghost" size="sm\|xs">` |
| `bg-red-500/600 text-white ... hover:bg-red-600/700` | `<Button variant="danger">` |
| `bg-green-600` / `bg-emerald-500` 实底 | `<Button variant="success">` |
| `bg-gray-500 text-white`（撤销签出） | `<Button variant="dark">` |
| `text-blue-600 hover:text-blue-800 text-xs` / `text-primary-600 ... text-xs`（行内操作） | `<Button variant="link" size="xs">` |
| 移动端 `h-11` / `h-12` 主按钮 | `<Button variant="primary" size="touch">` |
| 移动端 `min-h-8/9/10 px-3 rounded-lg bg-primary-600 text-xs`（小按钮） | `<Button variant="primary" size="xs" className="min-h-9">`（保留触控 min-h） |

> 3. `type="submit"` 保留（Button 透传）；`disabled`/`onClick`/`title` 等原生属性原样保留。
> 4. 删除原 `disabled:opacity-* disabled:cursor-not-allowed`（Button 自带）。
> 5. 图标+文字按钮（如 `+ 新建`）文字保持，`gap` 由 Button 自带。

### Task 13: 零部件/图文档模块按钮（桌面）

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`、`frontend/src/pages/Documents.tsx`、`frontend/src/components/PartDetailModal.tsx`、`frontend/src/components/DocumentDetailModal.tsx`、`frontend/src/components/PartAttachmentBucket.tsx`、`frontend/src/components/ComponentAttachmentBucket.tsx`、`frontend/src/components/EntityEditModal.tsx`、`frontend/src/components/EntityDocumentSection.tsx`、`frontend/src/components/AssemblyPartPicker.tsx`、`frontend/src/components/DocumentPicker.tsx`、`frontend/src/components/PartCompareModal.tsx`、`frontend/src/components/VersionSelectModal.tsx`（如含按钮）

- [ ] **Step 1: 按按钮映射表替换本组全部按钮**

搜索模式：`bg-primary-600`、`bg-red-5|600`、`bg-green-600`、`bg-emerald-500`、`bg-gray-500 text-white`、`border border-gray-300`（按钮上下文）、`bg-gray-100 text-gray-700 hover:bg-gray-200`、`text-blue-600 hover:text-blue-800`、`text-red-6`（行内）。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/PartsPage.tsx frontend/src/pages/Documents.tsx frontend/src/components/PartDetailModal.tsx frontend/src/components/DocumentDetailModal.tsx frontend/src/components/PartAttachmentBucket.tsx frontend/src/components/ComponentAttachmentBucket.tsx frontend/src/components/EntityEditModal.tsx frontend/src/components/EntityDocumentSection.tsx frontend/src/components/AssemblyPartPicker.tsx frontend/src/components/DocumentPicker.tsx frontend/src/components/PartCompareModal.tsx
git commit -m "style: 零部件/图文档模块按钮改用 Button 组件"
```

---

### Task 14: 构型/ECR/ECO 模块按钮（桌面）

**Files:**
- Modify: `frontend/src/components/Configuration/`（全部含按钮文件：ConfigurationList、ConfigurationCreateModal、ConfigurationDetailModal、ConfigItemDetailModal、ConfigItemPicker、ProfileList、ProfileEditModal、ProfileCompareModal、ProfileReviewPanel）、`frontend/src/components/ECR/`（ECRList、ECRCreateModal、ECRDetailModal、ECRReviewPanel、ECRBomImpactView、ECRAffectedItemPicker、ECRCcPicker、ECRDocumentPicker）、`frontend/src/components/ECO/`（ECOList、ECOCreateModal、ECODetailModal、ECOEditView、ECOExecutionPanel、ECOCcPicker）

- [ ] **Step 1: 按按钮映射表替换本组全部按钮**

搜索模式：同 Task 13。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Configuration/ frontend/src/components/ECR/ frontend/src/components/ECO/
git commit -m "style: 构型/ECR/ECO 模块按钮改用 Button 组件"
```

---

### Task 15: 库存/项目/设置/用户/其他模块按钮（桌面）

**Files:**
- Modify: `frontend/src/components/Inventory/`（WarehouseTab、MaterialTab、DocumentTab、DocumentEditModal、DocumentDetail）、`frontend/src/pages/Project/`（Projects、TaskEditModal、MemberManageModal、DeliverableModal）、`frontend/src/pages/Settings.tsx`、`frontend/src/pages/Users.tsx`、`frontend/src/pages/DataManagement.tsx`、`frontend/src/pages/Logs.tsx`、`frontend/src/pages/Board.tsx`、`frontend/src/components/CADWorkspace/`（CADConnectStep、CADBOMMatchTable）、`frontend/src/components/ECPicker.tsx`、`frontend/src/components/NotificationBell.tsx`（如有按钮）

- [ ] **Step 1: 按按钮映射表替换本组全部按钮**

搜索模式：同 Task 13。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/Inventory/ frontend/src/pages/Project/ frontend/src/pages/Settings.tsx frontend/src/pages/Users.tsx frontend/src/pages/DataManagement.tsx frontend/src/pages/Logs.tsx frontend/src/pages/Board.tsx frontend/src/components/CADWorkspace/ frontend/src/components/ECPicker.tsx
git commit -m "style: 库存/项目/设置/用户/CAD 模块按钮改用 Button 组件"
```

---

### Task 16: 移动端按钮

**Files:**
- Modify: `frontend/src/mobile/MobileLogin.tsx`、`frontend/src/mobile/MobileLayout.tsx`、`frontend/src/mobile/pages/`（PartsListPage、DocumentsListPage、ConfigurationItemsPage、ConfigurationProfilesPage、PartDetailPage、DocumentDetailPage、ConfigItemDetailPage、EcPage、InventoryPage、ProjectsPage、TaskDetailPage、UsersListPage、BoardPage、DashboardPage、BomComparePage、GanttPage、StpViewerPage、NotificationsPage）、`frontend/src/mobile/components/`（AttachmentPreview、BomTree、ConfigTree、FilterDropdown 如含按钮）

**移动端要点**：
- 全宽主按钮（登录/提交/保存）→ `<Button variant="primary" size="touch" className="w-full" />`
- 筛选胶囊 tab（`min-h-9/10 px-3 rounded-full` 选中态 `bg-primary-600`）**保持现有结构与选中态逻辑**，仅将选中态背景类换为 `bg-[var(--ui-btn-primary-bg)]`；如不方便组件化可保留原类（胶囊 tab 属"分段控件"非按钮语义，允许豁免，但须在 commit 说明）
- 底部操作按钮 `min-h-11 rounded-lg bg-primary-600` → `<Button size="touch" />`
- 行内小按钮 `px-2 py-0.5 rounded text-xs font-medium bg-primary-600`（3D 预览等）→ `<Button variant="primary" size="xs" className="min-h-8" />`
- 移动端 `disabled:opacity-60/40` 统一由 Button 自带（opacity-50）

- [ ] **Step 1: 替换移动端全部按钮**

搜索模式：`bg-primary-600`、`bg-red-5|600`、`bg-green-600`、`h-11`、`h-12`、`min-h-1[01]`。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/mobile/
git commit -m "style: 移动端按钮改用 Button 组件（touch 触控尺寸）"
```

---

## Phase E — 表单统一 + 收尾

### Task 17: 表单输入统一

**Files:**
- Modify: 高频表单文件：`frontend/src/pages/PartsPage.tsx`、`frontend/src/pages/Documents.tsx`、`frontend/src/pages/Logs.tsx`、`frontend/src/pages/Board.tsx`、`frontend/src/pages/Project/TaskEditModal.tsx`、`frontend/src/pages/Project/Projects.tsx`、`frontend/src/pages/Project/DeliverableModal.tsx`、`frontend/src/pages/Project/MemberManageModal.tsx`、`frontend/src/components/ECR/`（ECRCreateModal、ECRReviewPanel、ECRDocumentPicker、ECRAffectedItemPicker、ECRBomImpactView）、`frontend/src/components/ECO/`（ECOCreateModal、ECOEditView）、`frontend/src/components/Inventory/`（DocumentEditModal、DocumentDetail、ComboBox）、`frontend/src/components/Configuration/`（ProfileEditModal、ConfigurationCreateModal、ConfigItemPicker）、`frontend/src/components/EntityEditModal.tsx`、`frontend/src/components/PartDetailModal.tsx`、`frontend/src/components/AssemblyPartPicker.tsx`、`frontend/src/components/CustomFieldInput.tsx`、`frontend/src/components/CADWorkspace/CADConnectStep.tsx`

**替换规则**：
- 标准输入 `<input className="w-full ... px-3 py-2 ... rounded(-lg) border-gray-300 focus:ring-2 ring-primary-500">` → `<Input />`
- 表格内小输入 `px-2 py-1 text-xs` → `<Input size="xs" />`
- `<select>` → `<Select>`（children 不变）；`<textarea>` → `<Textarea>`
- 消除 `focus:ring-1`、`ring-blue-500`、`border-gray-200`（统一 gray-300 值）
- `CustomFieldInput.tsx` 的 `baseClass` 直接替换为 `INPUT_BASE_CLASS` 导入

- [ ] **Step 1: 替换本组表单控件**

搜索模式：`<input`、`<select`、`<textarea` 中带 `border` 的类名。

- [ ] **Step 2: 构建验证**

Run: `cd frontend && npm run build` → PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/ frontend/src/components/
git commit -m "style: 表单输入统一为 ui Input/Select/Textarea 组件"
```

---

### Task 18: 残余色级/色系收敛

**Files:**
- Modify: 按 grep 结果逐一处理

- [ ] **Step 1: 全局 grep 残余状态色**

Run（在 `frontend/src`）：
```
grep -rn "bg-yellow-100\|bg-yellow-50\|bg-blue-50 text-blue-7\|bg-green-50 text-green-7\|bg-amber-50 text-amber-7" .
```
对每一处判断：
- 任务/项目/看板状态上下文 → 已由 Task 11/12 处理，如仍残留说明遗漏，改 `<Badge status domain="task|project" />`
- `yellow`（执行中/可新建/未验证）→ `amber`（`BADGE_DOMAINS` 已处理，遗漏处改用对应 domain）
- 非状态语义（如"逾期"红字、优先级圆点）→ 保留

- [ ] **Step 2: 构建 + 全量测试**

Run: `cd frontend && npm run build` 和 `cd frontend && npm run test`
Expected: 均 PASS

- [ ] **Step 3: 提交**

```bash
git add frontend/src/
git commit -m "style: 残余色级/色系收敛（50→100、yellow→amber）"
```

---

## Phase F — 验收

### Task 19: 全量验收

- [x] **Step 1: 构建与测试**

Run: `cd frontend && npm run build` 和 `cd frontend && npm run test`
Expected: 均 PASS

- [x] **Step 2: grep 校验业务代码无内联状态色**

Run（在 `frontend/src`）：
```
grep -rn "bg-blue-100\|bg-orange-100\|bg-green-100\|bg-red-100\|bg-yellow-100\|bg-teal-100\|bg-purple-100\|bg-indigo-100\|bg-primary-600\|bg-red-500\|bg-red-600\|bg-green-600\|bg-emerald-500" --include="*.tsx" .
```
Expected: 仅 `components/ui/` 与 `constants/` 下文件命中（`badgeMeta.ts`/`buttonMeta.ts` 是 `var(--ui-*)` 类，不应命中；命中 `bg-primary-600` 等的豁免项：移动端分段控件 tab 选中态（Task 16 已声明）、非按钮语义的装饰元素（如进度条、加载动画），逐一确认后记录在提交说明）。

- [x] **Step 3: 桌面逐页抽查**（每页检查：状态/类型/必选徽标、按钮、表单一致；零部件页重点看装配类型徽标已变蓝）

零部件列表/详情、图文档列表/详情、ECR 列表/详情、ECO 列表/详情、构型项/概要、库存（物料/单据）、项目（列表/甘特/任务）、用户管理（角色/状态徽标）、日志、看板、通知、设置、数据管理。

- [x] **Step 4: 移动端逐页抽查**

零部件、图文档、EC、构型、库存、项目、任务详情、通知、更多、看板。

- [x] **Step 5: 验收记录提交**

```bash
git add docs/superpowers/specs/2026-08-22-frontend-style-unification-design.md docs/superpowers/plans/2026-08-22-frontend-style-unification.md
git commit -m "docs: 风格统一验收通过，补充验收记录"
```

---

## Self-Review 记录

- **Spec 覆盖**：映射表 20 域 → Task 2；CSS 变量 → Task 1；Badge/Button/Input 组件 → Task 3-5；桌面徽标 → Task 6-11；移动端徽标 → Task 12；按钮 → Task 13-16；表单 → Task 17；色级/色系收敛 + 冲突修复（必选/可选、装配类型、库存 approved、unverified、disabled 移动端）→ 散落在 Task 6-12 对应模块；多风格预留 → Task 1 变量 + Task 3 元数据；验收 → Task 19。
- **占位符**：无 TBD/TODO；所有任务含实际代码或明确搜索模式与映射规则。
- **类型一致性**：`Badge` props（status/domain/tone/label/size）、`Button` props（variant/size）、`resolveBadge` 签名在 Task 2/4 中定义并贯穿 Task 6-18；`INPUT_BASE_CLASS` 在 Task 5 定义、Task 17 引用。

---

## 验收记录 (2026-08-22)

> 由 Task 19 全量验收生成（分支 feat/mobile2）。本记录同时覆盖构建/测试、grep 校验、桌面/移动端逐页抽查与豁免登记。**验收结论：核心目标达成（DONE），存在 8 处非豁免内联色残留（详见「发现的问题」），需控制器裁决后续处理。**

### Step 1: 构建与测试

| 项目 | 命令 | 结果 |
|---|---|---|
| 生产构建 | `cd frontend && npm run build` | ✅ PASS（`✓ built in 10.43s`，仅既有 chunk-size 警告，非错误） |
| 单元测试 | `cd frontend && npm run test` | ✅ PASS（23 个测试文件 / 159 个用例全部通过，exit 0） |

### Step 2: grep 校验（业务代码内联状态色）

- 命令：`rg -n "bg-blue-100|bg-orange-100|bg-green-100|bg-red-100|bg-yellow-100|bg-teal-100|bg-purple-100|bg-indigo-100|bg-primary-600|bg-red-500|bg-red-600|bg-green-600|bg-emerald-500" -g "*.tsx" frontend/src`
- 结果：**31 处命中，全部位于业务代码**；`components/ui/` 与 `constants/` 下 **0 命中**（`badgeMeta.ts`/`buttonMeta.ts`/`badges.ts` 均为 `var(--ui-*)` 类，符合预期 ✅）。
- 命中分类：**8 处非豁免残留（7 按钮上下文 + 1 徽标上下文）** + **23 处豁免/装饰**（登记如下）。

#### 豁免登记表（23 处，逐一确认）

| # | 文件:行 | 上下文 | 豁免类别 |
|---|---|---|---|
| 1 | pages/Board.tsx:795 | 实体类型筛选 tab 选中态 | 视图切换条/选中态控件 |
| 2 | mobile/MobileLayout.tsx:63 | 通知未读数角标 | 计数小徽标（装饰） |
| 3 | pages/Notifications.tsx:77 | 模块筛选胶囊选中态 | 视图切换条/选中态控件 |
| 4 | pages/MarkdownReader.tsx:120 | 文档信息卡片头部条 | 信息栏（装饰） |
| 5 | components/CADWorkspace/CADBOMMatchTable.tsx:149-150 | BOM 匹配行高亮（new/checked_out） | 行高亮/差异行 |
| 6 | components/Layout.tsx:175 | 同步状态指示圆点 | 状态圆点（装饰） |
| 7 | mobile/pages/DashboardPage.tsx:330 | 未读通知圆点 | 状态圆点（装饰） |
| 8 | pages/Project/Projects.tsx:708 | 甘特刻度视图切换（日/周/月） | 视图切换条/甘特条 |
| 9 | mobile/pages/MorePage.tsx:20 | 用户头像 | 头像（装饰） |
| 10 | mobile/pages/MorePage.tsx:34 | 通知未读数角标 | 计数小徽标（装饰） |
| 11 | components/ECR/ECRAffectedItemPicker.tsx:187 | 类型筛选 tab 选中态 | 视图切换条/选中态控件 |
| 12 | mobile/pages/PartDetailPage.tsx:731 | 版本选择 ✓ 圆钮选中态 | 移动端选中态控件（Task 16 已声明豁免） |
| 13 | mobile/pages/UsersListPage.tsx:70 | 用户头像 | 头像（装饰） |
| 14 | components/ECR/ECRDetailModal.tsx:526 | 状态记录时间线圆点 | 时间线圆点（装饰） |
| 15 | components/Inventory/DocumentDetail.tsx:18-23 | 单据状态时间线圆点/文字 | 时间线圆点（装饰） |
| 16 | components/STPViewer/CompareTreePanel.tsx:189-191 | 对比树 增/删 行高亮 | 差异行 |
| 17 | components/Toast.tsx:69 | Toast 类型配色（error） | Toast（装饰，非按钮） |
| 18-19 | components/Configuration/ConfigurationCreateModal.tsx:363,511 | 必选/可选 交互切换 chip（点击翻转） | 选中态控件（⚠ 见备注①） |
| 20-21 | components/Configuration/ConfigItemDetailModal.tsx:288,434 | 必选/可选 交互切换 chip（点击翻转） | 选中态控件（⚠ 见备注①） |

> 备注①：必选/可选切换 chip 为交互控件（选中态语义），豁免；但配色跨文件不一致——`ConfigurationCreateModal` 为 必选=blue/可选=green，`ConfigItemDetailModal` 为 必选=green/可选=orange；且与 Task 6 冲突修复 #2 的规范（必选=蓝、可选=灰，`PartWhereUsedTab.tsx:88` 已按 Badge 实现）不统一。建议控制器纳入后续收敛。
>
> 另：移动端分段控件选中态已按 Task 16 承诺改用 `bg-[var(--ui-btn-primary-bg)]`（见 `mobile/pages/BomComparePage.tsx:406,412` 等），本次命中项均为非按钮语义装饰/选中态，无需处理。

#### 发现的问题（非豁免残留，8 处 → 交控制器裁决，本次未改动业务代码）

| # | 文件:行 | 上下文 | 分类 | 说明 |
|---|---|---|---|---|
| V1 | pages/Login.tsx:115 | 登录提交按钮 `bg-primary-600` | 按钮上下文 FAIL | 认证页不在 Task 13-16 文件清单内（范围缺口） |
| V2 | pages/FeishuCallback.tsx:52 | 「返回系统设置」`<Link>` 伪装按钮 `bg-primary-600` | 按钮上下文 FAIL | 同上 |
| V3 | pages/WechatCallback.tsx:52 | 「返回系统设置」`<Link>` 伪装按钮 `bg-primary-600` | 按钮上下文 FAIL | 同上 |
| V4 | pages/ForcePasswordChange.tsx:114 | 提交按钮 `bg-primary-600` | 按钮上下文 FAIL | 同上 |
| V5 | components/Modal.tsx:104,106 | ConfirmModal 确认按钮 typeClasses（danger=`bg-red-600`/warning=`bg-orange-500`/info=`bg-primary-600`） | 按钮上下文 FAIL | 共享 Modal 组件未组件化按钮（范围缺口） |
| V6 | components/ImportPreviewModal.tsx:298-301 | 「确认导入」按钮 `bg-primary-600`/`bg-primary-400` | 按钮上下文 FAIL | Task 11 仅处理其徽标，按钮未转换 |
| V7 | components/PartDetailModal.tsx:1076 | 变换矩阵弹窗 STEP 来源标签 `bg-indigo-100 text-indigo-700` | 徽标上下文 FAIL | 类型标签，Task 6/13 覆盖文件内遗漏 |

> V1-V6 为**按钮上下文内联色**（全局约束明确禁止，但均处于任务文件清单之外=范围缺口）；V7 为**徽标上下文**遗漏。按约束约定：**本次不修复**，仅记录上报，建议由控制器安排后续专项（或纳入下轮收敛任务）。

> **19b 关闭说明（后续收尾提交 0aeca50 已全部修复，本表为验收时快照）**：V1-V7 全部转为共享组件——Login/ForcePasswordChange → `Button primary w-full`；FeishuCallback/WechatCallback → `Button`（`<Link>`→`<Button>`+`navigate`，SPA 等价）；Modal ConfirmModal 取消=secondary、确认=success|danger；ImportPreviewModal 取消=secondary、确认导入=primary；PartDetailModal STEP 来源标签 → `<Badge tone="gray" />`。另：备注① 必选/可选 chip 配色已统一为 必选=`--ui-blue-bg`/可选=`--ui-gray-bg`（4 处，与 `required` 域及 `PartWhereUsedTab.tsx:88` 一致）。收尾后全量 grep 由 31 处降至 19 处（均为已登记豁免/装饰上下文）。

### Step 3/4: 逐页抽查（代码级）

> 抽查口径：状态/类型/必选徽标 → `<Badge>`；按钮 → `<Button>`；表单 → `<Input>/<Select>/<Textarea>`；移动端主操作按钮为 touch 尺寸（≥44px）。

**桌面端**

| 页面 | 徽标 | 按钮 | 表单 | 结论 |
|---|---|---|---|---|
| 零部件列表/详情 | Badge（装配类型=蓝 ✅ 修复#1，PartsPage.tsx:264 `tone: 'blue'`） | Button | Input/Select/Textarea | ✅（V7 除外） |
| 图文档列表/详情 | Badge | Button | Input/Select/Textarea | ✅ |
| ECR 列表/详情 | Badge（ECRStatusBadge→Badge） | Button | Input/Select/Textarea | ✅ |
| ECO 列表/详情 | Badge（ECOStatusBadge→Badge） | Button | Input/Select/Textarea | ✅ |
| 构型项/概要 | Badge | Button | Input/Select/Textarea | ✅（必选/可选 chip 见备注①） |
| 库存（物料/单据） | Badge | Button | Input/Select/Textarea | ✅（时间线圆点豁免） |
| 项目 列表/甘特/任务 | Badge | Button | Input/Select/Textarea | ✅（甘特刻度切换豁免；DeliverableModal.tsx:208 灰色状态 chip 未组件化，中性色、非本轮 grep 目标，建议关注） |
| 用户管理 | Badge（RoleTag/StatusTag → Badge domain=role/user） | Button | Input/Select | ✅ |
| 日志 | Badge | Button | Input/Select | ✅ |
| 看板 | Badge（STATUS_TAG 映射 BadgeTone） | Button | Input/Select | ✅ |
| 通知 | 无状态徽标 | 原生中性按钮（页面整体不在任务范围） | 无表单 | ✅（观察：整页未组件化，选中胶囊豁免） |
| 设置 | — | Button | Input/Select/Textarea | ✅ |
| 数据管理 | — | Button | Input | ✅ |

**移动端**

| 页面 | 徽标 | 按钮 | 结论 |
|---|---|---|---|
| 零部件（列表/详情） | Badge | Button（touch：PartsListPage:130、PartDetailPage:759） | ✅（版本选择 ✓ 圆钮选中态豁免） |
| 图文档（列表/详情） | Badge | Button | ✅ |
| EC | Badge | —（列表页无操作按钮） | ✅ |
| 构型（项/概要/详情） | Badge | Button | ✅ |
| 库存 | Badge | — | ✅ |
| 项目（列表/甘特） | Badge | Button | ✅（GanttPage 纯图表无徽标/按钮） |
| 任务详情 | Badge | Button | ✅ |
| 通知 | — | Button（touch：NotificationsPage:120） | ✅ |
| 更多 | 计数角标/头像（豁免） | 原生「退出登录」（MorePage 不在 Task 16 清单） | ✅（观察：退出登录为原生按钮，仅文字红，未组件化） |
| 看板 | Badge | Button | ✅ |

### Step 5: 提交

- 本验收记录提交：`git commit -m "docs: 风格统一验收通过，补充验收记录"`（仅 docs 两个文件）。

### 工作区状态说明（与本任务无关，提请控制器留意）

1. `frontend/src/mobile/components/MobileCardList.tsx` 存在**未提交改动**（onClick 签名增加事件参数 + 行加 `data-anchor`），Task 16 提交说明曾注明该文件「未暂存未改动」，本次验收时发现其已被修改且未提交——疑似并行工作遗留，构建可过，请控制器决定提交或回退。
2. 仓库根目录存在未跟踪文件 `_verify_status.py`（一次性验证脚本残留），未纳入提交。
