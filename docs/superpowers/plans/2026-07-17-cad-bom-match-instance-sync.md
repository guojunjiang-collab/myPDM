# CAD BOM 匹配同 PartNumber 实例属性同步 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAD 工作台 BOM 匹配表格中，修改任一实例的 CATIA 用户属性后，所有相同 PartNumber 的实例行同步更新显示，保持一致。

**Architecture:** 纯前端改动。新增纯函数 `syncRowsByPartNumber`（独立文件，便于 Vitest 测试），`CADBOMMatchTable.tsx` 中三处按 `path` 匹配的属性更新点改为调用该函数按 `part_number` 匹配。`bridge.writeProperty` 仍只调用一次（CATIA 属性存于零件文档，实例天然共享）。

**Tech Stack:** React 18 + TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-07-17-cad-bom-match-instance-sync-design.md`

## Global Constraints

- 无后端改动
- 签出/签入状态、创建零件后的匹配状态不在本次范围
- `part_number` 为空字符串时回退为仅按 `path` 更新当前行
- 代码注释使用中文；Vitest 测试文件必须为 `.ts`（vite.config.ts 的 include 为 `src/**/*.test.ts`）
- 前端修改完成后必须执行 `npm run build`

---

### Task 1: syncRowsByPartNumber 纯函数 + 单元测试

**Files:**
- Create: `frontend/src/components/CADWorkspace/syncRows.ts`
- Test: `frontend/src/components/CADWorkspace/syncRows.test.ts`

**Interfaces:**
- Consumes: `BOMRow` 类型（`import type { BOMRow } from './CADBOMMatchTable'`，type-only 导入无运行时副作用）
- Produces: `syncRowsByPartNumber(rows: BOMRow[], row: BOMRow, key: string, value: string): BOMRow[]` — Task 2 依赖此签名

- [ ] **Step 1: 写失败的测试**

创建 `frontend/src/components/CADWorkspace/syncRows.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { syncRowsByPartNumber } from './syncRows';
import type { BOMRow } from './CADBOMMatchTable';

function makeRow(overrides: Partial<BOMRow>): BOMRow {
  return {
    instance_name: '',
    part_number: '',
    path: '',
    level: 0,
    is_assembly: false,
    builtin: {},
    user_properties: {},
    pdm_match: null,
    match_status: 'unknown',
    checkout_status: null,
    ...overrides,
  };
}

describe('syncRowsByPartNumber', () => {
  it('同 PartNumber 的所有实例行同步更新，其他 PartNumber 不受影响', () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', user_properties: { 规格型号: 'old' } }),
      makeRow({ part_number: 'P-001', path: '0.2', user_properties: { 规格型号: 'old' } }),
      makeRow({ part_number: 'P-002', path: '0.3', user_properties: { 规格型号: 'keep' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'new');
    expect(result[0].user_properties['规格型号']).toBe('new');
    expect(result[1].user_properties['规格型号']).toBe('new');
    expect(result[2].user_properties['规格型号']).toBe('keep');
  });

  it('PartNumber 为空时回退为仅按 path 更新当前行', () => {
    const rows = [
      makeRow({ part_number: '', path: '0.1', user_properties: { 备注: 'a' } }),
      makeRow({ part_number: '', path: '0.2', user_properties: { 备注: 'a' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '备注', 'b');
    expect(result[0].user_properties['备注']).toBe('b');
    expect(result[1].user_properties['备注']).toBe('a');
  });

  it('仅更新目标属性键，其他键与字段不变，且不修改原数组', () => {
    const rows = [
      makeRow({
        part_number: 'P-001',
        path: '0.1',
        match_status: 'matched',
        user_properties: { 规格型号: 'old', 材料: '45钢' },
      }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'new');
    expect(result[0].user_properties['材料']).toBe('45钢');
    expect(result[0].match_status).toBe('matched');
    expect(rows[0].user_properties['规格型号']).toBe('old');
    expect(result[0]).not.toBe(rows[0]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend; npx vitest run src/components/CADWorkspace/syncRows.test.ts`
Expected: FAIL（无法解析 `./syncRows` 模块）

- [ ] **Step 3: 写最小实现**

创建 `frontend/src/components/CADWorkspace/syncRows.ts`：

```typescript
import type { BOMRow } from './CADBOMMatchTable';

/**
 * 按 CATIA PartNumber 同步更新所有相同零部件实例行的用户属性。
 * 业务来源：CATIA 中用户属性存于零件文档，同一 PartNumber 的所有实例
 * 引用同一文档、属性天然共享，因此表格各实例行的显示也必须保持一致。
 * PartNumber 为空时回退为仅按 path 更新当前行，避免多个空件号的行被误同步。
 */
export function syncRowsByPartNumber(
  rows: BOMRow[],
  row: BOMRow,
  key: string,
  value: string,
): BOMRow[] {
  const matches = row.part_number
    ? (r: BOMRow) => r.part_number === row.part_number
    : (r: BOMRow) => r.path === row.path;
  return rows.map(r =>
    matches(r) ? { ...r, user_properties: { ...r.user_properties, [key]: value } } : r
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend; npx vitest run src/components/CADWorkspace/syncRows.test.ts`
Expected: PASS（3 个用例全部通过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/CADWorkspace/syncRows.ts frontend/src/components/CADWorkspace/syncRows.test.ts
git commit -m "feat: 新增 syncRowsByPartNumber 同 PartNumber 实例属性同步函数"
```

---

### Task 2: CADBOMMatchTable 三处更新点接入同步函数

**Files:**
- Modify: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`（`handlePropEdit` L51-61、`handlePullFromPDM` L115-131、属性输入框 `onChange` L276-291）

**Interfaces:**
- Consumes: `syncRowsByPartNumber(rows, row, key, value)`（Task 1 产出）
- Produces: 无（终端 UI 行为）

- [ ] **Step 1: 添加导入**

在 `CADBOMMatchTable.tsx` 顶部 import 区（`import type { useCADBridge } ...` 之后）添加：

```typescript
import { syncRowsByPartNumber } from './syncRows';
```

- [ ] **Step 2: 修改 handlePropEdit**

将：

```typescript
      await bridge.writeProperty(row.path, key, value);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [key]: value } } : r
      ));
```

改为（CATIA 只写一次，表格按 PartNumber 同步所有实例行）：

```typescript
      await bridge.writeProperty(row.path, key, value);
      setRows(prev => syncRowsByPartNumber(prev, row, key, value));
```

- [ ] **Step 3: 修改属性输入框 onChange 本地回显**

将（表格渲染中 `propertyColumns.map` 内）：

```typescript
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => prev.map(r =>
                          r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [col]: val } } : r
                        ));
                        handlePropEdit(row, col, val);
                      }}
```

改为：

```typescript
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => syncRowsByPartNumber(prev, row, col, val));
                        handlePropEdit(row, col, val);
                      }}
```

- [ ] **Step 4: 修改 handlePullFromPDM**

将：

```typescript
        await bridge.writeProperty(row.path, '规格型号', master.spec);
        setRows(prev => prev.map(r =>
          r.path === row.path ? { ...r, user_properties: { ...r.user_properties, '规格型号': master.spec } } : r
        ));
```

改为：

```typescript
        await bridge.writeProperty(row.path, '规格型号', master.spec);
        setRows(prev => syncRowsByPartNumber(prev, row, '规格型号', master.spec));
```

- [ ] **Step 5: 运行全部前端测试**

Run: `cd frontend; npm run test`
Expected: 全部 PASS（含 Task 1 新增的 3 个用例）

- [ ] **Step 6: 生产构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: BOM匹配表格同PartNumber实例属性同步更新"
```
