# 零件/部件列表「反查」按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「零件管理」「部件管理」列表操作列各加一个「反查」按钮（仅 admin/engineer/production 可见），弹窗展示该零部件的递归 where-used 父项树，点击父项可在弹窗内查看其详情。

**Architecture:** 复用已有后端 `GET /bom/trace`（递归 CTE）、`bomApi.trace`、树 helper（`buildTraceTree`/`flattenTraceTree`）与详情组件。新增一个自包含共享组件 `BOMTraceModal`，两页各加一个状态 + 按钮即可接入。无后端改动、无权限改动。

**Tech Stack:** React + TypeScript + Tailwind + Zustand；现有共享 `Modal`、`PartDetailContent`、`AssemblyDetailContent`。

**测试约定（来自已批准 spec）：** 本项目前端无组件单测惯例，以 `tsc` 类型检查 + `npm run build` 通过 + Docker 手测为准。

---

## File Structure

- **Create:** `frontend/src/components/BOMTraceModal.tsx` — 自包含反查弹窗（取数 + 递归树表格 + 内置详情弹窗）
- **Modify:** `frontend/src/pages/Parts.tsx` — 加 `can` 导入、`traceEntity` 状态、操作列「反查」按钮、渲染 `BOMTraceModal`
- **Modify:** `frontend/src/pages/Components.tsx` — 同上（实体类型为 assembly）

---

## Task 1: 新增共享组件 BOMTraceModal

**Files:**
- Create: `frontend/src/components/BOMTraceModal.tsx`

- [ ] **Step 1: 创建组件文件**

写入 `frontend/src/components/BOMTraceModal.tsx`，完整内容：

```tsx
import { useState, useEffect } from 'react';
import { bomApi, partsApi, assembliesApi, customFieldsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import type { BOMTraceItem, CustomFieldDefinition, CustomFieldValue, AssemblyPartItem } from '../types';
import { buildTraceTree, flattenTraceTree } from '../pages/BOM/helpers';
import type { TraceTreeNode } from '../pages/BOM/helpers';
import { Modal } from './Modal';
import PartDetailContent from './PartDetailContent';
import AssemblyDetailContent from './AssemblyDetailContent';

interface BOMTraceModalProps {
  entity: { type: 'part' | 'assembly'; id: string; code: string; name: string } | null;
  onClose: () => void;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

export default function BOMTraceModal({ entity, onClose }: BOMTraceModalProps) {
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 内置详情弹窗（点击父项时叠加在反查之上）
  const [detailEntity, setDetailEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, any>>({});

  // 载入反查结果
  useEffect(() => {
    if (!entity) {
      setTraceResult([]);
      setError('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setTraceResult([]);
      try {
        const res = await bomApi.trace(entity.type, entity.id);
        if (!cancelled) setTraceResult(res.data || []);
      } catch {
        if (!cancelled) { setError('反查失败，请稍后重试'); setTraceResult([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entity]);

  useEffect(() => {
    setTraceTree(buildTraceTree(traceResult));
  }, [traceResult]);

  const toggleTraceNode = (targetId: string) => {
    setTraceTree(prev => {
      const toggle = (nodes: TraceTreeNode[]): TraceTreeNode[] =>
        nodes.map(n => {
          if (n.item.bom_item_id === targetId) return { ...n, expanded: !n.expanded };
          if (n.children.length > 0) return { ...n, children: toggle(n.children) };
          return n;
        });
      return toggle(prev);
    });
  };

  const handleViewEntity = async (type: 'part' | 'assembly', id: string) => {
    setDetailEntity({ type, id });
    setDetailData(null);
    setDetailLoading(true);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    try {
      const api = type === 'part' ? partsApi : assembliesApi;
      const res = await api.get(id);
      setDetailData(res.data);
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setDetailCustomDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setDetailCustomValues(vals);
        } catch { /* custom fields optional */ }
      }
    } catch { setDetailData(null); }
    finally { setDetailLoading(false); }
  };

  return (
    <>
      <Modal
        open={!!entity}
        title={entity ? `反查 — ${entity.code} ${entity.name}` : ''}
        onClose={onClose}
        width="3xl"
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">查询中...</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        ) : traceResult.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">未找到任何引用该实体的上级部件</div>
        ) : (
          <div className="border border-gray-200 rounded-lg">
            <div className="p-3 border-b border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-600">找到 {traceResult.length} 个关联节点（{traceTree.length} 个顶层）</span>
            </div>
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">层级</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">类型</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">版本</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flattenTraceTree(traceTree).map((node, idx) => {
                    const item = node.item;
                    const parent = item.parent_assembly || item.parent_part;
                    const parentType = item.parent_assembly ? '部件' : '零件';
                    const parentTypeCls = item.parent_assembly ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700';
                    const st = STATUS_MAP[parent?.status || ''] || { label: parent?.status || '-', cls: 'bg-gray-100 text-gray-800' };
                    const hasChildren = node.children.length > 0;
                    return (
                      <tr
                        key={`${item.bom_item_id}-${idx}`}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          if (!parent) return;
                          const type: 'part' | 'assembly' = item.parent_assembly ? 'assembly' : 'part';
                          handleViewEntity(type, parent.id);
                        }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-left">
                          <span className="inline-flex items-center gap-0.5">
                            <span className="text-xs text-gray-400">{'-'.repeat(item.level)}{item.level}</span>
                            {hasChildren ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleTraceNode(item.bom_item_id); }}
                                className="w-4 h-4 inline-flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
                              >
                                {node.expanded ? '▼' : '▶'}
                              </button>
                            ) : (
                              <span className="w-4 inline-block" />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-xs rounded ${parentTypeCls}`}>{parentType}</span></td>
                        <td className="px-3 py-2 font-medium">{parent?.code || '-'}</td>
                        <td className="px-3 py-2">{parent?.name || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{parent?.spec || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{parent?.version || '-'}</td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-xs rounded ${st.cls}`}>{st.label}</span></td>
                        <td className="px-3 py-2">{item.quantity}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* 内置详情弹窗（叠加在反查之上） */}
      <Modal
        open={!!detailEntity}
        title={detailEntity ? (detailEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setDetailEntity(null)}
        width="full"
        zIndex={60}
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !detailData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : detailEntity?.type === 'part' ? (
          <PartDetailContent part={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} />
        ) : (
          <AssemblyDetailContent
            assembly={detailData}
            customFieldDefs={detailCustomDefs}
            customFieldValues={detailCustomValues}
            onSubItemClick={(item: AssemblyPartItem) => handleViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
          />
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（特别是 `BOMTraceModal.tsx` 中的导入与类型）。
若报 `AssemblyPartItem` 上 `childType`/`child_id` 不存在，参照 `frontend/src/pages/BOM/BOM.tsx:120` 现有同款用法核对字段名（该处已通过编译，字段一定存在）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BOMTraceModal.tsx
git commit -m "feat(bom): 新增共享反查弹窗组件 BOMTraceModal"
```

---

## Task 2: 接入零件管理页 Parts.tsx

**Files:**
- Modify: `frontend/src/pages/Parts.tsx`（导入 auth `can`、导入组件、加状态、操作列按钮、渲染弹窗）

- [ ] **Step 1: 扩展 auth 导入**

把第 5 行：
```tsx
import { canEdit, isAdmin, canDownload } from '../stores/auth';
```
改为：
```tsx
import { canEdit, isAdmin, canDownload, can } from '../stores/auth';
```

- [ ] **Step 2: 导入 BOMTraceModal**

在 `import PartDetailContent from '../components/PartDetailContent';`（第 7 行）之后新增一行：
```tsx
import BOMTraceModal from '../components/BOMTraceModal';
```

- [ ] **Step 3: 新增 traceEntity 状态**

在详情弹窗状态附近（`const [viewingPart, setViewingPart] = ...` 一带，约第 69 行）新增：
```tsx
  // 反查弹窗
  const [traceEntity, setTraceEntity] = useState<{ type: 'part' | 'assembly'; id: string; code: string; name: string } | null>(null);
```

- [ ] **Step 4: 操作列加「反查」按钮**

定位操作列（约 `frontend/src/pages/Parts.tsx:551-556`）：
```tsx
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit() && <button onClick={() => handleEdit(part)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>}
                    {isAdmin() && (
                      <button onClick={() => setDeleteId(part.id)} className="text-red-600 hover:text-red-800">删除</button>
                    )}
                  </td>
```
在「编辑」按钮之前插入反查按钮，改为：
```tsx
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {can('bom:trace') && (
                      <button
                        onClick={() => setTraceEntity({ type: 'part', id: part.id, code: part.code, name: part.name })}
                        className="text-indigo-600 hover:text-indigo-800 mr-3"
                      >
                        反查
                      </button>
                    )}
                    {canEdit() && <button onClick={() => handleEdit(part)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>}
                    {isAdmin() && (
                      <button onClick={() => setDeleteId(part.id)} className="text-red-600 hover:text-red-800">删除</button>
                    )}
                  </td>
```

- [ ] **Step 5: 渲染弹窗**

在零件详情弹窗（约第 717 行 `{/* 零件详情弹窗 */}`）之前，新增：
```tsx
      {/* 反查弹窗 */}
      <BOMTraceModal entity={traceEntity} onClose={() => setTraceEntity(null)} />

```

- [ ] **Step 6: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Parts.tsx
git commit -m "feat(parts): 列表操作列新增反查按钮"
```

---

## Task 3: 接入部件管理页 Components.tsx

**Files:**
- Modify: `frontend/src/pages/Components.tsx`

- [ ] **Step 1: 扩展 auth 导入**

把第 5 行：
```tsx
import { canEdit, isAdmin, canDownload } from '../stores/auth';
```
改为：
```tsx
import { canEdit, isAdmin, canDownload, can } from '../stores/auth';
```

- [ ] **Step 2: 导入 BOMTraceModal**

在 `import PartDetailContent from '../components/PartDetailContent';`（第 8 行）之后新增：
```tsx
import BOMTraceModal from '../components/BOMTraceModal';
```

- [ ] **Step 3: 新增 traceEntity 状态**

在编辑弹窗状态区（约第 83 行 `/* ---- 编辑弹窗 ---- */` 附近）新增：
```tsx
  // 反查弹窗
  const [traceEntity, setTraceEntity] = useState<{ type: 'part' | 'assembly'; id: string; code: string; name: string } | null>(null);
```

- [ ] **Step 4: 操作列加「反查」按钮**

定位操作列（约 `frontend/src/pages/Components.tsx:1181-1206`）。在「导出」按钮块（`{canDownload() && (...导出...)}`）之前插入反查按钮：
```tsx
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {can('bom:trace') && (
                      <button
                        onClick={() => setTraceEntity({ type: 'assembly', id: assembly.id, code: assembly.code, name: assembly.name })}
                        className="text-indigo-600 hover:text-indigo-800 mr-3"
                      >
                        反查
                      </button>
                    )}
                    {canDownload() && (
                      <button
                        onClick={() => handleExportSingleBOM(assembly.id)}
                        className="text-green-600 hover:text-green-800 mr-3"
                      >
                        导出
                      </button>
                    )}
```
（保持其后的「编辑」「删除」块不变。）

- [ ] **Step 5: 操作列表头加宽（避免 4 个按钮换行）**

定位表头（约 `frontend/src/pages/Components.tsx:1142`）：
```tsx
              <th className="w-40 px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
```
改为：
```tsx
              <th className="w-52 px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
```

- [ ] **Step 6: 渲染弹窗**

在「新增/编辑弹窗」（约第 1214 行 `{/* ========== 新增/编辑弹窗 ========== */}`）之前，新增：
```tsx
      {/* 反查弹窗 */}
      <BOMTraceModal entity={traceEntity} onClose={() => setTraceEntity(null)} />

```

- [ ] **Step 7: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Components.tsx
git commit -m "feat(assemblies): 列表操作列新增反查按钮"
```

---

## Task 4: 构建、部署与手测

**Files:** 无（验证与部署）

- [ ] **Step 1: 生产构建**

Run: `cd frontend && npm run build`
Expected: `✓ built in ...`，无 TS/构建错误。

- [ ] **Step 2: 部署（重载 nginx 静态资源）**

Run: `docker compose restart nginx`
Expected: `Container bom_nginx Started`。

- [ ] **Step 3: 手测（浏览器 Ctrl+F5 强制刷新）**

逐项确认：
1. admin / engineer / production 登录：零件页、部件页操作列均出现「反查」按钮；guest 登录：**不显示**反查按钮。
2. 点击某个被多层装配引用的零件「反查」→ 弹窗展示递归树，层级缩进正确，可展开/收起。
3. 点击某无父项零件「反查」→ 显示「未找到任何引用该实体的上级部件」。
4. 反查弹窗中点击某父项行 → 叠加详情弹窗，零件渲染 `PartDetailContent`、部件渲染 `AssemblyDetailContent`；部件详情中子项可继续点击下钻。
5. 关闭详情回到反查树；关闭反查回到列表。点「反查」不会同时弹出列表行的详情弹窗。
6. 部件页操作列 4 个按钮（反查/导出/编辑/删除，admin）不换行、对齐正常。

- [ ] **Step 4: 更新项目记忆**

按需在 `C:\Users\guojun\.claude\projects\D--OpenCode-myPDM\memory\` 记录：反查按钮功能在 dev 分支完成、构建通过、待手测/未合并（参照 [[inventory-feature]] 体例），并更新 `MEMORY.md` 索引。

---

## Self-Review

**Spec coverage：**
- 操作列增加反查按钮（零件+部件）→ Task 2 / Task 3 ✅
- 弹窗展示所有父项（递归全树）→ Task 1（`bomApi.trace` + `buildTraceTree`）✅
- 仅 admin/engineer/production 可见 → `can('bom:trace')` 门控，权限矩阵已就绪 ✅
- 点击父项跳转详情 → Task 1 内置详情弹窗（part/assembly）✅
- 抽取共享组件 → Task 1 `BOMTraceModal` ✅
- 风格统一（共享 Modal/表格/配色）→ 复用 `Modal` 与 BOMTracePanel 同款表格 ✅

**Placeholder scan：** 无 TBD/TODO，全部步骤含完整代码或精确命令。✅

**Type consistency：** `traceEntity` 形状（`{type,id,code,name}`）在两页与 `BOMTraceModalProps.entity` 一致；`handleViewEntity`/`toggleTraceNode`/`STATUS_MAP` 与 Task 1 内定义一致；`bomApi.trace`、`buildTraceTree`、`flattenTraceTree`、`BOMTraceItem`、`TraceTreeNode`、`Modal`(`zIndex`)、`AssemblyPartItem.childType/child_id` 均经实际代码核对。✅
