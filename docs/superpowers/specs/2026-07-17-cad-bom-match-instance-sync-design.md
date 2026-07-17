# 设计：CAD 工作台 BOM 匹配 — 同 PartNumber 实例属性同步

- 日期：2026-07-17
- 状态：已批准
- 范围：仅前端 `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`，无后端改动

## 背景

零部件管理 → CAD 入口 → BOM 匹配表格（`CADBOMMatchTable`）中，装配树被扁平化为
`BOMRow[]`，同一零部件在装配体不同位置出现多次时会生成多行（以 `path` 区分实例）。

当前修改某一行的 CATIA 用户属性（如"规格型号"）时，仅按 `r.path === row.path`
更新该行，导致同一零部件的其他实例行显示的属性值不一致。

CATIA 中用户属性存于零件文档上，同一 PartNumber 的所有实例引用同一文档，属性
天然共享。因此表格显示也应保持一致。

## 需求决策（已与用户确认）

| 决策点 | 结论 |
| ------ | ---- |
| 「相同零部件实例」判定依据 | 相同 CATIA PartNumber（`BOMRow.part_number`） |
| 同步操作范围 | ① 表格内属性编辑（`handlePropEdit`）；② 属性←PDM 拉取（`handlePullFromPDM`） |
| 签出/签入状态、创建零件后的匹配状态 | 不在本次范围 |
| CATIA 端写入策略 | `bridge.writeProperty` 只调用一次（当前行 path），其余行仅同步前端表格显示 |

## 方案

在 `CADBOMMatchTable.tsx` 中新增导出的纯函数：

```typescript
export function syncRowsByPartNumber(
  rows: BOMRow[],
  row: BOMRow,
  key: string,
  value: string,
): BOMRow[]
```

行为：

- `row.part_number` 非空时：所有 `r.part_number === row.part_number` 的行的
  `user_properties[key]` 更新为 `value`
- `row.part_number` 为空字符串时：回退为仅按 `r.path === row.path` 更新当前行
  （避免多个空件号的行被误同步）
- 不修改其他属性键、不修改其他字段（`match_status` / `checkout_status` 等）

三处更新点改用该函数：

1. `handlePropEdit`：`await bridge.writeProperty(row.path, key, value)` 成功后，
   `setRows(prev => syncRowsByPartNumber(prev, row, key, value))`
2. 输入框 `onChange` 内联本地即时回显：同样改为 `syncRowsByPartNumber`
3. `handlePullFromPDM`：写入 CATIA "规格型号" 后，按 PartNumber 同步全部行

## 错误处理

- `bridge.writeProperty` 失败时行为不变：toast 报错，不做跨行同步
  （`onChange` 的本地回显仍会先行更新，与现有行为一致）

## 测试

为 `syncRowsByPartNumber` 编写 Vitest 单元测试
（`CADBOMMatchTable.test.ts`，与 STPViewer 现有测试风格一致）：

1. 同 PartNumber 多行同步更新，不同 PartNumber 行不受影响
2. 空 PartNumber 回退为仅更新当前 path 的行
3. 仅更新目标属性键，其他键与字段不变

## 验证

- `cd frontend; npm run test`
- `cd frontend; npm run build`
