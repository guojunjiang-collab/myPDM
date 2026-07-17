# 设计：CAD BOM 匹配表格显示 CATIA 内置属性

- 日期：2026-07-17
- 状态：已批准
- 范围：仅前端 `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx` 与 `syncRows.ts`，桥接端与后端无改动

## 背景

CAD 工作台 BOM 匹配表格目前仅显示 CATIA PartNumber 与实例名称，未展示
版本、定义、术语、描述等内置属性。桥接服务读取装配树时已返回这些属性
（`cad_bridge/catia/client.py:12` 的 `BUILTIN_ATTRS` 含 PartNumber /
Revision / Definition / Nomenclature / DescriptionRef 等），且
`write_property` 已支持内置属性写回（对引用产品 `setattr`），因此本功能
纯前端实现。

## 需求决策（已与用户确认）

| 决策点 | 结论 |
| ------ | ---- |
| 显示的内置属性 | 件号（PartNumber）、版本（Revision）、定义（Definition）、术语（Nomenclature）、描述（DescriptionRef） |
| 件号列 | 现有「CATIA PartNumber」列改名「件号」，保持只读（件号影响 PDM 匹配与创建，不允许在表格内修改） |
| CATIA 名称列 | 移除（instance_name 只是实例名称，无展示价值） |
| 版本/定义/术语/描述 | 可编辑，写回 CATIA，并按同 PartNumber 实例同步表格显示 |
| CATIA 写入策略 | `bridge.writeProperty` 只调用一次（当前行 path，属性名用英文如 `Revision`），其余行仅同步前端表格 |
| 写入失败 | 仅 toast 报错，不回滚（沿用既定乐观更新行为） |

## 方案

### UI（CADBOMMatchTable.tsx）

- 「CATIA PartNumber」列头改为「件号」，内容不变（`row.builtin.PartNumber`），只读
- 移除「CATIA 名称」列（`row.instance_name` 只是实例名称，不再展示）
- 在「件号」列之后、用户属性列之前新增 4 个可编辑列，
  列头中文、写回属性名英文：

  | 列头 | CATIA 属性名 |
  | ---- | ------------ |
  | 版本 | `Revision` |
  | 定义 | `Definition` |
  | 术语 | `Nomenclature` |
  | 描述 | `DescriptionRef` |

- 编辑控件与交互复用用户属性列的模式（input + onChange 本地回显 +
  异步写 CATIA），编辑权限同 `canEditProps`（他人签出时禁用）
- 内置属性列使用与用户属性列（绿色 `bg-green-50`）区分的底色（`bg-sky-50`），
  表头同色

### 同步逻辑（syncRows.ts）

`syncRowsByPartNumber` 签名扩展为：

```typescript
export function syncRowsByPartNumber(
  rows: BOMRow[],
  row: BOMRow,
  key: string,
  value: string,
  target: 'user' | 'builtin' = 'user',
): BOMRow[]
```

- `target === 'user'`（默认）：更新 `user_properties[key]`，现有调用不变
- `target === 'builtin'`：更新 `builtin[key]`
- 匹配规则不变：按 `part_number` 匹配全部行，空 `part_number` 回退按 `path`

### 属性编辑处理（CADBOMMatchTable.tsx）

新增 `handleBuiltinEdit(row, attr, value)`：

- `await bridge.writeProperty(row.path, attr, value)` 成功后
  `setRows(prev => syncRowsByPartNumber(prev, row, attr, value, 'builtin'))`
- 失败 toast 报错，不回滚
- 输入框 `onChange` 先本地同步回显（同 `target: 'builtin'`），再调用
  `handleBuiltinEdit`

### 附带效果

- 编辑「定义」后点「属性→PDM」推送的即为新值（现有 `handlePushToPDM`
  使用 `builtin.Definition` 作为 name），无需额外处理
- 件号不可编辑，`part_number` 同步键保持稳定

## 测试

在 `syncRows.test.ts` 补充 `target: 'builtin'` 用例：

1. `target: 'builtin'` 时同 PartNumber 多行的 `builtin[key]` 同步更新，
   `user_properties` 不受影响
2. 省略 `target` 时行为与现有一致（更新 `user_properties`，`builtin` 不变）

## 验证

- `cd frontend; npm run test`
- `cd frontend; npm run build`
- 部署：`docker-compose up -d --force-recreate nginx`
