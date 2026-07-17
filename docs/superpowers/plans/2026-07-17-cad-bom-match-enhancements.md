# CAD BOM 匹配增强（内置属性显示 + PDM 自动匹配）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAD 工作台 BOM 匹配表格显示 CATIA 内置属性（件号、版本、定义、术语、描述，除件号外可编辑并同步），并在进入匹配步骤时自动以 件号+版本 在 PDM 数据库中批量匹配。

**Architecture:** 前端扩展 `syncRowsByPartNumber` 支持 builtin 属性同步、`CADBOMMatchTable` 新增内置属性列与自动匹配逻辑；后端新增 `POST /api/parts/cad/bom-match` 批量匹配端点（crud + schema + router + pytest）。桥接服务（cad_bridge）无改动——其 `BUILTIN_ATTRS` 已返回所需属性且 `write_property` 支持内置属性写回。

**Tech Stack:** React 18 + TypeScript + Vitest（前端）；FastAPI + SQLAlchemy 2.0 + Pydantic 2.x + pytest（后端，测试用 SQLite 内存库）

**Specs:**
- `docs/superpowers/specs/2026-07-17-cad-bom-builtin-attrs-design.md`
- `docs/superpowers/specs/2026-07-17-cad-bom-auto-match-design.md`

## Global Constraints

- 件号（PartNumber）列只读，列头「件号」；移除「CATIA 名称」列
- 新增可编辑内置属性列（列头/CATIA 属性名）：版本/`Revision`、定义/`Definition`、术语/`Nomenclature`、描述/`DescriptionRef`
- 编辑内置属性：`bridge.writeProperty` 只调用一次（当前行 path），所有同 PartNumber 行同步更新表格；写入失败仅 toast，不回滚
- 匹配规则：件号+版本精确匹配（版本 trim 后不区分大小写）→ matched；版本为空 → 匹配最新版本（`created_at DESC` 第一条）→ matched；件号存在版本无对应 → conflict（返回 latest_version）；件号不存在 → new
- 匹配端点权限复用已有 `parts:read`（permissions.json 第6行已存在，无需改动权限文件）
- 代码注释使用中文；Vitest 测试文件必须为 `.ts`
- 前端修改完成后必须执行 `npm run build`；后端修改后 `docker restart bom_backend`

---

### Task 1: syncRowsByPartNumber 支持 builtin 属性同步

**Files:**
- Modify: `frontend/src/components/CADWorkspace/syncRows.ts`
- Test: `frontend/src/components/CADWorkspace/syncRows.test.ts`

**Interfaces:**
- Consumes: `BOMRow` 类型（含 `builtin: Record<string, string>` 与 `user_properties: Record<string, string>` 字段）
- Produces: `syncRowsByPartNumber(rows: BOMRow[], row: BOMRow, key: string, value: string, target?: 'user' | 'builtin'): BOMRow[]` — Task 2 依赖 `target: 'builtin'`；现有省略 target 的调用行为不变

- [ ] **Step 1: 写失败的测试**

在 `frontend/src/components/CADWorkspace/syncRows.test.ts` 的 describe 块末尾追加两个用例（沿用文件中已有的 `makeRow` 工厂函数）：

```typescript
  it("target 为 builtin 时同步更新 builtin 属性，user_properties 不受影响", () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
      makeRow({ part_number: 'P-001', path: '0.2', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
      makeRow({ part_number: 'P-002', path: '0.3', builtin: { Revision: 'A' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], 'Revision', 'B', 'builtin');
    expect(result[0].builtin['Revision']).toBe('B');
    expect(result[1].builtin['Revision']).toBe('B');
    expect(result[2].builtin['Revision']).toBe('A');
    expect(result[0].user_properties['规格型号']).toBe('x');
  });

  it('省略 target 时行为不变：更新 user_properties，builtin 不变', () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'y');
    expect(result[0].user_properties['规格型号']).toBe('y');
    expect(result[0].builtin['Revision']).toBe('A');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run（workdir: `frontend/`）: `npx vitest run src/components/CADWorkspace/syncRows.test.ts`
Expected: FAIL（builtin 用例失败：`result[0].builtin['Revision']` 仍为 `'A'`）

- [ ] **Step 3: 修改实现**

将 `frontend/src/components/CADWorkspace/syncRows.ts` 整体替换为：

```typescript
import type { BOMRow } from './CADBOMMatchTable';

/**
 * 按 CATIA PartNumber 同步更新所有相同零部件实例行的属性。
 * 业务来源：CATIA 中属性存于零件文档，同一 PartNumber 的所有实例
 * 引用同一文档、属性天然共享，因此表格各实例行的显示也必须保持一致。
 * PartNumber 为空时回退为仅按 path 更新当前行，避免多个空件号的行被误同步。
 * target 为 'builtin' 时更新内置属性（版本/定义/术语/描述），默认更新用户属性。
 */
export function syncRowsByPartNumber(
  rows: BOMRow[],
  row: BOMRow,
  key: string,
  value: string,
  target: 'user' | 'builtin' = 'user',
): BOMRow[] {
  const matches = row.part_number
    ? (r: BOMRow) => r.part_number === row.part_number
    : (r: BOMRow) => r.path === row.path;
  return rows.map(r => {
    if (!matches(r)) return r;
    if (target === 'builtin') {
      return { ...r, builtin: { ...r.builtin, [key]: value } };
    }
    return { ...r, user_properties: { ...r.user_properties, [key]: value } };
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run（workdir: `frontend/`）: `npx vitest run src/components/CADWorkspace/syncRows.test.ts`
Expected: PASS（7 个用例全部通过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/CADWorkspace/syncRows.ts frontend/src/components/CADWorkspace/syncRows.test.ts
git commit -m "feat: syncRowsByPartNumber 支持 builtin 内置属性同步"
```

---

### Task 2: BOM 匹配表格显示 CATIA 内置属性列

**Files:**
- Modify: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`

**Interfaces:**
- Consumes: `syncRowsByPartNumber(rows, row, key, value, 'builtin')`（Task 1 产出）；`bridge.writeProperty(path, propName, value)`（已有）
- Produces: 无（终端 UI 行为）

- [ ] **Step 1: 添加内置属性列定义与编辑处理函数**

在 `CADBOMMatchTable.tsx` 的 `getPropertyColumns` 函数之后添加常量（模块级）：

```typescript
// CATIA 内置属性列：列头中文，写回 CATIA 用英文属性名。
// 件号（PartNumber）只读不在此列表；属性存于零件文档，编辑后按同 PartNumber 实例同步。
const BUILTIN_COLUMNS: { label: string; attr: string }[] = [
  { label: '版本', attr: 'Revision' },
  { label: '定义', attr: 'Definition' },
  { label: '术语', attr: 'Nomenclature' },
  { label: '描述', attr: 'DescriptionRef' },
];
```

在 `handlePropEdit` 之后添加处理函数（组件内）：

```typescript
  const handleBuiltinEdit = useCallback(async (row: BOMRow, attr: string, value: string) => {
    try {
      await bridge.writeProperty(row.path, attr, value);
      setRows(prev => syncRowsByPartNumber(prev, row, attr, value, 'builtin'));
      toast.success(`已更新 CATIA 属性 ${attr}`);
    } catch (e: any) {
      toast.error(e.message || '写入 CATIA 失败');
    }
  }, [bridge]);
```

- [ ] **Step 2: 修改表头**

将表头中：

```typescript
              <th className="p-2 text-left">CATIA PartNumber</th>
              <th className="p-2 text-left">CATIA 名称</th>
```

改为：

```typescript
              <th className="p-2 text-left">件号</th>
              {BUILTIN_COLUMNS.map(col => (
                <th key={col.attr} className="p-2 text-left bg-sky-50">{col.label}</th>
              ))}
```

- [ ] **Step 3: 修改表格行**

将行渲染中：

```typescript
                <td className="p-2">{row.builtin.PartNumber || ''}</td>
                <td className="p-2">{row.instance_name}</td>
```

改为：

```typescript
                <td className="p-2">{row.builtin.PartNumber || ''}</td>

                {BUILTIN_COLUMNS.map(col => (
                  <td key={col.attr} className="p-2 bg-sky-50">
                    <input
                      value={row.builtin[col.attr] || ''}
                      disabled={!canEditProps(row)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => syncRowsByPartNumber(prev, row, col.attr, val, 'builtin'));
                        handleBuiltinEdit(row, col.attr, val);
                      }}
                      className="border border-sky-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                    />
                  </td>
                ))}
```

- [ ] **Step 4: 运行测试与构建**

Run（workdir: `frontend/`）: `npm run test`
Expected: 全部通过（34 个用例）

Run（workdir: `frontend/`）: `npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: BOM匹配表格显示CATIA内置属性(件号/版本/定义/术语/描述)"
```

---

### Task 3: 后端 件号+版本 批量匹配端点

**Files:**
- Modify: `backend/app/schemas_parts.py`（文件末尾追加 Schema）
- Modify: `backend/app/crud_parts.py`（文件末尾追加函数）
- Modify: `backend/app/routers/parts.py`（`create_part` 端点之后添加路由）
- Test: `backend/tests/test_cad_bom_match.py`（新建）

**Interfaces:**
- Consumes: `models_parts.PartMaster` / `models_parts.PartRevision`（已有模型，字段 code/name/version/deleted_at/check_out_user_id/created_at）；`require_permission("parts:read")`（已有权限）
- Produces: `POST /api/parts/cad/bom-match`，请求 `{"items": [{"code": str, "version": str|null}]}`，响应 `{"results": [{code, version, match_status, master_id, revision_id, matched_version, name, checkout_status, latest_version}]}` — Task 4 前端依赖此契约；crud 函数 `match_cad_bom_items(db, items: list[dict], current_user_id) -> list[dict]`

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/test_cad_bom_match.py`：

```python
"""件号+版本 批量匹配 PDM 零部件（CAD 工作台自动匹配）测试"""
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User
from app import models_parts, crud_parts


def _make_user(db, role="engineer"):
    user = User(
        id=uuid.uuid4(),
        username=f"u_{uuid.uuid4().hex[:8]}",
        password_hash="x",
        real_name="测试用户",
        role=role,
    )
    db.add(user)
    db.commit()
    return user


def _make_part(db, code, versions):
    """创建零件及多个版本。versions: [(version, check_out_user_id)]，
    created_at 递增以保证「最新版本 = created_at 最新」的确定性。"""
    master = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=f"零件{code}")
    db.add(master)
    base = datetime(2026, 1, 1)
    revs = []
    for i, (version, co_user) in enumerate(versions):
        rev = models_parts.PartRevision(
            id=uuid.uuid4(),
            master_id=master.id,
            version=version,
            check_out_user_id=co_user,
            created_at=base + timedelta(days=i),
        )
        db.add(rev)
        revs.append(rev)
    db.commit()
    return master, revs


def test_exact_match(db):
    user = _make_user(db)
    master, revs = _make_part(db, "P-001", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-001", "version": "a"}], user.id)
    assert results[0]["match_status"] == "matched"
    assert results[0]["revision_id"] == revs[0].id
    assert results[0]["matched_version"] == "A"
    assert results[0]["name"] == "零件P-001"
    assert results[0]["checkout_status"] == "not_checked_out"


def test_empty_version_matches_latest(db):
    user = _make_user(db)
    master, revs = _make_part(db, "P-002", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-002", "version": ""}], user.id)
    assert results[0]["match_status"] == "matched"
    assert results[0]["revision_id"] == revs[1].id
    assert results[0]["matched_version"] == "B"


def test_version_not_found_is_conflict(db):
    user = _make_user(db)
    _make_part(db, "P-003", [("A", None), ("B", None)])
    results = crud_parts.match_cad_bom_items(db, [{"code": "P-003", "version": "C"}], user.id)
    assert results[0]["match_status"] == "conflict"
    assert results[0]["revision_id"] is None
    assert results[0]["latest_version"] == "B"


def test_code_not_found_is_new(db):
    user = _make_user(db)
    results = crud_parts.match_cad_bom_items(db, [{"code": "NOT-EXIST", "version": "A"}], user.id)
    assert results[0]["match_status"] == "new"
    assert results[0]["master_id"] is None


def test_checkout_status(db):
    me = _make_user(db)
    other = _make_user(db)
    _make_part(db, "P-004", [("A", me.id)])
    _make_part(db, "P-005", [("A", other.id)])
    results = crud_parts.match_cad_bom_items(
        db,
        [{"code": "P-004", "version": "A"}, {"code": "P-005", "version": "A"}],
        me.id,
    )
    assert results[0]["checkout_status"] == "checked_out"
    assert results[1]["checkout_status"] == "other_checked_out"


def test_endpoint(db):
    user = _make_user(db)
    _make_part(db, "P-006", [("A", None)])
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    try:
        client = TestClient(app)
        r = client.post("/api/parts/cad/bom-match", json={
            "items": [{"code": "P-006", "version": "A"}, {"code": "X", "version": None}]
        })
        assert r.status_code == 200
        body = r.json()
        assert len(body["results"]) == 2
        assert body["results"][0]["match_status"] == "matched"
        assert body["results"][1]["match_status"] == "new"
    finally:
        app.dependency_overrides.clear()
```

注意：若 `from app.routers.auth import get_current_active_user` 导入路径报错，参照 `backend/tests/test_parts_perms.py` 顶部的实际导入方式修正。

- [ ] **Step 2: 运行测试确认失败**

Run（workdir: `backend/`）: `pytest tests/test_cad_bom_match.py -v`
Expected: FAIL（`AttributeError: module 'app.crud_parts' has no attribute 'match_cad_bom_items'`）

- [ ] **Step 3: 添加 Schema**

在 `backend/app/schemas_parts.py` 文件末尾追加：

```python
# === CAD 工作台 件号+版本 批量匹配 ===

class CadBomMatchItem(BaseModel):
    code: str
    version: Optional[str] = None


class CadBomMatchRequest(BaseModel):
    items: List[CadBomMatchItem] = []


class CadBomMatchResult(BaseModel):
    code: str
    version: Optional[str] = None
    match_status: str  # matched / conflict / new
    master_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None
    matched_version: Optional[str] = None
    name: Optional[str] = None
    checkout_status: Optional[str] = None  # not_checked_out / checked_out / other_checked_out
    latest_version: Optional[str] = None


class CadBomMatchResponse(BaseModel):
    results: List[CadBomMatchResult] = []
```

- [ ] **Step 4: 添加 crud 函数**

在 `backend/app/crud_parts.py` 文件末尾追加：

```python
def match_cad_bom_items(db: Session, items: list, current_user_id) -> list:
    """
    按 件号+版本 批量匹配 PDM 零部件（CAD 工作台自动匹配）。
    - 件号不存在 → new
    - 版本为空 → 匹配最新版本（created_at 最新）→ matched
    - 版本命中（trim 后不区分大小写）→ matched
    - 版本未命中 → conflict（latest_version 返回 PDM 已有最新版本号）
    matched 时返回相对当前用户的签出状态。
    """
    results = []
    for item in items:
        code = (item.get("code") or "").strip()
        version = (item.get("version") or "").strip()
        entry = {
            "code": code,
            "version": version or None,
            "match_status": "new",
            "master_id": None,
            "revision_id": None,
            "matched_version": None,
            "name": None,
            "checkout_status": None,
            "latest_version": None,
        }
        if not code:
            results.append(entry)
            continue
        master = (
            db.query(models_parts.PartMaster)
            .filter(
                models_parts.PartMaster.code == code,
                models_parts.PartMaster.deleted_at.is_(None),
            )
            .first()
        )
        if master is None:
            results.append(entry)
            continue
        revisions = (
            db.query(models_parts.PartRevision)
            .filter(
                models_parts.PartRevision.master_id == master.id,
                models_parts.PartRevision.deleted_at.is_(None),
            )
            .order_by(models_parts.PartRevision.created_at.desc())
            .all()
        )
        if not revisions:
            results.append(entry)
            continue
        latest = revisions[0]
        entry["master_id"] = master.id
        entry["latest_version"] = latest.version
        matched_rev = None
        if not version:
            matched_rev = latest
        else:
            for rev in revisions:
                if (rev.version or "").strip().upper() == version.upper():
                    matched_rev = rev
                    break
        if matched_rev is None:
            entry["match_status"] = "conflict"
        else:
            entry["match_status"] = "matched"
            entry["revision_id"] = matched_rev.id
            entry["matched_version"] = matched_rev.version
            entry["name"] = master.name
            if matched_rev.check_out_user_id is None:
                entry["checkout_status"] = "not_checked_out"
            elif matched_rev.check_out_user_id == current_user_id:
                entry["checkout_status"] = "checked_out"
            else:
                entry["checkout_status"] = "other_checked_out"
        results.append(entry)
    return results
```

- [ ] **Step 5: 添加路由**

在 `backend/app/routers/parts.py` 的 `create_part` 端点函数之后添加（固定路径端点靠前定义，避免被含路径参数的路由截获）：

```python
@router.post("/cad/bom-match", response_model=schemas_parts.CadBomMatchResponse)
def cad_bom_match(
    data: schemas_parts.CadBomMatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("parts:read")),
):
    """CAD 工作台：按 件号+版本 批量匹配 PDM 零部件"""
    results = crud_parts.match_cad_bom_items(
        db, [i.model_dump() for i in data.items], current_user.id
    )
    return {"results": results}
```

- [ ] **Step 6: 运行测试确认通过**

Run（workdir: `backend/`）: `pytest tests/test_cad_bom_match.py -v`
Expected: 6/6 PASS

Run（workdir: `backend/`）: `pytest`
Expected: 全部通过（无既有测试被破坏）

- [ ] **Step 7: 提交**

```bash
git add backend/app/schemas_parts.py backend/app/crud_parts.py backend/app/routers/parts.py backend/tests/test_cad_bom_match.py
git commit -m "feat: 新增件号+版本批量匹配PDM零部件端点"
```

---

### Task 4: 前端自动匹配接入

**Files:**
- Modify: `frontend/src/services/api.ts`（`partsApi` 对象内追加方法）
- Modify: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`

**Interfaces:**
- Consumes: `POST /api/parts/cad/bom-match`（Task 3 产出，契约见 Task 3 Produces）
- Produces: 无（终端 UI 行为）

- [ ] **Step 1: api.ts 添加客户端方法**

在 `frontend/src/services/api.ts` 的 `partsApi` 对象中（`cadImportPreview` 方法附近）追加：

```typescript
  // CAD 工作台：按 件号+版本 批量匹配 PDM 零部件
  cadBomMatch: (items: { code: string; version?: string }[]) =>
    api.post('/parts/cad/bom-match', { items }).then((r) => r.data),
```

- [ ] **Step 2: BOMRow 类型扩展**

在 `CADBOMMatchTable.tsx` 的 `BOMRow.pdm_match` 类型中追加可选字段（用于 conflict 提示）：

```typescript
  pdm_match: {
    master_id?: string;
    revision_id?: string;
    code?: string;
    version?: string;
    name?: string;
    latest_version?: string;
  } | null;
```

- [ ] **Step 3: 添加自动匹配逻辑**

`CADBOMMatchTable.tsx` 顶部 import 将 `useState, useCallback` 扩展为 `useState, useCallback, useEffect`。

在组件内（`handleBuiltinEdit` 之后）添加：

```typescript
  const [matching, setMatching] = useState(false);

  // 件号+版本 组成去重键；版本 trim 后不区分大小写，与后端匹配规则一致
  const matchKeyOf = (r: BOMRow) =>
    `${(r.part_number || '').trim()}|${(r.builtin.Revision || '').trim().toUpperCase()}`;

  const runPdmMatch = useCallback(async (targetRows: BOMRow[]) => {
    const uniq = new Map<string, { code: string; version?: string }>();
    for (const r of targetRows) {
      const code = (r.part_number || '').trim();
      if (!code) continue;
      const k = matchKeyOf(r);
      if (!uniq.has(k)) uniq.set(k, { code, version: (r.builtin.Revision || '').trim() || undefined });
    }
    if (uniq.size === 0) return;
    setMatching(true);
    try {
      const data = await partsApi.cadBomMatch([...uniq.values()]);
      const resultMap = new Map<string, any>();
      for (const res of data.results || []) {
        resultMap.set(`${res.code}|${(res.version || '').toUpperCase()}`, res);
      }
      setRows(prev => prev.map(r => {
        const res = resultMap.get(matchKeyOf(r));
        if (!res) return r;
        if (res.match_status === 'matched') {
          return {
            ...r,
            match_status: 'matched' as const,
            pdm_match: {
              master_id: res.master_id,
              revision_id: res.revision_id,
              code: res.code,
              version: res.matched_version,
              name: res.name,
            },
            checkout_status: res.checkout_status,
          };
        }
        if (res.match_status === 'conflict') {
          return {
            ...r,
            match_status: 'conflict' as const,
            pdm_match: { code: res.code, latest_version: res.latest_version },
            checkout_status: null,
          };
        }
        return { ...r, match_status: 'new' as const, pdm_match: null, checkout_status: null };
      }));
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'PDM 匹配失败');
    } finally {
      setMatching(false);
    }
  }, []);

  // 进入匹配步骤时自动执行一次 PDM 匹配
  useEffect(() => {
    runPdmMatch(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: 汇总栏添加「重新匹配」按钮与匹配中状态**

在汇总栏 `<div className="flex-1" />` 之后、「批量属性→PDM」按钮之前添加：

```typescript
        <button
          onClick={() => runPdmMatch(rows)}
          disabled={matching}
          className="px-3 py-1.5 bg-sky-500 text-white rounded text-xs hover:bg-sky-600 disabled:bg-gray-300"
        >
          {matching ? '匹配中...' : '重新匹配'}
        </button>
```

- [ ] **Step 5: PDM匹配列 conflict 提示**

将「PDM匹配」列单元格：

```typescript
                <td className="p-2">
                  {row.pdm_match ? (
                    <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                  ) : (
                    <span className="text-amber-600">— 无 —</span>
                  )}
                </td>
```

改为：

```typescript
                <td className="p-2">
                  {row.match_status === 'conflict' && row.pdm_match ? (
                    <span className="text-red-600">版本冲突 (PDM最新: v{row.pdm_match.latest_version})</span>
                  ) : row.pdm_match ? (
                    <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                  ) : (
                    <span className="text-amber-600">— 无 —</span>
                  )}
                </td>
```

- [ ] **Step 6: 运行测试与构建**

Run（workdir: `frontend/`）: `npm run test`
Expected: 全部通过

Run（workdir: `frontend/`）: `npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 7: 提交**

```bash
git add frontend/src/services/api.ts frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: BOM匹配表格进入时按件号+版本自动匹配PDM"
```

- [ ] **Step 8: 部署**

```powershell
docker restart bom_backend
docker-compose up -d --force-recreate nginx
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Expected: 4 个容器均 Up
