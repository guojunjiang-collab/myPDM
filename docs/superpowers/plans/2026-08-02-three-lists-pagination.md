# 三大列表分页化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把零部件/图文档/构型项 三个汇总列表的"伪分页（page_size=10000 + 前端排序/筛选）"改造为"100/页服务端分页 + 列头点击服务端排序 + 搜索框 400ms 防抖服务端搜索（含自定义字段）"，同时不破坏次级功能对 store 全量缓存的依赖。

**Architecture:** 后端给三个 list 端点新增 `sort_field/sort_order/search_field/include_custom_fields` 等参数，并把 list 函数重写为单条 SQL + 子查询/LEFT JOIN 消除 N+1，按 revision 维度正确分页；引入 PL/pgSQL 函数 `version_to_int(text)` 做版本号字典序排序。前端三个列表页改用本地 state 直接调 API，工具栏新增页码控件，列头点击切换排序、搜索防抖、`useEffect` 联动重拉。`store.parts/documents/configItems` 全量缓存保留供 importExport/Board/Dashboard 等次级功能不变。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + PostgreSQL 16（PL/pgSQL）、React 18 + TypeScript + Vite + Zustand、pytest + Vitest

## Global Constraints

- 后端迁移用 Python `db.execute(text(...))` 内联（沿用 `main.py:505-559` 的 `_sqla_inspect` 模式），不读取外部 `.sql` 文件。
- `version_to_int` SQL 函数与 `frontend/src/constants/index.ts::versionToNumber` 严格 1:1 对齐算法（24 进制跳过 I/O，A=0）。
- 三个列表页改动同型、同结构，避免风格分叉。
- 次级功能不被触碰：`importExport.ts / Board.tsx / Dashboard/hooks.ts / MaterialTab.tsx / syncService.ts`(fetcher 行为除外) 的 store 全量假设保持。
- 旧 `search` 参数语义保留，不破坏 Board Picker / AssemblyPartPicker / syncAll 全量调用。
- 测试代码风格沿用现有 `backend/tests/conftest.py` 与 `frontend/src/stores/viewerStore.compare.test.ts`。

---

## 文件结构

**新增**
- `backend/app/migrations_list_pagination.py` — 启动时迁移：创建 `version_to_int` 函数与 5 个索引。
- `backend/tests/test_list_pagination_sort.py` — 后端单测：sort_field/search/version_count/分页边界。
- `frontend/src/hooks/useDebounced.ts` — 防抖 hook，60 行。
- `docs/superpowers/plans/2026-08-02-three-lists-pagination.md`（本文件）

**后端修改**
- `backend/app/crud_parts.py:112-197` — `list_part_masters` 重写为窗口分页 + LEFT JOIN + sort/search_field/include_custom_fields 支持。
- `backend/app/routers/parts.py:29-44` — `list_parts` 增加新 Query 参数透传。
- `backend/app/schemas_parts.py:39-50` — `PartRevisionBrief` 增加 `version_count: Optional[int]`。
- `backend/app/crud_documents.py:536-575` — `list_documents` 重写（同型改造）。
- `backend/app/routers/documents.py:102-121` — `list_documents` 路由增参（含 `show_accessible_only`）。
- `backend/app/schemas.py:236-260` — `DocumentRevisionOut` 增加 `version_count`。
- `backend/app/crud_configuration.py:231-244` — `list_config_items` 重写（同型改造）。
- `backend/app/routers/configuration.py:58-149` — `list_config_items` 增参。
- `backend/app/schemas_configuration.py:35-44` — `ConfigItemRevisionOut` 增加 `version_count`。
- `backend/app/main.py:555`（startup 钩子末尾） — 调用 `migrations_list_pagination.apply(db)`。

**前端修改**
- `frontend/src/types/index.ts:100-120, 181-207` — `PartListItem` / `DocumentRevision` 增加 `version_count?: number`；`ConfigItemRow` 在 `ConfigurationList.tsx` 内本地声明 → 加 `version_count?: number`。
- `frontend/src/pages/PartsPage.tsx` — 重构 state 替换 `versionCountMap`/`useTableSort`，新增分页控件。
- `frontend/src/pages/Documents.tsx` — 同型。
- `frontend/src/components/Configuration/ConfigurationList.tsx` — 同型。
- `frontend/src/services/syncService.ts:22-40` — parts fetcher 修复增量 `updated_since` bug。

---

## 任务总览

| 序号 | 任务 | 文件数 | 估时 |
|----|----|----|----|
| 1 | 后端迁移：`version_to_int` 与索引 | 1 新增 + 1 改 | 30 min |
| 2 | 后端零部件 list 重写 + 路由增参 + Schema | 3 改 | 90 min |
| 3 | 后端零部件 list 单测 | 1 新增 | 60 min |
| 4 | 后端图文档 list 重写 + 路由增参 + Schema | 3 改 | 60 min |
| 5 | 后端构型项 list 重写 + 路由增参 + Schema | 3 改 | 50 min |
| 6 | 后端 list 通用回归 | — | 30 min |
| 7 | 前端 `useDebounced` Hook + 类型补全 | 2 新/改 | 15 min |
| 8 | 前端 PartsPage 分页化重构 | 1 改 | 90 min |
| 9 | 前端 Documents 分页化重构 | 1 改 | 60 min |
| 10 | 前端 ConfigurationList 分页化重构 | 1 改 | 50 min |
| 11 | syncService.ts 增量 poll 修复 | 1 改 | 30 min |
| 12 | 全链路回归 + 提交合并 | — | 60 min |

---

## Task 1: 后端迁移 — `version_to_int` 与排序/搜索索引

**Files:**
- Create: `backend/app/migrations_list_pagination.py`
- Modify: `backend/app/main.py:553-555`（startup 钩子末尾插入）

**Interfaces:**
- Produces: `migrations_list_pagination.apply(db: Session) -> None` — 幂等创建 `version_to_int` 函数和 5 个索引（IF NOT EXISTS）；同事务内失败回滚并打印，不影响主流程。

- [ ] **Step 1: 写迁移模块**

Create `backend/app/migrations_list_pagination.py`:

```python
"""启动时迁移：三大列表分页化所需的 SQL 函数与索引。

幂等：所有对象用 IF NOT EXISTS / OR REPLACE；失败仅打印不中断主流程。
"""
from sqlalchemy import text
from sqlalchemy.orm import Session


def apply(db: Session) -> None:
    """在 startup 钩子调用，创建 version_to_int 函数与排序/搜索索引。"""

    # 版本号 24 进制（不含 I/O）→ 整数，对齐 frontend versionToNumber
    # A=0, B=1, ..., Z=22, AA=24,_AB=25, ..., ZZ=575
    db.execute(text("""
        CREATE OR REPLACE FUNCTION version_to_int(v TEXT) RETURNS INTEGER AS $$
        DECLARE
            alphabet CHAR[] := ARRAY['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
            result INTEGER := 0;
            ch CHAR;
            pos INTEGER;
        BEGIN
            IF v IS NULL OR v = '' OR v = 'A' THEN RETURN 0; END IF;
            FOR i IN 1..length(v) LOOP
                ch := upper(substr(v, i, 1));
                pos := array_position(alphabet, ch);
                IF pos IS NULL THEN
                    pos := 1;  -- 未知字符兜底视为 A
                END IF;
                result := result * 24 + pos;
            END LOOP;
            RETURN result - 1;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE STRICT;
    """))

    # version 排序索引（按 master 分组内按版本号语义排序）
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_rev_version_order ON part_revisions (master_id, (version_to_int(version)) DESC)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_rev_version_order ON document_revisions (master_id, (version_to_int(version)) DESC)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_rev_version_order ON configuration_item_revisions (master_id, (version_to_int(version)) DESC)"))

    # code/name ILIKE 搜索加速（varchar_pattern_ops 让 LIKE '...' 走索引）
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_master_code_lower ON part_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_master_name_lower ON part_masters (lower(name) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_master_code_lower ON document_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_master_name_lower ON document_masters (lower(name) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_master_code_lower ON configuration_item_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_master_name_lower ON configuration_item_masters (lower(name) varchar_pattern_ops)"))

    # 自定义字段搜索复合索引
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values (entity_type, entity_id, iteration_id)"))

    db.commit()
```

- [ ] **Step 2: 在 main.py startup 末尾调用**

Modify `backend/app/main.py:553-555`, before `print("✓ Database migration completed successfully")`:

```python
        # 列表分页化所需的 SQL 函数与索引（幂等）
        try:
            from app import migrations_list_pagination
            migrations_list_pagination.apply(db)
        except Exception as _le:
            db.rollback()
            print(f"⚠ List pagination migration skipped: {_le}")

        print("✓ Database migration completed successfully")
```

- [ ] **Step 3: 启动后端验证**

Run: `docker restart bom_backend && docker logs bom_backend --tail 50`
Expected: 日志含 `✓ Database migration completed successfully`，不含 `⚠ List pagination migration skipped`。

```bash
docker exec bom_postgres psql -U bomadmin -d bom_system -c "SELECT version_to_int('A'), version_to_int('B'), version_to_int('Z'), version_to_int('AA'), version_to_int('ZZ')"
```
Expected: `0 | 1 | 22 | 24 | 575`

- [ ] **Step 4: 提交**

```bash
git add backend/app/migrations_list_pagination.py backend/app/main.py
git commit -m "feat(backend): 新增 version_to_int 与列表排序/搜索索引迁移

- version_to_int 函数对齐前端 versionToNumber（A=0, ZZ=575），跳过 I/O
- 为 parts/documents/config masters + revisions 加 ILIKE/版本序索引
- custom_field_values 加复合索引 (entity_type, entity_id, iteration_id)
- 幂等创建，失败不影响主启动流程"
```

---

## Task 2: 后端零部件 list 重写 + 路由增参 + Schema

**Files:**
- Modify: `backend/app/crud_parts.py:112-197`
- Modify: `backend/app/routers/parts.py:29-44`
- Modify: `backend/app/schemas_parts.py:39-50`

**Interfaces:**
- Consumes: Task 1 的 `version_to_int` SQL 函数。
- Produces:
  - `crud_parts.list_part_masters(db, *, search=None, status=None, check_out_user_id=None, show_all_versions=False, top_level=False, page=1, page_size=50, sort_field='code', sort_order='asc', search_field='all', include_custom_fields=False, type=None) -> Tuple[List[Dict], int]` —— 返回 dict 列表（每项含 `version_count: int`）和总条数（按 revision 维度）。
  - 路由透传新 Query。

- [ ] **Step 1: 重写 `list_part_masters`**

Modify `backend/app/crud_parts.py:112-197`, 完整替换函数体：

```python
from sqlalchemy import text, literal_column
from typing import Literal, Optional, Tuple, List, Dict
import uuid

SORT_FIELDS_PARTS = {'code', 'name', 'created_at', 'version', 'status', 'check_out_user_name', 'type'}
SORT_ORDERS = {'asc', 'desc'}
SEARCH_FIELDS_PARTS = {'all', 'code', 'name', 'spec'}


def list_part_masters(
    db, search=None, status=None, check_out_user_id=None,
    show_all_versions=False, top_level=False, page=1, page_size=50,
    sort_field='code', sort_order='asc', search_field='all',
    include_custom_fields=False, type=None,
) -> Tuple[List[Dict], int]:
    """按 revision 维度分页，支持服务端排序与搜索。

    show_all_versions=True：每个 revision 一行，total = revision 数
    show_all_versions=False：每个 master 一行（最新版本），total = master 数
    """
    # 强类型校验，拒绝非白名单值
    if sort_field not in SORT_FIELDS_PARTS:
        raise ValueError(f"Invalid sort_field: {sort_field}")
    if sort_order not in SORT_ORDERS:
        raise ValueError(f"Invalid sort_order: {sort_order}")
    if search_field not in SEARCH_FIELDS_PARTS:
        raise ValueError(f"Invalid search_field: {search_field}")
    page = max(1, page)
    page_size = max(1, page_size)  # 上限由路由层 Query 校验，CRUD 不再卡

    # 排序字段 SQL 映射
    order_col_map = {
        'code': 'm.code',
        'name': 'm.name',
        'created_at': 'r.created_at',
        'version': 'version_to_int(r.version)',
        'status': 'r.status',
        'check_out_user_name': 'co_user.real_name',
        'type': 'm.component_type',
    }
    order_col = order_col_map[sort_field]
    order_dir = 'DESC' if sort_order == 'desc' else 'ASC'
    nulls = 'NULLS LAST' if sort_order == 'asc' else 'NULLS FIRST'

    # 搜索字段 SQL 片段
    search_clauses = []
    search_params = {}
    if search:
        like = f"%{search}%"
        search_params['like'] = like
        if search_field in ('all', 'code'):
            search_clauses.append("m.code ILIKE :like")
        if search_field in ('all', 'name'):
            search_clauses.append("m.name ILIKE :like")
        if search_field == 'spec':
            search_clauses.append("m.spec ILIKE :like")
        if include_custom_fields:
            search_clauses.append("""
                EXISTS (
                    SELECT 1 FROM custom_field_values cfv
                    WHERE cfv.entity_type = 'component' AND cfv.entity_id = r.id
                      AND cfv.iteration_id IS NULL
                      AND COALESCE(cfv.value_text,
                                   to_char(cfv.value_number, 'FM999999999990.0000'),
                                   cfv.value_json::text) ILIKE :like
                )
            """)
    where_search = ""
    if search_clauses:
        where_search = "AND (" + " OR ".join(search_clauses) + ")"

    where_status = ""
    status_params = {}
    if status:
        where_status = "AND r.status = :status"
        status_params = {'status': status}

    where_checkout = ""
    co_params = {}
    if check_out_user_id:
        where_checkout = "AND r.check_out_user_id = :check_out_user_id"
        co_params = {'check_out_user_id': check_out_user_id}

    where_type = ""
    type_params = {}
    if type:
        where_type = "AND m.component_type = :type"
        type_params = {'type': type}

    where_toplevel = ""
    if top_level:
        where_toplevel = "AND m.id NOT IN (SELECT bi.child_master_id FROM bom_items bi)"

    # m.deleted_at = NULL 永远生效
    base_where = "WHERE m.deleted_at IS NULL"

    if show_all_versions:
        # 每个 revision 一行
        sql_count = f"""
            SELECT COUNT(*) FROM part_masters m
            JOIN part_revisions r ON r.master_id = m.id AND r.deleted_at IS NULL
            {base_where} {where_search} {where_status} {where_checkout} {where_type} {where_toplevel}
        """
        sql_items = f"""
            WITH ranked AS (
                SELECT
                    r.id AS revision_id, r.master_id, m.code, m.name, m.component_type, m.spec,
                    r.version, r.status, r.created_at,
                    r.check_out_user_id, co_user.real_name AS check_out_user_name,
                    v_cnt.cnt AS version_count,
                    c_cnt.cnt AS child_count
                FROM part_masters m
                JOIN part_revisions r ON r.master_id = m.id AND r.deleted_at IS NULL
                LEFT JOIN users co_user ON co_user.id = r.check_out_user_id
                LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM part_revisions WHERE deleted_at IS NULL GROUP BY master_id) v_cnt ON v_cnt.master_id = m.id
                LEFT JOIN (SELECT child_revision_id, COUNT(*) AS cnt FROM bom_items GROUP BY child_revision_id) c_cnt ON c_cnt.child_revision_id = r.id
                {base_where} {where_search} {where_status} {where_checkout} {where_type} {where_toplevel}
            )
            SELECT * FROM ranked
            ORDER BY {order_col} {order_dir} {nulls}
            LIMIT :limit OFFSET :offset
        """
    else:
        # 每个 master 一行（最新版本）：用 ROW_NUMBER 取版本号最大的
        sql_count = f"""
            SELECT COUNT(*) FROM (
                SELECT m.id
                FROM part_masters m
                WHERE EXISTS (
                    SELECT 1 FROM part_revisions r
                    WHERE r.master_id = m.id AND r.deleted_at IS NULL
                ) {where_search.replace('m.', 'm.').replace('r.', 'latest_r.')}
                -- 上述 search 子句可能引用 r，这里需用 latest_r
                {where_status.replace('r.', 'latest_r.')}
                {where_checkout.replace('r.', 'latest_r.')}
                {where_type} {where_toplevel}
                AND m.deleted_at IS NULL
                AND EXISTS (
                    SELECT 1 FROM part_revisions latest_r
                    WHERE latest_r.master_id = m.id AND latest_r.deleted_at IS NULL
                    AND latest_r.id = (
                        SELECT r2.id FROM part_revisions r2
                        WHERE r2.master_id = m.id AND r2.deleted_at IS NULL
                        ORDER BY version_to_int(r2.version) DESC LIMIT 1
                    )
                )
            ) AS _
        """
        # 上面的 count SQL 复杂且 search 不能简单 replace。重写更直接：
        sql_count = f"""
            SELECT COUNT(*) FROM part_masters m
            JOIN LATERAL (
                SELECT r.* FROM part_revisions r
                WHERE r.master_id = m.id AND r.deleted_at IS NULL
                ORDER BY version_to_int(r.version) DESC LIMIT 1
            ) latest_r ON TRUE
            {base_where} {where_search} {where_status} {where_checkout} {where_type} {where_toplevel}
        """
        sql_items = f"""
            WITH ranked AS (
                SELECT
                    latest_r.id AS revision_id, latest_r.master_id, m.code, m.name,
                    m.component_type, m.spec, latest_r.version, latest_r.status, latest_r.created_at,
                    latest_r.check_out_user_id, co_user.real_name AS check_out_user_name,
                    v_cnt.cnt AS version_count,
                    c_cnt.cnt AS child_count
                FROM part_masters m
                JOIN LATERAL (
                    SELECT r.* FROM part_revisions r
                    WHERE r.master_id = m.id AND r.deleted_at IS NULL
                    ORDER BY version_to_int(r.version) DESC LIMIT 1
                ) latest_r ON TRUE
                LEFT JOIN users co_user ON co_user.id = latest_r.check_out_user_id
                LEFT JOIN (SELECT master_id, COUNT(*) AS cnt FROM part_revisions WHERE deleted_at IS NULL GROUP BY master_id) v_cnt ON v_cnt.master_id = m.id
                LEFT JOIN (SELECT child_revision_id, COUNT(*) AS cnt FROM bom_items GROUP BY child_revision_id) c_cnt ON c_cnt.child_revision_id = latest_r.id
                {base_where} {where_search} {where_status} {where_checkout} {where_type} {where_toplevel}
            )
            SELECT * FROM ranked
            ORDER BY {order_col} {order_dir} {nulls}
            LIMIT :limit OFFSET :offset
        """

    params = {'limit': page_size, 'offset': (page - 1) * page_size, **search_params, **status_params, **co_params, **type_params}
    total = db.execute(text(sql_count), params).scalar()
    rows = db.execute(text(sql_items), params).mappings().all()

    items: List[Dict] = []
    for row in rows:
        items.append({
            'revision_id': str(row['revision_id']),
            'master_id': str(row['master_id']),
            'code': row['code'],
            'name': row['name'],
            'component_type': row['component_type'],
            'spec': row['spec'] or '',
            'version': row['version'],
            'status': row['status'],
            'created_at': row['created_at'],
            'check_out_user_id': str(row['check_out_user_id']) if row['check_out_user_id'] else None,
            'check_out_user_name': row['check_out_user_name'],
            'child_count': row['child_count'] or 0,
            'version_count': row['version_count'] or 0,
        })

    return items, total
```

> 注意：`where_search` 在 `show_all_versions=False` 分支里，`r` 关键字在 SQL 中是最新 revision 别名 `latest_r`，所以 search 子句不能用 `r.`，应改为 `latest_r.`。在上面的实现里，`where_search` 字符串里只引用了 `m.code/m.name/m.spec` 和 `r.id`（在 `custom_field_values cfv` 子查询里）。需要替换 `r.id` → `latest_r.id`。
>
> **实现时需把 `where_search` 字符串里的 `cfv.entity_id = r.id` 改为动态：show_all_versions=True 用 `r.id`，False 用 `latest_r.id`。**

修正版（替换上面 `where_search` 的构建逻辑）：

```python
# 在 search_clauses 构建里，把 EXISTS 子句单独拼到 search_clauses 列表时
# 不直接写 r.id，而是用一个占位变量 :rev_id_col 由 SQL 里替换。
# 简单做法：把 search 用一个 sep var，构建时 if show_all_versions: rev_alias='r' else 'latest_r'
# 然后 EXISTS 里写 f"cfv.entity_id = {rev_alias}.id"
rev_alias = 'r' if show_all_versions else 'latest_r'
# rewriting EXISTS clause:
# search_clauses.append(f"EXISTS (... cfv.entity_id = {rev_alias}.id ...)")
```

执行按上面的注释把 `_r` 替换为 `rev_alias` 即可。

- [ ] **Step 2: 路由 `list_parts` 增加新 Query 参数**

Modify `backend/app/routers/parts.py:29-44`:

```python
from typing import Optional, Literal
from fastapi import Query

@router.get("/", response_model=dict)
def list_parts(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    check_out_user_id: Optional[UUID] = Query(None),
    show_all_versions: bool = Query(False),
    top_level: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10000),
    sort_field: Literal['code', 'name', 'created_at', 'version', 'status', 'check_out_user_name', 'type'] = Query('code'),
    sort_order: Literal['asc', 'desc'] = Query('asc'),
    search_field: Literal['all', 'code', 'name', 'spec'] = Query('all'),
    include_custom_fields: bool = Query(False),
    type: Optional[Literal['part', 'assembly']] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:read")),
):
    try:
        items, total = crud_parts.list_part_masters(
            db, search=search, status=status, check_out_user_id=check_out_user_id,
            show_all_versions=show_all_versions, top_level=top_level, page=page, page_size=page_size,
            sort_field=sort_field, sort_order=sort_order, search_field=search_field,
            include_custom_fields=include_custom_fields, type=type,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "total": total, "page": page, "page_size": page_size}
```

- [ ] **Step 3: Schema 增加 `version_count`**

Modify `backend/app/schemas_parts.py:39-50`, in `PartRevisionBrief`:

```python
class PartRevisionBrief(BaseModel):
    # ... 原字段保留 ...
    version_count: Optional[int] = None
```

- [ ] **Step 4: 启动验证**

```bash
docker restart bom_backend && docker logs bom_backend --tail 20
```

Expected: 启动成功无错误。

```bash
curl -k "https://localhost:8080/api/parts/?page=1&page_size=10&sort_field=code&sort_order=asc"
```

Expected: 返回 `{items:[10条], total:N, page:1, page_size:10}`，每项含 `version_count`。

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud_parts.py backend/app/routers/parts.py backend/app/schemas_parts.py
git commit -m "feat(parts): list 端点服务端分页/排序/自定义字段搜索重写

- 把 N+1 SQL 改为 LEFT JOIN 单条 SQL
- 新增 sort_field/sort_order/search_field/include_custom_fields/type Query
- show_all_versions 计数与切片按 revision 维度统一
- response item 加 version_count 字段
- 旧 API 兼容：不传新参数时行为与原版一致"
```

---

## Task 3: 后端零部件 list 单测

**Files:**
- Create: `backend/tests/test_list_pagination_sort.py`

**Interfaces:**
- Consumes: Task 2 的 `crud_parts.list_part_masters`。
- Produces: 测试套件覆盖排序/筛选/搜索/分页边界。

- [ ] **Step 1: 写测试**

Create `backend/tests/test_list_pagination_sort.py`:

```python
"""三大列表分页/排序/搜索的单测。"""
import pytest
from sqlalchemy.orm import Session
from app import crud_parts, models


def test_version_to_int_basic(db_session):
    """version_to_int 与前端 versionToNumber 1:1 对齐。"""
    cases = [
        ('A', 0), ('B', 1), ('C', 2), ('H', 7), ('J', 8),  # 跳过 I
        ('N', 12), ('P', 13),  # 跳过 O
        ('Z', 23),
        ('AA', 24), ('AB', 25), ('AZ', 47),
        ('BA', 48), ('ZZ', 599),
    ]
    for v, expected in cases:
        actual = db_session.execute(f"SELECT version_to_int('{v}')").scalar()
        assert actual == expected, f"version_to_int('{v}')={actual}, expected={expected}"


def test_version_to_int_invalid_char(db_session):
    """非法字符兜底视为 A（charIndex=0）。"""
    # I 字母不在 alphabet 中，按 pos=1 处理
    actual = db_session.execute("SELECT version_to_int('I')").scalar()
    # I 视为 A：result = 0 * 24 + 1 = 1; return 1 - 1 = 0
    assert actual == 0
    # O 视为 A：同上
    assert db_session.execute("SELECT version_to_int('O')").scalar() == 0


def test_list_part_masters_pagination(db_session, sample_parts):
    """分页切片与 total 一致。"""
    items, total = crud_parts.list_part_masters(
        db_session, page=1, page_size=10, show_all_versions=True
    )
    assert len(items) == 10
    assert total >= 10
    assert all('version_count' in it for it in items)


def test_list_part_masters_sort_code_asc(db_session, sample_parts):
    items, _ = crud_parts.list_part_masters(
        db_session, page=1, page_size=50, sort_field='code', sort_order='asc',
        show_all_versions=False
    )
    codes = [it['code'] for it in items]
    assert codes == sorted(codes)


def test_list_part_masters_sort_version_desc(db_session, sample_parts):
    """version 字段用 version_to_int 比较，A < B < ... < Z < AA。"""
    items, _ = crud_parts.list_part_masters(
        db_session, page=1, page_size=50, sort_field='version', sort_order='desc',
        show_all_versions=True
    )
    versions = [it['version'] for it in items]
    # 转 int 检查递减
    nums = [db_session.execute(f"SELECT version_to_int('{v}')").scalar() for v in versions]
    assert nums == sorted(nums, reverse=True)


def test_list_part_masters_search_code(db_session, sample_parts):
    items, total = crud_parts.list_part_masters(
        db_session, search='PART-1', search_field='code', page=1, page_size=50,
    )
    assert all('PART-1' in it['code'].upper() for it in items)


def test_list_part_masters_search_include_custom_fields(db_session, sample_parts_with_cf):
    """include_custom_fields=True 时 search 命中自定义字段值。"""
    # 假设 fixture 给某 part 加了自定义字段"颜色=红色"
    items_without, _ = crud_parts.list_part_masters(
        db_session, search='红色', search_field='all', include_custom_fields=False, show_all_versions=True,
    )
    items_with, _ = crud_parts.list_part_masters(
        db_session, search='红色', search_field='all', include_custom_fields=True, show_all_versions=True,
    )
    assert len(items_with) > len(items_without)


def test_list_part_masters_show_all_versions_total_consistency(db_session, sample_parts):
    """show_all_versions=True 时 total == len(all revisions)（不分页）。"""
    items, total = crud_parts.list_part_masters(
        db_session, page=1, page_size=1000, show_all_versions=True
    )
    assert total == len(items)


def test_list_part_masters_invalid_sort_field(db_session):
    """非白名单 sort_field 直接 400。"""
    with pytest.raises(ValueError):
        crud_parts.list_part_masters(db_session, sort_field='invalid_field')


@pytest.fixture
def sample_parts(db_session):
    """创建测试零部件：同 master 多版本 + 不同 code/name。"""
    # 创建 fixture: 5 个 master × 3 versions = 15 revisions
    # ... 用 models.PartMaster / PartRevision ...
    yield
```

- [ ] **Step 2: 运行测试**

Run: `docker exec bom_backend pytest backend/tests/test_list_pagination_sort.py -v`
Expected: 全部 PASS（除 fixture 未实现的可能 skip）。

- [ ] **Step 3: 提交**

```bash
git add backend/tests/test_list_pagination_sort.py
git commit -m "test(parts): list 分页/排序/搜索单测

- version_to_int 边角 case 对齐前端 versionToNumber
- sort_field 白名单校验、version 排序语义、search 字段范围
- show_all_versions total/items 一致性"
```

---

## Task 4: 后端图文档 list 重写 + 路由增参 + Schema

**Files:**
- Modify: `backend/app/crud_documents.py:536-575`
- Modify: `backend/app/routers/documents.py:102-121`
- Modify: `backend/app/schemas.py:236-260`

**Interfaces:**
- Consumes: Task 1 的 `version_to_int`。
- Produces: `crud_documents.list_documents(db, *, search, status, show_all_versions, page, page_size, sort_field, sort_order, search_field='all', include_custom_fields=False, show_accessible_only=False, current_user_id=None) -> Tuple[List[Dict], int]`。route 加同名 Query。

- [ ] **Step 1: 重写 `list_documents`**

Modify `backend/app/crud_documents.py:536-575`, 与 Task 2 同型改造。差异：

- 主表 `document_masters`，revision 表 `document_revisions`，无 `top_level`、无 `component_type`
- master 有 `code`/`name`，无 `spec`，自定义字段 `entity_type='document'`
- `show_accessible_only=True` 时加子查询：
  ```sql
  AND (
      m.id NOT IN (SELECT document_id FROM document_group_links)
      OR m.creator_id = :current_user_id
      OR EXISTS (
          SELECT 1 FROM document_group_links dgl
          JOIN user_group_members ugm ON ugm.group_id = dgl.group_id
          WHERE dgl.document_id = m.id AND ugm.user_id = :current_user_id
      )
  )
  ```
- SEARCH_FIELDS_DOCUMENTS = `{'all', 'code', 'name', 'remark'}`
- `search_field='remark'` 时匹配 `m.remark ILIKE :like`

response dict 字段与原 `list_documents` 输出保持一致，加 `version_count: int`。

- [ ] **Step 2: 路由 `list_documents` 增参**

Modify `backend/app/routers/documents.py:102-121`:

```python
@router.get("/", response_model=dict)
def list_documents(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    show_all_versions: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10000),
    sort_field: Literal['code', 'name', 'created_at', 'version', 'status', 'check_out_user_name'] = Query('code'),
    sort_order: Literal['asc', 'desc'] = Query('asc'),
    search_field: Literal['all', 'code', 'name', 'remark'] = Query('all'),
    include_custom_fields: bool = Query(False),
    show_accessible_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents:read")),
):
    try:
        items, total = crud_documents.list_documents(
            db, search=search, status=status, show_all_versions=show_all_versions,
            page=page, page_size=page_size,
            sort_field=sort_field, sort_order=sort_order,
            search_field=search_field, include_custom_fields=include_custom_fields,
            show_accessible_only=show_accessible_only, current_user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "total": total, "page": page, "page_size": page_size}
```

- [ ] **Step 3: Schema 加 `version_count`**

Modify `backend/app/schemas.py:236-260`, in `DocumentRevisionOut`:

```python
class DocumentRevisionOut(BaseModel):
    # ... 原字段保留 ...
    version_count: Optional[int] = None
```

- [ ] **Step 4: 启动验证**

```bash
docker restart bom_backend && curl -k "https://localhost:8080/api/documents/?page=1&page_size=10&sort_field=code" -H "Authorization: Bearer $TOKEN"
```
Expected: `{items:[10], total:N, page:1, page_size:10}`，items 有 `version_count`。

- [ ] **Step 5: 提交**

```bash
git add backend/app/crud_documents.py backend/app/routers/documents.py backend/app/schemas.py
git commit -m "feat(documents): list 端点服务端分页/排序/搜索重写

- 同零部件模式：LEFT JOIN + 窗口分页 + sort/search 下推
- 新增 show_accessible_only 走 user_group join
- response item 加 version_count"
```

---

## Task 5: 后端构型项 list 重写 + 路由增参 + Schema

**Files:**
- Modify: `backend/app/crud_configuration.py:231-244`
- Modify: `backend/app/routers/configuration.py:58-149`
- Modify: `backend/app/schemas_configuration.py:35-44`

**Interfaces:**
- Consumes: Task 1 的 `version_to_int`。
- Produces: `crud_configuration.list_config_items(...)` 同型扩展。

- [ ] **Step 1: 重写 `list_config_items`**

Modify `backend/app/crud_configuration.py:231-244`, 与 Task 2 同型。差异：

- 表名 `configuration_item_masters` / `configuration_item_revisions`
- master 字段 `code/name`，无 `spec`/`remark`
- 支持 `top_level`（构型项有 BOM 树）
- SEARCH_FIELDS_CONFIG = `{'all', 'code', 'name'}`
- 自定义字段 `entity_type='config_item'`（或实际值需查 model）
- response dict 加 `version_count`

- [ ] **Step 2: 路由 `list_config_items` 增参**

Modify `backend/app/routers/configuration.py:58-149`, 与 Task 4 同型（无 `show_accessible_only`、含 `top_level`）。

- [ ] **Step 3: Schema 加 `version_count`**

Modify `backend/app/schemas_configuration.py:35-44`:

```python
class ConfigItemRevisionOut(BaseModel):
    # ... 原字段 ...
    version_count: Optional[int] = None
```

- [ ] **Step 4: 启动验证 + 提交**

```bash
docker restart bom_backend && curl -k "https://localhost:8080/api/configuration/items/?page=1&page_size=10&sort_field=code" -H "Authorization: Bearer $TOKEN"
git add backend/app/crud_configuration.py backend/app/routers/configuration.py backend/app/schemas_configuration.py
git commit -m "feat(configuration): 构型项 list 端点服务端分页/排序/搜索重写"
```

---

## Task 6: 后端 list 通用回归

**Files:**
- 无新文件，验证既有调用方未被破坏。

- [ ] **Step 1: 兼容性验证**

依次调用旧调用路径，确认响应正确：

```bash
# 不传新参数（syncAll 调用模式）
curl -k "https://localhost:8080/api/parts/?page_size=10000&show_all_versions=true" -H "Authorization: Bearer $TOKEN"
curl -k "https://localhost:8080/api/documents/?page_size=10000&show_all_versions=true" -H "Authorization: Bearer $TOKEN"
curl -k "https://localhost:8080/api/configuration/items/?page_size=10000" -H "Authorization: Bearer $TOKEN"

# 旧远程搜索（AssemblyPartPicker / Board Picker 调用）
curl -k "https://localhost:8080/api/parts/?search=ABC&page_size=200&show_all_versions=true" -H "Authorization: Bearer $TOKEN"
```

Expected: 均返回数据，total 正确，items 含 version_count（新字段，旧调用方忽略即可）。

- [ ] **Step 2: 单测全量跑**

```bash
docker exec bom_backend pytest backend/tests/ -v --tb=short 2>&1 | tail -50
```
Expected: 无新增 FAIL（pre-existing 测试已有 fail 不在本 plan 范围）。

---

## Task 7: 前端 `useDebounced` Hook + 类型补全

**Files:**
- Create: `frontend/src/hooks/useDebounced.ts`
- Modify: `frontend/src/types/index.ts:100-120, 181-207`

**Interfaces:**
- Produces: `useDebounced<T>(value: T, delay = 400): T`

- [ ] **Step 1: 写 Hook**

Create `frontend/src/hooks/useDebounced.ts`:

```ts
import { useEffect, useState } from 'react';

/** 防抖：value 变化后 delay 毫秒同步，期间新输入会重置计时器。 */
export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
```

- [ ] **Step 2: 写 Hook 测试**

Create `frontend/src/hooks/useDebounced.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react';
import { useDebounced } from './useDebounced';

describe('useDebounced', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('400ms 后同步值', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 400), {
      initialProps: { v: 'abc' },
    });
    rerender({ v: 'abcd' });
    expect(result.current).toBe('abc'); // 还没到 400ms
    act(() => jest.advanceTimersByTime(400));
    expect(result.current).toBe('abcd');
  });

  it('新输入重置计时器', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 400), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'ab' });
    act(() => jest.advanceTimersByTime(300));
    rerender({ v: 'abc' });
    act(() => jest.advanceTimersByTime(300));
    expect(result.current).toBe('a'); // 不到 400
    act(() => jest.advanceTimersByTime(100));
    expect(result.current).toBe('abc');
  });
});
```

- [ ] **Step 3: 类型补全**

Modify `frontend/src/types/index.ts`：

在 `PartListItem` 定义中（约 line 113）加：
```ts
  version_count?: number;
```

在 `DocumentRevision` 定义中（约 line 204）加：
```ts
  version_count?: number;
```

`ConfigItemRow` 在 `ConfigurationList.tsx` 内本地声明（约 line 10-23），Task 10 改造时一并加。

- [ ] **Step 4: 跑测试 + 构建**

```bash
cd frontend && npm run test -- useDebounced
npm run build
```
Expected: 测试 PASS、build PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/hooks/useDebounced.ts frontend/src/hooks/useDebounced.test.ts frontend/src/types/index.ts
git commit -m "feat(frontend): useDebounced hook + PartListItem/DocumentRevision 加 version_count"
```

---

## Task 8: 前端 PartsPage 分页化重构

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`（整体重写 state + 表格 + 工具栏）

**Interfaces:**
- Consumes: Task 7 的 `useDebounced`、Task 2 的后端 list 参数。

- [ ] **Step 1: 替换 state 与数据加载**

把 `PartsPage.tsx:53-122`（`loadData`、`useTableSort`、`versionCountMap`）整体替换为：

```tsx
// 新增 imports
import { useDebounced } from '../hooks/useDebounced';

// state
type SortField = 'code' | 'name' | 'created_at' | 'version' | 'status' | 'check_out_user_name' | 'type';
type SortOrder = 'asc' | 'desc';

const [items, setItems] = useState<PartListItem[]>([]);
const [total, setTotal] = useState(0);
const [page, setPage] = useState(1);
const pageSize = 100;
const [sortField, setSortField] = useState<SortField>('code');
const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
const [loading, setLoading] = useState(false);
const [search, setSearch] = useState('');
const debouncedSearch = useDebounced(search, 400);
const [searchField, setSearchField] = useState<'all' | 'code' | 'name' | 'spec'>('all');
const [statusFilter, setStatusFilter] = useState('');
const [showAllVersions, setShowAllVersions] = useState(false);
const [topLevelOnly, setTopLevelOnly] = useState(false);

const pageCount = Math.max(1, Math.ceil(total / pageSize));

// 数据加载（任意前端依赖变化即重拉）
useEffect(() => {
  setLoading(true);
  partsApi.list({
    page, page_size: pageSize,
    sort_field: sortField, sort_order: sortOrder,
    search: debouncedSearch || undefined,
    search_field: searchField,
    include_custom_fields: true,
    status: statusFilter || undefined,
    show_all_versions: showAllVersions,
    top_level: topLevelOnly,
  }).then((res: any) => {
    setItems(res.items || []);
    setTotal(res.total || 0);
    setPage(res.page || 1);
  }).catch(() => {
    setItems([]); setTotal(0);
  }).finally(() => setLoading(false));
}, [page, pageSize, sortField, sortOrder, debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly]);

// 筛选/搜索/排序变化时回首页
useEffect(() => { setPage(1); }, [debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly, sortField, sortOrder]);
```

- [ ] **Step 2: 列头排序 + 图标渲染**

在表格 thead 里把 `onClick={() => handleSort('code' as keyof PartListItem)}` 改为：

```tsx
const onSort = (field: SortField) => {
  if (sortField === field) {
    setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
  } else {
    setSortField(field);
    setSortOrder('asc');
  }
};

const sortIcon = (field: SortField) => {
  if (sortField !== field) return <span className="text-gray-300 ml-1">⇅</span>;
  return <span className="text-gray-700 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
};
```

每个可排序列头：

```tsx
<th onClick={() => onSort('code')} className="w-56 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
  件号 {sortIcon('code')}
</th>
```

（依此改 7 个列头：code/name/created_at/version/status/check_out_user_name/type；签出状态、操作列不加 onClick）

- [ ] **Step 3: 工具栏分页控件**

在工具栏右侧（搜索框后面、`+ 新增` 按钮前面）插入：

```tsx
<div className="flex items-center gap-2 text-xs text-gray-600">
  共 <span className="font-medium">{total}</span> 条
  <span className="text-gray-400">|</span>
  第 {page} / {pageCount} 页
  <button onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          className="px-2 py-0.5 border rounded disabled:opacity-40 hover:bg-gray-50">上一页</button>
  <button onClick={() => setPage(p => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount || loading}
          className="px-2 py-0.5 border rounded disabled:opacity-40 hover:bg-gray-50">下一页</button>
</div>
```

- [ ] **Step 4: 版本数徽标用 item.version_count**

把 `{(versionCountMap[item.code] || 0) > 1 && (<span>{versionCountMap[item.code]}个版本</span>)}` 改为：

```tsx
{item.version_count && item.version_count > 1 && !showAllVersions && (
  <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
    {item.version_count}个版本
  </span>
)}
```

- [ ] **Step 5: 删除/创建/编辑后刷新策略**

`handleDelete` 成功后：
```tsx
// 不调 loadData()，靠 useEffect 自动重拉；若当前页删空且 page>1，回退
if (items.length === 1 && page > 1) {
  setPage(p => p - 1);
} else {
  // useEffect 检测不到 items 变化（items 是 setItems 内部改），需手动触发
  // 简单做法：保持原 loadData() 调用替换为强制刷新：
}
```

> 注意：`items` 是 setItems 的 state，删除后直接 `setItems(prev => prev.filter(...))` 不会触发 useEffect 重拉（useEffect 依赖 page 不依赖 items）。所以 handleDelete 后需显式触发重拉：用 `refreshToken` state 增 1，作为 useEffect 依赖。

引入 refreshToken：

```tsx
const [refreshToken, setRefreshToken] = useState(0);
// 加入 useEffect 依赖列表
useEffect(() => { ... }, [..., refreshToken]);

// 删除成功后
setItems(prev => prev.filter(it => it.revision_id !== deleteTarget.revision_id));
setRefreshToken(f => f + 1);
```

`handleCreate` 成功后：`setPage(1); setRefreshToken(f => f + 1);`

`PartDetailModal` 保存后：本地 patch `setItems(prev => prev.map(it => it.revision_id === saved.revision_id ? {...it, ...saved} : it))`，不调 refreshToken。

- [ ] **Step 6: 构建验证**

```bash
cd frontend && npm run build
```
Expected: tsc + vite build 无错（pre-existing test files 的 `@testing-library/react` 报错忽略）。

- [ ] **Step 7: 部署 + 手工 e2e 验证**

```bash
docker-compose up -d --force-recreate nginx
```

手工浏览器验证：
1. 列表加载 100 条，工具栏显示`共 N 条 第 1 / Y 页`
2. 点「上一页/下一页」正确翻页
3. 点列头切换排序，箭头变化、列表刷新
4. 搜索框输入字符，400ms 后列表刷新、回首页
5. 切换「显示所有版本」开关，列表刷新、total 变化
6. 删除最后一行的当前页空时自动回退一页
7. 创建新件自动回首页

- [ ] **Step 8: 提交**

```bash
git add frontend/src/pages/PartsPage.tsx
git commit -m "feat(PartsPage): 列表服务端分页化重构

- 100/页 + 工具栏页码控件 + 列头点击服务端排序
- 搜索 400ms 防抖 + 重置首页
- version_count 来自后端字段
- 删除/创建/编辑后正确处理分页边界"
```

---

## Task 9: 前端 Documents 分页化重构

**Files:**
- Modify: `frontend/src/pages/Documents.tsx`

**Interfaces:**
- Consumes: Task 4 的后端参数；Task 7 的 `useDebounced`。

- [ ] **Step 1: 同 PartsPage 模式重构**

与 Task 8 同型改造。差异：

- 移除 `useDataStore((s) => s.documents)` 订阅（line 48）与依赖它的 useEffect（line 62-67）
- 移除 `filteredData`（line 75-106）与 `displayData`（line 115-130）；items 直接用 state
- `searchField` 类型 `<'all' | 'code' | 'name' | 'remark'>`
- 加 `showAccessibleOnly` 状态 → 传 `show_accessible_only` 给后端
- 移除 `versionCountMap` 计算，徽标用 `item.version_count`
- `partsApi.list` → `documentsApi.list(...)` （注意返回需要 `.then(r => r.data)`，因为 documentsApi.list 不解包）

- [ ] **Step 2: 构建验证 + 部署 + 提交**

```bash
cd frontend && npm run build
docker-compose up -d --force-recreate nginx
# 手工 e2e 验证同 Task 8
git add frontend/src/pages/Documents.tsx
git commit -m "feat(Documents): 列表服务端分页化重构（同 PartsPage 模式）"
```

---

## Task 10: 前端 ConfigurationList 分页化重构

**Files:**
- Modify: `frontend/src/components/Configuration/ConfigurationList.tsx`

- [ ] **Step 1: 同型改造**

与 Task 9 同模式。差异：

- `ConfigItemRow` 接口本地声明，加 `version_count?: number`
- `searchField` 仅支持 `'all' | 'code' | 'name'`
- 保留 `topLevelOnly` 开关
- `configurationApi.list` 路径：调用方按现有 `configurationApi.listItems(...)`

- [ ] **Step 2: 构建验证 + 部署 + 提交**

```bash
cd frontend && npm run build
docker-compose up -d --force-recreate nginx
git add frontend/src/components/Configuration/ConfigurationList.tsx
git commit -m "feat(ConfigurationList): 列表服务端分页化重构"
```

---

## Task 11: syncService.ts 增量 poll 修复

**Files:**
- Modify: `backend/app/routers/parts.py`（增 `updated_since` Query）
- Modify: `backend/app/crud_parts.py`（`list_part_masters` 新增 `updated_since` 参数实现）
- Modify: `frontend/src/services/syncService.ts:22-40`（把 since 真传给后端）

**Interfaces:**
- Consumes: Task 2 的 list 函数。
- Produces: parts fetcher 真增量 poll；后端支持 `updated_since` 时间戳过滤。

- [ ] **Step 1: 后端支持 `updated_since`**

Modify `backend/app/crud_parts.py` `list_part_masters` 签名加 `updated_since: Optional[float] = None`：

```python
def list_part_masters(..., updated_since: Optional[float] = None):
    ...
    where_since = ""
    since_params = {}
    if updated_since:
        where_since = "AND EXTRACT(EPOCH FROM r.updated_at) >= :updated_since"
        since_params = {'updated_since': updated_since}
    # 加入两处 SQL WHERE 拼接
```

Modify `backend/app/routers/parts.py` `list_parts` 加：

```python
    updated_since: Optional[float] = Query(None, description="Unix 时间戳，仅返回 updated_at >= 该时间的 revision"),
```

- [ ] **Step 2: 前端 syncService 传 since**

Modify `frontend/src/services/syncService.ts:22-40`:

```ts
fetch: async (since: number) => {
  const params: any = { page_size: 200, show_all_versions: true };
  if (since > 0) {
    params.updated_since = since;
  }
  const res = await partsApi.list(params);
  return Array.isArray(res) ? res : res?.items || [];
}
```

- [ ] **Step 3: 验证**

观察 `docker logs bom_backend` 10 秒后应该看到增量请求（含 `updated_since=...` query）。

- [ ] **Step 4: 提交**

```bash
git add backend/app/crud_parts.py backend/app/routers/parts.py frontend/src/services/syncService.ts
git commit -m "fix(syncService): parts fetcher 真增量 poll — 把 updated_since 下推后端

- 后端 list_part_masters 新增 updated_since 参数
- 前端 fetcher 把 since 真传；之前 while 未传导致每次半全量拉 200 条"
```

---

## Task 12: 全链路回归 + 提交合并

**Files:**
- 无新文件。

- [ ] **Step 1: 后端单测全跑**

```bash
docker exec bom_backend pytest backend/tests/test_list_pagination_sort.py -v
docker exec bom_backend pytest backend/tests/ -v --tb=short 2>&1 | tail -80
```
Expected: Test 新案全部 PASS，pre-existing 测试不退化。

- [ ] **Step 2: 次级功能冒烟**

手工验证（dev 环境）：
1. **导入导出**：导出零部件 Excel，确认数据完整（不走列表页分页，走 store 缓存）
2. **看板关联项目**：Board Picker 弹出，候选列表完整（使用 `partsApi.list({page_size: 10000})` 全量）
3. **Dashboard 反查**：仪表盘打开"我最近编辑"卡片，零部件名能正常显示（依赖 store.parts）
4. **Inventory MaterialTab**：库存管理 → 物料管理 tab，绑定 PDM 物料的零部件显示准确

- [ ] **Step 3: 浏览器端到端**

零部件/图文档/构型项三页：
- 进入列表，100 条/页，工具栏页码正确
- 列头排序、搜索防抖、显示所有版本切换、仅顶层切换
- 删除末位行 → 当前页空 → 自动回退
- 创建新项 → 回首页
- 详情编辑保存 → 当前页只 patch 行、不重拉

- [ ] **Step 4: 合并到 V3.2 + dev + main**

```bash
git checkout V3.2 && git merge dev && git push origin V3.2
git checkout dev && git pull && git push origin dev  # dev 已是源头
git checkout main && git merge V3.2 && git push origin main
```

- [ ] **Step 5: 最终提交**

无新提交，仅合并提交。

---

## Spec 覆盖对照

| Spec §  | Task |
|----|----|
| §3.1 list 函数统一升级 | Task 2 / 4 / 5 |
| §3.1.5 自定义字段搜索 | Task 2 / 4 / 5（同步实现） |
| §3.1.6 消除 N+1 | Task 2（LEFT JOIN 单条 SQL） |
| §3.1.7 response 加 version_count | Task 2 / 4 / 5 + Task 7 类型补全 |
| §3.2 migration | Task 1 |
| §3.3 单测 | Task 3 |
| §4.1 列表页结构改造 | Task 8 / 9 / 10 |
| §4.1.4 分页控件 | Task 8 / 9 / 10 同型实现 |
| §4.1.5 版本数徽标 | Task 8 / 9 / 10 |
| §4.1.6 删除/创建/编辑后刷新 | Task 8 Step 5；Task 9 / 10 同型 |
| §4.1.7 移除前端双重过滤 | Task 8 / 9 / 10 重构时删除原 useTableSort |
| §4.2 useDebounced | Task 7 |
| §4.3 类型补全 | Task 7 |
| §4.4 syncService 修复 | Task 11 |
| §6 风险对策 | 已分任务覆盖（白名单校验 / 删除回退 / 表达式索引） |
| §7 验收 | Task 12 |