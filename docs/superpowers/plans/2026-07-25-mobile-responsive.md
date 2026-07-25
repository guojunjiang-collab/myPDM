# 移动端网页响应式适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有桌面 PDM 网页在手机浏览器上可用——响应式导航、列表卡片化、详情弹窗全屏、3D 查看器触控，桌面端零回归。

**Architecture:** 同一套 React 代码做移动优先叠加改造。以 Tailwind `md`(768px) 为界：`< md` 走移动布局，`≥ md` 保持现桌面。集中改造三处共享件（`Layout`、`Modal`、新增 `ResponsiveTable`），再把高频列表页逐个迁到 `ResponsiveTable`；3D 查看器独立全屏路由单独适配。权限仍按登录角色，不做移动专属只读。

**Tech Stack:** React 18 + TypeScript + Vite + TailwindCSS 3 + react-router-dom 6 + zustand + Vitest；3D 为 @react-three/fiber + @react-three/drei(`ArcballControls`)。

**Spec:** `docs/superpowers/specs/2026-07-25-mobile-responsive-design.md`

---

## File Structure

**新增：**
- `frontend/src/hooks/useIsMobile.ts` — 基于 `matchMedia` 的移动端判定 hook。
- `frontend/src/hooks/useIsMobile.test.ts` — hook 单测。
- `frontend/src/components/ResponsiveTable.tsx` — 桌面渲染 `<table>`、`< md` 渲染卡片列表的共享组件。
- `frontend/src/components/ResponsiveTable.test.tsx` — 组件单测。
- `frontend/src/components/MobileNavDrawer.tsx` — 移动端汉堡抽屉（复用 Layout 的菜单数据）。
- `frontend/src/components/DesktopOnlyNotice.tsx` — 重模块的"请用电脑打开"占位。

**修改：**
- `frontend/src/components/Layout.tsx` — 侧栏 `< md` 隐藏、header 加汉堡、接入抽屉。
- `frontend/src/components/Modal.tsx` — `< md` 全屏。
- `frontend/src/pages/PartsPage.tsx` 等高频列表页 — 表格迁到 `ResponsiveTable`。
- `frontend/src/pages/STPViewer.tsx` + `frontend/src/components/STPViewer/ViewerCanvas.tsx` 等 — 触控、树抽屉、工具折叠、返回按钮。
- `frontend/src/pages/OfficeReader.tsx`、`frontend/src/components/CADWorkspace/*` 入口 — `< md` 显示占位。

**约定（所有任务遵守）：**
- 移动样式写成 `基础类=手机` + `md:原类=桌面`，不删改现有 `md:`/`lg:` 前缀。
- 提交信息用现有中文 `type: 描述` 风格。
- 每个任务结尾 `npm run build` 必须通过（`cd frontend`）。

---

## Task 1: `useIsMobile` hook

**Files:**
- Create: `frontend/src/hooks/useIsMobile.ts`
- Test: `frontend/src/hooks/useIsMobile.test.ts`

- [ ] **Step 1: 写失败测试**

`frontend/src/hooks/useIsMobile.test.ts`:
```ts
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useIsMobile } from './useIsMobile';

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: any) => void> = [];
  const mql = {
    matches,
    media: '(max-width: 767px)',
    addEventListener: (_: string, cb: (e: any) => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: (e: any) => void) => {
      const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1);
    },
    _emit: (m: boolean) => { mql.matches = m; listeners.forEach((cb) => cb({ matches: m })); },
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return mql;
}

describe('useIsMobile', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('returns true when viewport matches mobile query', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => mql._emit(true));
    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/hooks/useIsMobile.test.ts`
Expected: FAIL（`useIsMobile` 未定义 / 模块不存在）。

> 注：若 `@testing-library/react` 未安装，先 `cd frontend && npm i -D @testing-library/react` 再跑。

- [ ] **Step 3: 实现 hook**

`frontend/src/hooks/useIsMobile.ts`:
```ts
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

/** 返回当前是否为移动端视口（< md，767px 及以下）。SSR/无 matchMedia 时返回 false。 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/hooks/useIsMobile.test.ts`
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/hooks/useIsMobile.ts frontend/src/hooks/useIsMobile.test.ts
git commit -m "feat: 新增 useIsMobile 响应式判定 hook"
```

---

## Task 2: `Modal` 移动端全屏

`< md` 时弹窗铺满屏幕、去圆角、去水平外边距；`≥ md` 保持现有居中卡片与 `widthMap`。改共享组件一处即覆盖大部分详情弹窗。

**Files:**
- Modify: `frontend/src/components/Modal.tsx`

- [ ] **Step 1: 改容器类名支持移动全屏**

在 `frontend/src/components/Modal.tsx` 的内层容器（现为 `bg-white rounded-lg shadow-xl w-full mx-4 ${widthMap[width]} ...`）改为移动优先：手机全屏、桌面回到卡片。

把这段：
```tsx
      <div
        className={`bg-white rounded-lg shadow-xl w-full mx-4 ${widthMap[width]} transform transition-transform duration-300 ${
          open ? 'scale-100' : 'scale-95'
        } ${height ? 'flex flex-col' : ''}`}
        style={height ? { height } : undefined}
      >
```
替换为：
```tsx
      <div
        className={`bg-white shadow-xl transform transition-transform duration-300 flex flex-col
          w-full h-full max-h-full rounded-none
          md:w-full md:h-auto md:max-h-[90vh] md:mx-4 md:rounded-lg ${widthMap[width]} ${
          open ? 'scale-100' : 'scale-95'
        }`}
        style={height ? { height: undefined } : undefined}
      >
```
说明：
- 手机：`w-full h-full max-h-full rounded-none` 铺满；`flex flex-col` 让标题固定、内容滚动。
- 桌面：`md:h-auto md:max-h-[90vh] md:mx-4 md:rounded-lg` + `widthMap` 恢复原样。
- `widthMap` 里的 `max-w-*` 在手机上被 `w-full` 覆盖（`max-w` 只限上限，不影响 `< md` 铺满，因为屏幕本就窄）。桌面 `md:` 尺寸不变。
- 原 `height` 内联高度改为不再强制（手机需铺满、桌面用 `max-h`）；下一步让内容区始终可滚动以兼容 `height` 场景。

- [ ] **Step 2: 让内容区始终可滚动**

把内容区这段：
```tsx
        <div className={`px-6 py-4 ${height ? 'flex-1 overflow-auto' : ''}`}>{children}</div>
```
替换为：
```tsx
        <div className="px-4 py-4 md:px-6 flex-1 overflow-auto min-h-0">{children}</div>
```
说明：内容区恒为 `flex-1 overflow-auto min-h-0`，配合 Step 1 的 `flex flex-col`，标题栏固定、内容独立滚动（手机长表单不再溢出）。手机 `px-4` 更省空间，桌面 `md:px-6` 保持原样。

- [ ] **Step 3: 标题栏手机内边距收窄**

把标题栏这段：
```tsx
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
```
替换为：
```tsx
          <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-gray-200 shrink-0">
```
`shrink-0` 保证标题栏在 flex 列中不被压缩。

- [ ] **Step 4: 桌面回归自查 + 构建**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动：桌面浏览器打开任一带详情弹窗页面（如 `/parts` 点开零件详情），确认弹窗仍居中、尺寸不变。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/Modal.tsx
git commit -m "feat: Modal 移动端全屏、内容区可滚动，桌面不变"
```

---

## Task 3: 移动端导航抽屉组件

抽出一个独立抽屉组件，复用 Layout 的菜单，避免把 Layout 改得过大。

**Files:**
- Create: `frontend/src/components/MobileNavDrawer.tsx`

- [ ] **Step 1: 实现抽屉组件**

`frontend/src/components/MobileNavDrawer.tsx`:
```tsx
import { Link, useLocation } from 'react-router-dom';

export type NavItem = { path: string; label: string; icon: string; roles: string[] };
export type NavSeparator = { type: 'separator' };
export type NavEntry = NavItem | NavSeparator;

const isSeparator = (item: NavEntry): item is NavSeparator =>
  'type' in item && item.type === 'separator';

interface Props {
  open: boolean;
  onClose: () => void;
  items: NavEntry[];
  footer?: React.ReactNode;
}

/** 移动端左滑导航抽屉。桌面端不使用（Layout 用 md: 控制）。 */
export default function MobileNavDrawer({ open, onClose, items, footer }: Props) {
  const location = useLocation();
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}>
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      {/* 抽屉本体 */}
      <aside
        className={`absolute top-0 left-0 h-full w-64 max-w-[80vw] bg-white shadow-xl flex flex-col
          transform transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-14 border-b border-gray-200 flex items-center px-4">
          <h1 className="text-lg font-semibold">🏗️ PDM系统</h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {items.map((item, idx) =>
            isSeparator(item) ? (
              <div key={`sep-${idx}`} className="mx-2 my-2 border-t border-gray-300" />
            ) : (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={`flex items-center gap-2 px-3 py-3 rounded-lg mb-1 transition-colors ${
                  location.pathname === item.path
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          )}
        </nav>
        {footer && <div className="p-2 border-t border-gray-200">{footer}</div>}
      </aside>
    </div>
  );
}
```
说明：`px-3 py-3` 保证触控点 ≥ 40px；`md:hidden` 保证桌面永不渲染。

- [ ] **Step 2: 构建**

Run: `cd frontend && npm run build`
Expected: 构建通过（组件已被引用前不应产生未用告警——若 eslint `no-unused` 报错，Task 4 会接入；可先 `npm run build` 只做 tsc+vite，通常不拦未用导出）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/MobileNavDrawer.tsx
git commit -m "feat: 新增移动端导航抽屉组件"
```

---

## Task 4: Layout 接入移动导航（侧栏隐藏 + 汉堡 + 抽屉）

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: 引入 hook/抽屉与开关状态**

在 `frontend/src/components/Layout.tsx` 顶部 import 区加：
```tsx
import MobileNavDrawer from './MobileNavDrawer';
```
在组件内 `const [confirmClearOpen, setConfirmClearOpen] = useState(false);` 附近加：
```tsx
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
```

- [ ] **Step 2: 侧栏桌面专属**

把侧栏 `<aside className="w-56 min-w-56 bg-white border-r border-gray-200 flex flex-col">` 改为：
```tsx
      <aside className="hidden md:flex w-56 min-w-56 bg-white border-r border-gray-200 flex-col">
```
（`hidden md:flex`：手机隐藏，桌面 flex；`flex` 从原类保留到 `md:flex`。）

- [ ] **Step 3: header 加汉堡按钮（仅手机）**

把 header 左侧这段：
```tsx
          <div className="left">
            {headerContent ?? (
              <span className="text-lg font-semibold text-gray-800">
                {(navItems.filter((item): item is NavItem => !isSeparator(item)).find((item) => item.path === location.pathname))?.label || ''}
              </span>
            )}
          </div>
```
替换为：
```tsx
          <div className="left flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 text-gray-600 hover:text-gray-900"
              aria-label="打开菜单"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {headerContent ?? (
              <span className="text-base md:text-lg font-semibold text-gray-800 truncate">
                {(navItems.filter((item): item is NavItem => !isSeparator(item)).find((item) => item.path === location.pathname))?.label || ''}
              </span>
            )}
          </div>
```

- [ ] **Step 4: header 右侧手机精简**

把 header 右侧 `<div className="right flex items-center gap-3">` 改为：
```tsx
          <div className="right flex items-center gap-3">
```
并把其中"同步状态指示器"整块、用户名 `<span className="text-sm text-gray-700">`、角色徽标、分隔符 `|`、手动同步按钮各自加 `hidden md:flex` / `hidden md:inline`（手机只留通知铃与退出）。具体：
- 同步指示器外层 `<div className="flex items-center gap-1 text-xs" ...>` → `<div className="hidden md:flex items-center gap-1 text-xs" ...>`
- `<span className="text-sm text-gray-700">{user?.real_name}</span>` → 加 `hidden md:inline`
- 角色徽标 `<span className={...px-2 py-0.5...}>` → 外面包 `hidden md:inline`（或直接在其 className 前加 `hidden md:inline-block`）
- `<span className="text-gray-300">|</span>` → 加 `hidden md:inline`
- 手动同步 `<button ... title="手动强制同步">` → 加 `hidden md:inline`
- `NotificationBell` 与"退出登录"按钮保留在手机可见。

- [ ] **Step 5: 渲染抽屉**

在 `<FloatingAssistant />` 之前插入：
```tsx
      <MobileNavDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        items={visibleNavItems}
        footer={
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-sm text-gray-700">{user?.real_name}</span>
              <span className="text-xs text-gray-400">
                {{ admin: '管理员', engineer: '工程师', production: '生产人员', guest: '访客' }[user?.role || 'guest'] || user?.role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              退出登录
            </button>
            <div className="text-xs text-gray-400 text-center">{APP_VERSION} · PDM系统</div>
          </div>
        }
      />
```
说明：`visibleNavItems` 已是角色过滤后的菜单（含分隔符），直接复用，抽屉与侧栏内容一致。

- [ ] **Step 6: 构建 + 真机/仿真验证**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动（Chrome DevTools 切 375px）：侧栏消失、header 出现汉堡；点汉堡滑出抽屉、菜单齐全、点项跳转并关闭抽屉、点遮罩关闭。切回桌面(≥768px)：侧栏与 header 与改动前一致。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: Layout 移动端隐藏侧栏、汉堡抽屉导航，桌面不变"
```

---

## Task 5: `ResponsiveTable` 共享组件

一个泛型组件：桌面渲染标准 `<table>`（尽量贴近现有视觉），`< md` 渲染卡片列表。列配置声明每列的表头、取值渲染，以及在卡片里的角色（标题/副标题/徽标/普通字段/隐藏）。

**Files:**
- Create: `frontend/src/components/ResponsiveTable.tsx`
- Test: `frontend/src/components/ResponsiveTable.test.tsx`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/ResponsiveTable.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponsiveTable, type Column } from './ResponsiveTable';

type Row = { id: string; code: string; name: string; status: string };
const rows: Row[] = [
  { id: '1', code: 'P-001', name: '螺栓', status: '已发布' },
  { id: '2', code: 'P-002', name: '螺母', status: '草稿' },
];
const columns: Column<Row>[] = [
  { key: 'code', header: '件号', card: 'title', render: (r) => r.code },
  { key: 'name', header: '名称', card: 'subtitle', render: (r) => r.name },
  { key: 'status', header: '状态', card: 'badge', render: (r) => r.status },
];

function setMobile(mobile: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: mobile, media: '', addEventListener: () => {}, removeEventListener: () => {},
  }));
}

describe('ResponsiveTable', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('renders a table on desktop', () => {
    setMobile(false);
    render(<ResponsiveTable columns={columns} data={rows} rowKey={(r) => r.id} />);
    expect(document.querySelector('table')).toBeTruthy();
    expect(screen.getByText('件号')).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
  });

  it('renders cards (no table) on mobile', () => {
    setMobile(true);
    render(<ResponsiveTable columns={columns} data={rows} rowKey={(r) => r.id} />);
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getByText('螺栓')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    setMobile(true);
    render(<ResponsiveTable columns={columns} data={[]} rowKey={(r) => r.id} emptyText="无匹配数据" />);
    expect(screen.getByText('无匹配数据')).toBeInTheDocument();
  });

  it('calls onRowClick when a row/card is activated', () => {
    setMobile(true);
    const onRowClick = vi.fn();
    render(<ResponsiveTable columns={columns} data={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    screen.getByText('P-001').closest('[data-row]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
```
> 若 `@testing-library/jest-dom` 匹配器（`toBeInTheDocument`）未配置，用 `expect(screen.queryByText(...)).not.toBeNull()` 等价替换，或在 `frontend/src/setupTests.ts` 引入 `@testing-library/jest-dom` 并在 `vite.config` 的 test.setupFiles 挂载。最省事：把 `toBeInTheDocument()` 改为 `!== null` 断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && npx vitest run src/components/ResponsiveTable.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现组件**

`frontend/src/components/ResponsiveTable.tsx`:
```tsx
import { ReactNode } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

export type CardRole = 'title' | 'subtitle' | 'badge' | 'field' | 'hidden';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** 卡片中的角色，默认 'field' */
  card?: CardRole;
  /** 表头/单元格额外类名（对齐、宽度等），仅桌面表格用 */
  thClass?: string;
  tdClass?: string;
  /** 表头点击（排序），仅桌面 */
  onHeaderClick?: () => void;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  loading?: boolean;
  loadingText?: string;
  /** 每张卡片右上角额外操作（如删除），阻止冒泡由调用方处理 */
  rowActions?: (row: T) => ReactNode;
}

export function ResponsiveTable<T>({
  columns, data, rowKey, onRowClick, emptyText = '无匹配数据',
  loading = false, loadingText = '加载中...', rowActions,
}: Props<T>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    if (loading) return <div className="py-8 text-center text-gray-500">{loadingText}</div>;
    if (data.length === 0) return <div className="py-8 text-center text-gray-500">{emptyText}</div>;
    return (
      <div className="space-y-2">
        {data.map((row) => {
          const title = columns.find((c) => c.card === 'title');
          const subtitle = columns.find((c) => c.card === 'subtitle');
          const badges = columns.filter((c) => c.card === 'badge');
          const fields = columns.filter((c) => (c.card ?? 'field') === 'field');
          return (
            <div
              key={rowKey(row)}
              data-row
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`bg-white rounded-lg border border-gray-200 p-3 ${onRowClick ? 'active:bg-gray-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {title && <div className="font-medium text-gray-900 break-all">{title.render(row)}</div>}
                  {subtitle && <div className="text-sm text-gray-500 break-all">{subtitle.render(row)}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {badges.map((b) => <span key={b.key}>{b.render(row)}</span>)}
                  {rowActions?.(row)}
                </div>
              </div>
              {fields.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {fields.map((f) => (
                    <div key={f.key} className="flex gap-1 min-w-0">
                      <dt className="text-gray-400 shrink-0">{f.header}</dt>
                      <dd className="text-gray-700 truncate">{f.render(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // 桌面：标准表格
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={c.onHeaderClick}
                className={`px-4 py-3 text-left text-sm font-medium text-gray-500 whitespace-nowrap ${c.onHeaderClick ? 'cursor-pointer hover:text-gray-700 select-none' : ''} ${c.thClass ?? ''}`}
              >
                {c.header}
              </th>
            ))}
            {rowActions && <th className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500">操作</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {loading ? (
            <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-4 py-8 text-center text-gray-500">{loadingText}</td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-4 py-8 text-center text-gray-500">{emptyText}</td></tr>
          ) : (
            data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 text-sm ${c.tdClass ?? ''}`}>{c.render(row)}</td>
                ))}
                {rowActions && (
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>{rowActions(row)}</td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend && npx vitest run src/components/ResponsiveTable.test.tsx`
Expected: PASS（4 passed）。若用了 `toBeInTheDocument` 且未配置匹配器，按 Step 1 备注改断言后再跑。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ResponsiveTable.tsx frontend/src/components/ResponsiveTable.test.tsx
git commit -m "feat: 新增 ResponsiveTable（桌面表格/移动卡片）组件"
```

---

## Task 6: 迁移零部件页到 ResponsiveTable（样板迁移）

这是**样板任务**：后续列表页照此改。完整展示一次。

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`

- [ ] **Step 1: 引入组件并构造列配置**

在 `frontend/src/pages/PartsPage.tsx` import 区加：
```tsx
import { ResponsiveTable, type Column } from '../components/ResponsiveTable';
```
在 `sortedData` 可用处（渲染前）构造列。用现有 `statusTag`、`versionCountMap`、`showAllVersions`、`handleSort`、`getSortIcon`、`item` 结构：
```tsx
  const columns: Column<PartListItem>[] = [
    {
      key: 'code', header: <>件号 {getSortIcon('code' as keyof PartListItem)}</>, card: 'title',
      thClass: 'w-56', onHeaderClick: () => handleSort('code' as keyof PartListItem),
      render: (item) => (
        <span className="font-medium">
          {item.code}
          {!showAllVersions && (versionCountMap[item.code] || 0) > 1 && (
            <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
              {(versionCountMap[item.code] || 0)}个版本
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'name', header: <>中文名称 {getSortIcon('name' as keyof PartListItem)}</>, card: 'subtitle',
      onHeaderClick: () => handleSort('name' as keyof PartListItem),
      render: (item) => <span className="truncate">{item.name}</span>,
    },
    {
      key: 'version', header: <>版本 {getSortIcon('version' as keyof PartListItem)}</>, card: 'field',
      thClass: 'w-16 text-center', tdClass: 'text-gray-500 text-center',
      onHeaderClick: () => handleSort('version' as keyof PartListItem),
      render: (item) => item.version,
    },
    {
      key: 'type', header: <>类型 {getSortIcon('type' as keyof PartListItem)}</>, card: 'badge',
      thClass: 'w-20 text-center', tdClass: 'text-center',
      onHeaderClick: () => handleSort('type' as keyof PartListItem),
      render: (item) => (
        <span className={`px-2 py-1 text-xs rounded-full ${item.type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
          {item.type === 'assembly' ? '部件' : '零件'}
        </span>
      ),
    },
    {
      key: 'status', header: <>状态 {getSortIcon('status' as keyof PartListItem)}</>, card: 'badge',
      thClass: 'w-20 text-center', tdClass: 'text-center',
      onHeaderClick: () => handleSort('status' as keyof PartListItem),
      render: (item) => (
        <span className={`px-2 py-1 text-xs rounded-full ${statusTag(item.status).cls}`}>
          {statusTag(item.status).label}
        </span>
      ),
    },
    {
      key: 'checkout', header: '签出状态', card: 'field', thClass: 'w-20 text-center', tdClass: 'text-center',
      render: (item) => item.check_out_user_name
        ? <span className="text-orange-600">{item.check_out_user_name}</span>
        : <span className="text-gray-400">—</span>,
    },
  ];
```

- [ ] **Step 2: 用组件替换整段 `<table>` 容器**

把从 `<div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">` 到其对应 `</div>`（包裹整个 `<table>...</table>` 的容器）整段替换为：
```tsx
      <ResponsiveTable
        columns={columns}
        data={sortedData}
        rowKey={(item) => item.revision_id}
        loading={loading}
        emptyText="无匹配数据"
        onRowClick={(item) => openDetail(item.master_id, item.revision_id)}
        rowActions={(item) => (
          user?.role === 'admin' ? (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
              className="text-red-500 hover:text-red-700"
            >
              删除
            </button>
          ) : null
        )}
      />
```

- [ ] **Step 3: 构建 + 双端验证**

Run: `cd frontend && npm run build`
Expected: 构建通过（注意 `sortedData` 元素类型是否为 `PartListItem`；若为派生类型，把 `Column<PartListItem>` 与 `rowKey`/`render` 的入参类型对齐）。
手动：桌面 `/parts` 看表格、排序、点击进详情、admin 删除按钮均正常；375px 下每行变卡片（件号为标题、名称副标题、类型/状态徽标、版本/签出为字段、删除在右上），点卡片进详情。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/PartsPage.tsx
git commit -m "feat: 零部件列表迁移到 ResponsiveTable，移动端卡片化"
```

---

## Task 7: 迁移图文档页

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`

- [ ] **Step 1: 读取现有表格结构**

Run: `grep -nE "<thead|<th |<td |<tr |openDetail|onClick=|map\(" frontend/src/pages/Documents.tsx`
记录：各列表头文案、每列 `render` 用到的字段/徽标、行点击处理、行内操作按钮、加载/空态、rowKey 字段。

- [ ] **Step 2: 按 Task 6 的模式构造 `columns` 并替换 `<table>`**

参照 Task 6：
- import `ResponsiveTable, type Column`。
- 主标识列（文档编号/名称）设 `card: 'title'`；次要名称/类型设 `card: 'subtitle'`；状态/密级等徽标设 `card: 'badge'`；其余设 `card: 'field'`。
- 排序列把原 `onClick={() => handleSort(...)}` 移到 `onHeaderClick`，表头文案含 `getSortIcon(...)`。
- 行点击移到 `onRowClick`；行内删除/操作移到 `rowActions`（内部 `e.stopPropagation()`）。
- 用组件替换整个表格容器 `<div>...<table>...</table></div>`。

- [ ] **Step 3: 构建 + 双端验证**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动：桌面表格与改动前一致；375px 下卡片化、点击进详情、操作可用。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/Documents.tsx
git commit -m "feat: 图文档列表迁移到 ResponsiveTable，移动端卡片化"
```

---

## Task 8: 迁移构型管理页

**Files:**
- Modify: `frontend/src/pages/Configuration.tsx`（及其在 `components/Configuration/` 下的列表子组件，若表格在子组件中）

- [ ] **Step 1: 定位表格所在文件**

Run: `grep -rnl "<table" frontend/src/pages/Configuration.tsx frontend/src/components/Configuration/`
在含 `<table>` 的文件里操作。

- [ ] **Step 2: 按 Task 6 模式迁移**

同 Task 7 Step 2：构造 `columns`（构型编号/名称为 title/subtitle，状态/版本徽标为 badge，其余 field），排序移 `onHeaderClick`，行点击移 `onRowClick`，行操作移 `rowActions`，替换表格容器。

- [ ] **Step 3: 构建 + 双端验证**

Run: `cd frontend && npm run build`
Expected: 构建通过；桌面无回归；375px 卡片化正常。

- [ ] **Step 4: 提交**

```bash
git add -A frontend/src/pages/Configuration.tsx frontend/src/components/Configuration/
git commit -m "feat: 构型列表迁移到 ResponsiveTable，移动端卡片化"
```

---

## Task 9: 迁移变更 / 库存 / 看板 / 仪表盘列表

对每个页面各做一遍 Task 6 的模式。逐页独立提交。

**Files（逐一处理，含 `<table>` 的实际文件以 grep 结果为准）：**
- `frontend/src/pages/EC.tsx`（变更）
- `frontend/src/pages/Inventory.tsx` 及 `frontend/src/components/Inventory/*`（库存，5 类单据表格）
- `frontend/src/pages/Board.tsx`（看板）
- `frontend/src/pages/Dashboard/*`（仪表盘中的列表/表格）

- [ ] **Step 1: 逐页定位表格**

Run: `grep -rnl "<table" frontend/src/pages/EC.tsx frontend/src/pages/Inventory.tsx frontend/src/components/Inventory frontend/src/pages/Board.tsx frontend/src/pages/Dashboard`

- [ ] **Step 2: 逐页迁移（每页一个提交）**

对每个含 `<table>` 的文件，重复 Task 6 模式：`columns` 配置 → 卡片角色分配（主标识 title、次要 subtitle、状态类 badge、其余 field）→ 排序移 `onHeaderClick` → 行点击移 `onRowClick` → 行操作移 `rowActions` → 替换表格容器。每完成一页：
```bash
cd frontend && npm run build   # 必须通过
```
然后：
```bash
git add -A frontend/src/pages/<该页>
git commit -m "feat: <该模块>列表迁移到 ResponsiveTable，移动端卡片化"
```

- [ ] **Step 3: 全量双端回归**

Chrome DevTools 375px 逐页点一遍：EC、Inventory 各单据、Board、Dashboard 均卡片化、可进详情；切桌面确认无回归。

---

## Task 10: 3D 查看器触控（`touch-action: none`）

让画布吃掉触控手势，避免浏览器把拖动/双指当成页面滚动缩放。

**Files:**
- Modify: `frontend/src/components/STPViewer/ViewerCanvas.tsx`

- [ ] **Step 1: 给 Canvas 加 touch-action**

在 `frontend/src/components/STPViewer/ViewerCanvas.tsx` 的 `<Canvas ... style={{ width: '100%', height: '100%', background: '#e8e8e8' }}>`，把 style 改为：
```tsx
      style={{ width: '100%', height: '100%', background: '#e8e8e8', touchAction: 'none' }}
```
并给 `gl` 限制 dpr 上限，减轻手机负载——在 `<Canvas>` 上加属性：
```tsx
      dpr={[1, 2]}
```

- [ ] **Step 2: 构建 + 真机验证**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动（真机或 DevTools 触控仿真）：进入 `/stp-viewer`，单指旋转、双指捏合缩放、双指拖动平移均作用于模型，且页面本身不滚动/不缩放。若 `ArcballControls` 手势不灵敏，在 `CameraController.tsx` 已有的 `controlsRef.current` 初始化处调整（如保持 `rotateSpeed`，必要时设 `(controlsRef.current as any).setGizmosVisible?.(false)` 以免手机误触 gizmo）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/STPViewer/ViewerCanvas.tsx
git commit -m "feat: 3D 画布 touch-action:none 支持移动触控，限制 dpr"
```

---

## Task 11: 3D 查看器模型树抽屉化 + 返回按钮

`< md` 时把左侧固定树面板改为可切换的覆盖抽屉，并在全屏路由加返回入口。

**Files:**
- Modify: `frontend/src/pages/STPViewer.tsx`

- [ ] **Step 1: 引入状态与判定**

在 `frontend/src/pages/STPViewer.tsx` import 区加：
```tsx
import { useIsMobile } from '../hooks/useIsMobile';
```
在组件顶部状态区加：
```tsx
  const isMobile = useIsMobile();
  const [treePanelOpen, setTreePanelOpen] = useState(false);
```

- [ ] **Step 2: 树面板按端切换渲染**

找到渲染树面板的容器（现为根 `<div className="w-screen h-screen relative flex">` 内、宽度受 `treeWidth` 控制、包着 `<ModelTreePanel />` 的块）。改为：
- `≥ md`：保持原固定侧栏（`hidden md:flex` + 原 `style={{ width: treeWidth }}` 与拖拽手柄）。
- `< md`：不占布局，改为覆盖抽屉。

把树面板外层容器类名加 `hidden md:flex`，其拖拽手柄一并置于该容器内（手机不显示）。然后在根 div 内、canvas 区域之上追加移动抽屉：
```tsx
      {isMobile && (
        <>
          <button
            onClick={() => setTreePanelOpen(true)}
            className="absolute top-3 left-3 z-40 md:hidden bg-white/90 rounded-full shadow px-3 py-1.5 text-sm"
          >
            模型树
          </button>
          <div className={`fixed inset-0 z-40 md:hidden ${treePanelOpen ? '' : 'pointer-events-none'}`}>
            <div
              className={`absolute inset-0 bg-black/40 transition-opacity ${treePanelOpen ? 'opacity-100' : 'opacity-0'}`}
              onClick={() => setTreePanelOpen(false)}
            />
            <div className={`absolute top-0 left-0 h-full w-72 max-w-[85vw] bg-white shadow-xl overflow-y-auto
              transform transition-transform ${treePanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
              <div className="h-12 flex items-center justify-between px-3 border-b">
                <span className="font-medium">模型树</span>
                <button onClick={() => setTreePanelOpen(false)} className="text-gray-400 text-xl">×</button>
              </div>
              <ModelTreePanel />
            </div>
          </div>
        </>
      )}
```
说明：`ModelTreePanel` 用共享 store（`useViewerStore`），两处渲染共享同一状态，选中/显隐一致。

- [ ] **Step 3: 加返回按钮**

在根 div 内右上角追加（全屏路由无 Layout 返回入口）：
```tsx
      <button
        onClick={() => window.history.length > 1 ? window.history.back() : window.close()}
        className="absolute top-3 right-3 z-40 bg-white/90 rounded-full shadow w-9 h-9 flex items-center justify-center text-gray-600"
        aria-label="返回"
      >
        ←
      </button>
```
> 注：右上角已有状态徽标块（`absolute top-3 right-3 ... pointer-events-none`）。为避免重叠，把返回按钮放 `top-3 right-3`、把原徽标块下移为 `top-14 right-3`，或将返回按钮改到 `top-3 left-14`（在"模型树"按钮右侧）。实施时二选一，保证不重叠且都可点。

- [ ] **Step 4: 构建 + 真机验证**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动：`≥ md` 树面板与拖拽调宽如常；375px 下侧树消失、左上"模型树"按钮打开抽屉、树可展开/选中并联动高亮、返回按钮可用。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/STPViewer.tsx
git commit -m "feat: 3D 查看器移动端模型树抽屉化、加返回按钮"
```

---

## Task 12: 3D 工具控件移动端折叠（评估后实施）

测量/剖切/爆炸等工具在小屏折叠进浮动菜单。先定位它们的 UI 位置再决定改动范围。

**Files:**
- Modify: 3D 工具的 UI 触发处（以 grep 结果为准，可能在 `pages/STPViewer.tsx` 或 `components/STPViewer/` 的工具条组件）

- [ ] **Step 1: 定位工具 UI**

Run: `grep -rnE "测量|剖切|爆炸|Measure|Section|Explode" frontend/src/pages/STPViewer.tsx frontend/src/components/STPViewer/ | grep -iE "button|onClick|className"`
判断工具触发按钮是否已在页面上有可见控件。若工具仅由键盘/store 驱动而无按钮，本任务只需保证现有触点在手机可点（≥40px），可跳过折叠菜单。

- [ ] **Step 2: 折叠为浮动菜单（若有工具条）**

若存在工具条容器，`< md` 时用一个"工具"浮动按钮 + 展开面板包裹现有按钮：
```tsx
// 伪结构：<div className="md:flex ...原工具条">  →  桌面保留；移动端包一层可展开面板
```
具体：给原工具条加 `hidden md:flex`；新增移动版：
```tsx
      <div className="md:hidden absolute bottom-4 right-4 z-40">
        <details className="bg-white/95 rounded-lg shadow">
          <summary className="list-none px-4 py-2 cursor-pointer select-none">工具</summary>
          <div className="p-2 flex flex-col gap-2">
            {/* 把原工具按钮复制进来，或抽成子组件在两处复用 */}
          </div>
        </details>
      </div>
```
若工具按钮逻辑复杂，抽成 `components/STPViewer/ViewerTools.tsx` 子组件在桌面工具条与移动 `<details>` 两处复用（避免重复）。

- [ ] **Step 3: 构建 + 验证**

Run: `cd frontend && npm run build`
Expected: 构建通过；桌面工具条不变；375px 下工具收进右下浮动菜单且可用。

- [ ] **Step 4: 提交**

```bash
git add -A frontend/src/pages/STPViewer.tsx frontend/src/components/STPViewer/
git commit -m "feat: 3D 查看器工具控件移动端折叠"
```

---

## Task 13: 重模块占位（CAD 工作台 / OfficeReader）

`< md` 时对未适配的重模块显示"请用电脑打开"，不加载重资源。

**Files:**
- Create: `frontend/src/components/DesktopOnlyNotice.tsx`
- Modify: `frontend/src/pages/OfficeReader.tsx`；CAD 工作台入口（`components/CADWorkspace/` 的顶层组件或其页面）

- [ ] **Step 1: 占位组件**

`frontend/src/components/DesktopOnlyNotice.tsx`:
```tsx
export default function DesktopOnlyNotice({ feature = '该功能' }: { feature?: string }) {
  return (
    <div className="w-full h-full min-h-[50vh] flex flex-col items-center justify-center text-center px-6 gap-3">
      <div className="text-4xl">🖥️</div>
      <div className="text-lg font-medium text-gray-800">{feature}暂不支持手机</div>
      <div className="text-sm text-gray-500">请使用电脑浏览器打开以获得完整体验</div>
    </div>
  );
}
```

- [ ] **Step 2: 在重模块入口按端短路**

在 `frontend/src/pages/OfficeReader.tsx` 组件返回前加（import `useIsMobile`、`DesktopOnlyNotice`）：
```tsx
  const isMobile = useIsMobile();
  if (isMobile) return <DesktopOnlyNotice feature="文档在线阅读" />;
```
对 CAD 工作台顶层组件同样处理：
```tsx
  const isMobile = useIsMobile();
  if (isMobile) return <DesktopOnlyNotice feature="CAD 工作台" />;
```
> 用 grep 定位 CAD 工作台的顶层渲染组件：`grep -rnl "CADWorkspace" frontend/src/pages frontend/src/components/CADWorkspace`，在其页面级容器加短路。

- [ ] **Step 3: 构建 + 验证**

Run: `cd frontend && npm run build`
Expected: 构建通过。
手动：375px 打开 OfficeReader / CAD 工作台入口显示占位；桌面正常加载。

- [ ] **Step 4: 提交**

```bash
git add -A frontend/src/components/DesktopOnlyNotice.tsx frontend/src/pages/OfficeReader.tsx frontend/src/components/CADWorkspace
git commit -m "feat: 手机端 CAD 工作台/文档阅读显示请用电脑打开占位"
```

---

## Task 14: 剩余表格兜底 + 全站移动回归

未迁到 `ResponsiveTable` 的详情内嵌小表，统一套横向滚动兜底，避免撑破手机布局；再做一次整体回归。

**Files:**
- Modify: 仍含裸 `<table>` 且未包裹滚动容器的文件（以 grep 为准）

- [ ] **Step 1: 找出未处理的裸表格**

Run: `grep -rn "<table" frontend/src/ | grep -v ResponsiveTable`
对每处，确认其外层是否已有 `overflow-x-auto` 或 `overflow-auto` 容器。

- [ ] **Step 2: 加横向滚动兜底**

对没有滚动容器的 `<table>`，在其外层包一层：
```tsx
<div className="overflow-x-auto -mx-2 px-2">
  <table ...>...</table>
</div>
```
（`-mx-2 px-2` 让滚动条贴边不产生额外留白；桌面无影响。）

- [ ] **Step 3: 全站移动回归清单**

Chrome DevTools 375px + 一台真机，逐项确认：
- 导航：汉堡抽屉、菜单跳转、桌面侧栏无回归。
- 详情：主要弹窗全屏、内容可滚动、关闭正常。
- 列表：Task 6–9 各页卡片化、点击进详情、行操作可用。
- 3D：进入、单指旋转、双指缩放/平移、模型树抽屉、返回按钮。
- 占位：CAD/OfficeReader 显示"请用电脑打开"。
- 兜底：其余表格可横向滑动、不撑破页面。
- 桌面（≥768px）逐页对比，确认零回归。

- [ ] **Step 4: 最终构建**

Run: `cd frontend && npm run build`
Expected: 构建通过。

- [ ] **Step 5: 提交**

```bash
git add -A frontend/src
git commit -m "feat: 剩余表格移动端横向滚动兜底"
```

---

## 完成标准

- 高频列表页在手机上全部卡片化，可查看、进详情。
- 导航、详情弹窗在手机上可用，桌面零回归。
- 3D 查看器手机可触控查看、看模型树。
- CAD 工作台 / OfficeReader 手机显示占位。
- `cd frontend && npm run build` 通过；`useIsMobile`、`ResponsiveTable` 单测绿。
