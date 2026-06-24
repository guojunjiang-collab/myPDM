# STP 查看器自动上色 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STP 查看器工具栏新增「上色」开关，按零件名称为零部件自动着色（同名同色），关闭时还原原色。

**Architecture:** 纯函数 `autoColor.ts` 按名称均匀铺色相生成 name→color；`viewerStore` 加 `autoColor` 开关；`ModelLoader` 加载时捕获各 mesh 原始色，并在一个依赖 `[autoColor, treeData, nodeMap]` 的 effect 里着色/还原；`Toolbar` 加 toggle 按钮。着色只改 `material.color`，与既有选中/隔离/线框（改 emissive/opacity/wireframe）正交。

**Tech Stack:** React + TypeScript + @react-three/fiber + three.js + zustand + vitest。

参考 spec：`docs/superpowers/specs/2026-06-24-stp-viewer-auto-color-design.md`

现状要点（已核对）：
- `ModelLoader.tsx` 加载后克隆每个单材质 mesh 的 `material`（约 38-43 行）；随后 `setTreeData(buildModelTree(gltf.scene))`。
- 选中/隔离 effect 仅改 `emissive`/`opacity`/`depthWrite`/`wireframe`，不改 `color`。
- `TreeNode`：`type: 'group' | 'part'`，`part` 节点有 `meshUuids: string[]`、`name`。
- `viewerStore` 有 `treeData`、`nodeMap`、`reset()`；vitest 已配置（`src/**/*.test.ts` 有先例，如 `buildModelTree.test.ts`）。
- three 的 `Color` 有 `setHex(number)`、`getHex(): number`、`setHSL(h,s,l)`（h/s/l 均 0..1）。

---

## File Structure

- 新增 `frontend/src/components/STPViewer/autoColor.ts` — 纯函数：名称集合 → name→color(hex)。单一职责、可单测。
- 新增 `frontend/src/components/STPViewer/autoColor.test.ts` — 单测。
- 修改 `frontend/src/stores/viewerStore.ts` — 增 `autoColor` 状态 + `toggleAutoColor` + reset 复位。
- 修改 `frontend/src/components/STPViewer/ModelLoader.tsx` — 原始色捕获 + 着色/还原 effect。
- 修改 `frontend/src/components/STPViewer/Toolbar.tsx` — 「上色」按钮。

---

## Task 1: 着色纯函数 `autoColor.ts`（TDD）

**Files:**
- Create: `frontend/src/components/STPViewer/autoColor.ts`
- Test: `frontend/src/components/STPViewer/autoColor.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// frontend/src/components/STPViewer/autoColor.test.ts
import { describe, it, expect } from 'vitest';
import { buildColorMap } from './autoColor';

describe('buildColorMap', () => {
  it('空数组返回空 Map', () => {
    expect(buildColorMap([]).size).toBe(0);
  });

  it('同名得同色、不同名得不同色', () => {
    const m = buildColorMap(['螺栓', '法兰', '螺栓', '端盖']);
    expect(m.size).toBe(3); // 去重后 3 个
    expect(m.get('螺栓')).toBe(m.get('螺栓'));
    const colors = new Set([m.get('螺栓'), m.get('法兰'), m.get('端盖')]);
    expect(colors.size).toBe(3); // 三种名称三种颜色
  });

  it('返回合法 packed hex (0..0xffffff)', () => {
    const m = buildColorMap(['a', 'b', 'c', 'd', 'e']);
    for (const v of m.values()) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('确定性：同输入多次调用结果一致', () => {
    const a = buildColorMap(['x', 'y', 'z']);
    const b = buildColorMap(['z', 'y', 'x']); // 顺序不同
    expect(a.get('x')).toBe(b.get('x'));
    expect(a.get('y')).toBe(b.get('y'));
    expect(a.get('z')).toBe(b.get('z'));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/STPViewer/autoColor.test.ts`
Expected: FAIL（`buildColorMap` 未定义 / 模块不存在）

- [ ] **Step 3: 实现 `autoColor.ts`**

```ts
// frontend/src/components/STPViewer/autoColor.ts
import { Color } from 'three';

const GOLDEN_ANGLE = 137.508; // 度，均匀铺色相
const SAT = 0.55;
const LIGHT = 0.55;

/**
 * 给定一组零件名称，返回 name -> 颜色(packed hex number) 的映射。
 * - 去重并按字典序排序，保证确定性（与输入顺序无关）。
 * - 第 i 个名称色相 = (i * 黄金角) % 360，固定 S/L。
 * - 同名必同色；不同名色相尽量拉开。
 */
export function buildColorMap(names: string[]): Map<string, number> {
  const uniq = Array.from(new Set(names)).sort();
  const map = new Map<string, number>();
  const c = new Color();
  uniq.forEach((name, i) => {
    const h = ((i * GOLDEN_ANGLE) % 360) / 360; // three 期望 0..1
    c.setHSL(h, SAT, LIGHT);
    map.set(name, c.getHex());
  });
  return map;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/STPViewer/autoColor.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
cd "D:/OpenCode/myPDM" && git add frontend/src/components/STPViewer/autoColor.ts frontend/src/components/STPViewer/autoColor.test.ts && git commit -m "feat(stp-viewer): 自动上色取色纯函数 buildColorMap"
```

---

## Task 2: viewerStore 增加 autoColor 开关

**Files:**
- Modify: `frontend/src/stores/viewerStore.ts`

> 该任务只改 store，类型与 reset 一致性靠 `npm run build`（tsc）把关；无独立单测。

- [ ] **Step 1: 在 `ViewerState` 接口增加字段与 action**

在 `wireframe: boolean;` 一行附近（视图状态区）增加：

```ts
  wireframe: boolean;
  autoColor: boolean;
```

在 Actions 区 `toggleWireframe: () => void;` 下方增加：

```ts
  toggleWireframe: () => void;
  toggleAutoColor: () => void;
```

- [ ] **Step 2: 在 `initialState` 增加默认值**

在 `wireframe: false,` 一行下方增加：

```ts
  wireframe: false,
  autoColor: false,
```

- [ ] **Step 3: 实现 action**

在 `toggleWireframe: () => set({ wireframe: !get().wireframe }),` 下方增加：

```ts
  toggleWireframe: () => set({ wireframe: !get().wireframe }),
  toggleAutoColor: () => set({ autoColor: !get().autoColor }),
```

（`reset()` 已展开 `...initialState`，`autoColor` 会一并复位为 false，无需额外改动。）

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 5: 提交**

```bash
cd "D:/OpenCode/myPDM" && git add frontend/src/stores/viewerStore.ts && git commit -m "feat(stp-viewer): viewerStore 增加 autoColor 开关"
```

---

## Task 3: ModelLoader 原始色捕获 + 着色/还原 effect

**Files:**
- Modify: `frontend/src/components/STPViewer/ModelLoader.tsx`

> 着色行为依赖真实 three 场景，靠 Docker 手测验证；本任务以 `npm run build` 类型/编译为自动关卡。

- [ ] **Step 1: 引入 buildColorMap、useRef 原始色 Map，并从 store 取 autoColor**

在文件顶部 import 区（`import { buildModelTree } from './buildModelTree';` 下方）增加：

```ts
import { buildModelTree } from './buildModelTree';
import { buildColorMap } from './autoColor';
```

在组件内解构 store 的那段（`selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe, resetViewTrigger, measureMode,`）中追加 `autoColor`：

```ts
    selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe, resetViewTrigger,
    measureMode, autoColor,
```

在 `const groupRef = useRef<THREE.Group>(null);` 下方新增原始色 Map ref：

```ts
  const groupRef = useRef<THREE.Group>(null);
  const origColorRef = useRef<Map<string, number>>(new Map());
```

- [ ] **Step 2: 加载时捕获原始色**

在"克隆材质"的 `gltf.scene.traverse(...)` 块（设置 `m.material = (m.material as THREE.Material).clone();` 的那段）之后、`setTreeData(...)` 之前，新增捕获原始色的遍历：

```ts
    // 1b) 记录每个单材质 mesh 的原始颜色，供自动上色关闭时还原
    origColorRef.current = new Map();
    gltf.scene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        const std = m.material as THREE.MeshStandardMaterial;
        if (std.color) origColorRef.current.set(m.uuid, std.color.getHex());
      }
    });
```

- [ ] **Step 3: 新增着色/还原 effect**

在选中/隔离的那个 effect（依赖 `[selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe]` 的 effect）之后，新增：

```ts
  // 自动上色：按零件名称着色；关闭时还原原始色。只改 color，不触碰 emissive/opacity。
  useEffect(() => {
    const group = groupRef.current;
    const { treeData } = useViewerStore.getState();
    if (!group || !treeData) return;

    // 收集 uuid -> 目标颜色
    const target = new Map<string, number>();
    if (autoColor) {
      const names: string[] = [];
      nodeMap.forEach((n) => { if (n.type === 'part') names.push(n.name); });
      const colorMap = buildColorMap(names);
      nodeMap.forEach((n) => {
        if (n.type !== 'part') return;
        const color = colorMap.get(n.name);
        if (color === undefined) return;
        n.meshUuids.forEach((u) => target.set(u, color));
      });
    } else {
      origColorRef.current.forEach((hex, uuid) => target.set(uuid, hex));
    }

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return; // 多材质跳过
      const std = mat as THREE.MeshStandardMaterial;
      const hex = target.get(mesh.uuid);
      if (hex === undefined || !std.color) return;
      std.color.setHex(hex);
      std.needsUpdate = true;
    });
  }, [autoColor, nodeMap]);
```

> 说明：依赖里用 `nodeMap`（每次 `setTreeData` 会换新引用，模型加载后即触发一次；此时 `autoColor` 默认 false，会按原始色 Map 还原，等价于不变）。`treeData` 通过 `getState()` 读取以避免再列一个依赖。

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 5: 提交**

```bash
cd "D:/OpenCode/myPDM" && git add frontend/src/components/STPViewer/ModelLoader.tsx && git commit -m "feat(stp-viewer): ModelLoader 原始色捕获与自动上色 effect"
```

---

## Task 4: Toolbar 「上色」按钮

**Files:**
- Modify: `frontend/src/components/STPViewer/Toolbar.tsx`

- [ ] **Step 1: 从 store 取 autoColor 与 toggleAutoColor**

在 `const wireframe = useViewerStore((s) => s.wireframe);` 下方增加：

```ts
  const wireframe = useViewerStore((s) => s.wireframe);
  const autoColor = useViewerStore((s) => s.autoColor);
  const toggleAutoColor = useViewerStore((s) => s.toggleAutoColor);
```

- [ ] **Step 2: 在「线框」按钮后增加「上色」按钮**

找到「线框」按钮块：

```tsx
      {/* Wireframe */}
      <button
        onClick={toggleWireframe}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${wireframe
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        线框
      </button>
```

在其后新增：

```tsx
      {/* Auto color */}
      <button
        onClick={toggleAutoColor}
        className={`text-sm px-3 py-1.5 rounded-md font-medium transition-colors
          ${autoColor
            ? 'bg-blue-50 text-blue-600 border border-blue-200'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-transparent'}`}
      >
        上色
      </button>
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 错误。

- [ ] **Step 4: 运行前端单测确认无回归**

Run: `cd frontend && npm test`
Expected: 全部通过（含新增 autoColor 用例与既有测试）。

- [ ] **Step 5: 提交**

```bash
cd "D:/OpenCode/myPDM" && git add frontend/src/components/STPViewer/Toolbar.tsx && git commit -m "feat(stp-viewer): 工具栏新增上色开关按钮"
```

---

## Task 5: Docker 手测（端到端验证）

**前置：** Task 1–4 已提交。

- [ ] **Step 1: 重建前端并部署**

```bash
cd "D:/OpenCode/myPDM/frontend" && npm run build && cd "D:/OpenCode/myPDM" && docker compose restart nginx
```
（前端为静态构建，nginx 挂载 `frontend/dist`，重启即生效。）

- [ ] **Step 2: 浏览器手测（硬刷新 Ctrl+F5）**

打开一个多零件装配体 STP 的三维预览，验证：
- 点工具栏「上色」→ 零件按名称着色，同名零件同色、相邻零件区分明显
- 着色态下：选中某零件仍高亮（蓝色 emissive）、隔离仍半透明、线框/剖切/爆炸仍正常
- 再点「上色」关闭 → 还原模型原始颜色
- 切换其它模型或重置视图后行为正常

---

## Self-Review

**Spec coverage：**
- 取色算法（去重排序 + 黄金角 + 固定 S/L）→ Task 1 ✅
- viewerStore autoColor 状态 + toggle + reset 复位 → Task 2 ✅
- 原始色捕获 → Task 3 Step 2 ✅
- 着色/还原 effect（part 节点按名上色、关闭还原、多材质跳过）→ Task 3 Step 3 ✅
- 与选中/隔离正交（只改 color）→ Task 3（effect 仅 setHex color）✅
- Toolbar「上色」按钮 → Task 4 ✅
- 测试（纯函数单测 + 手测）→ Task 1、4、5 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency：** `buildColorMap(names: string[]) => Map<string, number>` 在 Task 1 定义，Task 3 按此签名调用；`autoColor`/`toggleAutoColor` 在 Task 2 定义，Task 3/4 使用，命名一致；`origColorRef`（`Map<string, number>`）在 Task 3 内自洽；three `Color.setHSL/getHex/setHex` 用法与库一致。
