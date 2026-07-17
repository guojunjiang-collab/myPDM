# 设计：CAD BOM 匹配 — 件号+版本 PDM 自动匹配

- 日期：2026-07-17
- 状态：已批准
- 范围：后端新增批量匹配端点 + 前端 CAD 工作台接入

## 背景

CAD 工作台 BOM 匹配表格目前无自动 PDM 匹配：读取 CATIA 装配树后所有行
`pdm_match=null`、`match_status='unknown'`，只有「创建零件」后才变为已匹配。
用户需要进入匹配步骤时，自动以 件号（CATIA PartNumber）+ 版本（CATIA
Revision）在 PDM 数据库中精确匹配。

## 需求决策（已与用户确认）

| 决策点 | 结论 |
| ------ | ---- |
| 匹配键 | 件号 + 版本同时匹配 |
| 版本不一致 | 件号存在但版本在 PDM 无对应 → 标为「冲突」，不自动关联其他版本 |
| CATIA Revision 为空 | 仅按件号匹配，关联 PDM 最新版本 → 已匹配 |
| 实现方式 | 后端批量匹配端点（一次请求），非前端逐个查询 |

## 方案

### 后端

新增 `POST /api/parts/cad/bom-match`（`routers/parts.py`，权限 `parts:read`）。

请求（Pydantic Schema，`schemas_parts.py`）：

```json
{ "items": [ { "code": "P-001", "version": "A" } ] }
```

前端提交前按（件号，版本）去重。

响应：

```json
{ "results": [ {
  "code": "P-001",
  "version": "A",
  "match_status": "matched | conflict | new",
  "master_id": "uuid | null",
  "revision_id": "uuid | null",
  "matched_version": "A | null",
  "name": "零件名 | null",
  "checkout_status": "not_checked_out | checked_out | other_checked_out | null",
  "latest_version": "B | null"
} ] }
```

匹配逻辑（`crud_parts.py`）：

- 按 code 精确查 PartMaster（未软删除）
  - 不存在 → `new`
  - 存在：
    - 请求 version 为空 → 取最新版本 revision → `matched`
    - version 非空：trim 后不区分大小写与 revision.version 比较
      - 命中 → `matched`
      - 未命中 → `conflict`，`latest_version` 返回该件号最新版本号
- `matched` 时返回相对当前用户的签出状态：未签出 /
  我签出（`checked_out`）/ 他人签出（`other_checked_out`）

### 前端

- `services/api.ts` 的 `partsApi` 新增 `cadBomMatch(items)` 客户端方法
- `CADBOMMatchTable`：挂载时自动执行匹配（rows 去重出（件号，版本）列表 →
  调用端点 → 按件号+版本回填每行的 `pdm_match` / `match_status` /
  `checkout_status`）
- 匹配期间表格区域显示加载中；失败 toast 报错，行保持 `unknown` 状态
- 汇总栏新增「重新匹配」按钮，手动重新执行匹配
- `conflict` 行的「PDM匹配」列提示 PDM 已有最新版本号

## 错误处理

- 端点对空 items 返回空 results
- 前端匹配请求失败：toast 报错，不阻塞表格其他操作，可点「重新匹配」重试

## 测试

后端 pytest（匹配逻辑）覆盖：

1. 件号+版本精确命中 → matched
2. 版本为空 → 匹配最新版本
3. 件号存在版本无对应 → conflict（含 latest_version）
4. 件号不存在 → new
5. 签出状态：我签出 / 他人签出 / 未签出

前端逻辑并入 `npm run build` 验证。

## 验证

- `cd backend; pytest`（或 docker 内运行）
- `cd frontend; npm run test; npm run build`
- 部署：`docker restart bom_backend; docker-compose up -d --force-recreate nginx`
