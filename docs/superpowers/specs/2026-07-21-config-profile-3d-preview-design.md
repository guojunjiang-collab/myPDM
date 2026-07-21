# 构型配置详情：3D 预览

日期：2026-07-21
状态：设计完成，待审批

## 背景

构型配置详情页（`ProfileEditModal`）展示「正式配置清单」，列出该配置方案下所有选中的零部件。需求：在正式配置清单区域添加「3D 预览」按钮，点击后在新标签页中以统一 3D 场景展示所有零部件的 STP 模型。

## 决策（已与用户确认）

- **展示形式**：新浏览器标签页，复用现有 `/stp-viewer` 路由，新增 `?config-profile={profileId}` 参数模式
- **场景布局**：所有零部件以单位变换矩阵加载到同一坐标系，STP 文件自带的绝对位置决定它们在场景中的空间关系（相当于"整机拆开展示"）
- **零部件版本**：以配置清单中指定的 `(part_master_id, version)` 定位 `PartRevision`，取其最新 `PartIteration` 的 `category='production'` 的 STP 附件
- **缺失模型处理**：无 STP 附件的零部件跳过，加载完成后提示「共 N 个零部件，已加载 M 个3D模型」
- **交互能力**：复用现有 STP 查看器全部交互（模型树面板、点击高亮、旋转/缩放、剖面、爆炸视图等）
- **模型树**：左侧面板显示配置清单的零部件列表（扁平列表，非装配 BOM 树）

## 改动详情

### 1. 后端：新增端点 `GET /api/configurations/profiles/{profile_id}/preview-3d`

**文件**：`backend/app/routers/configuration.py`

**权限**：`profile:read`（与配置详情页一致，admin/engineer/production 可访问，guest 不可）

**逻辑流程**：

1. 获取 `profile` 和对应的 `config_item`（与 `get_profile` 一致）
2. 获取 `working_items`，构建 `config_tree`
3. 递归遍历 `config_tree`，收集所有 `is_selected` 为 true 的零部件（跳过 `item_type == 'config_item'` 的构型项行）
4. 对每个零部件，按 `(part_master_id, version)` 查询 `PartRevision`：
   ```python
   rev = db.query(PartRevision).filter(
       PartRevision.master_id == UUID(item_id),
       PartRevision.version == item_version,
       PartRevision.deleted_at.is_(None),
   ).first()
   ```
5. 取该 revision 的最新 `PartIteration`（`latest_iteration` 字段 + join `PartIteration` 表）
6. 在迭代的附件中查找 `category='production'` 且 `is_stp_file()` 为 True 的 `PartAttachment`
7. 有附件 → 复用 `_glb_url_resolver_factory` 逻辑生成 LOD 三级 `glb_urls`（含媒体令牌）
8. 无附件 → 记入 `missing` 列表
9. 所有实例使用单位矩阵（`[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]`）

**返回结构**：

```json
{
  "profile_code": "CP-2026-001",
  "profile_name": "标准配置方案",
  "total_count": 15,
  "loaded_count": 12,
  "instances": [
    {
      "part_code": "ABC-001",
      "part_name": "底座",
      "version": "A",
      "revision_id": "uuid",
      "glb_urls": {
        "coarse": "/api/v2/attachments/{att_id}/gltf?token=...",
        "normal": "/api/v2/attachments/{att_id}/gltf?token=...",
        "fine": "/api/v2/attachments/{att_id}/gltf?token=..."
      },
      "matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    }
  ],
  "missing": [
    { "part_code": "XYZ-001", "part_name": "盖板", "version": "B", "reason": "无STP生产附件" }
  ],
  "tree": [
    { "bom_item_id": "instance-0", "part_code": "ABC-001", "part_name": "底座",
      "version": "A", "quantity": 1, "instance_count": 1, "is_leaf": true, "children": [] }
  ]
}
```

**实现要点**：
- 复用 `_glb_url_resolver_factory`（`parts.py` 第1070行）构建 glb URLs，避免重复逻辑
- `instances` 结构兼容现有的 `AssemblyInstance` 接口（`glb_urls` + `matrix` + `part_code`）
- `tree` 结构兼容现有的 `AssemblyTreeNode` 接口
- 对于配置清单中无版本信息的零部件（极端情况），使用 `list_revisions_by_master` 取最新非删除版本

### 2. 前端：STPViewer 扩展 config 模式

#### 2.1 入口按钮（`frontend/src/components/Configuration/ProfileEditModal.tsx`）

- 在正式配置清单表格上方（与「导出 PDF」按钮同区域）添加「3D 预览」按钮
- 仅当 `configTree` 存在且有至少一个零部件时显示
- 点击：`window.open('/stp-viewer?config-profile={profileId}', '_blank')`

#### 2.2 STPViewer 页面扩展（`frontend/src/pages/STPViewer.tsx`）

新增 URL 参数识别：`const configProfileId = params.get('config-profile');`

新增分支逻辑（约第 46 行 `useEffect` 中，在 `assemblyRevId` 之后）：

```typescript
if (configProfileId) {
  loadConfigProfilePreview(configProfileId);  // 调用新 API
  return;
}
```

#### 2.3 新增服务函数（`frontend/src/services/api.ts`）

```typescript
export interface ConfigProfilePreviewData {
  profile_code: string;
  profile_name: string;
  total_count: number;
  loaded_count: number;
  instances: AssemblyInstance[];      // 复用 AssemblyInstance 接口
  missing: { part_code: string; part_name: string; version: string; }[];
  tree: AssemblyTreeNode[];           // 复用 AssemblyTreeNode 接口
}

export const configurationProfileApi = {
  // ... 现有方法 ...
  preview3d: (profileId: string) =>
    api.get<ConfigProfilePreviewData>(`/configurations/profiles/${profileId}/preview-3d`).then(r => r.data),
};
```

#### 2.4 ViewerCanvas 扩展（`frontend/src/components/STPViewer/ViewerCanvas.tsx`）

`ViewerSource` 类型保持不变，config 模式获取的数据（`instances` + `tree`）直接映射为 `{ kind: 'assembly', instances, tree }`，现有 `AssemblyModelLoader` 无需修改即可渲染。

**坐标系统处理**：`AssemblyModelLoader` 第 48 行对装配根 `rootGroup` 应用全局 Z-up→Y-up 旋转，这是因为装配体 CAD 实例矩阵是 STEP 坐标系（Z-up）。config 模式下所有实例使用单位矩阵，且单个 GLB 文件经 Mayo 转换后已是 glTF 标准 Y-up 坐标系（与 `ModelLoader` 单件模式一致，不额外旋转）。因此需为 `AssemblyModelLoader` 添加 `applyZUp?: boolean` prop，默认为 `true`（兼容现有装配模式），config 模式传 `false`，跳过根 group 的 `Z_UP_TO_Y_UP` 旋转。

### 3. 前端：加载状态与提示

- STPViewer 页面顶部显示 profile_name 和「配置清单 3D 预览」标题
- 使用现有 `viewerStore.loadingState` 展示加载进度
- 加载完成后在左侧模型树面板显示零部件扁平列表（按 code 排序）
- Toast 提示：「共 N 个零部件，已加载 M 个3D模型」（仅当 `missing.length > 0` 时显示）
- 缺失模型的零部件在模型树中以灰色斜体显示，不可选中/高亮

### 4. 权限

- 后端端点权限：`require_permission("profile:read")`
- 前端按钮：`can('profile:read')` 控制可见性
- 媒体令牌：3600s TTL，与装配体模式一致

## 不改动

- `AssemblyModelLoader` 核心逻辑（仅在必要时增加 `applyZUp` prop）
- `ViewerCanvas` 核心渲染管线
- `ModelTreePanel`、`Toolbar` 等查看器子组件
- `ProfileEditModal` 的主要布局结构
- 现有单件/装配体预览流程

## 验证

1. `npm run build` 通过（前端）
2. 打开一个有多个零部件、部分含 STP 附件的构型配置详情页
3. 点「3D 预览」→ 新标签页打开 STPViewer，加载配置清单3D模型
4. 验证：模型树面板显示零部件列表、有附件的零部件正确渲染在场景中、点击可高亮
5. 验证：无 STP 附件的零部件在模型树灰显、Toast 提示数量差异
6. 验证：旋转/缩放/剖面/爆炸视图等工具栏功能正常
7. 验证：权限控制正确（guest 角色看不到按钮、API 返回 403）
