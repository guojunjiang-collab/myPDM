# 构型项详情 — 子构型项统一树表（含关联零部件）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把构型项详情的「子构型项」表改造为统一层级树表，展开每个子构型项时同时显示其关联零部件（先零部件、后更深子构型项），支持点击查看实体详情、部件展开 BOM。

**Architecture:** 后端 `get_config_item` 的 children 每项补一个 `has_parts` 标记。前端 `ConfigurationDetailModal` 把「子构型项」区域换成统一树表：新增两个递归渲染函数（构型项行 / 零部件行，统一 8 列），`toggleChild` 改为同时缓存该子项的 parts 与 children。顶部「关联零部件」表不动。

**Tech Stack:** FastAPI + SQLAlchemy（后端）、React + TypeScript + Tailwind（前端）。本仓库无前端测试框架，验证方式沿用既有约定：`npx tsc --noEmit` + `npm run build` + 手动运行核对。

参考 spec：`docs/superpowers/specs/2026-06-10-config-item-detail-child-parts-design.md`

---

## File Structure

- `backend/app/routers/configuration.py` — `get_config_item` 内 `children_data` 增加 `has_parts` 字段。
- `frontend/src/types/index.ts` — `ConfigChildItem` 增加 `has_parts?: boolean`。
- `frontend/src/components/Configuration/ConfigurationDetailModal.tsx` — 改 `expandedChild` 状态结构与 `toggleChild`；新增 `renderUnifiedPartRow` / `renderUnifiedChildRow`；替换「子构型项」表头/表体；删除旧 `renderChildRow`。

---

## Task 1: 后端 children 增加 has_parts

**Files:**
- Modify: `backend/app/routers/configuration.py:122-137`

- [ ] **Step 1: 在 children 循环里计算 has_parts**

把现有 children 循环（约 122-137 行）改为：

```python
    # 子构型项
    children_data = []
    for c in crud.get_config_children(db, config_id):
        child = db.query(models.ConfigurationItem).filter(models.ConfigurationItem.id == c.child_id).first()
        has_children = db.query(models.ConfigurationItemChild).filter(
            models.ConfigurationItemChild.parent_id == c.child_id
        ).limit(1).count() > 0 if child else False
        has_parts = db.query(models.ConfigurationItemPart).filter(
            models.ConfigurationItemPart.configuration_item_id == c.child_id
        ).limit(1).count() > 0 if child else False
        children_data.append({
            "id": str(c.id), "child_id": str(c.child_id),
            "is_required": c.is_required, "sort_order": c.sort_order,
            "quantity": c.quantity,
            "has_children": has_children,
            "has_parts": has_parts,
            "child_detail": {
                "id": str(child.id), "code": child.code, "name": child.name,
                "spec": child.spec or "", "remark": child.remark or "",
            } if child else {},
        })
```

- [ ] **Step 2: 重启后端，验证字段出现**

后端容器挂载了 `./backend/app`，保存即热重载。验证：

```bash
docker compose restart backend
```

Expected: 容器 `bom_backend` Started。随后任意构型项详情接口返回的 `children[]` 每项含 `has_parts`（布尔）。若手头有 token 可 `curl` 验证；否则留待 Task 5 前端联调时核对。

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/configuration.py
git commit -m "feat(config-item): get_config_item 的子构型项补 has_parts 标记"
```

---

## Task 2: 前端类型补 has_parts

**Files:**
- Modify: `frontend/src/types/index.ts:567-576`

- [ ] **Step 1: ConfigChildItem 增加 has_parts**

把 `ConfigChildItem` 改为：

```ts
export interface ConfigChildItem {
  id: string;
  parent_id: string;
  child_id: string;
  is_required: boolean;
  quantity?: number;
  sort_order: number;
  has_children?: boolean;
  has_parts?: boolean;
  child_detail?: { id: string; code: string; name: string; spec?: string; status?: string };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无输出（通过）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(config-item): ConfigChildItem 类型补 has_parts"
```

---

## Task 3: 前端统一树表（ConfigurationDetailModal）

> 本任务集中在一个文件、改动相互依赖，作为一次性提交。完成后 `tsc` 必须通过。

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationDetailModal.tsx`

- [ ] **Step 1: 改 expandedChild 状态结构**

将状态声明（约 22 行）：

```tsx
  const [expandedChild, setExpandedChild] = useState<Record<string, any[]>>({});
```

改为：

```tsx
  const [expandedChild, setExpandedChild] = useState<Record<string, { parts: any[]; children: any[] }>>({});
```

- [ ] **Step 2: 重写 toggleChild，同时缓存 parts 与 children**

将现有 `toggleChild`（约 75-97 行）整体替换为：

```tsx
  const toggleChild = async (idx: string, childId: string) => {
    if (expandedChild[idx]) { setExpandedChild(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (noChildren.has(idx)) return; // already checked, nothing to expand
    setLoadingChild(idx);
    try {
      const r = await configurationApi.getItem(childId);
      const parts = r.data.parts || [];
      const children = sortByCode((r.data.children || []).map((c: any) => ({
        child_id: c.child_id,
        child_code: c.child_detail?.code || '',
        child_name: c.child_detail?.name || '',
        remark: c.child_detail?.remark || '',
        quantity: c.quantity ?? 1,
        is_required: c.is_required,
        has_children: c.has_children,
        has_parts: c.has_parts,
      })));
      if (parts.length > 0 || children.length > 0) {
        setExpandedChild(p => ({ ...p, [idx]: { parts, children } }));
      } else {
        setNoChildren(prev => new Set(prev).add(idx));
      }
    } catch { setNoChildren(prev => new Set(prev).add(idx)); }
    finally { setLoadingChild(null); }
  };
```

- [ ] **Step 3: 新增 renderUnifiedPartRow（替代位置：renderChildRow 之前）**

在 `renderChildRow` 函数定义之前，新增统一树的零部件行渲染函数。它同时兼容“构型项关联零部件”形状（`part_detail`）与“BOM 子零件”形状（`entity_*`），复用现有 `togglePart`（部件展开 BOM）与 `handleNestedView`（点击实体详情）：

```tsx
  // 统一树：零部件行（构型号/零部件件号 列序）
  const renderUnifiedPartRow = (p: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = p.part_type === 'assembly' || p.entity_type === 'assembly';
    const childRows = expandedParts[idx];
    const entityId = p.part_id || p.entity_id;
    const entityType = (p.part_type || p.entity_type || 'part');
    const code = p.part_detail?.code || p.entity_code || entityId;
    const name = p.part_detail?.name || p.entity_name || '-';
    const version = p.part_detail?.version || p.entity_version || '-';
    const status = p.part_detail?.status || p.status || '';
    const onClickRow = entityId ? () => handleNestedView(entityType === 'assembly' ? 'assembly' : 'part', entityId) : undefined;
    const rowCls = onClickRow ? 'cursor-pointer' : '';
    return (
      <>
        <tr key={idx} className={`hover:bg-gray-50 ${rowCls}`}>
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}</span>
            {isAssembly && (
              <button onClick={(e) => { e.stopPropagation(); togglePart(idx, entityId, entityType); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '▼' : '▶'}
              </button>
            )}
          </td>
          <td className={`px-3 py-2 text-sm font-mono text-gray-600 ${rowCls}`} onClick={onClickRow}>{code}</td>
          <td className={`px-3 py-2 text-sm ${rowCls}`} onClick={onClickRow}>{name}</td>
          <td className={`px-3 py-2 text-sm whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <span className={`px-1.5 py-0.5 rounded text-xs ${isAssembly ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
              {isAssembly ? '部件' : '零件'}
            </span>
          </td>
          <td className={`px-3 py-2 text-sm text-gray-500 ${rowCls}`} onClick={onClickRow}>{version}</td>
          <td className={`px-3 py-2 text-sm whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <span className={`px-1.5 py-0.5 rounded text-sm ${status === 'draft' ? 'bg-blue-100 text-blue-800' : status === 'frozen' ? 'bg-orange-100 text-orange-800' : status === 'released' ? 'bg-green-100 text-green-800' : status === 'obsolete' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
              {status === 'draft' ? '草稿' : status === 'released' ? '发布' : status === 'frozen' ? '冻结' : status === 'obsolete' ? '作废' : '-'}
            </span>
          </td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>{p.quantity ?? 1}</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>
            <span className={`px-2 py-0.5 text-sm rounded ${p.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {p.is_required != null ? (p.is_required ? '必选' : '可选') : '-'}
            </span>
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderUnifiedPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };
```

- [ ] **Step 4: 用 renderUnifiedChildRow 替换 renderChildRow**

将现有 `renderChildRow` 函数（约 184-217 行）整体替换为下面的 `renderUnifiedChildRow`。构型项行用统一 8 列：构型号填「构型号/零部件件号」列、类型列显示「构型项」徽章、版本/状态为 `-`；展开时先渲染 parts（`-p` 前缀）后递归 children（`-c` 前缀）；点击行打开嵌套构型项详情：

```tsx
  // 统一树：构型项行
  const renderUnifiedChildRow = (c: any, level: number, idx: string): React.ReactNode => {
    const expanded = expandedChild[idx];
    const hasChildren = c.has_children === true;
    const hasParts = c.has_parts === true;
    const isEmpty = noChildren.has(idx);
    const childId = c.child_id || c.child_detail?.id;
    const expandable = (hasChildren || hasParts) && !isEmpty;
    const onClickRow = childId ? () => setNestedConfigId(childId) : undefined;
    const rowCls = onClickRow ? 'cursor-pointer' : '';
    return (
      <>
        <tr key={idx} className={`bg-gray-50/70 hover:bg-purple-50 ${rowCls}`}>
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {expandable && (
              <button onClick={(e) => { e.stopPropagation(); toggleChild(idx, childId); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {expanded ? '▼' : '▶'}
              </button>
            )}
          </td>
          <td className={`px-3 py-2 text-sm font-medium text-gray-700 ${rowCls}`} onClick={onClickRow}>{c.child_detail?.code || c.child_code || c.child_id}</td>
          <td className={`px-3 py-2 text-sm text-gray-600 ${rowCls}`} onClick={onClickRow}>{c.child_detail?.name || c.child_name || '-'}</td>
          <td className={`px-3 py-2 text-xs whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">构型项</span>
          </td>
          <td className="px-3 py-2 text-xs text-gray-400">-</td>
          <td className="px-3 py-2 text-xs text-gray-400">-</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>{c.quantity ?? 1}</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>
            <span className={`px-2 py-0.5 text-sm rounded ${c.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {c.is_required ? '必选' : '可选'}
            </span>
          </td>
        </tr>
        {expanded && expanded.parts.map((p: any, j: number) => renderUnifiedPartRow(p, level + 1, `${idx}-p${j}`))}
        {expanded && expanded.children.map((cc: any, j: number) => renderUnifiedChildRow(cc, level + 1, `${idx}-c${j}`))}
        {loadingChild === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };
```

- [ ] **Step 5: 替换「子构型项」表头与表体**

把「子构型项」区块（约 259-277 行）整体替换为统一 8 列表，顶层调用以 `level=1`、`c{i}` 前缀的 idx：

```tsx
          {/* 子构型项 */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">子构型项 ({data.children?.length || 0})</h4>
            {data.children?.length > 0 ? (
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50 border-b"><tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">层级</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">构型号/零部件件号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">类型</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-14">版本</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                  <th className="px-3 py-2 text-center text-gray-500 font-medium w-16">用量</th>
                  <th className="px-3 py-2 text-center text-gray-500 font-medium w-24">必选/可选</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.children as ConfigChildItem[]).map((c, i) => renderUnifiedChildRow(c, 1, `c${i}`))}
                </tbody>
              </table>
            ) : <div className="text-sm text-gray-400 py-2">暂无子构型项</div>}
          </div>
```

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无输出（通过）。若报 `renderChildRow` 相关错误，确认 Step 4 已把旧函数整体替换（无残留引用）。

- [ ] **Step 7: Build**

```bash
cd frontend && npm run build
```

Expected: `✓ built in ...`，无报错。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Configuration/ConfigurationDetailModal.tsx
git commit -m "feat(config-item): 构型项详情子构型项改为统一树表并展示关联零部件"
```

---

## Task 4: 部署与手动验证

**Files:** 无（部署与核对）

- [ ] **Step 1: 部署**

```bash
docker compose restart nginx
```

Expected: `bom_nginx` Started（前端 dist 为 bind mount，新包已就位）。后端若 Task 1 未重启则一并 `docker compose restart backend`。

- [ ] **Step 2: 手动核对（强刷浏览器 https://localhost:8080）**

打开一个“含子构型项、且子构型项有关联零部件”的构型项详情，逐项确认：

- [ ] 子构型项区域为统一 8 列树表（层级 / 构型号·零部件件号 / 名称 / 类型 / 版本 / 状态 / 用量 / 必选可选），无「备注」列。
- [ ] 展开一个子构型项：先显示其关联零部件行（件号 mono、类型零件/部件、版本、状态、用量），后显示更深层子构型项行。
- [ ] 只有零部件、没有更深子构型项的子项也能展开（has_parts 生效）。
- [ ] 既无零部件又无子项的子构型项不显示展开按钮。
- [ ] 部件（部件徽章）零部件行可继续展开其 BOM 子零件。
- [ ] 点击零部件行弹出零件/部件实体详情；点击构型项行弹出嵌套构型项详情。
- [ ] 顶部「关联零部件」表外观与行为不变。

- [ ] **Step 3: 合并到主分支（按需）**

确认无误后，按既有流程合并 `dev` → `V1.3.1_CHANGE_CONFIG` 并推送（参照本仓库历史做法）。

---

## Self-Review

- **Spec coverage:**
  - 统一 8 列树表 → Task 3 Step 5（表头）+ Step 3/4（行）。
  - 去掉备注列 → Task 3 Step 5（表头无备注）。
  - 展开先 parts 后 children → Task 3 Step 4（渲染顺序）+ Step 2（缓存结构）。
  - has_parts 决定展开按钮 → Task 1（后端）+ Task 2（类型）+ Task 3 Step 4（`expandable`）。
  - 点击实体详情 / 部件展开 BOM / 点击构型项嵌套详情 → Task 3 Step 3/4 复用 `handleNestedView` / `togglePart` / `setNestedConfigId`。
  - 顶部关联零部件表不动 → 计划未触碰 `renderPartRow` 及其表。
- **Placeholder scan:** 无 TBD/TODO，所有代码步骤含完整代码与命令。
- **Type/命名一致性:** `expandedChild` 结构 `{parts,children}` 在 Step 1/2/4 一致；`renderUnifiedPartRow`/`renderUnifiedChildRow` 命名前后一致；idx 前缀 `c{i}` / `-p{j}` / `-c{j}` 互不冲突，且与顶部表 idx（`"0"`、`"0-1"`）不冲突，`expandedParts` 共享安全。
