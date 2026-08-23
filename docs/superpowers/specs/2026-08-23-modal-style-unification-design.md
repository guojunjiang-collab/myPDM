# 弹窗统一风格整改设计方案

> 日期：2026-08-23
> 范围：桌面端（`frontend/src/`，不含 `mobile/`）
> 目标：全量排查桌面端所有弹窗（60+ 处共享 Modal 实例、5 处自绘 overlay、118 处原生弹窗），
> 分类汇总问题，通过**共享组件化**统一窗口风格，避免重复造轮子。
>
> 决策（用户已确认）：① 本次只做桌面端，移动端另行立项；② 阶段 0→3 一次性全做；③ 本设计文档落盘 `docs/superpowers/specs/`，审阅通过后进入实施。
>
> **2026-08-23 追加决策（示意审查后）**：
> - 对象多选 Picker 候选列表**操作列「添加」按钮，无多选框**；**添加后候选行不移除，操作列提示「已添加」（禁用态）**；已选面板保留顶部常驻；
> - **多类型添加（关联对象等）以用户看板 ItemPicker（`components/ItemPicker.tsx`）为参考基准**：类型筛选 Tab（全部/零件/部件/图文档/构型项）+ 类型徽标列 + 操作列「添加」按钮 + 已选行「已选」态；
> - 内嵌快速新建**仅件号+名称**，折叠区置于**搜索区上侧**；
> - 新建表单**仅件号+名称的简单表单**（卡片式字段）；**复杂表单（EntityEditModal / 编辑 ECO / 编辑 ECR / 编辑构型项 / 编辑配置概要 / 库存单据等）已弃用**，不在统一范围；
> - 错误提示：校验错误用 `Alert`、后台错误用 `toast`；轻量选择器确认按钮多选显示数量、单选不显示。

---

## 1. 背景与目标

前端弹窗经过多轮迭代，已形成**共享 `Modal`/`ConfirmModal`（`components/Modal.tsx`）+ `ui/*` 基础组件 + CSS 主题变量（`--ui-*`）**的基础设施，但存量弹窗用法混乱：

- 同一份"选择器骨架"在 3 个文件逐行复制；
- 表单 label 分裂为「硬编码 `text-gray-700`」与「主题变量 `var(--ui-text-secondary)`」两代，甚至同一文件混用；
- 底部按钮区 6 种组合、错误提示 6 种写法、loading 文案 4 种变体并存；
- **118 处原生 `alert()`/`confirm()`** 无法主题化，与 ConfirmModal 体系脱节；
- 5 处自绘 overlay（遮罩色 30/40/50 三档、zIndex 50/70/100 散落、无过渡动画）；
- 公共能力缺口：共享 Modal **无 Esc 关闭、无 body 滚动锁、无焦点管理**；无共享 `Tabs`/`Dropdown`/`Alert` 组件；
- 功能级重复：`ECOCcPicker` 与 `ECRCcPicker` 双份、Documents 新旧两套详情弹窗并存、ECRDetailModal 自绘 header 等。

**目标**：以共享组件为骨架统一全部弹窗的 ① 容器与标题栏 ② 表单字段 ③ 底部操作区 ④ 错误/加载反馈 ⑤ 层级（zIndex/宽度语义）⑥ 确认交互，并在过程中消灭重复实现。

## 2. 现状审计（排查结果）

### 2.1 弹窗全景分类

| 类别 | 数量 | 说明 |
|---|---|---|
| ① 确认/提示类 | ~23 处 `ConfirmModal` + 22 处原生 `confirm()` + 96 处原生 `alert()` | ConfirmModal 覆盖 13 文件；原生弹窗集中于详情弹窗内行级操作与附件/预览/保存失败 |
| ② 新建/编辑表单类 | 19 处 Modal 实例 / 16 个文件 | 简单表单（md/lg）与复杂表单（3xl/full）两级 |
| ③ 添加/选择 Picker 类 | 11 处 Modal + 2 处自绘内嵌 | 骨架在 AssemblyPartPicker / DocumentPicker / ConfigItemPicker 三文件逐行复制 |
| ④ 详情/查看类 | 15 处 | 高度滚动 3 种风格；Tab 全手写；签入说明 ×3 同构复制 |
| ⑤ 页面内联筛选工具栏 | 6+ 处 | PartsPage/Documents/ECR/ECO/Logs/Notifications/Inventory 布局各异，无共享 FilterBar |

### 2.2 关键证据（行号均为当前工作区）

**Picker 骨架逐行复制**：已选面板→搜索+Select 筛选→快速新建→候选表格→footer 整套重复——
`AssemblyPartPicker.tsx` L316-335/L378-428/L430-449、`DocumentPicker.tsx` L288-308/L334-388/L390-399、
`Configuration/ConfigItemPicker.tsx` L145-156/L179-222/L224-232。「取消+确认」footer 在 11 个文件重复书写。

**label 两代并存**：
- 硬编码派（`block text-sm font-medium text-gray-700 mb-1`）：Users 用户弹窗 9 字段（L351-456）、PartsPage 新建零件 3 字段（L292-302）、Documents 新增图文档 4 字段（L301-328）；
- 主题变量派（`block text-xs text-[var(--ui-text-secondary)] mb-0.5`，多配卡片容器 `bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100`）：约 60+ 字段（EntityEditModal、ECO/ECRCreateModal、ConfigurationCreateModal、ProfileEditModal、TaskEditModal、Projects、Settings 等）；
- 同一文件混用：ECOCreateModal L404（新）与 L460（旧）；
- 节标题 h4 几乎 100% 硬编码 `text-gray-700`（12 个文件），`font-medium`/`font-bold` 混用；
- 必填星号两种写法：红色 `<span className="text-red-500">*</span>`（12 处）vs 纯文本 `*`（ConfigurationCreateModal L420/425、ProfileEditModal L832/842）；
- `cardCls`/`cardLabelCls` 常量字符串在 MaterialTab.tsx L17-18 与 DocumentEditModal.tsx L21-22 原样复制。

**footer 6 种组合**：`border-t` 有无（缺失 5 处）、`gap-2`/`gap-3`、`pt-1~pt-4`、`mt-3`/`mt-6`（ECRCreateModal L687）、MaterialTab 按钮叠 `mt-3`（L278-279）、TaskEditModal 用 `justify-between`（L762）。

**错误提示 6 种写法**：
1. 红块 `bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm` —— 4 文件逐字复制（EntityEditModal L419、Users L470、Documents L345、Settings L797）；
2. 无 border 变体（ConfigurationCreateModal L415、ProfileEditModal L809）；
3. 字段级红字+红边框 `!border-red-400` + `text-red-500 text-xs`（ECO/ECRCreateModal）；
4. Toast（ECO/ECR/Projects/PartsPage）；
5. 原生 `alert()`（DocumentEditModal、TaskEditModal、MemberManageModal、Board 全部 handler 等）；
6. **无任何错误处理**（WarehouseTab save、MaterialTab saveStandalone、Users saveGroup、Settings 确认重置）。

**自绘 overlay 5 处**：

| 位置 | 遮罩 | zIndex | 差异 |
|---|---|---|---|
| ConfigurationCreateModal.tsx L540（子构型项选择器） | `bg-black/40` | z-[70] | 遮罩浅一档、无过渡、无 Esc；`max-w-2xl` 不在 widthMap |
| ECOCreateModal.tsx L655（ECR 选择器） | `bg-black/40` | z-[100]（全项目最高） | 同上；**完全重复了现成 `ECPicker.tsx` 组件** |
| PartDetailModal.tsx L1066（变换矩阵） | `bg-black/30` | z-50 | "容器+absolute 遮罩"写法、无过渡 |
| Board.tsx L543（文件夹 ⋮ 菜单） | 无遮罩锚定式 | z-50 | 与居中弹窗形态不同，属 Dropdown 范畴 |
| Settings.tsx L603（确认重置） | 共享 Modal | 50 | 因需密码输入，ConfirmModal 纯文本无法承载 |

**zIndex 全表**：默认 50（绝大多数 + ConfirmModal + Toast）；60（Modal prop，7 处：STPViewer、AssemblyPartPicker、DocumentPicker、ECPicker、ConfigItemPicker、ImportPreviewModal、EntityDocumentSection）；70（VersionSelectModal L60 + ConfigurationCreateModal 自绘）；100（ECOCreateModal 自绘，唯一）。

**详情弹窗高度 3 种风格**：① Modal `height` prop（4 处：PartCompare 90vh、ProfileCompare 75vh、Deliverable 75vh、CADWorkspace 85vh）；② 手动 `h-[50/55/60vh] flex flex-col`（5 处：PartDetail、DocumentDetail、ConfigItemDetail、StockDetail、STPViewer）；③ `max-h-[70/72vh] overflow-y-auto pr-1` 文档式（6 处）。**滚动缺陷**：PartDetailModal 非 BOM Tab 无滚动容器（内容超高被裁，L674）、DocumentDetailModal L507 缺 `min-h-0`。

**确认交互**：ConfirmModal 约 23 处；原生 `confirm()` 约 20 处未统一（PartDetailModal L432/L930 删子项/删迭代、DocumentDetailModal L320/L685、ConfigItemDetailModal L192/L298/L456、**ECOList L84 删 ECO**、Settings L365 删字段、Users L224 删用户组、Feishu/Wechat 解绑、附件桶×3、Inventory DocumentTab L85/107/110 内联 `confirm()&&act()`）；手写 Modal 确认框 1 处（Settings L603）。

**公共能力缺口**：Modal.tsx 与所有自绘 overlay **均无 body 滚动锁、无 Escape 关闭、无 focus trap**（grep `body.style`/`keydown Escape` 仅 STPViewer/ViewerCanvas.tsx L56 用于取消 3D 高亮，与弹窗无关）；无共享 Tabs/Dropdown/Alert 组件（Tab 全手写 `border-b-2`，下拉全手写定位）。

**功能级重复**：
- `ECOCcPicker`（sm）与 `ECRCcPicker`（sm）同功能双份实现；
- Documents.tsx 新旧两套详情弹窗并存：L370 旧内联（版本历史跳转用）+ L437 `DocumentDetailModal`；
- ECRDetailModal L297-301 不用 `title`/`headerAction`，内容区自绘 header（h3+导出按钮）；
- 签入说明 Modal ×3 同构（PartDetailModal L957、DocumentDetailModal L727、ConfigItemDetailModal L498：同 width="md"、同 Textarea 占位文案、同取消/确认按钮）；
- 审批人区块（ECO/ECR/DocumentEditModal 三处逐行复制）与关联图文档表格（ECO/ECR 两处）应抽共享组件；
- Modal 的 `height` prop 仅 4 处使用，其余 11 处全部内部 `max-h-[50~78vh]` 自行滚动。

## 3. 范围

**做：**
- 阶段 0：增强共享 `Modal`（Esc/滚动锁/焦点/zIndex 常量）+ 新增共享 `Tabs`、`Alert`、`Dropdown` 组件；
- 阶段 1：新增骨架组件 `FormModal`、`FormField`、`ModalFooter`、`EntityPickerModal`、增强 `ConfirmDialog`（支持自定义内容）、`FilterBar`；
- 阶段 2：存量替换——5 处自绘 overlay 迁移、118 处原生弹窗替换、label/footer/错误块统一（约 20+ 文件）；
- 阶段 3：清理重复——合并 CcPicker、删除 Documents 旧详情弹窗、ECRDetailModal 回归标准 header、高度/宽度/zIndex 语义收敛。

**不做（Non-goals）：**
- 移动端（`mobile/`，<768px 独立全屏覆盖层体系）不在本次范围，另行立项；
- **复杂表单（EntityEditModal、编辑 ECO/ECR/构型项/配置概要、库存单据等）已弃用**——不纳入统一改造，也不做视觉重构；仅保证其现有功能不回归；
- 不改后端 API、不改数据模型；
- 不做视觉重设计（配色/圆角/间距保持现有 `--ui-*` 主题体系），只做结构统一；
- 不引入第三方 UI 库（AntD 等），继续用 Tailwind + 自研组件。

## 4. 整改方案设计

### 4.1 阶段 0：基础设施补齐

**4.1.1 增强 `components/Modal.tsx`**（兼容现有全部调用，只加不改）
- 新增 `onKeyDown` Esc 关闭（`open && onClose`）；
- body 滚动锁：open 时 `document.body.style.overflow = 'hidden'`，卸载/关闭恢复（多弹窗叠加用计数器）；
- 焦点管理：打开后聚焦面板（`tabIndex={-1}` + `focus()`），关闭后还原触发元素焦点；
- 新增 `zIndex` 常量导出（`MODAL_Z = { base: 50, picker: 60, overlay: 70 }`），默认值不变；
- 可选 `footer` 插槽：`renderFooter` 或 `footer?: ReactNode`，渲染为 `flex justify-end gap-2 pt-4 border-t border-[var(--ui-border)]`（阶段 1 的 ModalFooter 落点）；
- 可选 `scrollLock?: boolean`（默认 true）、`closeOnEsc?: boolean`（默认 true）便于 3D 全屏类弹窗关闭。

**4.1.2 新增共享组件**
- `components/ui/Tabs.tsx`：受控 `Tabs`（items + activeKey + onChange + size），样式统一为现有 `border-b-2` 手写 Tab 的观感（active `border-primary-600 text-primary-600`），吸收 5 处详情弹窗手写 Tab 与 1 处静态步骤条（CADWorkspace）；
- `components/ui/Alert.tsx`：语义化提示块（`tone: info/success/warning/danger` + `bordered?`），吸收 6 种错误写法；`InlineError` 别名用于表单内错误；
- `components/ui/Dropdown.tsx`：触发器 + 面板 + 外部点击关闭 + Esc 关闭 + 锚定定位（`getBoundingClientRect`），吸收 Board 右键菜单、DocumentTab 新建单据菜单（后续 mobile FilterDropdown 可复用）。

### 4.2 阶段 1：骨架组件（消灭最大重复）

| 新组件 | 设计要点 | 吸收的重复 |
|---|---|---|
| `FormModal`（`components/ui/FormModal.tsx`） | `Modal` 扩展：`title/width/height/onClose/onSubmit/confirmText/cancelText/saving/error/footerLeft`；内容 `space-y-4`；footer 固定 `flex justify-end gap-2 pt-4 border-t`；saving 时确认按钮 `保存中...` + disabled；error 自动渲染 Alert danger。**新建表单统一为简单表单（仅件号+名称）** | 19 个表单弹窗的 footer/错误/loading |
| `FormField`（`components/ui/FormField.tsx`） | `label/required/error/hint/children`；label 统一 `block text-xs text-[var(--ui-text-secondary)] mb-0.5`；必填统一红色 `*`；error 统一 `text-red-500 text-xs mt-1`；可选 `card` 模式输出卡片容器（`bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]`，**border 从 `border-gray-100` 改为主题变量**） | 两代 label、两种星号、卡片容器 12+ 文件复制 |
| `ModalFooter`（`components/ui/ModalFooter.tsx`） | `onCancel/cancelText/onConfirm/confirmText/confirmVariant/saving/left`；`justify-end gap-2 pt-4 border-t border-[var(--ui-border)]` | 6 种 footer 组合 |
| `EntityPickerModal`（`components/ui/EntityPickerModal.tsx`） | slot 化骨架：`title/searchPlaceholder/filters/columns/renderRow/fetchData/selectedKey/onConfirm`；内置已选面板（表格式，**保留顶部常驻**）、搜索+筛选行、候选表格（sticky thead + 滚动，**操作列「添加」按钮，无多选框；添加后候选行不移除、操作列提示「已添加」（禁用态）**）、快速新建折叠区（slot `quickCreate`，**仅件号+名称、置于搜索区上侧**）、footer（已选 N 项 + 取消/确认，`justify-between`）；**多类型模式（类型筛选 Tab + 类型徽标列）以 `ItemPicker` 为参考基准**；zIndex 固定 60 | **三份逐行复制的 Picker** + 2 处自绘内嵌选择器 |
| `ConfirmDialog` 增强（改 `components/Modal.tsx` 的 ConfirmModal） | 新增可选 `children`（自定义内容，如密码输入）、`confirmLoading`、`dangerouslyHtmlContent?`（不需要则不做）；保留现有 props 全兼容 | Settings 确认重置、Documents/ConfigurationList 失败提示复用 |
| `FilterBar`（`components/ui/FilterBar.tsx`） | 布局统一：`flex items-center gap-2 flex-wrap`，子项 `search/filter/actions` 三区；`Button active` 胶囊样式沿用 | 6+ 种页面筛选工具栏 |
| `CheckinNoteModal`（`components/CheckinNoteModal.tsx`） | `open/note/onChange/onConfirm/onCancel/saving`，width="md"，Textarea 占位统一 | 签入说明 ×3 同构复制 |

### 4.3 阶段 2：存量替换（约 20+ 文件）

1. **5 处自绘 overlay 迁移**：
   - ECOCreateModal L655 内嵌 ECR 选择器 → 直接用现成 `ECPicker`（onConfirm 签名对齐即可，消灭 z-[100]）；注：父弹窗属已弃用复杂表单，仅迁移该内嵌 overlay，其余不动；
   - ConfigurationCreateModal L540 内嵌子构型项选择器 → 改用 `EntityPickerModal`（消灭 z-[70] 与自绘 header/footer）；注：同上，仅迁移 overlay；
   - PartDetailModal L1066 变换矩阵弹窗 → 共享 `Modal`（width="lg"、zIndex 60）；
   - Board L543 菜单、DocumentTab L136 菜单 → 共享 `Dropdown`；
   - Settings L603 确认重置 → `ConfirmDialog` + `children`（密码 Input）。
2. **118 处原生弹窗替换**（语义映射）：
   - 破坏性操作 `confirm()`（删迭代/删子项/删附件/删 ECO/删字段/解绑/归档/删用户组/单据取消等）→ `ConfirmModal`；
   - 操作失败 `alert()` → `toast.error()` 或表单内 `Alert`（表单校验类错误用 Alert，后台错误用 toast）；
   - 信息提示 `alert()`（如"已保存 N 个"）→ `toast.success()`；
   - 阻塞性校验（如"请选择仓库"）→ 表单内 `FormField error` / `Alert`。
   - 注：`confirm()` 调用点多在行级操作 handler 内，需改为状态驱动（`setConfirmXxx(obj)` + 渲染 ConfirmModal），改动量为逐点改造。
3. **label/footer/错误统一**：Users 用户弹窗 9 字段、PartsPage、Documents 表单 → `FormField`；WarehouseTab text-sm 变体归一；纯文本星号 → 红色星号；节标题 → `text-[var(--ui-text-secondary)] font-semibold text-sm` 单一规范；`border-gray-100` → `var(--ui-border)`。
4. **补错误/loading 缺口**（仅简单表单类）：WarehouseTab save、MaterialTab saveStandalone、Users saveGroup、Settings 重置、TaskEditModal 主保存、Board 三弹窗 → 补 try/catch + saving 状态；已弃用的复杂表单（DocumentEditModal 等）仅做回归保障，不改错误处理。

### 4.4 阶段 3：清理重复与收尾

1. 合并 `ECOCcPicker`/`ECRCcPicker` → 单一 `components/CcPicker.tsx`（props：`open/entityId/onClose/api?`，默认 `ecrApi`，ECO 场景经 `api` 覆写为 `ecoApi`；已实现），两处列表引用替换；
2. Documents.tsx 删除旧内联详情弹窗（L370-426），版本历史跳转改为复用 `DocumentDetailModal`（传入 revisionId）；
3. ECRDetailModal 改用 `title="ECR 详情"` + `headerAction`（导出按钮），删除内容区自绘 header；
4. 高度统一：详情弹窗全部改走 Modal `height` prop + 内容区 `flex-1 min-h-0 overflow-auto`（修复 PartDetailModal 非 BOM Tab 无滚动、DocumentDetailModal 缺 min-h-0）；固定 `h-[50/55/60vh]` 的 5 处与 `max-h-[70/72vh]` 的 6 处收敛为统一规范（内容类 75vh、对比类 90vh 可保留差异，但必须走 height prop）；
5. 宽度语义收敛：保留 widthMap 但明确语义注释（sm≈表单/确认、md/lg≈简单表单、xl/full≈Picker/详情、3xl≈复杂详情、max≈全屏工作台），新建弹窗按语义选档；
6. zIndex 收敛：全部走 `MODAL_Z` 常量（base 50 / picker 60 / overlay 70），删除 `z-[100]`；
7. ~~审批人区块与关联图文档表格抽共享组件~~：因复杂表单（ECO/ECR 创建、DocumentEditModal）已弃用，该抽取失去消费方，**取消**；仅保留 `EntityPickerModal` 内文档/EC 表格的列规范统一。

## 5. 实施顺序与验证

**顺序**：阶段 0（基础设施，先合入）→ 阶段 1（骨架组件，独立可测）→ 阶段 2（存量替换，按模块逐页改造：Inventory → Users/Settings/Board → ECR/ECO → Parts/Documents → Configuration）→ 阶段 3（清理重复）。

**验证**：
- 每个阶段 `cd frontend; npx tsc --noEmit` 与 `npm run build` 通过；
- 桌面端四主题（light/dark/green/brown）目检关键弹窗（新增零件、添加子项、零部件详情、删除确认、ECR 详情、设置确认重置）；
- 重点回归：多弹窗叠加层级（EntityEditModal 内嵌 Picker/VersionSelect）、滚动锁（打开弹窗后页面不可滚动、关闭后恢复）、Esc 关闭不误触表单输入；
- 原生弹窗替换后全量 grep `alert(`/`confirm(` 应仅剩注释或移动端文件。

## 6. 风险

| 风险 | 应对 |
|---|---|
| 共享 Modal 增强（滚动锁/Esc/焦点）影响存量 60+ 调用 | 阶段 0 只加不改（默认行为兼容），先合入并全量回归后再进入阶段 1 |
| 原生 confirm → ConfirmModal 需状态化改造，工作量大且易漏 | 按文件逐点替换，每页替换后立即构建验证；grep 计数作为完成度指标 |
| 详情弹窗滚动重构（height prop）可能引入布局回归 | 保留原内部 max-h 写法作为过渡，分批迁移并目检 |
| 删除 Documents 旧详情弹窗有功能引用（版本历史跳转） | 先改跳转逻辑复用 DocumentDetailModal，再删旧弹窗，避免死代码 |

## 7. 相关文件清单（主要改动面）

- 新增：`components/ui/Tabs.tsx`、`Alert.tsx`、`Dropdown.tsx`、`FormModal.tsx`、`FormField.tsx`、`ModalFooter.tsx`、`EntityPickerModal.tsx`、`FilterBar.tsx`、`components/CheckinNoteModal.tsx`、`components/CcPicker.tsx`
- 修改：`components/Modal.tsx`（增强）、`components/AssemblyPartPicker.tsx`、`DocumentPicker.tsx`、`Configuration/ConfigItemPicker.tsx`（改用 EntityPickerModal）、`components/ECO/ECOCreateModal.tsx`、`Configuration/ConfigurationCreateModal.tsx`、`PartDetailModal.tsx`、`DocumentDetailModal.tsx`、`ConfigItemDetailModal.tsx`、`ECRDetailModal.tsx`、`ECODetailModal.tsx`、`Inventory/*`、`pages/Users.tsx`、`Settings.tsx`、`Board.tsx`、`PartsPage.tsx`、`Documents.tsx`、`Project/Projects.tsx`、`TaskEditModal.tsx`、`MemberManageModal.tsx`、`EntityEditModal.tsx`、`EntityDocumentSection.tsx`、`ECR/ECRCreateModal.tsx`、`ECR/ECRList.tsx`、`ECO/ECOList.tsx`、`ECR/ECRCcPicker.tsx`、`ECO/ECOCcPicker.tsx`、`Layout.tsx` 等
