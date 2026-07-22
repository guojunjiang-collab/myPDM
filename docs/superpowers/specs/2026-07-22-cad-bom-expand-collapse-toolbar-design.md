# CAD BOM 匹配列表「展开层级」工具栏控件 — 设计

日期:2026-07-22
分支:feat/config
涉及文件:`frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`(纯前端、单文件)

## 背景

CAD 入口弹窗 → BOM 匹配列表以树形展示 CATIA 装配结构。当前只有**逐行**的 ▶/▼ 展开/折叠(每行一个箭头),深装配下想统一看某一层级需要一个个点,效率低。需要在工具栏提供**按层级批量展开/折叠**的控件。

## 复用的现有机制

- 折叠状态:`collapsedPaths: Set<string>`,存放被折叠节点的 `path`。
- `visibleRows`:某行可见 ⟺ 其所有祖先 path 都不在 `collapsedPaths` 中。
- 每行携带 0 基层级 `row.level`(层级列显示 `"-".repeat(level) + level`,即 0、-1、--2…)。
- 逐行箭头调用 `toggleCollapse(path)` 增删 `collapsedPaths`。

新控件只是**批量改写 `collapsedPaths`**,与逐行箭头共用同一状态,两者互相兼容。

## 交互设计

### 控件形式
汇总栏(现 `handleRefreshAndMatch` 所在的 `汇总栏` 区)**最左侧**新增一个 `<select>`,标签"展开层级",与状态药丸同组;右侧仍为操作按钮(重新匹配 / 批量属性→PDM / 全部签入)。形成"左=视图控制、右=操作"分组。

样式沿用组件内既有 select:`border border-gray-300 rounded text-xs`,内边距与工具栏按钮视觉高度一致。

### 选项与语义
设选择"展开到层级 k":**所有 `level < k` 的可展开节点展开、`level ≥ k` 的节点折叠** ⟹ 可见层为 `0 … k`。

层号采用 **0 基**(与"层级"列数字一致),标签形如 `L1`、`L2`:`Lk` 表示"显示到第 k 层"(即 `level 0 … k` 可见)。

选项按当前数据最大层级 `maxLevel = max(row.level)` 动态生成,自上而下:

| 选项标签 | 语义 k | 效果 |
|---|---|---|
| 全部折叠 | 0 | 仅顶层根节点可见 |
| L1 | 1 | 可见 level 0–1 |
| L2 | 2 | 可见 level 0–2 |
| … | … | … |
| L(maxLevel−1) | maxLevel−1 | 可见 level 0…maxLevel−1 |
| 全部展开 | ∞ | 清空 `collapsedPaths`,全部可见 |
| 自定义 | — | 仅在用户手动点箭头偏离批量层级时出现(见下) |

说明:`L(maxLevel)` 等价于"全部展开",故编号档只到 `L(maxLevel−1)`,最深档用"全部展开"。

### 状态反映(方案 A)
- 新增状态 `expandSel: string`,取值 `'collapsed' | '1' | '2' | … | 'all' | 'custom'`,即 select 的受控值。
- 选择某个批量选项 → 立即应用并把 `expandSel` 设为该值。
- 用户**手动**点任一行 ▶/▼(`toggleCollapse`)→ 把 `expandSel` 设为 `'custom'`。
- `自定义` 这个 `<option>` **仅当 `expandSel === 'custom'` 时渲染**,使 select 能显示"自定义";其余情况不出现在下拉里。
- 初始值:进入匹配步骤时树默认全部展开(现状),故 `expandSel` 初始为 `'all'`。

### 禁用条件
`maxLevel === 0`(整棵树只有一层、无任何可展开节点)时,控件 `disabled`。

## 实现要点

- 纯函数 `buildCollapsedForLevel(rows: BOMRow[], k: number): Set<string>`
  - 单趟 O(n) 遍历;对每行判断"有子节点"用相邻行:`i < len-1 && rows[i+1].level > rows[i].level`(避免现有 `hasChildren` 里的 `rows.indexOf` O(n²))。
  - 收集满足 `hasChild && row.level >= k` 的 `row.path`。
  - `k = Infinity`(全部展开)⟹ 返回空 Set;`k = 0`(全部折叠)⟹ 所有有子节点的行。
- `maxLevel` 由 `rows` 派生:`rows.length ? Math.max(...rows.map(r => r.level)) : 0`。
- 应用:`onChange` 解析选中值 → `setCollapsedPaths(buildCollapsedForLevel(rows, k))` 并 `setExpandSel(value)`。
- `toggleCollapse` 末尾追加 `setExpandSel('custom')`。
- `<select>` 的 `<option>` 列表由 `maxLevel` 动态 `map` 生成。

## 影响面 / 非目标

- 不改后端、不改数据结构、不改 `BOMRow`。
- 不改左右表布局、行高同步、横向滚动等既有逻辑。
- 行高同步 effect 依赖 `visibleRows`,批量折叠改变 `visibleRows` 会自动触发重新同步,无需额外处理。
- 不引入"记住每个装配上次展开层级"等持久化(YAGNI)。

## 测试要点(手测,CATIA 桥接环境)

1. 多层装配:依次选 全部折叠 / L1 / L2 / 全部展开,可见行随层级正确增减。
2. 选 L2 后手动折叠某一行 → 下拉变为"自定义";再选 L2 → 恢复到该层级。
3. 单层 BOM:控件禁用。
4. 批量折叠/展开后,左右两表行高仍对齐、右区横向滚动抬头仍同步。
