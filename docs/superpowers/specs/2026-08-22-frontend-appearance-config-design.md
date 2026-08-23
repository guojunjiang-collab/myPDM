# 前端外观配置扩展与树形组件统一设计

> 日期：2026-08-22
> 状态：已批准（PM 三问三答确认）
> 前置：`2026-08-22-frontend-style-unification-design.md`（徽标/按钮/表单 var(--ui-*) 化 + 多主题切换器，已完成）

## 背景与目标

风格统一轮已把徽标/按钮/表单全部 token 化（46 个 `--ui-*` 变量）并落地多主题切换器（`html[data-theme]` + localStorage + 设置页/更多页入口）。本设计在此基础上扩展：

1. **字体可配置**：字族、字号档位、行高 token 化，主题可携带字体预设
2. **背景可配置**：页面底/卡片/斑马纹/悬停/边框/文字灰阶 token 化，主题可携带背景预设
3. **树形统一**：展开折叠符号（SVG chevron + 旋转动画）与缩进量全端统一

原则延续：业务代码零感知（尽可能）、语义色稳定、主题即预设（不新增独立设置项，字号调节预留二期）。

## 现状调查

### 树形符号（26 处，4 套并存）

| 符号 | 使用方 | 备注 |
|---|---|---|
| `▼ / ▶` | 桌面 13 处：ArchiveTreeModal:44、AssemblyPartPicker:338、ConfigItemPicker:160、ConfigurationCreateModal:589、ProfileCompareModal:171、ConfigurationDetailModal:193/240/282、ECOCreateModal:823、ECOEditView:101、ECODetailModal:534、ECRBomImpactView:264、Board:658、BomWhereUsedTree:152 | 尺寸/颜色各异：text-gray-400 w-3 / text-xs / w-5 h-5 / ml-1 |
| `▾ / ▸` | 移动 7 处：BoardPage:297、ConfigTree:85、BomComparePage:510、BomTree:115、TaskRowCells:39/43、UsersListPage:305、ProjectsPage:112 | — |
| `⋯` 加载态 | ConfigTree:85、BomTree:115 | 展开切换中 |
| `•` 叶子 | ProjectsPage:112 | 无子节点占位 |
| 杂项 | TaskEditModal:690/705（`▶ 开始任务` 按钮文案）、DocumentTab:135（`+ 新建单据 ▾` 下拉） | 非树符号，不动 |

### 缩进步长（12 处，5 种步长 10~20px）

| 步长 | 使用方 |
|---|---|
| `depth*16 + 8` | Board:653 |
| `16 + depth*20` | ArchiveTreeModal:42 |
| `8 + level*12` | PartDetailModal:358、ConfigItemDetailModal:252 |
| `row.level*12` | CADBOMMatchTable:882 |
| `8 + indent`（indent 变量） | CompareTreePanel:53/70/117、ModelTreePanel:73 |
| `depth*10` | 移动 GanttPage:162/169 |
| `(depth+1)*INDENT + BTN` | 移动 BomTree:169/174/179、ConfigTree:130/135/140 |

### 字体与背景

- 字体：`tailwind.config.js` `fontFamily.sans: Inter + system-ui`；`index.css` body 16px/行高 1.5；业务代码大量 `text-xs`(12px)/`text-sm`(14px)/`text-base` 硬编码类；**无字号 token**
- 背景：仅 `--color-bg: #f5f5f5` 进变量；`bg-white`/`bg-gray-50`/`hover:bg-gray-100`/`border-gray-200`/`text-gray-900/600/400` 等全部硬编码

## 决策记录（PM 确认，binding）

1. **可配置粒度**：主题预设扩展——每个主题自带字体+背景预设，选主题即换全套；不新增独立设置项
2. **树形统一程度**：共享组件（TreeToggle）+ 缩进 token，存量逐处收敛；不做通用 Tree 组件重构
3. **符号选型**：SVG chevron（展开 ▾ / 折叠 ▸）+ 旋转动画，桌面移动同一套
4. **背景替换范围**：高频表面类（页面底/卡片/斑马纹/悬停/边框/主次文字），机械替换可控；不追求全部灰阶 token 化
5. **字号档位**：三个浅色主题预设先全部 1.0（机制落地不缩放），字号调节留二期独立设置项
6. **（追加）黑夜模式**：本轮同时支持深色主题 `html[data-theme="dark"]`——基于背景 token 化基础设施，业务代码零改动；主题集变为 3 浅色 + 1 深色

## 变量层设计

### 字体组（新增 5 个，进 :root）

```css
--ui-font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--ui-font-scale: 1;          /* 字号档位：0.9 紧凑 / 1 标准 / 1.1 宽松（二期设置项驱动） */
--ui-font-size-sm: 12px;     /* 对应 text-xs */
--ui-font-size-base: 14px;   /* 对应 text-sm */
--ui-font-size-lg: 16px;     /* 对应 text-base */
--ui-line-height: 1.5;
```

### 背景组（新增 8 个，进 :root）

| 变量 | 默认值 | 替换目标类 |
|---|---|---|
| `--ui-bg-page` | `#f5f5f5` | body 底色（对齐 `--color-bg`） |
| `--ui-bg-surface` | `#ffffff` | `bg-white`（卡片/表格/侧边栏/弹窗） |
| `--ui-bg-subtle` | `#f9fafb` | `bg-gray-50`（斑马纹/表头/输入禁用底） |
| `--ui-bg-hover` | `#f3f4f6` | `hover:bg-gray-100`、`hover:bg-gray-50` |
| `--ui-border` | `#e5e7eb` | `border-gray-200` |
| `--ui-text-primary` | `#111827` | `text-gray-900` |
| `--ui-text-secondary` | `#6b7280` | `text-gray-600`、`text-gray-500` |
| `--ui-text-tertiary` | `#9ca3af` | `text-gray-400` |

### 树组（新增 1 个）

```css
--ui-tree-indent: 14px;      /* 每级缩进步长（统一 10~20px 五种步长） */
```

### 主题预设（forest/warm 覆盖块扩展）

- 继承 :root 全部变量，仅覆盖差异化项
- `forest`：背景带冷调微差（如 `--ui-bg-page: #f4f7f5`、`--ui-bg-surface: #ffffff`、`--ui-border: #e2e8e4`）；字号 1.0
- `warm`：背景带暖调微差（如 `--ui-bg-page: #faf7f5`、`--ui-bg-surface: #fffdfb`、`--ui-border: #ece3dd`）；字号 1.0
- 默认（:root）：现值

### 深色主题（`html[data-theme="dark"]`，本轮新增）

基于背景 token 化基础设施，深色模式 = 一套变量覆盖集 + 深色灰阶补偿块，业务代码零改动。

**变量覆盖集（~50 个，深色值）**：

- 背景组：`--ui-bg-page: #0f172a`、`--ui-bg-surface: #1e293b`、`--ui-bg-subtle: #334155`、`--ui-bg-hover: #475569`、`--ui-border: #334155`、`--ui-text-primary: #f8fafc`、`--ui-text-secondary: #cbd5e1`、`--ui-text-tertiary: #94a3b8`
- 徽标 9 组深色版：bg 用 15% 透明度色、text 用 300 级亮色（示例：blue `rgba(59,130,246,.15)` / `#93c5fd`；green `rgba(34,197,94,.15)` / `#86efac`；red `rgba(239,68,68,.15)` / `#fca5a5`；amber `rgba(245,158,11,.15)` / `#fcd34d`；gray `rgba(148,163,184,.18)` / `#cbd5e1`；orange/teal/purple/indigo 同理）——保持色相识别性
- 按钮：primary bg 微亮（`#0284c7` 系不变或 `#0ea5e9`）、hover/active 递减；secondary/ghost 深色底浅色字；danger/success/dark 保持 bg + 白字（`--ui-btn-*-text` 已有）
- 表单：input bg `#0f172a`、border `#334155`、text `#e2e8f0`、placeholder `#64748b`、focus ring `#38bdf8`、disabled 底 `#1e293b`/字 `#64748b`
- 字体组：不覆盖（字号与主题无关）
- 树缩进：不覆盖

**深色灰阶补偿块**（关键：解决豁免类在深色下的浅色残留）：

```css
/* specificity (0,2,0) > Tailwind 类 (0,1,0)，仅深色生效，浅色零影响 */
html[data-theme='dark'] .text-gray-700,
html[data-theme='dark'] .text-gray-600 { color: #cbd5e1; }
html[data-theme='dark'] .text-gray-500 { color: #94a3b8; }
html[data-theme='dark'] .text-gray-300 { color: #64748b; }
html[data-theme='dark'] .bg-gray-100 { background-color: #334155; }
html[data-theme='dark'] .bg-gray-200 { background-color: #475569; }
html[data-theme='dark'] .border-gray-100,
html[data-theme='dark'] .border-gray-300 { border-color: #334155; }
/* divide-gray-*、hover:bg-gray-* 同理（~20-30 条，grep 高频类驱动） */
```

- **状态色/装饰色在深色下保持语义色**（bg-green-50/text-green-700 等 diff 行、时间线点、toast、进度条）：原则「语义色稳定」，深色下状态色仍显眼属预期——**待 PM 确认**
- 硬编码 primary 类（`bg-primary-600` 分段控件选中态 ~14 处、头像）：深色下保持品牌亮蓝，可接受；如需随主题，列入补偿块（`html[data-theme='dark'] .bg-primary-600 { background-color: var(--ui-btn-primary-bg); }`）

### 主题集与切换入口

- 主题集：3 浅色（默认蓝/森林绿/酒红）+ 1 深色（`data-theme="dark"`，UI 称「深色」）= 4 个；`theme.ts` THEMES 加 `{ key: 'dark', label: '深色', desc: '黑夜模式，暗色护眼界面', swatch: '#111827' }`
- `index.html` 防闪烁脚本允许集合加 `'dark'`（`isThemeKey` 由 THEMES 驱动自动覆盖）
- 选择器 UI（设置页「界面主题」tab / 更多页分区）：4 个选项，按浅色/深色分组展示（分组标签「浅色」「深色」，仅视觉分组不改变交互）
- 切换即时生效（CSS 变量响应式），localStorage 持久化机制不变

## 字体机制（零业务改动）

Tailwind 3 的 `text-xs/sm/base` 为编译期固定值。在 `index.css` 用 `@layer utilities` 同名覆盖使其读 var：

```css
@layer utilities {
  .text-xs   { font-size: var(--ui-font-size-sm); }
  .text-sm   { font-size: var(--ui-font-size-base); }
  .text-base { font-size: var(--ui-font-size-lg); }
}
```

- `body { font-family: var(--ui-font-family); font-size: calc(var(--ui-font-size-lg) * var(--ui-font-scale)); line-height: var(--ui-line-height); }`
- 切换主题即整体缩放字号档位，业务代码零替换
- **风险（关键）**：CSS 输出顺序——Tailwind 生成的 `.text-xs` 可能位于我们的 utilities 之后导致覆盖失效（风格统一轮同类教训）。**实施第一步必须 build 后实测 dist CSS 顺序**，必要时对这三个类加 `!important` 或改用其他优先级手段；加 `!important` 需在验收 grep 中确认无意外副作用（如徽标/按钮内 text-xs 大小随之变化属预期）

## 背景替换（一轮机械替换）

### 替换映射（高频表面类）

| 原类 | 替换为 | 说明 |
|---|---|---|
| `bg-white` | `bg-[var(--ui-bg-surface)]` | 含 `bg-white/` 透明变体按上下文判断 |
| `bg-gray-50` | `bg-[var(--ui-bg-subtle)]` | 斑马纹/表头/禁用底 |
| `hover:bg-gray-100` / `hover:bg-gray-50` | `hover:bg-[var(--ui-bg-hover)]` | 悬停 |
| `border-gray-200` | `border-[var(--ui-border)]` | 通用边框 |
| `text-gray-900` | `text-[var(--ui-text-primary)]` | 主文字 |
| `text-gray-600` / `text-gray-500` | `text-[var(--ui-text-secondary)]` | 次文字 |
| `text-gray-400` | `text-[var(--ui-text-tertiary)]` | 弱文字 |

### 范围与豁免

- 范围：桌面 + 移动全量（grep 清单驱动，分模块替换）
- **豁免（保留硬编码）**：非表面语义的灰阶——diff 行底色（red-50/green-50）、状态色、`bg-gray-100`（次级面，如 hover 目标）、`text-gray-700`（强调次文字，未 token 化）、`divide-gray-100/200`、`bg-gray-100` 用于 tab 未选中态等；以及 components/ui/ 与 constants/ 内部
- 具体豁免清单在实施 grep 时逐条判定登记（沿用风格统一轮 23 类豁免登记法）

## 树形统一

### TreeToggle 共享组件（`components/ui/TreeToggle.tsx`）

- **SVG chevron**：单一 path（`M9 6l6 6-6 6` 竖向右 chevron），展开态 `rotate-90`（CSS transition 0.15s），折叠态 0°
- **规格**：图标 `w-4 h-4`（size="sm" 时 `w-3.5 h-3.5`）；可点区域 `w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--ui-bg-hover)]`；颜色 `text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)]`
- **props**：`expanded: boolean`、`onClick?: () => void`、`loading?: boolean`（显示 `⋯` 动画替代 chevron）、`leaf?: boolean`（渲染透明占位保持对齐，不响应点击）、`size?: 'sm' | 'md'`、`title?`、`disabled?`
- 无子节点时由使用方传 `leaf` 或条件渲染（保留占位宽度防抖动）

### 缩进收敛公式

- 递归 div 型：`paddingLeft: depth * INDENT`，INDENT 常量改为 `var(--ui-tree-indent)`（14px）
- 表格型：`paddingLeft: 基准 + level * var(--ui-tree-indent)`（基准 = 表头列基准 28/8px 等，维持表头与内容对齐）
- 移动端 BomTree/ConfigTree 的 `(depth+1)*INDENT + BTN` 保持公式结构，仅 INDENT 值统一

### 存量收敛清单

- 26 处符号 → TreeToggle（含 ProjectsPage `•` 叶子 → leaf 占位、ConfigTree/BomTree `⋯` → loading prop）
- 12 处缩进公式 → 统一 token
- 不动：TaskEditModal `▶ 开始任务`（按钮文案）、DocumentTab `+ 新建单据 ▾`（下拉指示）

## 工程流程（沿用风格统一轮 SDD 模式）

| 阶段 | 内容 |
|---|---|
| P0 | 变量层（字体组/背景组/树组 + 主题预设扩展）+ utilities 覆盖 + **dist CSS 顺序实测**（风险验证） |
| P1 | TreeToggle 组件 |
| P2 | 树形收敛：26 符号 + 12 缩进（桌面 → 移动） |
| P3 | 背景类替换：grep 清单 → 分模块桌面 → 移动（豁免登记） |
| P4 | 验收：build + test + grep（表面类残留仅限豁免）+ 逐页抽查 + 文档（本设计文档 + 计划文档验收记录） |

## 验收标准

1. `cd frontend && npm run build` PASS；`npm run test` PASS（node 环境，现有 162 用例 + 新增纯函数测试如适用）
2. 四主题切换：字体/背景 token 随 `data-theme` 即时切换（无闪烁、无布局崩坏）；深色下页面/卡片/文字/边框/表单/徽标全部深色适配，无大面积浅色残留（灰阶补偿块覆盖的高频类无残留；状态色保持语义色属预期）
3. grep：业务代码表面类残留仅限豁免清单；树形符号 `▶▼▾▸` 业务代码 0 处（TreeToggle 内部除外）
4. 桌面/移动逐页抽查：树展开/折叠交互正常（旋转动画、加载态、叶子占位）、表格对齐不破坏；**深色下逐页抽查**（表格斑马纹、弹窗、侧边栏、表单、徽标可读性、对比度基本达标）
5. 验收记录提交（docs）

## 二期预留（不在本轮）

- 字号档位独立设置项（`--ui-font-scale` 由 localStorage 驱动，机制已就绪零代码改动）
- 深色下残余状态色的进一步适配（若 PM 验收后认为状态色在深色下仍刺眼，可加深色版状态色补偿）

## 验收结论 (2026-08-22)

- 构建/测试双 PASS（`npm run build` ✓ / `npm run test` 162 用例全通过，含 theme.test.ts 3 例）。
- grep：表面类残留仅限豁免清单（10 处全归类，非豁免 0）；树符号字面 0 处非豁免——但发现 `BOMTreeTable.tsx:145,212` 以 `\u25BC/\u25B6` 转义渲染 ▼/▶ 的真实遗留（字面 grep 漏检），详见计划文档验收记录 §7。
- 四主题代码级抽查通过：THEMES 4 条目、Settings/MorePage 浅色+深色分组、dark 变量块（背景/徽标9组/按钮/表单）+ 灰阶补偿块、`bg-[var(--ui-bg-surface)]` 214 处（桌面+移动）。
- 实际视觉渲染未在浏览器验证（代码级验收）；深色逐页视觉确认由控制器/PM 在浏览器完成。

> **跟进注记（2026-08-22 收尾）**：验收发现的 BOMTreeTable 转义树符号（`\u25BC/\u25B6`）及同源 4 处（EntityEditModal / ProfileEditModal×2 / ConfigurationCreateModal）已全部收敛为共享 TreeToggle（`908b372` + `38ccbbf`，均 build PASS 且评审通过）；全库 `\u25` 系列转义与字面树符号非豁免残留 = 0。BOMTreeTable / BomWhereUsedTree 缩进经复核为连字符徽标层级列（无像素缩进），登记豁免。**最终验收结论：通过**。
