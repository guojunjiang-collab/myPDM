# BOM 3D 对比：实例级匹配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 BOM 3D 对比下沉到实例级——件号、版本、空间位置三者全同才算同一实例，否则按删除 / 新增处理，3D 与对比树都按实例级结果着色。

**Architecture:** 把匹配逻辑从 `CompareModelLoader` 里抽成纯函数模块 `matchInstances.ts` 并用 vitest 锁死容差与配对规则；加载器改为按**配对行 key** 分组（修掉用 bom_item id 分组导致匹配从未生效的 bug）；对比树修正实例行布局并补变更标签。

**Tech Stack:** React 18 + TypeScript + Vite、three.js + @react-three/fiber、zustand、TailwindCSS、vitest。

**设计文档：** [docs/superpowers/specs/2026-08-01-bom-3d-compare-instance-level-design.md](../specs/2026-08-01-bom-3d-compare-instance-level-design.md)
**视觉参考：** [docs/superpowers/plans/bom-compare-tree-preview.html](bom-compare-tree-preview.html)

## Global Constraints

- 后端与数据库**零改动**。
- 现有三种预览模式（单件 `?id&token` / 装配 `?assembly=` / 配置清单 `?config-profile=`）行为不变。
- 不修改 `compareRenderRules.ts`、`compareTreeFilter.ts`、`buildCompareTree.ts`、`useCompareVisualState.ts`、`viewerStore.ts`。它们的现有测试必须保持全绿。
- 所有命令在 `frontend/` 目录下执行：测试 `npm test`、构建 `npm run build`、lint `npm run lint`（`--max-warnings 0`）。
- 容差常量：`POSITION_TOLERANCE = 0.01`（mm，平移欧氏距离）、`ROTATION_TOLERANCE = 1e-4`（3×3 分量最大绝对差）。写死为模块常量，不做界面可调。
- 匹配身份用 `AssemblyInstance.revision_id`（等价于件号+版本）。**不要**用 `part_code + version` 拼串，也**不要**用 `bom_item id`。
- 矩阵是**行主序** 16 元组：平移在下标 3 / 7 / 11，旋转 3×3 在下标 0,1,2,4,5,6,8,9,10。
- 实例级只有 `none` / `add` / `delete` 三态，不存在实例级 `modify`。
- 3D 变更色沿用：未变 `0xB4B2A9`、新增 `0x639922`、删除 `0xE24B4A`。
- 树配色沿用：新增 `bg-green-50`、删除 `bg-red-50`、修改与子项变化 `bg-yellow-50`。
- 树布局硬约束：**单一滚动容器；每行一个 flex 行；行内两格等宽**。层级缩进只能加在左右两格各自的 `paddingLeft` 上，**不得**加在外层 flex 行上。
- 提交信息末尾附：`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 与 spec 的一处偏差（已确认必要）

spec 的文件清单里写了「不动 `compareTypes.ts`」。实施时发现 `CompareInstanceNode.meshUuid` 是**单值**，而一个 `none` 实例左右各有一份几何：叠加模式下可见的是左份、只看右模式下可见的是右份，单值 uuid 无法让两格的眼睛按钮各自生效（后加载的右份会覆盖左份）。

因此 Task 1 把 `meshUuid: string` 拆成 `leftMeshUuid: string` 和 `rightMeshUuid: string`。这是让「两格各带眼睛按钮」这条已确认需求真正成立的最小改动。

## 已确认的代码事实（勿再猜）

1. `AssemblyInstance` 字段：`{ path, bom_path: string[], part_code, revision_id, glb_urls: {coarse,normal,fine}, matrix: number[], bbox }`。**没有 version 字段**，`revision_id` 即版本身份。
2. `CompareNode.key` 是件号链（如 `/GB-110/GB-115`），左右两侧共用——**它才是配对身份**。
3. `bom_item id` 按 `parent_revision_id` 存行，左右版本下的同一零件必然是不同的 id——**不能用作配对身份**。
4. `CompareModelLoader` 里已有 `leftIndex` / `rightIndex`（`Map<bomItemId, nodeKey>`，由 `indexByBomItem` 生成），正好用来把实例映射到配对行 key。
5. `renderDecision(changeType, mode)` 对 `none` / `add` / `delete` 的返回值已经符合实例级语义，**不需要修改**。
6. `queue` 中左右实例的序号与各自数组下标一一对应。

## File Structure

| 文件 | 改动 | 职责 |
|---|---|---|
| `frontend/src/components/STPViewer/matchInstances.ts` | 新增 | 纯函数：容差判定 + 左右实例配对 |
| `frontend/src/components/STPViewer/matchInstances.test.ts` | 新增 | 锁死容差与配对规则 |
| `frontend/src/components/STPViewer/compareTypes.ts` | 修改 | `CompareInstanceNode` 的 mesh uuid 拆成左右两个 |
| `frontend/src/components/STPViewer/CompareModelLoader.tsx` | 修改 | 分组键改配对行 key、删内联匹配改调新模块、按实例着色 |
| `frontend/src/components/STPViewer/CompareTreePanel.tsx` | 修改 | 统一行骨架修正两格等宽、BOM 行变更标签、实例行样式 |

---

### Task 1: 实例匹配纯函数模块

**Files:**
- Create: `frontend/src/components/STPViewer/matchInstances.ts`
- Test: `frontend/src/components/STPViewer/matchInstances.test.ts`
- Modify: `frontend/src/components/STPViewer/compareTypes.ts`

**Interfaces:**
- Consumes: 无（纯函数，不依赖任何现有模块）
- Produces:
  - `const POSITION_TOLERANCE = 0.01`
  - `const ROTATION_TOLERANCE = 1e-4`
  - `interface InstanceRef { index: number; matrix: number[]; revisionId: string }`
  - `interface InstanceMatch { changeType: 'none' | 'add' | 'delete'; side: 'left' | 'right' | 'both'; leftIndex?: number; rightIndex?: number }`
  - `function isSamePlacement(a: number[], b: number[]): boolean`
  - `function matchInstancePairs(left: InstanceRef[], right: InstanceRef[]): InstanceMatch[]`
  - `CompareInstanceNode` 的 `meshUuid: string` 替换为 `leftMeshUuid: string` + `rightMeshUuid: string`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/STPViewer/matchInstances.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { isSamePlacement, matchInstancePairs, POSITION_TOLERANCE, ROTATION_TOLERANCE } from './matchInstances';
import type { InstanceRef } from './matchInstances';

/** 行主序 4×4：单位旋转 + 指定平移。平移在下标 3/7/11。 */
const at = (x: number, y: number, z: number): number[] => [
  1, 0, 0, x,
  0, 1, 0, y,
  0, 0, 1, z,
  0, 0, 0, 1,
];

/** 在单位矩阵的某个旋转分量上加扰动 */
const rotPerturbed = (delta: number): number[] => {
  const m = at(0, 0, 0);
  m[1] = delta; // 旋转 3×3 的一个分量
  return m;
};

const ref = (index: number, matrix: number[], revisionId = 'rev-A'): InstanceRef => ({ index, matrix, revisionId });

describe('isSamePlacement', () => {
  it('完全相同的矩阵视为同一位置', () => {
    expect(isSamePlacement(at(10, 20, 30), at(10, 20, 30))).toBe(true);
  });

  it('平移差在容差内（0.005mm）视为同一位置', () => {
    expect(isSamePlacement(at(0, 0, 0), at(0.005, 0, 0))).toBe(true);
  });

  it('平移差超容差（0.05mm）视为不同位置', () => {
    expect(isSamePlacement(at(0, 0, 0), at(0.05, 0, 0))).toBe(false);
  });

  it('平移按欧氏距离而非分量各自比较', () => {
    // 三个分量各 0.008，单看分量都在 0.01 内，但合成距离 ≈0.0139 超容差
    expect(isSamePlacement(at(0, 0, 0), at(0.008, 0.008, 0.008))).toBe(false);
  });

  it('旋转分量差 1e-5 视为同一姿态', () => {
    expect(isSamePlacement(at(0, 0, 0), rotPerturbed(1e-5))).toBe(true);
  });

  it('旋转分量差 1e-3 视为不同姿态', () => {
    expect(isSamePlacement(at(0, 0, 0), rotPerturbed(1e-3))).toBe(false);
  });

  it('容差常量为约定值', () => {
    expect(POSITION_TOLERANCE).toBe(0.01);
    expect(ROTATION_TOLERANCE).toBe(1e-4);
  });
});

describe('matchInstancePairs', () => {
  it('同 revision 同位置 → none，并带上左右两侧下标', () => {
    const out = matchInstancePairs([ref(0, at(1, 2, 3))], [ref(0, at(1, 2, 3))]);
    expect(out).toEqual([
      { changeType: 'none', side: 'both', leftIndex: 0, rightIndex: 0 },
    ]);
  });

  it('位置在容差内仍配对为 none（吸收重导出的浮点噪声）', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], [ref(0, at(0.005, 0, 0))]);
    expect(out[0].changeType).toBe('none');
  });

  it('位置超容差 → 左删右增', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], [ref(0, at(0.05, 0, 0))]);
    expect(out.map((m) => m.changeType)).toEqual(['delete', 'add']);
  });

  it('revision 不同但位置相同 → 左删右增（版本参与匹配）', () => {
    const out = matchInstancePairs(
      [ref(0, at(1, 1, 1), 'rev-V1')],
      [ref(0, at(1, 1, 1), 'rev-V2')],
    );
    expect(out.map((m) => m.changeType)).toEqual(['delete', 'add']);
  });

  it('数量 3→5 且其中 2 个位置匹配 → 2 none + 1 delete + 3 add', () => {
    const left = [ref(0, at(0, 0, 0)), ref(1, at(10, 0, 0)), ref(2, at(20, 0, 0))];
    const right = [
      ref(0, at(0, 0, 0)),    // 配 left#0
      ref(1, at(20, 0, 0)),   // 配 left#2
      ref(2, at(30, 0, 0)),   // 新增
      ref(3, at(40, 0, 0)),   // 新增
      ref(4, at(50, 0, 0)),   // 新增
    ];
    const out = matchInstancePairs(left, right);
    expect(out.map((m) => m.changeType)).toEqual(['none', 'delete', 'none', 'add', 'add', 'add']);
    // 左侧原序在前，右侧未匹配追加在后
    expect(out[0]).toEqual({ changeType: 'none', side: 'both', leftIndex: 0, rightIndex: 0 });
    expect(out[1]).toEqual({ changeType: 'delete', side: 'left', leftIndex: 1 });
    expect(out[2]).toEqual({ changeType: 'none', side: 'both', leftIndex: 2, rightIndex: 1 });
    expect(out[3]).toEqual({ changeType: 'add', side: 'right', rightIndex: 2 });
  });

  it('同一右实例不会被两个左实例重复占用', () => {
    // 两个左实例在同一位置（异常数据），右侧只有一个
    const out = matchInstancePairs(
      [ref(0, at(5, 5, 5)), ref(1, at(5, 5, 5))],
      [ref(0, at(5, 5, 5))],
    );
    expect(out.map((m) => m.changeType)).toEqual(['none', 'delete']);
    expect(out.filter((m) => m.rightIndex === 0)).toHaveLength(1);
  });

  it('左空右非空 → 全 add', () => {
    const out = matchInstancePairs([], [ref(0, at(0, 0, 0)), ref(1, at(1, 0, 0))]);
    expect(out.map((m) => m.changeType)).toEqual(['add', 'add']);
    expect(out.every((m) => m.side === 'right')).toBe(true);
  });

  it('左非空右空 → 全 delete', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], []);
    expect(out).toEqual([{ changeType: 'delete', side: 'left', leftIndex: 0 }]);
  });

  it('两侧皆空 → 空数组', () => {
    expect(matchInstancePairs([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- matchInstances`
Expected: FAIL —— `Failed to resolve import "./matchInstances"`

- [ ] **Step 3: 实现纯函数模块**

`frontend/src/components/STPViewer/matchInstances.ts`：

```ts
/**
 * 实例级匹配：判定左右两版装配中的零件实例是否为"同一个实例"。
 *
 * 判定标准：件号 + 版本 + 空间位置三者全同。件号+版本在数据上等价于一个
 * PartRevision，因此直接用 revision_id 作身份；空间位置按容差比对矩阵。
 *
 * 不用 toFixed 串比：一是舍入边界会抖（0.00005 与 0.000049999 落到不同串），
 * 二是同一装配重新导出后矩阵尾数几乎必然变化，4 位小数在 mm 单位下约等于
 * 要求二进制完全一致。
 */

/** 平移欧氏距离阈值（mm）。远小于任何有意义的位置变动，又足以吸收重导出噪声。 */
export const POSITION_TOLERANCE = 0.01;

/** 旋转 3×3 分量最大绝对差阈值（约 0.006°） */
export const ROTATION_TOLERANCE = 1e-4;

/** 行主序 4×4 中平移分量的下标 */
const TRANSLATION_INDICES = [3, 7, 11];

/** 行主序 4×4 中旋转 3×3 部分的下标 */
const ROTATION_INDICES = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/** 参与匹配的实例引用 */
export interface InstanceRef {
  /** 在所属侧 instances 数组中的下标 */
  index: number;
  /** 行主序 4×4，共 16 个数 */
  matrix: number[];
  /** 件号+版本的等价身份 */
  revisionId: string;
}

/** 一条匹配结果 */
export interface InstanceMatch {
  changeType: 'none' | 'add' | 'delete';
  side: 'left' | 'right' | 'both';
  leftIndex?: number;
  rightIndex?: number;
}

/**
 * 两个矩阵是否表示同一空间位置。
 * 平移与旋转分开设阈值——两者量纲不同，用同一个数比没有物理意义。
 */
export function isSamePlacement(a: number[], b: number[]): boolean {
  if (a.length !== 16 || b.length !== 16) return false;

  let sq = 0;
  for (const i of TRANSLATION_INDICES) {
    const d = a[i] - b[i];
    sq += d * d;
  }
  if (Math.sqrt(sq) > POSITION_TOLERANCE) return false;

  for (const i of ROTATION_INDICES) {
    if (Math.abs(a[i] - b[i]) > ROTATION_TOLERANCE) return false;
  }
  return true;
}

/**
 * 左右实例配对。左侧按序贪心：找第一个未被占用、revision 相同、位置相同的
 * 右实例配成 none；配不上标 delete；右侧剩余标 add。
 *
 * 贪心不保证全局最优，但在 0.01mm 容差下两个候选同时命中意味着两个零件几乎
 * 重叠——现实装配里不出现，因此解唯一。
 *
 * 返回顺序即树中显示顺序：左侧原序在前，右侧未匹配追加在后。
 */
export function matchInstancePairs(left: InstanceRef[], right: InstanceRef[]): InstanceMatch[] {
  const out: InstanceMatch[] = [];
  const usedRight = new Set<number>();

  for (const l of left) {
    const hit = right.findIndex(
      (r, i) => !usedRight.has(i) && r.revisionId === l.revisionId && isSamePlacement(l.matrix, r.matrix),
    );
    if (hit >= 0) {
      usedRight.add(hit);
      out.push({ changeType: 'none', side: 'both', leftIndex: l.index, rightIndex: right[hit].index });
    } else {
      out.push({ changeType: 'delete', side: 'left', leftIndex: l.index });
    }
  }

  for (let i = 0; i < right.length; i++) {
    if (!usedRight.has(i)) {
      out.push({ changeType: 'add', side: 'right', rightIndex: right[i].index });
    }
  }

  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- matchInstances`
Expected: PASS，16 个用例全绿（`isSamePlacement` 7 例 + `matchInstancePairs` 9 例）

- [ ] **Step 5: 拆分 CompareInstanceNode 的 mesh uuid**

在 `frontend/src/components/STPViewer/compareTypes.ts` 中，把 `CompareInstanceNode` 的

```ts
  /** 关联的 mesh uuid（加载后回填） */
  meshUuid: string;
```

替换为

```ts
  /** 左侧那份几何的 mesh uuid（加载后回填；无左份时为空串） */
  leftMeshUuid: string;
  /** 右侧那份几何的 mesh uuid（加载后回填；无右份时为空串） */
  rightMeshUuid: string;
```

> 拆成两个是因为 `none` 实例左右各有一份几何，叠加模式显示左份、只看右模式显示右份；单值 uuid 会被后加载的一侧覆盖，导致两格的眼睛按钮无法各自生效。

- [ ] **Step 6: 类型检查（预期报错，Task 2/3 修复）**

Run: `npx tsc --noEmit`
Expected: `CompareModelLoader.tsx` 与 `CompareTreePanel.tsx` 报 `meshUuid` 不存在。不要在本任务修它们。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/STPViewer/matchInstances.ts frontend/src/components/STPViewer/matchInstances.test.ts frontend/src/components/STPViewer/compareTypes.ts
git commit -m "feat(3d-compare): 实例匹配纯函数（件号+版本+位置三元，容差 0.01mm/1e-4）"
```

---

### Task 2: 加载器接入实例级匹配

**Files:**
- Modify: `frontend/src/components/STPViewer/CompareModelLoader.tsx`

**Interfaces:**
- Consumes: `matchInstancePairs` / `InstanceRef`（Task 1）、`renderDecision`（现有，不改）、`CompareInstanceNode.leftMeshUuid` / `rightMeshUuid`（Task 1）
- Produces: `node.instances` 填充为实例级匹配结果，每个 `lod` 与 mesh 的 `userData` 带上 `changeType`（实例级）与 `compareInstanceKey`

- [ ] **Step 1: 删除内联的匹配代码，改为导入新模块**

在 `frontend/src/components/STPViewer/CompareModelLoader.tsx` 中：

删除 `matrixKey` 函数（`/** 矩阵稳定标识（4 位小数取整） */` 那段）和整个内联的 `matchInstances` 函数（`/** 对同一 bomItemId 的左右实例做矩阵匹配，产出实例子节点列表 */` 那段）。

在 import 区追加：

```tsx
import { matchInstancePairs, type InstanceRef } from './matchInstances';
```

- [ ] **Step 2: queue 带上数组下标**

把

```tsx
    // 逐实例排队：先左后右，保证 modify 的旧版先落位
    const queue: { inst: AssemblyInstance; side: Side }[] = [
      ...leftInstances.map((inst) => ({ inst, side: 'left' as Side })),
      ...rightInstances.map((inst) => ({ inst, side: 'right' as Side })),
    ];
```

改为

```tsx
    // 逐实例排队：先左后右。index 即该实例在所属侧数组中的下标，匹配结果按它回查。
    const queue: { inst: AssemblyInstance; side: Side; index: number }[] = [
      ...leftInstances.map((inst, index) => ({ inst, side: 'left' as Side, index })),
      ...rightInstances.map((inst, index) => ({ inst, side: 'right' as Side, index })),
    ];
```

- [ ] **Step 3: 第一遍改为按配对行 key 分组并调用新匹配**

把「── 第一遍：按 bomItemId 分组收集矩阵，做实例匹配 ──」整段（从 `const groupLeft = new Map...` 到 `useViewerStore.setState({ compare: { ...c, tree: { ...c.tree } } });` 结束的那个 `}`）整体替换为：

```tsx
      // ── 第一遍：按配对行 key 分组，做实例匹配 ──
      // 关键：分组键必须是 CompareNode.key（件号链，左右共有），不能是 bom_item id
      // ——后者按 parent_revision_id 存行，左右版本下必然不同，会导致永远匹配不上。
      const groupLeft = new Map<string, InstanceRef[]>();
      const groupRight = new Map<string, InstanceRef[]>();
      for (const { inst, side, index } of queue) {
        const nodeKey = (side === 'left' ? leftIndex : rightIndex).get(bomItemIdOf(inst));
        if (!nodeKey) continue;
        const group = side === 'left' ? groupLeft : groupRight;
        const list = group.get(nodeKey) || [];
        list.push({ index, matrix: inst.matrix, revisionId: inst.revision_id });
        group.set(nodeKey, list);
      }

      const allKeys = new Set([...groupLeft.keys(), ...groupRight.keys()]);
      for (const nodeKey of allKeys) {
        const node = compare.nodeMap.get(nodeKey);
        if (!node) continue;
        const matches = matchInstancePairs(groupLeft.get(nodeKey) || [], groupRight.get(nodeKey) || []);
        // 左右共享一套序号：删除项与新增项都占号，匹配上的实例在两侧序号相同
        node.instances = matches.map((m, i) => {
          const sideData = m.side === 'right' ? node.right : (node.left || node.right);
          const seq = i + 1;
          return {
            key: `${nodeKey}:inst:${seq}`,
            changeType: m.changeType,
            side: m.side,
            leftIndex: m.leftIndex,
            rightIndex: m.rightIndex,
            leftMeshUuid: '',
            rightMeshUuid: '',
            label: [sideData?.code, sideData?.version, sideData?.name, seq].filter(Boolean).join('_'),
            seq,
          };
        });
      }

      // 实例数据是直接改在节点对象上的，浅拷贝 compare 触发面板重渲染
      const c0 = useViewerStore.getState().compare;
      if (c0) useViewerStore.setState({ compare: { ...c0, tree: { ...c0.tree } } });

      // 按 "{side}:{index}" 建反查表，第二遍加载时按实例下标直接定位（不再按矩阵串比）
      const instByRef = new Map<string, CompareInstanceNode>();
      for (const node of compare.nodeMap.values()) {
        for (const inst of node.instances || []) {
          if (inst.leftIndex !== undefined) instByRef.set(`left:${inst.leftIndex}`, inst);
          if (inst.rightIndex !== undefined) instByRef.set(`right:${inst.rightIndex}`, inst);
        }
      }
```

- [ ] **Step 4: 第二遍改为按下标定位实例并回填对应侧 mesh uuid**

把第二遍循环的头部

```tsx
      for (const { inst, side } of queue) {
        const bomItemId = bomItemIdOf(inst);
        const nodeKey = (side === 'left' ? leftIndex : rightIndex).get(bomItemId);
        if (!nodeKey) { loaded++; setStreamProgress({ loaded, total }); continue; }
        const node = compare.nodeMap.get(nodeKey);
        if (!node) { loaded++; setStreamProgress({ loaded, total }); continue; }

        // 查找该实例对应的实例子节点，确定其变更类型和颜色
        const instances = node.instances || [];
        const mk = matrixKey(inst.matrix);
        let instNode: CompareInstanceNode | undefined;
        if (side === 'left') {
          instNode = instances.find(i => i.leftIndex !== undefined && matrixKey(leftInstances[i.leftIndex]?.matrix || []) === mk);
        } else {
          instNode = instances.find(i => i.rightIndex !== undefined && matrixKey(rightInstances[i.rightIndex]?.matrix || []) === mk);
        }
        const instChangeType: ChangeType = instNode?.changeType ?? node.changeType;
        const decision = renderDecision(instChangeType, 'both');
```

替换为

```tsx
      for (const { inst, side, index } of queue) {
        const nodeKey = (side === 'left' ? leftIndex : rightIndex).get(bomItemIdOf(inst));
        if (!nodeKey) { loaded++; setStreamProgress({ loaded, total }); continue; }
        const node = compare.nodeMap.get(nodeKey);
        if (!node) { loaded++; setStreamProgress({ loaded, total }); continue; }

        // 按 "{side}:{index}" 直接定位实例子节点，确定其变更类型与颜色。
        // 匹配不到（该节点无实例数据）时回退到节点级 changeType。
        const instNode = instByRef.get(`${side}:${index}`);
        const instChangeType: ChangeType = instNode?.changeType ?? node.changeType;
        const decision = renderDecision(instChangeType, 'both');
```

把回填 mesh uuid 那段

```tsx
        mergeCompareMeshes(nodeKey, side, uuids);
        // 回填实例子节点的 meshUuid
        if (instNode && uuids.length > 0) {
          instNode.meshUuid = uuids[0];
        }
```

替换为

```tsx
        mergeCompareMeshes(nodeKey, side, uuids);
        // 回填该实例在**本侧**的 mesh uuid：none 实例左右各有一份几何，
        // 两格的眼睛按钮各自控制自己那份，不能共用一个值。
        if (instNode && uuids.length > 0) {
          if (side === 'left') instNode.leftMeshUuid = uuids[0];
          else instNode.rightMeshUuid = uuids[0];
        }
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 只剩 `CompareTreePanel.tsx` 报 `meshUuid` 不存在（Task 3 修）。`CompareModelLoader.tsx` 无错误。

如果报 `CompareInstanceNode` 未使用或未导入，确认文件顶部的 `import type { CompareNode, CompareInstanceNode, Side, ChangeType } from './compareTypes';` 仍然保留——`instByRef` 用到了它。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/STPViewer/CompareModelLoader.tsx
git commit -m "fix(3d-compare): 分组键改用配对行key修复矩阵匹配从未生效，接入实例级匹配"
```

---

### Task 3: 对比树布局修正与实例行样式

**Files:**
- Modify: `frontend/src/components/STPViewer/CompareTreePanel.tsx`

**Interfaces:**
- Consumes: `CompareInstanceNode.leftMeshUuid` / `rightMeshUuid`（Task 1）、`node.instances`（Task 2）、`toggleMesh`（store 现有）

**布局硬约束**：所有行统一骨架 —— 固定宽度展开槽 + 两个 `flex-1 min-w-0` 格子 + 中间 1px 分隔线。**缩进加在两格各自的 `paddingLeft`，两格取相同值**，绝不加在外层 flex 行上。当前实例行把 `paddingLeft` 加在外层行上，导致左格被压窄、两格不等宽、与 BOM 行分栏错位——本任务修掉它。

- [ ] **Step 1: 加入变更标签常量**

在 `frontend/src/components/STPViewer/CompareTreePanel.tsx` 的 `ROW_BG` 之后追加：

```tsx
const CHANGE_LABEL: Record<ChangeType, string> = {
  add: '新增',
  delete: '删除',
  modify: '修改',
  internal: '子项变',
  none: '',
};

const CHANGE_LABEL_COLOR: Record<ChangeType, string> = {
  add: 'text-green-600',
  delete: 'text-red-600',
  modify: 'text-yellow-600',
  internal: 'text-yellow-600',
  none: '',
};
```

- [ ] **Step 2: SideCell 接受缩进并渲染变更标签**

把 `SideCell` 整个函数替换为：

```tsx
/** 单侧格子：缺失侧渲染占位。缩进走本格 paddingLeft，保证两格等宽。 */
function SideCell({ side, node, which, indent }: {
  side: CompareSide | null;
  node: CompareNode;
  which: Side;
  indent: number;
}) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMeshes = useViewerStore((s) => s.toggleCompareSideVisibility);

  if (!side) {
    return (
      <div className="flex-1 min-w-0 flex items-center px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
        <span className="text-gray-300 italic text-xs">—</span>
      </div>
    );
  }

  const visible = side.meshUuids.length === 0 ? true : side.meshUuids.some((u) => !hiddenParts.has(u));
  const noModel = !side.hasModel;
  const label = [side.code, side.version, side.name].filter(Boolean).join('_');
  const count = node.instances && node.instances.length > 0 ? node.instances.length : side.quantity;

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
      {side.meshUuids.length > 0 ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMeshes(node.key, which); }}
          className={`w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500 hover:bg-blue-50' : 'text-gray-300 hover:text-gray-400'}`}
          title={visible ? '隐藏' : '显示'}
        >
          <EyeIcon visible={visible} />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <span
        className={`truncate flex-1 text-xs
          ${noModel ? 'text-gray-400 italic' : 'text-gray-700'}
          ${visible ? '' : 'text-gray-300 line-through'}`}
        title={label}
      >
        {label}
        {count !== null && count !== undefined && <span className="text-gray-400 ml-1">×{count}</span>}
        {noModel && <span className="text-gray-400 ml-1">(无模型)</span>}
      </span>
      {which === 'right' && CHANGE_LABEL[node.changeType] && (
        <span className={`shrink-0 text-[10px] ${CHANGE_LABEL_COLOR[node.changeType]}`}>
          {CHANGE_LABEL[node.changeType]}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 重写 InstanceRow，遵守统一骨架**

把 `InstanceRow` 与 `formatInstanceLabel` 两个函数整体替换为：

```tsx
/** 实例行的单侧格子 */
function InstanceCell({ present, label, meshUuid, indent }: {
  present: boolean;
  label: string;
  meshUuid: string;
  indent: number;
}) {
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const toggleMesh = useViewerStore((s) => s.toggleMesh);
  const visible = !meshUuid || !hiddenParts.has(meshUuid);

  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: 8 + indent }}>
      {present && meshUuid ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleMesh(meshUuid); }}
          className={`w-3.5 h-3.5 flex items-center justify-center shrink-0 rounded transition-colors
            ${visible ? 'text-gray-400 hover:text-blue-500' : 'text-gray-300'}`}
          title={visible ? '隐藏' : '显示'}
        >
          <EyeIcon visible={visible} />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className={`truncate flex-1 text-[11px] ${visible ? 'text-gray-600' : 'text-gray-300 line-through'}`}>
        {present ? label : <span className="text-gray-300 italic">—</span>}
      </span>
    </div>
  );
}

/** 实例行：与 BOM 行同一套骨架（展开槽 + 两格等宽 + 分隔线），缩进走格内 padding */
function InstanceRow({ inst, depth, node }: { inst: CompareInstanceNode; depth: number; node: CompareNode }) {
  const selectedKey = useViewerStore((s) => s.compare?.selectedKey ?? null);
  const selectCompareKey = useViewerStore((s) => s.selectCompareKey);
  const isSelected = selectedKey === inst.key;
  const inLeft = inst.side === 'left' || inst.side === 'both';
  const inRight = inst.side === 'right' || inst.side === 'both';
  const indent = (depth + 1) * 12;

  // 左右两侧件号/版本可能不同，各取自己那侧的 CompareSide
  const labelOf = (s: CompareSide | null) =>
    [s?.code, s?.version, s?.name, inst.seq].filter(Boolean).join('_');

  const bg = isSelected
    ? 'bg-primary-50 ring-1 ring-inset ring-primary-400'
    : inst.changeType === 'add'
      ? 'bg-green-50 hover:bg-green-100'
      : inst.changeType === 'delete'
        ? 'bg-red-50 hover:bg-red-100'
        : 'hover:bg-gray-50';

  return (
    <li>
      <div
        onClick={(e) => { e.stopPropagation(); selectCompareKey(inst.key); }}
        className={`flex items-stretch cursor-pointer select-none transition-colors ${bg}`}
      >
        <div className="shrink-0 w-5" />
        <InstanceCell present={inLeft} label={labelOf(node.left)} meshUuid={inst.leftMeshUuid} indent={indent} />
        <div className="w-px bg-gray-200 shrink-0" />
        <InstanceCell present={inRight} label={labelOf(node.right)} meshUuid={inst.rightMeshUuid} indent={indent} />
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Row 传递缩进给两格，展开槽固定宽度**

把 `Row` 里的行渲染部分

```tsx
        {/* 展开按钮每行只有一个，作用于整行 —— 左右联动是结构性的 */}
        <div className="shrink-0 flex items-center" style={{ paddingLeft: 4 + depth * 12 }}>
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.key); }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200/60"
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="w-4" />
          )}
        </div>
        <SideCell side={node.left} node={node} which="left" />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell side={node.right} node={node} which="right" />
```

替换为

```tsx
        {/* 展开槽宽度固定，不随层级变化 —— 缩进走两格各自的 paddingLeft，
            这样两格永远等宽、分隔线在所有行上处于同一水平位置 */}
        <div className="shrink-0 w-5 flex items-center justify-center">
          {hasChildren || hasInstances ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.key); }}
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200/60"
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            <span className="w-4" />
          )}
        </div>
        <SideCell side={node.left} node={node} which="left" indent={depth * 12} />
        <div className="w-px bg-gray-200 shrink-0" />
        <SideCell side={node.right} node={node} which="right" indent={depth * 12} />
```

在 `Row` 的 `const hasChildren = node.children.length > 0;` 之后追加：

```tsx
  const hasInstances = !!node.instances && node.instances.length > 0;
```

并把实例子行的渲染条件从

```tsx
      {node.instances && node.instances.length > 0 && (
```

改为

```tsx
      {hasInstances && expanded && (
```

> 实例行改为跟随展开态，与子 BOM 行一致——否则实例行会在折叠状态下仍然显示。

- [ ] **Step 5: 表头对齐新的展开槽宽度**

`CompareTreePanel` 里表头的 `<span className="shrink-0 w-5" />` 已经是 20px，与新的展开槽一致，无需改动。确认它仍在 `<span>` 列表首位即可。

- [ ] **Step 6: 类型检查与构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 均无错误

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: 0 error 0 warning

如果报 `ChangeType` 或 `CompareInstanceNode` 未使用，检查文件顶部 import：应为
`import type { CompareNode, CompareSide, ChangeType, Side, CompareInstanceNode } from './compareTypes';`

- [ ] **Step 8: 提交**

```bash
git add frontend/src/components/STPViewer/CompareTreePanel.tsx
git commit -m "fix(3d-compare): 修正实例行破坏两格等宽的布局，补 BOM 行变更标签"
```

---

### Task 4: 全量校验与手动验收

**Files:** 无代码改动（发现问题回到对应 Task 的文件修复）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS。新增 `matchInstances` 16 例；`buildCompareTree` / `compareRenderRules` / `compareTreeFilter` / `viewerStore.compare` 的既有用例全绿。

- [ ] **Step 2: Lint 与构建**

Run: `npm run lint && npm run build`
Expected: 均通过

- [ ] **Step 3: 启动开发服务器**

Run: `npm run dev`

- [ ] **Step 4: 手动验收（逐条对照设计文档验收标准）**

- [ ] 零部件管理 → BOM 对比 → 选两个部件 → 「🧊 3D对比」→ 新标签打开
- [ ] 同零件、同版本、同位置的实例在 3D 中是**灰色**且只渲染一份（修复前是满屏红绿、无灰件）
- [ ] 同零件同版本但位置移动超过 0.01mm 的实例：左红、右绿
- [ ] 同零件同位置但版本不同的实例：判为删除+新增（红+绿），不判为未变
- [ ] 用同一装配重新导出的 STEP 做左右两侧：不应整体变红绿（容差吸收浮点噪声）
- [ ] 数量 3→5 的零件，展开后有 5 条实例子行，颜色对应匹配结果；左右序号一一对齐，缺失侧显示 `—`
- [ ] BOM 行右侧显示变更标签（新增 / 删除 / 修改 / 子项变），数量显示实际实例数
- [ ] **两格等宽**：BOM 行与实例行的中间分隔线在所有行上处于同一水平位置，缩进不破坏分栏
- [ ] 折叠某 BOM 行，其实例子行一并隐藏
- [ ] 切 `只看左`：未变实例显示左份、删除实例显示、新增实例消失；`只看右` 对称
- [ ] 实例行左右两格的眼睛按钮各自只控制自己那一侧的几何
- [ ] 幽灵滑块仍作用于「隔离未选中」与「仅显示差异时的未变件」
- [ ] 回归：`?assembly=<revId>`、`?config-profile=<id>`、附件 STP 预览三种入口行为不变

- [ ] **Step 5: 提交（若有修复）**

```bash
git add -A
git commit -m "fix(3d-compare): 手动验收问题修复"
```

---

## 完成后

验收通过后，用 `superpowers:finishing-a-development-branch` 决定如何合入（当前分支 `feat/cad_compare`，主分支 `V1.3.1_CHANGE_CONFIG`）。
