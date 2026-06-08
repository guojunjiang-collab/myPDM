# 构型项 / 构型配置 / ECR / ECO 批量导入导出设计方案

> **版本**: v2.0
> **日期**: 2026-06-08
> **状态**: 🟡 设计中
> **前版本**: 项目说明/构型与变更导入导出设计方案.md (v1.0)

---

## 一、需求总览

实现构型项、构型配置、ECR、ECO 四大模块的批量导入导出，支持数据备份和跨环境迁移恢复。

### 1.1 导出需求

| 模块 | 导出内容 | 格式 |
|------|---------|------|
| 构型项 | 基本信息 + 关联零部件 + 子构型项 + 关联图文档 | 单个 Excel（多 Sheet） |
| 构型配置 | 基本信息 + 正式清单项 | 单个 Excel（多 Sheet） |
| ECR | 基本信息 + 受影响对象 + 审批人 + 知会人 + 关联图文档 | 单个 Excel（多 Sheet） |
| ECO | 基本信息 + 执行明细 + 审批人 + 知会人 + 关联图文档 + 预变更零部件 | 单个 Excel（多 Sheet） |

### 1.2 导入需求

| 模块 | 匹配键 | 更新策略 |
|------|--------|---------|
| 构型项 | `code` | 基本字段覆盖；关联关系追加（不清空已有） |
| 构型配置 | `code` | 基本字段覆盖；正式清单项新增时写入，更新时保留已有 |
| ECR | `ecr_number` | 基本字段+审批人+图文档完全覆盖；受影响对象先清空再写入 |
| ECO | `eco_number` | 基本字段+审批人+图文档完全覆盖；执行明细先清空再写入 |

> **通用原则**：导入只做新增和更新，不删除已有数据；ECR/ECO 导入后状态统一设为 `draft`。

---

## 二、整体技术架构

### 2.1 技术路线

**后端零改动**，全部导入导出逻辑在前端 `frontend/src/services/importExport.ts` 中实现，通过现有 API 操作数据。

```
┌──────────────────────────────────────────────────────────┐
│                   前端 (React + TypeScript)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │            importExport.ts 服务层                 │   │
│  │                                                  │   │
│  │  exportConfigurationItems / importConfigurationItems  │   │
│  │  exportConfigurationProfiles / importConfigurationProfiles │
│  │  exportECRs / importECRs                         │   │
│  │  exportECOs / importECOs                         │   │
│  └───────────────────────┬──────────────────────────┘   │
│                           │ 调用现有 API                  │
└───────────────────────────┼──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                    后端 (FastAPI)                          │
│  /api/configurations/items/*   构型项 CRUD + 关联          │
│  /api/configurations/profiles/* 构型配置 CRUD + 清单       │
│  /api/ecrs/*                   ECR CRUD + 受影响对象       │
│  /api/ecos/*                   ECO CRUD + 执行明细         │
│  /api/users/                   用户查询                    │
└──────────────────────────────────────────────────────────┘
```

### 2.2 依赖

| 依赖 | 用途 | 备注 |
|------|------|------|
| `xlsx` (SheetJS) | Excel 读写 | 已有 |
| `downloadBlob()` | 触发浏览器下载 | 已有工具函数 |

导出使用 `downloadBlob()` 直接下载，**不使用** File System Access API（构型/ECR/ECO 为单文件导出，无需选文件夹）。

### 2.3 通用 API 对照表

| 操作 | API 调用 |
|------|---------|
| 构型项列表 | `configurationApi.listItems()` |
| 创建构型项 | `configurationApi.createItem(data)` |
| 更新构型项 | `configurationApi.updateItem(id, data)` |
| 构型项关联零件 | `configurationApi.addParts(id, items[])` |
| 构型项关联子构型 | `configurationApi.addChildren(id, items[])` |
| 构型项关联图文档 | `entityDocumentsApi.add('configuration', id, {document_id, category, sort_order})` |
| 构型配置列表 | `configurationProfileApi.list()` |
| 创建构型配置 | `configurationProfileApi.create(data)` |
| 更新构型配置 | `configurationProfileApi.update(id, data)` |
| 更新配置清单项选中状态 | `configurationProfileApi.updateItem(profileId, itemId, {is_selected})` |
| 重新生成清单 | `configurationProfileApi.regenerate(profileId)` |
| ECR 列表 | `ecrApi.list({page_size: 10000})` |
| 创建 ECR | `ecrApi.create(data)` — 审批人/图文档内嵌在请求体 |
| 更新 ECR | `ecrApi.update(id, data)` — 审批人/图文档内嵌覆盖 |
| 添加受影响对象 | `ecrApi.addAffectedItem(ecrId, {entity_type, entity_id, change_description, change_type})` |
| 删除受影响对象 | `ecrApi.removeAffectedItem(ecrId, itemId)` |
| 添加 ECR 知会人 | `ecrApi.cc(ecrId, userIds[])` |
| ECO 列表 | `ecoApi.list({page_size: 10000})` |
| 创建 ECO | `ecoApi.create(data)` — 审批人/图文档内嵌在请求体 |
| 更新 ECO | `ecoApi.update(id, data)` — 审批人/图文档内嵌覆盖 |
| 获取执行明细 | `ecoApi.getExecutionItems(ecoId)` |
| 添加执行明细 | `ecoApi.addExecutionItem(ecoId, data)` |
| 删除执行明细 | `ecoApi.deleteExecutionItem(ecoId, itemId)` |
| 添加 ECO 知会人 | `ecoApi.cc(ecoId, userIds[])` |
| 用户列表 | `usersApi.list({page_size: 10000})` |

### 2.4 通用匹配策略

| 实体 | 匹配键 | store 字段 |
|------|--------|------------|
| 构型项 | `code` | `useDataStore().configurationItems`（如存在）或 API 查询 |
| 构型配置 | `code` | API 查询 |
| ECR | `ecr_number` | API 查询 |
| ECO | `eco_number` | API 查询 |
| 零件 | `code + version` | `useDataStore().parts` |
| 部件 | `code + version` | `useDataStore().assemblies` |
| 图文档 | `code + version` | `useDataStore().documents` |
| 用户 | `username` | 导入时一次性加载全量用户列表建 Map |

### 2.5 通用导入行为约定

1. **只新增和更新，不删除**已有数据
2. **关联关系处理**：
   - 构型项的关联零件/子构型/图文档：追加（已存在则跳过，不清空）
   - ECR 的受影响对象：更新模式先 `removeAffectedItem` 全部清空，再重新写入
   - ECO 的执行明细：更新模式先 `deleteExecutionItem` 全部清空，再重新写入
   - ECR/ECO 审批人和图文档：通过 `update` 请求体内嵌覆盖（API 层完整替换）
   - ECR/ECO 知会人：更新模式先 `uncc` 全部，再 `cc` 重新添加
3. **找不到的引用对象**：标记警告、跳过该关联，不阻塞主记录导入
4. **ECR / ECO 状态**：导入后统一设为 `draft`（审批记录无法跨环境迁移）
5. **创建人找不到**：回退为当前登录用户（`useAuthStore().user.id`）
6. **Excel 编码**：UTF-8，文件名带日期后缀 `_YYYYMMDD.xlsx`

---

## 三、构型项导入导出

### 3.1 导出

**触发**：构型项管理页面顶部「📥 导出全部」按钮（权限：`canDownload()`）

**输出**：`构型项数据_YYYYMMDD.xlsx`，包含 4 个 Sheet：

**Sheet 1「构型项清单」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 构型号 | `code` | 导入匹配键 |
| 名称 | `name` | |
| 规格型号 | `spec` | |
| 备注 | `remark` | |
| 创建时间 | `created_at` | 仅导出，不参与导入 |
| 更新时间 | `updated_at` | 仅导出，不参与导入 |

**Sheet 2「关联零部件」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 构型号 | `ci_code` | 关联 Sheet1 |
| 零部件类型 | `part_type` | `part` / `assembly` |
| 零部件件号 | `part_code` | 导入匹配键 |
| 零部件版本 | `part_version` | 导入匹配键 |
| 是否必选 | `is_required` | `TRUE` / `FALSE` |
| 排序 | `sort_order` | |

**Sheet 3「子构型项」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 父构型号 | `parent_code` | 关联 Sheet1 |
| 子构型号 | `child_code` | |
| 是否必选 | `is_required` | `TRUE` / `FALSE` |
| 排序 | `sort_order` | |

**Sheet 4「关联图文档」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 构型号 | `ci_code` | 关联 Sheet1 |
| 图文档编号 | `doc_code` | |
| 图文档版本 | `doc_version` | |
| 类别 | `category` | |
| 排序 | `sort_order` | |

**导出实现**：
```typescript
// 伪代码
async function exportConfigurationItems(): Promise<void> {
  const res = await configurationApi.listItems({ page_size: 10000 });
  const items = res.data.items;

  // 批量获取每个构型项的关联数据
  const detailResults = await Promise.all(items.map(i => configurationApi.getItem(i.id)));
  const details = detailResults.map(r => r.data);

  // 构建 4 个 Sheet 的行数据
  const sheet1Rows = details.map(d => ({ 构型号: d.code, 名称: d.name, ... }));
  const sheet2Rows = details.flatMap(d => (d.parts || []).map(p => ({ 构型号: d.code, ... })));
  const sheet3Rows = details.flatMap(d => (d.children || []).map(c => ({ 父构型号: d.code, ... })));
  const sheet4Rows = details.flatMap(d => (d.document_links || []).map(doc => ({ 构型号: d.code, ... })));

  // 写入 workbook 并下载
  const wb = XLSX.utils.book_new();
  // ... append sheets
  downloadBlob(blob, `构型项数据_${todayStr()}.xlsx`);
}
```

### 3.2 导入

**触发**：构型项管理页面顶部「📤 导入」按钮（权限：`canEdit()`）

**输入**：单个 Excel 文件（与导出格式一致）

**预览阶段（`previewConfigurationItemsImport`）**：

```
解析 Sheet「构型项清单」
  ├── 校验必填字段：构型号、名称
  ├── 按 code 匹配已有构型项 → 标记 新增 / 更新
  ├── 解析 Sheet「关联零部件」→ 按 code+version 在 store 中预查
  ├── 解析 Sheet「子构型项」→ 按 code 在已有列表预查
  ├── 解析 Sheet「关联图文档」→ 按 code+version 在 store 中预查
  └── 返回预览数据（含 warnings 计数）
```

**执行阶段（`executeConfigurationItemsImport`）**：

**第一轮：创建/更新构型项主记录**
```typescript
for (const row of validRows) {
  if (row.status === '更新') {
    await configurationApi.updateItem(existingId, { name, spec, remark });
  } else {
    const res = await configurationApi.createItem({ code, name, spec, remark });
    row._newId = res.data.id;
  }
}
// 建立 code → id 索引 Map，供后续轮次使用
```

**第二轮：建立关联零部件**
```typescript
for (const row of partRelRows) {
  const ciId = codeToIdMap.get(row.ci_code);
  const part = store.parts.find(p => p.code === row.part_code && p.version === row.part_version)
            || store.assemblies.find(a => a.code === row.part_code && a.version === row.part_version);
  if (!part) { warnings.push(...); continue; }

  // 查现有关联，已存在则跳过
  const existing = await configurationApi.getItem(ciId); // 或从缓存取
  const alreadyLinked = existing.parts.some(p => p.part_id === part.id);
  if (alreadyLinked) continue;

  await configurationApi.addParts(ciId, [{
    part_type: row.part_type,   // 'part' | 'assembly'
    part_id: part.id,
    is_required: row.is_required === 'TRUE',
  }]);
}
```

**第三轮：建立子构型项关系**
```typescript
for (const row of childRows) {
  const parentId = codeToIdMap.get(row.parent_code);
  const childId = codeToIdMap.get(row.child_code)
               || existingItemsMap.get(row.child_code)?.id;
  if (!childId) { warnings.push(...); continue; }

  await configurationApi.addChildren(parentId, [{
    child_id: childId,
    is_required: row.is_required === 'TRUE',
  }]);
}
```

**第四轮：建立关联图文档**
```typescript
for (const row of docRows) {
  const ciId = codeToIdMap.get(row.ci_code);
  const doc = store.documents.find(d => d.code === row.doc_code && d.version === row.doc_version);
  if (!doc) { warnings.push(...); continue; }

  await entityDocumentsApi.add('configuration', ciId, {
    document_id: doc.id,
    category: row.category,
    sort_order: row.sort_order,
  });
}
```

**导入后**：调用 `useDataStore.getState().syncAll()` 刷新列表。

### 3.3 导入预览弹窗

```
共 N 条（新增 X / 更新 Y）
关联零部件 M 个（⚠️ W 个未找到），子构型项 P 个（⚠️ Q 个未找到），关联图文档 R 个（⚠️ S 个未找到）
┌──────────────────────────────────────────────────────────┐
│ 状态   │ 构型号   │ 名称    │ 关联零件数 │ 子构型项数 │ 图文档数 │
│ 🆕新增 │ CFG-001  │ 机翼构型 │ 3         │ 1         │ 2       │
│ ✏️更新 │ CFG-002  │ 机身构型 │ 5         │ 2         │ 0       │
└──────────────────────────────────────────────────────────┘
[取消]  [确认导入 (N 条)]
```

---

## 四、构型配置导入导出

### 4.1 导出

**触发**：构型配置页面顶部「📥 导出全部」按钮（权限：`canDownload()`）

**输出**：`构型配置数据_YYYYMMDD.xlsx`，包含 2 个 Sheet：

**Sheet 1「配置清单」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 配置编号 | `code` | 导入匹配键 |
| 配置名称 | `name` | |
| 关联构型项编号 | `ci_code` | 关联构型项的 code（可空） |
| 状态 | `status` | `draft` / `active` / `archived` |
| 起始架次号 | `effectivity_start` | |
| 结束架次号 | `effectivity_end` | |
| 备注 | `remark` | |
| 创建时间 | `created_at` | 仅导出 |
| 更新时间 | `updated_at` | 仅导出 |

**Sheet 2「正式配置清单项」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| 配置编号 | `profile_code` | 关联 Sheet1 |
| 来源构型项编号 | `source_ci_code` | |
| 项类型 | `item_type` | `part` / `assembly` / `config_item` |
| 项编号 | `item_code` | 零部件件号或构型号 |
| 项名称 | `item_name` | |
| 是否必选 | `is_required` | `TRUE` / `FALSE` |
| 是否选用 | `is_selected` | `TRUE` / `FALSE` |
| 来源类型 | `source_type` | `direct` / `child` |
| 排序 | `sort_order` | |

> **设计要点**：仅导出正式清单（`configuration_profile_items`），不导出工作表（`configuration_working_items`）。工作表是编辑中间状态，导入后无意义；用户打开配置编辑时系统自动重建。

**导出实现**：
```typescript
async function exportConfigurationProfiles(): Promise<void> {
  const res = await configurationProfileApi.list({ page_size: 10000 });
  const profiles = res.data.items;

  // 获取每个配置的详情（含 profile_items 和关联构型项 code）
  const details = await Promise.all(profiles.map(p => configurationProfileApi.get(p.id)));

  const sheet1Rows = details.map(d => ({ 配置编号: d.data.code, ... }));
  const sheet2Rows = details.flatMap(d =>
    (d.data.profile_items || []).map(item => ({ 配置编号: d.data.code, ... }))
  );

  // 写入 workbook 并下载
  downloadBlob(blob, `构型配置数据_${todayStr()}.xlsx`);
}
```

### 4.2 导入

**触发**：构型配置页面顶部「📤 导入」按钮（权限：`canEdit()`）

**预览阶段（`previewConfigurationProfilesImport`）**：

```
解析 Sheet「配置清单」
  ├── 校验必填字段：配置编号、配置名称
  ├── 按 code 匹配已有配置 → 标记 新增 / 更新
  ├── 校验关联构型项 ci_code（不存在则警告）
  ├── 解析 Sheet「正式配置清单项」→ 统计项数
  └── 返回预览数据
```

**执行阶段（`executeConfigurationProfilesImport`）**：

**第一步：创建/更新配置主记录**
```typescript
for (const row of validRows) {
  // 查找关联构型项 ID（按 code）
  const ciId = await findConfigItemIdByCode(row.ci_code); // 可能为空

  const payload = {
    code: row.code, name: row.name,
    configuration_item_id: ciId || null,
    effectivity_start: row.effectivity_start,
    effectivity_end: row.effectivity_end,
    remark: row.remark,
  };

  if (row.status === '更新') {
    await configurationProfileApi.update(existingId, payload);
  } else {
    const res = await configurationProfileApi.create(payload);
    row._newId = res.data.id;
  }
}
```

**第二步：写入正式清单项（仅新增模式）**
- 更新模式：保留用户已调整的清单数据，不覆盖
- 新增模式：调用 `configurationProfileApi.regenerate(profileId)` 从关联构型项生成清单，然后按导入的 `is_selected` 逐项调用 `configurationProfileApi.updateItem(profileId, itemId, {is_selected})`

> **注意**：`regenerate` 会根据关联构型项重建清单，导入的 `is_selected` 状态在 regenerate 后再逐项设置。若配置无关联构型项，则跳过此步骤。

**导入后**：刷新构型配置列表。

### 4.3 导入预览弹窗

```
共 N 条（新增 X / 更新 Y）
正式清单项 M 条，⚠️ W 个关联构型项未找到
┌──────────────────────────────────────────────────────────┐
│ 状态   │ 配置编号  │ 配置名称  │ 关联构型项 │ 清单项数 │
│ 🆕新增 │ PC-001   │ 标准配置  │ CFG-001   │ 12      │
│ ✏️更新 │ PC-002   │ 特装配置  │ ⚠️未找到  │ 8       │
└──────────────────────────────────────────────────────────┘
[取消]  [确认导入 (N 条)]
```

---

## 五、ECR 导入导出

### 5.1 导出

**触发**：ECR 列表页面顶部「📥 导出全部」按钮（权限：`canDownload()`）

**输出**：`ECR数据_YYYYMMDD.xlsx`，包含 5 个 Sheet：

**Sheet 1「ECR 清单」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECR 编号 | `ecr_number` | 导入匹配键，格式 `ECR-YYYY-XXXXX` |
| 标题 | `title` | |
| 详细描述 | `description` | |
| 变更原因 | `reason` | |
| 优先级 | `priority` | `urgent` / `high` / `normal` / `low` |
| 变更类别 | `category` | `design_change` / `process_change` / `material_change` / `other` |
| 状态 | `status` | 仅导出参考，导入时统一设为 `draft` |
| 审批模式 | `review_mode` | `all`=会签 / `any`=或签 |
| 创建人 | `creator_name` | 用户名，导入时按此匹配 |
| 创建时间 | `created_at` | 仅导出 |

**Sheet 2「受影响对象」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECR 编号 | `ecr_number` | 关联 Sheet1 |
| 实体类型 | `entity_type` | `part` / `assembly` |
| 实体编号 | `entity_code` | 导入匹配键 |
| 实体名称 | `entity_name` | |
| 实体版本 | `entity_version` | |
| 变更说明 | `change_description` | |
| 变更类型 | `change_type` | |

**Sheet 3「审批人」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECR 编号 | `ecr_number` | 关联 Sheet1 |
| 审批人用户名 | `user_name` | 导入匹配键 |
| 审批角色 | `role` | |
| 审批序号 | `seq` | |

**Sheet 4「知会人」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECR 编号 | `ecr_number` | 关联 Sheet1 |
| 知会人用户名 | `user_name` | |

**Sheet 5「关联图文档」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECR 编号 | `ecr_number` | 关联 Sheet1 |
| 图文档编号 | `doc_code` | |
| 图文档版本 | `doc_version` | |
| 类别 | `category` | |
| 排序 | `sort_order` | |

**不导出**：审批记录、状态变更日志、BOM 影响分析（JSONB，计算生成）、`creator_id` / UUID 字段。

**导出实现**：
```typescript
async function exportECRs(): Promise<void> {
  const res = await ecrApi.list({ page_size: 10000 });
  const ecrs = res.data.items;

  // ECR detail 含 reviewers、cc_users、document_links、affected_items
  const details = await Promise.all(ecrs.map(e => ecrApi.detail(e.id)));

  const sheet1Rows = details.map(d => ({ 'ECR编号': d.data.ecr_number, ... }));
  const sheet2Rows = details.flatMap(d =>
    (d.data.affected_items || []).map(item => ({ 'ECR编号': d.data.ecr_number, ... }))
  );
  const sheet3Rows = details.flatMap(d =>
    (d.data.reviewers || []).map(r => ({ 'ECR编号': d.data.ecr_number, 审批人用户名: r.user_name, ... }))
  );
  const sheet4Rows = details.flatMap(d =>
    (d.data.cc_users || []).map(u => ({ 'ECR编号': d.data.ecr_number, 知会人用户名: u.user_name }))
  );
  const sheet5Rows = details.flatMap(d =>
    (d.data.document_links || []).map(doc => ({ 'ECR编号': d.data.ecr_number, ... }))
  );

  downloadBlob(blob, `ECR数据_${todayStr()}.xlsx`);
}
```

### 5.2 导入

**触发**：ECR 列表页面顶部「📤 导入」按钮（权限：`canEdit()`）

**预览阶段（`previewECRsImport`）**：

```
解析 Sheet「ECR 清单」
  ├── 校验必填字段：ECR 编号、标题、变更原因
  ├── 按 ecr_number 匹配已有 ECR → 标记 新增 / 更新
  ├── 解析 Sheet「审批人」→ 按用户名预查（不存在则警告）
  ├── 解析 Sheet「知会人」→ 按用户名预查（不存在则警告）
  ├── 解析 Sheet「受影响对象」→ 按 code+version 预查（不存在则警告）
  ├── 解析 Sheet「关联图文档」→ 按 code+version 预查（不存在则警告）
  └── 返回预览数据
```

**执行阶段（`executeECRsImport`）**：

**一次性加载全量用户 Map**（`username → {id, ...}`）：
```typescript
const usersRes = await usersApi.list({ page_size: 10000 });
const userMap = new Map(usersRes.data.items.map(u => [u.username, u]));
```

**第一步：创建/更新 ECR 主记录（含审批人+图文档）**
```typescript
for (const row of validRows) {
  // 解析审批人（内嵌到请求体）
  const reviewers = reviewerRows
    .filter(r => r.ecr_number === row.ecr_number)
    .map(r => {
      const user = userMap.get(r.user_name);
      if (!user) { warnings.push(`审批人未找到: ${r.user_name}`); return null; }
      return { user_id: user.id, seq: r.seq };
    })
    .filter(Boolean);

  // 解析图文档（内嵌到请求体）
  const documentLinks = docRows
    .filter(d => d.ecr_number === row.ecr_number)
    .map(d => {
      const doc = store.documents.find(doc => doc.code === d.doc_code && doc.version === d.doc_version);
      if (!doc) { warnings.push(`图文档未找到: ${d.doc_code}`); return null; }
      return { document_id: doc.id, category: d.category, sort_order: d.sort_order };
    })
    .filter(Boolean);

  const creatorUser = userMap.get(row.creator_name) || currentUser;

  const payload = {
    ecr_number: row.ecr_number,
    title: row.title,
    description: row.description,
    reason: row.reason,
    priority: row.priority,
    category: row.category,
    status: 'draft',           // 统一设为 draft
    review_mode: row.review_mode,
    creator_id: creatorUser.id,
    reviewers,                 // 内嵌，API 层完整替换
    document_links: documentLinks,
  };

  if (row.status === '更新') {
    await ecrApi.update(existingId, payload);
  } else {
    const res = await ecrApi.create(payload);
    row._newId = res.data.id;
  }
}
```

**第二步：处理受影响对象（先清空再写入）**
```typescript
for (const row of validRows) {
  const ecrId = row._newId || existingId;

  if (row.status === '更新') {
    // 清空旧受影响对象
    const detail = await ecrApi.detail(ecrId);
    for (const item of (detail.data.affected_items || [])) {
      await ecrApi.removeAffectedItem(ecrId, item.id);
    }
  }

  // 写入新受影响对象
  for (const affRow of affectedRows.filter(a => a.ecr_number === row.ecr_number)) {
    const entity = store.parts.find(p => p.code === affRow.entity_code && p.version === affRow.entity_version)
                || store.assemblies.find(a => a.code === affRow.entity_code && a.version === affRow.entity_version);
    if (!entity) { warnings.push(...); continue; }

    await ecrApi.addAffectedItem(ecrId, {
      entity_type: affRow.entity_type,
      entity_id: entity.id,
      change_description: affRow.change_description,
      change_type: affRow.change_type,
    });
  }
}
```

**第三步：处理知会人（先清空再写入）**
```typescript
for (const row of validRows) {
  const ecrId = row._newId || existingId;

  if (row.status === '更新') {
    const detail = await ecrApi.detail(ecrId);
    for (const ccUser of (detail.data.cc_users || [])) {
      await ecrApi.uncc(ecrId, ccUser.user_id);
    }
  }

  const ccUserIds = ccRows
    .filter(c => c.ecr_number === row.ecr_number)
    .map(c => userMap.get(c.user_name)?.id)
    .filter(Boolean);

  if (ccUserIds.length > 0) {
    await ecrApi.cc(ecrId, ccUserIds);
  }
}
```

**导入后**：刷新 ECR 列表。

### 5.3 导入预览弹窗

```
共 N 条（新增 X / 更新 Y）
受影响对象 M 个（⚠️ W 个未找到），审批人 P 人（⚠️ Q 人未找到），知会人 R 人（⚠️ S 人未找到）
┌──────────────────────────────────────────────────────────────┐
│ 状态   │ ECR 编号        │ 标题       │ 受影响对象 │ 审批人 │
│ 🆕新增 │ ECR-2026-00001  │ 翼肋材料变更 │ 2         │ 3     │
│ ✏️更新 │ ECR-2026-00002  │ 航电升级    │ 1         │ 2     │
└──────────────────────────────────────────────────────────────┘
[取消]  [确认导入 (N 条)]
```

---

## 六、ECO 导入导出

### 6.1 导出

**触发**：ECO 列表页面顶部「📥 导出全部」按钮（权限：`canDownload()`）

**输出**：`ECO数据_YYYYMMDD.xlsx`，包含 6 个 Sheet：

**Sheet 1「ECO 清单」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 导入匹配键，格式 `ECO-YYYY-XXXXX` |
| 来源 ECR 编号 | `ecr_number` | 可空，导入按此匹配 ECR |
| 标题 | `title` | |
| 详细描述 | `description` | |
| 变更原因 | `reason` | |
| 优先级 | `priority` | `urgent` / `high` / `normal` / `low` |
| 变更类别 | `category` | `design_change` / `process_change` / `material_change` / `new_release` / `other` |
| 状态 | `status` | 仅导出参考，导入时统一设为 `draft` |
| 审批模式 | `review_mode` | `all` / `any` |
| 创建人 | `creator_name` | 用户名 |
| 执行负责人 | `executor_name` | 用户名，可空 |
| 创建时间 | `created_at` | 仅导出 |

**Sheet 2「执行明细」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 关联 Sheet1 |
| 来源 | `source` | `ecr` / `manual` |
| 实体类型 | `entity_type` | `part` / `assembly` |
| 实体编号 | `entity_code` | 导入匹配键 |
| 实体名称 | `entity_name` | |
| 操作类型 | `action` | `create` / `upgrade` / `qty_change` / `delete` / `no_change` |
| 执行状态 | `status` | 导出参考，导入时统一设为 `pending` |
| 执行顺序 | `sort_order` | |
| 目标用量 | `_targetQty` | 从 `detail` JSONB 提取 |
| 说明备注 | `_desc` | 从 `detail` JSONB 提取 |
| 所属受影响项编码 | `_affectedCode` | 从 `detail` JSONB 提取 |

**Sheet 3「审批人」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 关联 Sheet1 |
| 审批人用户名 | `user_name` | |
| 审批角色 | `role` | |
| 审批序号 | `seq` | |

**Sheet 4「知会人」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 关联 Sheet1 |
| 知会人用户名 | `user_name` | |

**Sheet 5「关联图文档」**：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 关联 Sheet1 |
| 图文档编号 | `doc_code` | |
| 图文档版本 | `doc_version` | |
| 类别 | `category` | |
| 排序 | `sort_order` | |

**Sheet 6「预变更零部件」**（`release_items` JSONB 展开）：

| 列名 | 字段 | 备注 |
|------|------|------|
| ECO 编号 | `eco_number` | 关联 Sheet1 |
| 实体类型 | `entity_type` | `part` / `assembly` |
| 实体编号 | `entity_code` | |
| 实体名称 | `entity_name` | |
| 实体版本 | `entity_version` | |
| 规格型号 | `spec` | |
| 状态 | `status` | |

**不导出**：审批记录、状态变更日志、`detail` JSONB 中含 UUID 的执行态字段（`entity_id`、`new_entity_id`、`parent_entity_id` 等）。

**导出实现**：
```typescript
async function exportECOs(): Promise<void> {
  const res = await ecoApi.list({ page_size: 10000 });
  const ecos = res.data.items;

  const details = await Promise.all(ecos.map(e => ecoApi.detail(e.id)));
  const execItemsMap = new Map(
    await Promise.all(details.map(async d => {
      const r = await ecoApi.getExecutionItems(d.data.id);
      return [d.data.id, r.data] as [string, any[]];
    }))
  );

  // 展开 detail JSONB 中的编辑态字段，剔除 UUID 引用
  const sheet2Rows = details.flatMap(d => {
    const items = execItemsMap.get(d.data.id) || [];
    return items.map(item => ({
      'ECO编号': d.data.eco_number,
      来源: item.source,
      实体类型: item.entity_type,
      实体编号: item.entity_code,
      ...
      目标用量: item.detail?._targetQty ?? '',
      说明备注: item.detail?._desc ?? '',
      所属受影响项编码: item.detail?._affectedCode ?? '',
    }));
  });

  downloadBlob(blob, `ECO数据_${todayStr()}.xlsx`);
}
```

### 6.2 导入

**触发**：ECO 列表页面顶部「📤 导入」按钮（权限：`canEdit()`）

**预览阶段（`previewECOsImport`）**：

```
解析 Sheet「ECO 清单」
  ├── 校验必填字段：ECO 编号、标题、变更原因
  ├── 按 eco_number 匹配已有 ECO → 标记 新增 / 更新
  ├── 校验来源 ECR（按 ecr_number 匹配，不存在则警告）
  ├── 解析 Sheet「审批人」→ 按用户名预查（不存在则警告）
  ├── 解析 Sheet「知会人」→ 按用户名预查（不存在则警告）
  ├── 解析 Sheet「执行明细」→ 按 entity_code 预查（不存在则警告）
  ├── 解析 Sheet「关联图文档」→ 按 code+version 预查（不存在则警告）
  └── 返回预览数据
```

**执行阶段（`executeECOsImport`）**：

**一次性加载**：全量用户 Map、全量 ECR Map（`ecr_number → id`）

**第一步：创建/更新 ECO 主记录（含审批人+图文档）**
```typescript
for (const row of validRows) {
  const reviewers = reviewerRows.filter(r => r.eco_number === row.eco_number)
    .map(r => ({ user_id: userMap.get(r.user_name)?.id, seq: r.seq }))
    .filter(r => r.user_id);

  const documentLinks = docRows.filter(d => d.eco_number === row.eco_number)
    .map(d => {
      const doc = store.documents.find(...);
      return doc ? { document_id: doc.id, category: d.category } : null;
    })
    .filter(Boolean);

  const ecrId = ecrNumberToIdMap.get(row.ecr_number) || null;
  const creatorUser = userMap.get(row.creator_name) || currentUser;
  const executorUser = row.executor_name ? userMap.get(row.executor_name) : null;

  const payload = {
    eco_number: row.eco_number,
    title: row.title,
    reason: row.reason,
    status: 'draft',
    review_mode: row.review_mode,
    priority: row.priority,
    category: row.category,
    ecr_id: ecrId,
    creator_id: creatorUser.id,
    executor_id: executorUser?.id || null,
    reviewers,
    document_links: documentLinks,
  };

  if (row.status === '更新') {
    await ecoApi.update(existingId, payload);
  } else {
    const res = await ecoApi.create(payload);
    row._newId = res.data.id;
  }
}
```

**第二步：处理执行明细（先清空再写入）**
```typescript
for (const row of validRows) {
  const ecoId = row._newId || existingId;

  if (row.status === '更新') {
    const existingItems = await ecoApi.getExecutionItems(ecoId);
    for (const item of existingItems.data || []) {
      await ecoApi.deleteExecutionItem(ecoId, item.id);
    }
  }

  for (const execRow of execRows.filter(e => e.eco_number === row.eco_number)) {
    const entity = store.parts.find(p => p.code === execRow.entity_code)
                || store.assemblies.find(a => a.code === execRow.entity_code);

    await ecoApi.addExecutionItem(ecoId, {
      source: execRow.source,
      entity_type: execRow.entity_type,
      entity_id: entity?.id || null,
      entity_code: execRow.entity_code,
      entity_name: execRow.entity_name,
      action: execRow.action,
      status: 'pending',       // 统一设为 pending，不可迁移执行进度
      sort_order: execRow.sort_order,
      detail: {
        _targetQty: execRow._targetQty || null,
        _desc: execRow._desc || null,
        _affectedCode: execRow._affectedCode || null,
        // 不写入含 UUID 的执行态字段
      },
    });
  }
}
```

**第三步：处理知会人（先清空再写入，同 ECR）**

**第四步：写入预变更零部件（`release_items`）**
```typescript
for (const row of validRows) {
  const ecoId = row._newId || existingId;
  const releaseItems = releaseRows
    .filter(r => r.eco_number === row.eco_number)
    .map(r => {
      const entity = store.parts.find(p => p.code === r.entity_code && p.version === r.entity_version)
                  || store.assemblies.find(a => a.code === r.entity_code && a.version === r.entity_version);
      if (!entity) return null;
      return {
        entity_type: r.entity_type,
        entity_id: entity.id,
        entity_code: entity.code,
        entity_name: entity.name,
        entity_version: entity.version,
      };
    })
    .filter(Boolean);

  if (releaseItems.length > 0) {
    await ecoApi.update(ecoId, { release_items: releaseItems });
  }
}
```

**导入后**：刷新 ECO 列表。

### 6.3 导入预览弹窗

```
共 N 条（新增 X / 更新 Y）
执行明细 M 条（⚠️ W 个实体未找到），审批人 P 人（⚠️ Q 人未找到），来源 ECR ⚠️ R 个未找到
┌──────────────────────────────────────────────────────────────────┐
│ 状态   │ ECO 编号        │ 标题    │ 来源ECR         │ 执行明细 │
│ 🆕新增 │ ECO-2026-00001  │ 翼肋升版 │ ECR-2026-00001 │ 5       │
│ ✏️更新 │ ECO-2026-00002  │ 航电替换 │ ⚠️未找到       │ 3       │
└──────────────────────────────────────────────────────────────────┘
[取消]  [确认导入 (N 条)]
```

---

## 七、界面设计

### 7.1 各页面按钮布局

```
构型项管理：[📥 导出全部] [📤 导入] [＋ 新建构型项]
构型配置：  [📥 导出全部] [📤 导入] [＋ 新建配置]
ECR 管理：  [📥 导出全部] [📤 导入] [＋ 新建 ECR]
ECO 管理：  [📥 导出全部] [📤 导入] [＋ 新建 ECO]
```

### 7.2 权限控制

| 操作 | admin | engineer | production | guest |
|------|:-----:|:--------:|:----------:|:-----:|
| 导出（所有模块） | ✅ | ✅ | ✅ | ❌ |
| 导入（所有模块） | ✅ | ✅ | ❌ | ❌ |

- 导出：`canDownload()`（admin + engineer + production）
- 导入：`canEdit()`（admin + engineer）

### 7.3 导入弹窗通用结构

1. 用户点击「📤 导入」→ `<input type="file" accept=".xlsx">` 触发文件选择
2. 解析文件 → 调用 `previewXxxImport(file)` → 显示预览弹窗
3. 用户确认 → 调用 `executeXxxImport(preview)` → loading 状态
4. 完成 → toast 提示（包含 warnings 数量）→ 关闭弹窗 → 刷新列表

复用现有 `ImportPreviewModal` 组件，扩展支持新的 `type` 值（`'configuration_item' | 'configuration_profile' | 'ecr' | 'eco'`）。

---

## 八、注意事项与边界

1. **导入不删除**：导入只做新增和更新，不会删除已有数据
2. **ECR/ECO 状态统一设为 draft**：审批记录无法跨环境迁移，导入后保留原状态会导致状态与审批数据不一致
3. **ECO 执行明细状态统一设为 pending**：执行进度（执行态 UUID 字段）不可迁移
4. **关联引用容错**：找不到的引用对象标记警告并跳过该条关联，不阻塞主数据导入
5. **ECR → ECO 导入顺序**：ECO 的来源 ECR 如果在本次导入中尚未创建，会标记"未找到"警告；建议先导入 ECR 再导入 ECO
6. **构型配置清单**：仅导出正式清单，不导出工作表；导入后工作表为空，用户编辑配置时系统自动重建
7. **N+1 问题**：导出时批量获取 detail，使用 `Promise.all()` 并发请求；数据量极大时可考虑分批
8. **浏览器兼容**：导出使用 `downloadBlob()`，无浏览器版本限制；导入使用 `<input type="file">`，无版本限制
9. **文件名约定**：`构型项数据_YYYYMMDD.xlsx`、`构型配置数据_YYYYMMDD.xlsx`、`ECR数据_YYYYMMDD.xlsx`、`ECO数据_YYYYMMDD.xlsx`

---

## 九、与现有导入导出方案的关系

| 模块 | 状态 | 本方案 |
|------|------|--------|
| 零件 | ✅ 已实施 | 不涉及 |
| 部件 | ✅ 已实施 | 不涉及 |
| 图文档 | ✅ 已实施 | 不涉及 |
| 构型项 | ❌ 无 | 第三章 |
| 构型配置 | ❌ 无 | 第四章 |
| ECR | ❌ 无 | 第五章 |
| ECO | ❌ 无 | 第六章 |

本方案与现有零件/部件/图文档导入导出保持一致的技术路线（前端侧实现、复用 `importExport.ts`）、界面规范（`ImportPreviewModal`）和权限控制（`canEdit` / `canDownload`）。

---

*v1.0 初稿: 2026-06-06*
*v2.0 重写: 2026-06-08 — 补充 API 调用细节、更新模式策略、伪代码实现*
