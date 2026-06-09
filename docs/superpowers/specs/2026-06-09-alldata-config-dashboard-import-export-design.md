# 全部数据导入导出：补充构型项/构型配置 + 修复用户看板构型项支持

日期：2026-06-09
状态：已批准，待实现

## 背景

系统设置页的数据区提供 `导出全部数据` / `导入全部数据`（`exportAllData` / `importAllData`，位于 `frontend/src/services/importExport.ts`）。

当前覆盖范围：自定义字段、用户、用户看板、图文档、零件、部件。

缺口：
1. 全部导出/导入**不包含构型项、构型配置**（这两类已有独立的导出/导入函数和构型管理页按钮，但未纳入全量流程）。
2. 用户看板导入导出**缺少 `configuration`（构型项）实体类型的中文标签映射**——`ENTITY_TYPE_TO_ZH` / `ENTITY_TYPE_FROM_ZH` 只有 part/assembly/document。导出含构型项的文件夹时"实体类型"列写成英文 `configuration`，且手工用中文"构型项"编辑后导入无法识别。

## 目标

- 将构型项、构型配置纳入 `导出全部数据` / `导入全部数据`。
- 修复用户看板对构型项实体类型的支持。
- 不新增独立按钮（构型管理页已有单独的导入/导出）。
- 不改后端（后端 `/dashboard/export-all`、`/dashboard/import-all` 已支持 `configuration`，按编号解析）。

## 改动详情（全部在前端）

### 1. 用户看板构型项标签映射（修复）

文件：`frontend/src/services/importExport.ts`（约 154-163 行）

- `ENTITY_TYPE_TO_ZH` 增加 `configuration: '构型项'`
- `ENTITY_TYPE_FROM_ZH` 增加 `'构型项': 'configuration'`

效果：含构型项的文件夹导出后"实体类型"列显示"构型项"，导入正确还原；手工编辑用中文也能识别。后端无需改动。

### 2. 构型项/构型配置：新增写入目录的变体

重构现有 `exportConfigurationItems()` / `exportConfigurationProfiles()`：

- 抽出工作簿构建逻辑为 `_buildConfigItemsWorkbook()` / `_buildConfigProfilesWorkbook()`（返回 `XLSX.WorkBook`，无数据返回 null 或抛错由调用方决定）。
- 保留原下载函数（构型管理页按钮、单文件下载命名仍带日期 `构型项数据_日期.xlsx` / `构型配置数据_日期.xlsx`），内部改为调用 build helper。
- 新增内部函数 `exportConfigItemsToDir(dirHandle)` / `exportConfigProfilesToDir(dirHandle)`：构建工作簿并以**固定文件名**写入目录——`构型项.xlsx`、`构型配置.xlsx`。无数据时静默跳过（不抛错）。

### 3. `exportAllData` 追加构型项/构型配置

在现有导出末尾（部件之后）追加：

```
... 部件
→ 构型项（exportConfigItemsToDir）：有数据则导出，onProgress 报告条数；无数据 onProgress('构型项: 无数据，跳过')
→ 构型配置（exportConfigProfilesToDir）：同上
```

导出顺序不影响正确性。

### 4. `importAllData` 追加构型项/构型配置

在 **部件导入之后、用户看板导入之前** 插入：

```
... 部件
→ 构型项：_readXlsxAsFile(dir, '构型项.xlsx') → previewConfigurationItemsImport(file) → executeConfigurationItemsImport(preview)；无文件跳过
→ 构型配置：_readXlsxAsFile(dir, '构型配置.xlsx') → previewConfigurationProfilesImport(file) → executeConfigurationProfilesImport(preview)；无文件跳过
→ 用户看板（最后）
```

最终导入顺序：自定义字段 → 用户 → 图文档 → 零件 → 部件 → **构型项 → 构型配置** → 用户看板。

依赖关系：构型项引用零件/部件/图文档（故在其后）；构型配置引用构型项（故在构型项后）；用户看板文件夹可能关联构型项（故最后）。

### 5. Settings.tsx 文案

文件：`frontend/src/pages/Settings.tsx`

- `导出全部数据` 说明补"构型项、构型配置"。
- `导入全部数据` 说明的文件清单补 `构型项.xlsx`、`构型配置.xlsx`。

## 不改动

- 后端任何代码。
- 构型管理页 / 用户看板页的独立导入导出按钮。
- 单文件下载命名（仍带日期）。

## 验证

1. `npx tsc --noEmit` 通过。
2. 准备含构型项、构型配置、且看板文件夹关联了构型项的环境，点"导出全部数据"到一个文件夹，确认生成 `构型项.xlsx`、`构型配置.xlsx`，且 `用户看板.xlsx` 的"实体类型"列对构型项显示"构型项"。
3. 清库后点"导入全部数据"选该文件夹，确认构型项、构型配置、看板（含构型项关联）全部正确还原。
4. 构型管理页、用户看板页的独立导入导出按钮仍正常。
