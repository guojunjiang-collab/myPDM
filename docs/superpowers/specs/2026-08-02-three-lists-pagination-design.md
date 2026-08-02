# 三大列表分页化设计

> **日期**：2026-08-02
> **范围**：零部件管理 / 图文档管理 / 构型项管理 三个汇总列表
> **目标**：100 条/页服务端分页 + 列头点击服务端排序 + 搜索框服务端搜索（含自定义字段），替换现状「伪分页 page_size=10000 + 前端排序/筛选」模式

---

## 1. 背景与现状

### 1.1 当前三处列表的统一模式

| 文件 | 当前 `page_size` | 排序 | 筛选 |
|------|----|----|----|
| `frontend/src/pages/PartsPage.tsx:56` | 10000 硬编码 | `useTableSort`（`hooks/useTableSort.ts`，100% 前端 `localeCompare('zh-CN')`） | 前端按字段再 filter + "按 created_at 取最新版本"去重 |
| `frontend/src/pages/Documents.tsx:136` | 10000 硬编码 | 同上 | 同上（用版本号 `compareVersions` 文字比较取最新） |
| `frontend/src/components/Configuration/ConfigurationList.tsx:56` | 10000 硬编码 | 同上 | 同上 |

### 1.2 痛点

1. **数据量增长**：单表零部件/文档/构型 revision 数已超千，每页 10000 仍全量传输与渲染，进入页面慢、搜索每键触发全量拉。
2. **N+1 SQL**：`crud_parts.list_part_masters` 在循环里逐 master 再查 revisions + check_out_user + child_count（`crud_parts.py:148-179`），高基数场景远端响应慢。
3. **`show_all_versions=True` 时 `total` 与 items 数量不一致**：后端 `total = query.count()` 是 master 数，但 push 进 items 的是所有 revision（`crud_parts.py:143, 165-188`），分页元信息错误。
4. **最新版本判断逻辑不统一**：零部件/构型项用 `created_at.desc()`（`crud_parts.py:154`、`crud_configuration.py:240`）；图文档前端用 `compareVersions`（`Documents.tsx:120`）。边角场景（手工改 `created_at`）会产生不一致。
5. **次级功能强依赖 `useDataStore.parts/documents/configItems` 全量缓存**：importExport（14 处）、Board Picker、Dashboard 反查 byId map、Inventory MaterialTab 等都假设 store 全量。
6. **`syncService` 的 parts fetcher 未传 `updated_since`**（`syncService.ts:22-40` 定义了 since 形参但未使用），每次 poll 半全量拉 200 条 merge 进 store。

### 1.3 本设计不动的部分

- **次级功能**（importExport / Board Picker / Dashboard / MaterialTab）保持原状。
- **`syncAll` 全量缓存** 仍由 `data.ts` 维护并 persist 到 localStorage。
- **详情弹窗、BOM 树、反查** 等单项 API 调用不变。

---

## 2. 设计决策快表

| 决策点 | 选择 |
|----|----|
| 重构范围 | **三大列表同步重构**（零部件 + 图文档 + 构型项） |
| 全量缓存策略 | **保留 syncAll 全量缓存**（次级功能不动） |
| 版本维度计数 | **后端按 revision 正确计数**（`total` = revision 数） |
| `show_all_versions=False` 取最新版本 | **后端按版本号 A→B→…→ZZ 24 进制比较**（不用 created_at） |
| `version` 列服务端排序 | **后端 `version_to_int(text)→int` 函数 + expression index** |
| 搜索字段范围 | **包含自定义字段**（join `custom_field_values`） |
| 搜索触发时机 | **防抖 400ms，重置 page=1** |
| 分页交互 | **工具栏页码控件**（`第 X / Y 页 · 上一页 · 下一页 · 跳转`），无 IntersectionObserver 自动加载 |
| 版本数徽标 | **后端 list 响应附带 `version_count` 字段** |
| store 与列表关系 | 列表页改用本地 state，不订阅 store |

---

## 3. 后端改动

### 3.1 三个 list 函数的统一升级

`crud_parts.list_part_masters` / `crud_documents.list_documents` / `crud_configuration.list_config_items` 各自按以下规约改造。以 `list_part_masters` 为例（另两个对位）：

#### 3.1.1 新增入参

| 参数 | 类型 | 默认 | 说明 |
|----|----|----|----|
| `sort_field` | `Literal['code','name','created_at','version','status','check_out_user_name','type']` | `'code'` | 排序字段白名单（`type` 仅零部件支持，其他实体传入即 400） |
| `sort_order` | `Literal['asc','desc']` | `'asc'` | |
| `search_field` | `Literal['all','code','name','spec','remark']` | `'all'` | 实体差异：零部件 `spec` 为主表字段、`remark` 不支持；图文档 `remark` 为 master 表字段、`spec` 不支持；构型项两者都不支持，仅 `all/code/name` 有效 |
| `include_custom_fields` | `bool` | `False` | 是否让 search 同时匹配自定义字段值 |
| `show_accessible_only` | `bool` | `False` | 仅图文档支持：根据当前用户与文档关联 user_group 过滤可见行 |
| `top_level` | `bool` | `False` | 仅零部件 / 构型项支持 |

路由层 `routers/parts.py:list_parts`、`routers/documents.py:list_documents`、`routers/configuration.py:list_config_items` 同步透传这些 `Query`。

> 旧的 `search` 参数保留语义不变（仅 code/name）；新加参数为可选叠加，避免破坏既有调用方（Board Picker / syncAll / AssemblyPartPicker 等）。

#### 3.1.2 计数与切片

总条数与切片**都在 revision 视图上完成**：

- `show_all_versions=True`：每个 revision 一行，`total` = 符合条件的 revision 总数。
- `show_all_versions=False`：每个 master 一行（最新 revision），后端按版本号语义取最新（见 3.1.3），`total` = 符合条件的 master 总数。
- 切片 SQL 用 `ROW_NUMBER() OVER (ORDER BY <sort>)` + `BETWEEN` 窗口分页（避免 offset 性能塌陷），page_size 上限 100、下限 1。

#### 3.1.3 最新版本判定

新增纯 SQL 函数 `version_to_int(text) RETURNS INTEGER`（migration 中固化），将 24 进制版本号（A→B→…→ZZ，跳过 I、O）解析为整数，与 `frontend/src/constants/index.ts` 的 `compareVersions` 保持一致算法。后端 `ORDER BY version_to_int(revision.version) DESC` 取最新版本，不再用 `created_at.desc()`。

#### 3.1.4 排序实现

`ORDER BY` 动态构造，字段白名单内的列直接拼到 SQL（强类型校验，拒入外的字段直接 400）：

- `code` / `name` → 主表字段
- `created_at` / `version` / `status` → revision 子查询字段（`version` 用 `version_to_int()` 转整数比较）
- `check_out_user_name` → LEFT JOIN User
- `type`（仅零部件）→ 主表 `component_type`

> `type` 列在 SQLAlchemy 模型上为枚举字符串；图文档与构型项无此列，路由直接拒绝该字段。

#### 3.1.5 自定义字段搜索

`include_custom_fields=True` 时追加上述条件的 OR 子句：

```sql
EXISTS (
  SELECT 1 FROM custom_field_values cfv
    JOIN custom_field_definitions cfd ON cfd.id = cfv.field_id
  WHERE cfv.entity_type = 'component' AND cfv.entity_id = rev.id
    AND cfv.iteration_id IS NULL
    AND COALESCE(cfv.value_text, cfv.value_number::text,
                 cfv.value_json::text) ILIKE :search_like
)
```

注意 `value_number::text` 需 `to_char` 精度对齐（用 `to_char(cfv.value_number, 'FM999999999990.0000')`），避免 `12` 与 `1.2` 客户端搜索 "1" 命中歧义。

#### 3.1.6 消除 N+1

把 `crud_parts.list_part_masters` 里 master 循环中的三次子查询改为一次主 SQL：

- `LEFT JOIN User` 取 `check_out_user_name`
- `LEFT JOIN (SELECT master_id, COUNT(*) FROM part_revisions GROUP BY master_id) v_cnt` 取 `version_count`
- `LEFT JOIN (SELECT child_revision_id, COUNT(*) FROM bom_items GROUP BY child_revision_id) c_cnt` 取 `child_count`

返回 dict 每个 item 增加 `version_count: int`。

#### 3.1.7 路由响应

响应结构维持 `{items, total, page, page_size}`，每条 item 多 `version_count` 字段（schema 同步声明）。

### 3.2 数据库改动（migration）

新增文件：`initdb/migrations/014_list_sort_indexes.sql`

内容：

```sql
-- 版本号 24 进制 → 整数函数（与 frontend compareVersions 等价）
-- 字母集 ABCDEFGHJKLMNPQRSTUVWXYZ（共 24 个，不含 I/O）
-- 算法对齐 frontend/src/constants/index.ts::versionToNumber
--   result = result * 24 + (charIndex + 1)；最终 result - 1
CREATE OR REPLACE FUNCTION version_to_int(v TEXT) RETURNS INTEGER AS $$
DECLARE
  -- 与 js VERSION_CHARS 顺序一致：跳过 I、O
  alphabet CHAR[] := ARRAY['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
  result INTEGER := 0;
  ch CHAR;
  pos INTEGER;  -- array_position 1-based
BEGIN
  IF v IS NULL OR v = '' OR v = 'A' THEN RETURN 0; END IF;
  FOR i IN 1..length(v) LOOP
    ch := upper(substr(v, i, 1));
    pos := array_position(alphabet, ch);
    IF pos IS NULL THEN
      -- 未知字符按 0 处理，兼容历史脏数据（前端会抛异常，后端容错）
      pos := 1;  -- 视为 A（charIndex=0）→ 加 1 后仍为 1，符合"
    END IF;
    result := result * 24 + pos;  -- pos = charIndex + 1
  END LOOP;
  RETURN result - 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- 排序/搜索性能索引（按需）
CREATE INDEX IF NOT EXISTS idx_part_rev_version_order
  ON part_revisions (master_id, (version_to_int(version)) DESC);

CREATE INDEX IF NOT EXISTS idx_part_master_code_lower
  ON part_masters (lower(code) varchar_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_part_master_name_lower
  ON part_masters (lower(name) varchar_pattern_ops);

CREATE INDEX IF NOT EXISTS idx_document_rev_version_order
  ON document_revisions (master_id, (version_to_int(version)) DESC);

CREATE INDEX IF NOT EXISTS idx_config_rev_version_order
  ON configuration_item_revisions (master_id, (version_to_int(version)) DESC);

-- 自定义字段搜索的复合索引
CREATE INDEX IF NOT EXISTS idx_cfv_entity
  ON custom_field_values (entity_type, entity_id, iteration_id);
```

启动自动迁移：在 `backend/app/main.py` 启动钩子里追加 `014_list_sort_indexes.sql` 的执行（沿用现有 `012-add-iteration-deleted_at` 模式）。

### 3.3 单元测试

`backend/tests/test_list_pagination_sort.py`：

- `list_part_masters` 全部 `sort_field` 字段 × asc/desc × show_all_versions on/off 共 8 组，校验结果序与 `total`、`len(items) <= page_size`、`page` 元信息一致。
- `version_to_int` 单测对齐 frontend `versionToNumber`：A=0, B=1, ..., Z=22, AA=24, AB=25, ..., ZZ=575；非法字符（I、O、数字、小写、空格）按 charIndex=0 处理（pos=1 对应 A）。
- `include_custom_fields=True` 时 search 命中自定义字段值的 revision；`False` 时只命中 code/name。
- 自加 expression index 前后 EXPLAIN 检查（人工）。

---

## 4. 前端改动

### 4.1 列表页结构改造（三个文件同模式）

#### 4.1.1 state

```ts
// PartsPage.tsx（Documents / ConfigurationList 对位）
type SortOrder = 'asc' | 'desc';
type SortField = 'code' | 'name' | 'created_at' | 'version' | 'status' | 'check_out_user_name';

const [items, setItems] = useState<PartListItem[]>([]);
const [total, setTotal] = useState(0);
const [page, setPage] = useState(1);
const [pageSize] = useState(100);
const [sortField, setSortField] = useState<SortField>('code');
const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
const [loading, setLoading] = useState(false);
const [search, setSearch] = useState('');
const [searchField, setSearchField] = useState<'all' | ...>('all');
const [statusFilter, setStatusFilter] = useState('');
const [showAllVersions, setShowAllVersions] = useState(false);
const [topLevelOnly, setTopLevelOnly] = useState(false);
```

不再 `useDataStore` 订阅 `parts/documents/configItems`。
不再使用 `useTableSort`；列头 `onClick` 切换 `sortField/sortOrder`。

#### 4.1.2 数据加载

```ts
useEffect(() => {
  const params = {
    page, page_size: pageSize,
    sort_field: sortField, sort_order: sortOrder,
    search: search || undefined,
    search_field: searchField,
    include_custom_fields: true,
    status: statusFilter || undefined,
    show_all_versions: showAllVersions,
    top_level: topLevelOnly,
  };
  setLoading(true);
  partsApi.list(params).then(res => {
    setItems(res.items);
    setTotal(res.total);
    setPage(res.page);
  }).finally(() => setLoading(false));
}, [page, pageSize, sortField, sortOrder, debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly]);
```

防抖：`const debouncedSearch = useDebounced(search, 400)`。`debouncedSearch / searchField / statusFilter / showAllVersions / topLevelOnly` 五类**筛选**变化时显式 `setPage(1)` 再重拉；`page / pageSize / sortField / sortOrder` 变化维持当前 page（仅排序变化时也强制回首页便于查看结果）。实现用一个 `useEffect` 监听上述所有依赖，并在筛选类变化回调里同步调 `setPage(1)`（React 18 自动批处理保证一次重拉）。

#### 4.1.3 列头排序交互

点击列头：
- 同列再次点击 → 翻转 `asc/desc`
- 切换列 → `sortField=col`，`sortOrder='asc'`
- 列头显示当前排序图标（沿用现有 `<SortIcon field order />`，前端纯渲染）
- `onClick` 触发 `setSortField(col)` + `setPage(1)`

#### 4.1.4 分页控件（工具栏右侧）

```tsx
<div className="flex items-center gap-2 text-xs text-gray-600">
  共 <span className="font-medium">{total}</span> 条
  第 <input value={page} onChange={...} type="number" min={1} max={pageCount}
           className="w-12 px-1 py-0.5 border rounded text-center" /> / {pageCount} 页
  <button onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          className="px-2 py-0.5 border rounded disabled:opacity-40">上一页</button>
  <button onClick={() => setPage(p => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount || loading}
          className="px-2 py-0.5 border rounded disabled:opacity-40">下一页</button>
</div>
```

`pageCount = Math.max(1, Math.ceil(total / pageSize))`。

#### 4.1.5 版本数徽标

`<span>{item.version_count}个版本</span>` —— 直接读后端字段，删除前端 `versionCountMap` 计算。

#### 4.1.6 删除/创建/编辑后刷新

- 删除成功：保持当前 `page`，重拉（依赖 useEffect 自动触发）；若当前页变空且 `page > 1`，回退一页：`setPage(p => Math.max(1, p - 1))`。
- 创建成功：`setPage(1)` 回首页（默认按 code asc 排，新件通常在前）。
- 详情编辑保存：本地 `setItems` patch 已改字段（不重拉，避免分页跳动）。

#### 4.1.7 移除前端的双重过滤

- 删除 `PartsPage.tsx:67-83` 的本地 `filter`（spec/自定义字段搜索全部下推）
- 删除 `PartsPage.tsx:85-94` 的 `latestVersion` 去重
- `Documents.tsx:75-130` 的 `filteredData` + `displayData` 同步精简
- `ConfigurationList.tsx:122-143` 同步

### 4.2 useDebounced Hook

新增 `frontend/src/hooks/useDebounced.ts`：

```ts
export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
```

### 4.3 类型补全

`frontend/src/types/index.ts` 的 `PartListItem` / `DocumentRevision` / `ConfigItemRow` 三者声明增加 `version_count?: number`。

### 4.4 同步服务的潜在 bug 修复（顺手）

`syncService.ts:22-40` parts fetcher 形参 `since` 未使用 —— 把它真正传入 `partsApi.list({ updated_since: since, ... })`，由后端 list 函数做 `updated_at >= since` 过滤。`syncAll` 启动时仍走全量（since=0），之后 poll 增量拉。

> **注意**：次级功能不变（importExport / Board Picker / Dashboard 仍读全量 store），这次仅修复 syncService 的 parts 增量路径，避免每次 poll 拉全量 200 条 merge 进 store 的浪费。

---

## 5. 实施顺序

1. **后端 014 migration**（version_to_int 函数 + expression indexes）
2. **后端 list 函数改造** + 路由透传新参数（先后端能独立跑通测试，前端旧调用方仍兼容）
3. **后端单元测试**（覆盖排序/筛选/自定义字段搜索/version_count/分页边界）
4. **前端 useDebounced Hook** + 三个列表页（PartsPage / Documents / ConfigurationList）state 改造 + 工具栏分页控件
5. **前端 e2e 验证**（手工点列头、搜索、翻页、跳页、删到空回退、编辑后只 patch 当前页）
6. **syncService.ts parts fetcher 修复**（增量 poll）
7. **回归**：次级功能（importExport / 看板 picker / Dashboard 反查 / MaterialTab）冒烟测试确认未受影响

---

## 6. 风险与对策

| 风险 | 对策 |
|----|----|
| 自定义字段搜索 SQL 性能退化 | migration 加 `idx_cfv_entity` 复合索引；EXPLAIN 验证；高数据量客户灰度后观察 |
| `version_to_int` 函数与前端 `compareVersions` 行为差异 | 测试集覆盖边角 case；migration 前对全表 SELECT 验证无负数/异常值 |
| expression index 在大表上 REINDEX 卡顿 | 仅对新建索引使用 `CONCURRENTLY`；索引 IF NOT EXISTS 容错重启 |
| 某些列表页传参 `show_all_versions=False` + `top_level=True` 时 revision 维度分页让 total 计算复杂 | 在测试中显式覆盖此组合，对照前端 expectation |
| UI 改造后用户找不到"全部版本"开关 | 工具栏保留 checkbox；分页控件与筛选 checkbox 同行展示 |
| persist localStorage 体积仍大（store 全量缓存） | 本设计不动 store；后续可单独发起一个 spec 处理"次级功能去 store 化"，本 spec 不入 |
| syncService 修复增量 poll 后某些 master 长期不更新 | 周期性 fallback：每 N 次 poll 强制走一次全量 sync（如每 60s / 6 次）；用 `localStorage.syncCycleCount` 计数 |
| `sort_field` 注入攻击 | 后端强类型校验 + 白名单枚举，外来值直接 400 |
| 大数据量删除后分页页码错位 | 删除后重拉时若当前页返回空且 `page > 1`，自动回退 `page - 1` |
| 图文档列表原有「可查看 only」过滤 | 因涉及权限，保留前端 checkbox → 调 `show_accessible_only=true` 下推后端 |

---

## 7. 验收标准

### 7.1 后端

- 三个 list 端点支持 `page / page_size / sort_field / sort_order / search / search_field / include_custom_fields / status / show_all_versions / top_level`，全部有 `Query` 文档可见。
- 单测覆盖率：`list_*` 函数 80%+ 行覆盖；`version_to_int` 100% 覆盖边角值。
- 响应 `{items, total, page, page_size}` 每个 item 含 `version_count: int`。
- `show_all_versions=True/False` 切换不破坏 `total === len(items)` 一致性（单页内）。
- EXPLAIN：自定义字段搜索走 `idx_cfv_entity`，version 排序走 `idx_*_version_order`。

### 7.2 前端

- 三个列表页工具栏都有「共 N 条 / 第 X / Y 页 / 上一页 / 下一页 / 跳至页」控件。
- 列头点击任意可排序列均触发后端重拉，列头显示当前排序图标。
- 搜索框输入防抖 400ms 后重拉，期间无 401/网络抖动。
- 「显示所有版本」「仅顶层」开关切换后正确分页。
- 版本数徽标正确显示（来自 `item.version_count`）。
- 删除某行后：若当前页仍有数据，仅重拉当前页；若当前页空，自动回退一页。
- 创建新行后自动回首页（page=1）。
- 详情弹窗编辑保存后只本地 patch 当前行，不重拉、不跳页。

### 7.3 兼容性

- 次级功能（importExport 导入导出、看板 ItemPicker、Dashboard 反查、Inventory MaterialTab）冒烟通过。
- `syncAll` 全量缓存 + persist 不变。
- 老调用方（Board Picker / AssemblyPartPicker）传 `search` + `page_size=200` 仍工作。

---

## 8. 不在本 spec 范围

- 取消 `useDataStore` 全量缓存（次级功能不改）
- 移除 persist 序列化
- 重构 importExport 改为按需 fetch
- 改 BOM 树 / 详情弹窗等单项 API
- 改同步服务的 documents / configItems fetcher（只动 parts fetcher 增量 bug）
- 与 CAD 工作区（`CADBOMMatchTable`）的无缝衔接（这里仍单独调 `bridge.readAssemblyTree`，不依赖列表页分页）

---

## 9. 相关代码引用（重构边界）

**前端**
- `frontend/src/pages/PartsPage.tsx:53-122`（loadData、useTableSort、versionCountMap）
- `frontend/src/pages/Documents.tsx:48-130`（store 订阅、loadDocuments、filteredData）
- `frontend/src/components/Configuration/ConfigurationList.tsx:53-145`（load、filteredData）
- `frontend/src/hooks/useTableSort.ts`（全部沿用前端排序的其它列表保持不变）
- `frontend/src/stores/data.ts:96-118`（syncAll 不动）
- `frontend/src/services/syncService.ts:22-40`（parts fetcher 增量 bug 顺手修）

**后端**
- `backend/app/routers/parts.py:29-44`（list_parts 增参）
- `backend/app/routers/documents.py:102-121`（list_documents 增参）
- `backend/app/routers/configuration.py:58-149`（list_config_items 增参）
- `backend/app/crud_parts.py:112-197`（list_part_masters 重写）
- `backend/app/crud_documents.py:536-575`（list_documents 重写）
- `backend/app/crud_configuration.py:231-244`（list_config_items 重写）
- `backend/app/main.py`（启动自动跑 014 migration）
- `backend/initdb/migrations/014_list_sort_indexes.sql`（新增）
- `backend/tests/test_list_pagination_sort.py`（新增）

**类型/Schema**
- `frontend/src/types/index.ts`（PartListItem / DocumentRevision / ConfigItemRow 加 `version_count`）
- `backend/app/schemas_parts.py`、`schemas.py`、`schemas_configuration.py`（response 增加字段）