# AGENTS.md - myPDM 项目开发指南

> **角色**: 你是负责本项目开发的 AI 开发助手。
> **用户**: 产品经理，专注 BOM/PDM 系统开发。
> **工作空间**: D:\OpenCode\myPDM

---

## 📋 顶层要求引用

本文件**引用** `D:\OpenCode\AGENTS.md` 的顶层通用要求，作为本项目开发的基础约束，包括但不限于：

- **身份与工作模式**: Sisyphus 工程师角色，"Work, delegate, verify, ship"、全程中文交流
- **硬性禁止**: 无类型妥协（禁 `as any`/`@ts-ignore`）、无空捕获、无测试删除、无猜测代码、无提前交付、无硬编码密钥
- **不可逆操作确认**: `rm -rf` / `DROP TABLE` / `git push --force` / `git reset --hard` / 提交未请求的代码 / 推送远程 必须先确认
- **验证要求**: 代码编辑后检查诊断、构建 exit code 为 0、测试通过、委托任务逐项验收
- **Git 工作流**: Conventional Commits 提交格式（`<type>(<scope>): <description>`）、提交/推送前用户确认
- **安全要求**: 禁止提交 `.env`/密钥/凭证，输入与服务端双重校验，HTTPS + JWT 令牌过期

**冲突时项目级规则优先**（见文末"配置层级"）。

---

## 📋 项目概述

### 基本信息

| 属性   | 値                                   |
| ---- | ----------------------------------- |
| 项目名称 | 网页版 BOM 管理工具 (PDM 系统)               |
| 项目类型 | 前后端分离 Web 应用                        |
| 版本   | v3.3.2                              |
| 架构   | React SPA + RESTful API (Docker 部署) |
| 语言   | TypeScript + Python                 |

### 核心功能

- **零部件管理**: 三层结构（物料 PartMaster → 版本 PartRevision → 迭代 PartIteration），检出/检入/级联检出、冻结/发布/作废、版本升级（A→B→…→ZZ 序列）、自定义字段、软删除、装配 STEP 导入与 BOM 匹配
- **CAD 工作台**: 浏览器内嵌 CAD 工作台 + 本地 CAD 桥接服务（`cad_bridge`，COM 调用 CATIA/SolidWorks）——装配结构读取、属性读写、字段映射下发、源文件直传、STP 导出上传、工程图转 PDF 上传、CAD→PDM BOM 匹配与实例同步
- **图文档管理**: 三层结构（DocumentMaster → DocumentRevision → DocumentIteration），检出/检入、附件管理、PDF/Office/Markdown 在线预览
- **BOM 管理**: BOM 树、BOM 对比、Where-Used 反查（零部件/图文档/配置项/ECR/ECO/项目任务）
- **ECR/ECO 变更管理**: 工程变更请求/变更单全生命周期（创建→提交→审批→执行→关闭），ECN 规划中
- **构型管理**: 配置项与配置概要管理（BOM 配置对比、审批流、PDF 导出）
- **库存管理**: 仓库/物料/库存/单据管理（入库/出库/盘点）
- **项目管理**: 项目任务管理（甘特图、任务依赖、日期自动汇总）、**交付物汇总**（零部件/文档/构型项/变更 Excel 导出）、WBS 模板
- **通知中心**: 站内通知（变更/构型/库存/项目/审批请求）、未读数、已读/全部已读/清理
- **第三方登录**: 多路飞书（多企业免登）+ 微信 PC 扫码登录，支持账号绑定/解绑
- **用户组管理**: 用户组与文档共享权限
- **用户看板**: 用户自定义文件夹式数据看板（支持共享）
- **附件管理**: 上传/下载/PDF 预览/STP 三维预览（含 LOD 多级细节）/Office 预览/压缩包浏览
- **AI 助手**: DeepSeek 驱动的自然语言交互（SSE 流式、工具编排、文档生成）
- **数据导入导出**: 零部件/文档/自定义字段 Excel 批量导入导出
- **数据同步**: 跨环境数据同步 API
- **操作日志**: 全量操作审计追踪（仅管理员可见）
- **数据管理**: 软删除查看与清理（仅 admin）
- **系统设置**: CAD 附件命名前缀配置（PDF/装配/STP）
- **帮助文档**: 内置使用说明与第三方登录配置指南

---

## 🏗️ 技术栈

### 后端

| 类别        | 技术                                     |
| --------- | -------------------------------------- |
| 框架        | FastAPI                                |
| ASGI 服务器  | Uvicorn（开发环境 `--reload`）               |
| ORM       | SQLAlchemy 2.0                         |
| 数据验证      | Pydantic 2.x                           |
| 认证        | JWT (python-jose + passlib/bcrypt)     |
| 数据库       | PostgreSQL 16                          |
| 缓存        | Redis 7                                |
| 文件存储      | 本地文件系统 (`./uploads/`)                  |
| 3D 转换     | MayoConv (STP → glTF/glb via AppImage) |
| Office 转换 | LibreOffice (Office → PDF 在线预览)        |
| AI 模型     | DeepSeek (OpenAI 兼容接口)                 |
| 文档生成      | python-docx, openpyxl, pypdf           |
| 第三方登录     | httpx（飞书 OpenAPI / 微信开放平台 OAuth2）      |
| 压缩包解析     | rarfile, py7zr                         |
| 测试        | pytest                                 |

**依赖文件**: `backend/requirements.txt`

### 前端

| 类别       | 技术                                                |
| -------- | ------------------------------------------------- |
| 框架       | React 18 + TypeScript                             |
| 构建工具     | Vite 5                                            |
| 样式       | Tailwind CSS 3 + @tailwindcss/typography          |
| 路由       | React Router 6                                    |
| 状态管理     | Zustand (persist 持久化)                             |
| HTTP 客户端 | Axios                                             |
| 3D 渲染    | Three.js + @react-three/fiber + @react-three/drei |
| Markdown | react-markdown + remark-gfm + marked + rehype-raw |
| 数学公式     | katex                                             |
| 配置解析     | js-yaml                                           |
| 电子表格     | xlsx                                              |
| 日期       | dayjs                                             |
| 测试       | Vitest（node 环境，`src/**/*.test.ts`）                |

**源码目录**: `frontend/`
**构建输出**: `frontend/dist/`

### 基础设施

| 服务         | 容器名          | 端口                                                                                  |
| ---------- | ------------ | ----------------------------------------------------------------------------------- |
| Nginx      | bom_nginx    | 443 HTTPS (映射 `${NGINX_HOST_PORT:-8080}`) + 80 (映射 `${NGINX_HTTP_HOST_PORT:-8081}`) |
| FastAPI    | bom_backend  | 8000（开发挂载卷 + `--reload`）                                                            |
| PostgreSQL | bom_postgres | 5432                                                                                |
| Redis      | bom_redis    | 6379                                                                                |

---

## 📂 项目结构

```
D:\OpenCode\myPDM\
├── frontend/                     # React + Vite 前端项目
│   ├── src/
│   │   ├── App.tsx               # 根组件（路由定义）
│   │   ├── main.tsx              # 入口（document.title 支持 VITE_APP_TITLE 自定义）
│   │   ├── index.css             # Tailwind 全局样式
│   │   ├── components/           # 可复用组件
│   │   │   ├── Layout.tsx        # 导航布局（侧边栏+顶栏，含通知铃铛）
│   │   │   ├── Modal.tsx / Toast.tsx / Loading.tsx / CustomFieldInput.tsx
│   │   │   ├── CheckinNoteModal.tsx / CcPicker.tsx   # 签入说明 / 知会用户（共享弹窗）
│   │   │   ├── ui/               # 共享 UI 基座（Button/Input/Select/Badge/Textarea/TreeToggle + Tabs/Alert/Dropdown/FormModal/FormField/ModalFooter/FilterBar/EntityPickerModal）
│   │   │   ├── NotificationBell.tsx
│   │   │   ├── BOMTreeTable.tsx / ArchiveTreeModal.tsx / PartCompareModal.tsx
│   │   │   ├── EntityEditModal.tsx / EntityDocumentSection.tsx / ImportPreviewModal.tsx
│   │   │   ├── VersionHistory.tsx / VersionSelectModal.tsx
│   │   │   ├── PartDetailContent.tsx / AssemblyDetailContent.tsx / DocumentDetailContent.tsx
│   │   │   ├── AssemblyPartPicker.tsx / DocumentPicker.tsx（EntityPickerModal 薄封装）/ ECPicker.tsx
│   │   │   ├── PartAttachmentBucket.tsx / ComponentAttachmentBucket.tsx
│   │   │   ├── FeishuBindPanel.tsx / WechatBindPanel.tsx
│   │   │   ├── PartDetailModal/   # 零部件详情弹窗（BOM/附件/文档/Where-Used Tab）
│   │   │   │   └── PartWhereUsedTab.tsx
│   │   │   ├── DocumentDetailModal/  # 图文档详情弹窗
│   │   │   │   └── DocWhereUsedTab.tsx
│   │   │   ├── CADWorkspace/     # CAD 工作台（ConnectStep/BOMMatchTable/CompleteStep）
│   │   │   ├── assistant/       # AI 助手组件（FloatingAssistant/ChatInput/MessageList/Markdown + cards/）
│   │   │   ├── Configuration/   # 构型管理组件（ConfigItemPicker/ConfigList/ProfileList/ProfileCompare 等）
│   │   │   ├── ECO/             # ECO 组件（ECOList/ECOCreateModal/ECODetailModal/ECOExecutionPanel 等）
│   │   │   ├── ECR/             # ECR 组件（ECRList/ECRCreateModal/ECRDetailModal/ECRReviewPanel 等）
│   │   │   ├── Inventory/       # 库存组件（WarehouseTab/MaterialTab/StockTab/DocumentTab 等）
│   │   │   └── STPViewer/       # STP 3D 查看器组件（模型树/剖切/测量/爆炸/高亮/ViewCube）
│   │   ├── pages/               # 页面组件
│   │   │   ├── Login.tsx / FeishuCallback.tsx / WechatCallback.tsx
│   │   │   ├── PendingApproval.tsx      # 待审批用户（unverified 角色）
│   │   │   ├── ForcePasswordChange.tsx  # 强制修改密码
│   │   │   ├── Dashboard/        # 仪表盘（tiles 化重写，MyTasksTile/MyTodosTile）
│   │   │   ├── Board.tsx         # 用户看板
│   │   │   ├── PartsPage.tsx     # 零部件管理（替代原 ComponentsPage，含 CAD 工作台入口）
│   │   │   ├── Documents.tsx     # 图文档管理（三层版本 + 检出状态）
│   │   │   ├── EC.tsx / ECN.tsx  # ECR/ECO 工程变更（ECN 未启用）
│   │   │   ├── Configuration.tsx # 构型管理
│   │   │   ├── Inventory.tsx     # 库存管理
│   │   │   ├── Project/          # 项目管理（Projects/DeliverableModal/MemberManageModal/TaskEditModal/gantt/）
│   │   │   ├── BOM/              # BomWhereUsedTree.tsx（Where-Used 树）+ helpers/types
│   │   │   ├── Users.tsx / Logs.tsx / Notifications.tsx / Settings.tsx
│   │   │   ├── DataManagement.tsx / Help.tsx
│   │   │   ├── STPViewer.tsx / OfficeReader.tsx / MarkdownReader.tsx  # 懒加载阅读器
│   │   ├── services/            # API 客户端
│   │   │   ├── api.ts           # 主 API 客户端（authApi/partsApi/documentsApi/bomApi 等）
│   │   │   ├── assistantApi.ts / inventoryApi.ts / projectApi.ts / notificationApi.ts
│   │   │   ├── cadBridge.ts     # CAD 桥接 WebSocket 客户端
│   │   │   ├── syncApi.ts / syncService.ts
│   │   │   ├── importExport.ts / deliverableExport.ts
│   │   │   ├── ecPdfExport.ts / ecMarkdownExport.ts / configProfilePdfExport.ts
│   │   ├── stores/              # Zustand 状态管理
│   │   │   ├── auth.ts / data.ts / assistant.ts / inventory.ts
│   │   │   ├── project.ts / pageHeader.ts / notification.ts
│   │   │   └── viewerStore.ts   # 3D 查看器状态
│   │   ├── hooks/               # 自定义 Hooks
│   │   │   ├── useAssistantChat.ts / useCADBridge.ts / useCommon.ts
│   │   │   ├── useDebounced.ts / usePersistedTabState.ts
│   │   │   └── useResizable.ts / useTableSort.ts / useHeaderTabs.tsx
│   │   ├── types/               # TypeScript 类型（index.ts / assistant.ts / project.ts）
│   │   ├── constants/           # index.ts（APP_VERSION=v3.3.2 / 状态/角色/分页）+ permissions.generated.ts
│   │   ├── lib/                 # 工具库（date/file/utils/feishu/wechat/notification/profileCompare）
│   │   └── utils/               # date.ts / attachmentPreview.ts
│   ├── public/draco/            # Draco 解压 (glTF 压缩)
│   ├── index.html / vite.config.ts / tailwind.config.js / tsconfig.json / package.json
├── backend/                     # FastAPI 后端
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（22 个路由注册 + 启动自动迁移）
│   │   ├── database.py          # 数据库 + Redis 连接
│   │   ├── models.py            # 核心模型（User/UserFeishuBinding/UserWechatBinding/BOMItem/OperationLog/
│   │   │                       #   DocumentMaster/Revision/Iteration/Attachment/CustomField*/Dashboard*/UserGroup*）
│   │   ├── models_parts.py      # 零部件三层模型（PartMaster/PartRevision/PartIteration/PartAttachment）
│   │   ├── models_ecr.py / models_eco.py / models_configuration.py / models_inventory.py
│   │   ├── models_project.py / models_notification.py
│   │   ├── schemas*.py          # Pydantic Schema（含 schemas_parts.py / schemas_notification.py）
│   │   ├── crud.py / crud_parts.py / crud_documents.py / crud_dashboard.py / crud_deliverables.py
│   │   ├── crud_ecr.py / crud_eco.py / crud_configuration.py / crud_inventory.py / crud_project.py / crud_groups.py
│   │   ├── file_storage.py      # 文件存储服务（分块上传 5MB/块）
│   │   ├── stp_converter.py / stp_to_gltf.py   # STP → glTF 转换（含 LOD 多级细节）
│   │   ├── office_converter.py / media_token.py
│   │   ├── feishu_client.py     # 飞书 OpenAPI 客户端（多 provider 多企业）
│   │   ├── wechat_client.py     # 微信开放平台 OAuth2 客户端（PC 扫码）
│   │   ├── notifications.py     # 站内通知服务（create_notifications 统一入口）
│   │   ├── permissions/         # 权限系统（__init__.py / _generated.py / policies.py）
│   │   ├── routers/             # API 路由（22 个）
│   │   │   ├── auth.py          # JWT 认证（登录/令牌/修改密码/当前用户）
│   │   │   ├── feishu.py        # 飞书认证（/auth/feishu/*，多 provider + 绑定 + jsapi）
│   │   │   ├── wechat.py        # 微信认证（/auth/wechat/*，扫码 + 绑定）
│   │   │   ├── users.py / user_groups.py
│   │   │   ├── parts.py         # 零部件（三层 CRUD + 检出检入 + CAD BOM 匹配 + 装配 STEP 导入 + Where-Used）
│   │   │   ├── bom.py           # BOM 树/对比/反查/引用/导出
│   │   │   ├── documents.py     # 图文档（三层 CRUD + 检出检入 + 附件 + Where-Used）
│   │   │   ├── attachments_v2.py# V2 附件（multipart/分块/预览/stream/gltf/LOD）
│   │   │   ├── dashboard.py / custom_fields.py
│   │   │   ├── ecrs.py / ecos.py / configuration.py
│   │   │   ├── inventory.py / projects.py / notifications.py
│   │   │   ├── sync.py / admin.py / assistant.py / logs.py
│   │   │   └── settings.py      # 系统设置（CAD 命名前缀）
│   │   ├── cad/                 # CAD 后端工具
│   │   │   ├── assembly_parser.py   # 装配 STEP 解析
│   │   │   ├── matrix_utils.py      # 实例变换矩阵
│   │   │   └── step_splitter.py     # STEP 拆分
│   │   ├── assistant/           # AI 助手引擎（agent/api_gateway/llm_client/tools/knowledge/
│   │   │                       #   attachment_reader/document_builder/skills_loader/sanitizer/system_prompt.md/skills/）
│   │   └── bom/                 # compare.py（BOM 对比算法）/ archive_reader.py（压缩包读取）
│   ├── Dockerfile               # Python 3.12-slim, MayoConv AppImage, LibreOffice
│   └── requirements.txt
├── cad_bridge/                  # 本地 CAD 桥接服务（独立 Python 应用，PyInstaller 打包）
│   ├── server.py                # WebSocket 服务（ws://127.0.0.1:9527）
│   ├── pdm_client.py            # PDM HTTP 客户端（JWT 透传）
│   ├── launcher.py / build_exe.py / cad_bridge.spec
│   ├── catia/                   # CATIA COM 实现（含 field_mapping.json）
│   ├── solidworks/              # SolidWorks COM 实现（含 field_mapping.json）
│   └── tests/ / README.md
├── nginx/nginx.conf             # HTTPS + HTTP 双入口, 限流(login 10r/s, api 100r/s), SSE, 1G 上传
├── certs/                       # SSL 自签名证书
├── initdb/                      # init.sql / test_data.sql / migrations/（增量迁移 001-013）
├── permissions/permissions.json # 权限矩阵单一事实源（172 行，5 个角色，~140 权限项）
├── tools/gen_permissions.py     # 从 permissions.json 生成后端+前端权限代码
├── keys/                        # 授权公钥（private_key.pem / public_key.b64）
├── licenses/                    # 授权文件（*.lic，gitignored）
├── docs/                        # 设计文档 + 微信登录指南.md + 飞书免登配置指南.md
├── uploads/                     # 上传文件存储目录
├── docker-compose.yml
├── Dockerfile.nginx
├── .env / .env.example          # 环境变量（端口/路径/AI/飞书多路/微信/安全密钥）
└── 项目说明/                     # 项目文档（中文）
```

---

## 📋 代码规范

### 后端 (Python)



**Python 特定规则**:

- **类型注解**: 必须使用 Type Hints（函数参数、返回值）
- **Pydantic**: 用于 API 请求/响应验证
- **SQLAlchemy 2.0**: 使用新版 Declarative API
- **异常处理**: 使用 `HTTPException` 而非裸 raise
- **模型文件**: 核心模型在 `models.py`，领域模块独立文件（`models_parts.py` / `models_ecr.py` / `models_eco.py` / `models_configuration.py` / `models_inventory.py` / `models_project.py` / `models_notification.py`），Schema 和 CRUD 同理

### 前端 (React + TypeScript)

- **组件**: `src/components/` 下每个组件一个文件，使用 `export default`，领域组件分目录（如 `ECO/`, `STPViewer/`, `CADWorkspace/`）
- **页面**: `src/pages/` 下按功能命名，路由组件
- **类型**: 统一在 `src/types/` 定义（`index.ts` 为通用类型，`assistant.ts` 为 AI 类型，`project.ts` 为项目类型）
- **状态管理**: Zustand store 放在 `src/stores/`（支持 persist 持久化）
- **API 调用**: 按领域分文件（`api.ts` 主客户端，`inventoryApi.ts` / `assistantApi.ts` / `notificationApi.ts` / `syncApi.ts` 等）
- **样式**: Tailwind CSS 原子类，避免自定义 CSS
- **排序图标**: 可排序列表头添加 `cursor-pointer select-none whitespace-nowrap`

---

## 🎨 弹窗与 UI 统一规范（2026-08 弹窗统一整改后）

> 桌面端全部弹窗已统一走共享组件（分支 feat/modal-unification，19 提交）。**新增弹窗/表单必须复用下列组件，禁止新写自绘弹窗骨架**；设计文档 `docs/superpowers/specs/2026-08-23-modal-style-unification-design.md`。

### 共享组件清单

| 组件 | 路径 | 用途 |
| --- | --- | --- |
| `Modal` + `MODAL_Z` | `components/Modal.tsx` | 弹窗基座（唯一入口），导出 `Modal` / `ConfirmModal` / `MODAL_Z` |
| `ConfirmModal` | 同上 | 确认弹窗：`type: danger/warning/info`（danger/warning→红色、info→primary）、可选 `children`（自定义内容如密码输入）、`confirmLoading` |
| `FormModal` | `components/ui/FormModal.tsx` | 表单弹窗：`title/width/height/onSubmit/saving/error/footerLeft`；saving 时按钮「保存中…」+disabled；error 自动渲染 Alert danger；footer 走 `ModalFooter` |
| `FormField` | `components/ui/FormField.tsx` | 表单项：`label/required/error/hint/children`，可选 `card` 模式 |
| `ModalFooter` | `components/ui/ModalFooter.tsx` | 底部按钮区（`justify-end gap-2 pt-4 border-t border-[var(--ui-border)]`） |
| `EntityPickerModal` | `components/ui/EntityPickerModal.tsx` | 添加类选择器骨架：已选面板（顶部常驻）+ 搜索/筛选 + 快速新建 + 候选表格（操作列「添加」无多选框、已添加 disabled）+ footer；多类型模式 typeTabs + 类型徽标；`filterParams` 触发重拉、`selectedExtra` 已选面板额外列、300ms 搜索防抖内置 |
| `CheckinNoteModal` | `components/CheckinNoteModal.tsx` | 签入说明弹窗（`open/note/onChange/onConfirm/onCancel/saving`） |
| `CcPicker` | `components/CcPicker.tsx` | 知会用户弹窗（`open/entityId/onClose/api?`，ECR/ECO 共用，ECO 传 `api` 覆写） |
| `Tabs` / `Alert` / `Dropdown` / `FilterBar` | `components/ui/` | 详情弹窗 Tab；提示块（`tone: info/success/warning/danger`，`InlineError` 别名用于表单内错误）；触发器菜单；筛选工具栏 |

### Modal 契约

- **层级**：`MODAL_Z = { base: 50, picker: 60, overlay: 70 }`——普通弹窗 50、Picker 60、内嵌浮层（Dropdown 等）70；**禁止硬编码 zIndex 字面量**（一律走 MODAL_Z 档位）
- **宽度语义**（widthMap）：`sm`≈确认/简单输入、`md`≈表单/确认、`lg`≈简单表单、`xl`≈Picker/详情、`full`≈复杂详情、`3xl`≈复杂详情/大表、`max`≈全屏工作台
- **高度**：内容类详情弹窗 `height="75vh"`、对比类 90vh、全屏工作台 85vh；设置后内容区自动滚动
- **交互契约**（内置，勿自实现）：滚动锁（模块级计数器，多弹窗叠加最后关闭才恢复 body 滚动）、Esc 仅栈顶弹窗响应、打开聚焦面板/关闭还原焦点、300ms 淡出
- **标题栏**：`headerAction` 放标题右侧操作按钮（如「导出 PDF」），位于关闭按钮左侧

### 表单与标签规范

- 表单统一 `FormField`：label `block text-xs text-[var(--ui-text-secondary)] mb-0.5`；必填红色星号 `<span className="text-red-500">*</span>`
- 节标题（分区小标题）：`text-[var(--ui-text-secondary)] font-semibold text-sm`（禁止 `text-gray-700 font-bold` 旧写法）
- 新建表单统一简单表单（仅件号+名称等核心字段）；复杂表单保持现状不再重构

### 错误与反馈规范

- 表单内校验错误：`FormField error` 或 `Alert` danger（弹窗内 `mb-4`）
- 操作结果反馈：一律 `toast`（`success` 3000ms / `error` 5000ms / `warning` 4000ms / `info` 3000ms）；批量成功「已保存 N 个」→ `toast.success`
- 确认类操作：状态驱动 `setConfirmXxx` + 渲染 `ConfirmModal`（禁止内联条件弹窗）

### 原生弹窗禁令

- **桌面端**（`frontend/src/` 非 mobile）：禁止 `alert(` / `confirm(`——一律 `toast` + `ConfirmModal`（验收标准：桌面端 grep 0 残留）
- **移动端**（`frontend/src/mobile/`）：豁免，保留 `window.alert/confirm`（范围外，勿改动）

### 主题变量（四主题：light / forest / warm / dark）

- 边框 `--ui-border`、次级文本 `--ui-text-secondary`、弱文本 `--ui-text-tertiary`、底色 `--ui-bg-subtle` / `--ui-bg-hover` 随主题切换；**桌面端禁止写死 `border-gray-100`**（已全局替换为 `border-[var(--ui-border)]`）
- 深色主题无 `--color-primary`：主色一律 Tailwind `primary-600`（#0284c7）

---

## 🔐 权限模型

### 用户角色

| 角色   | 标识           | 说明                 |
| ---- | ------------ | ------------------ |
| 管理员  | `admin`      | 全部功能，用户管理, 软删除管理   |
| 工程师  | `engineer`   | 创建/编辑，CRU 大部分资源    |
| 生产人员 | `production` | 查看、下载、导出，库存单据操作    |
| 访客   | `guest`      | 仅查看                |
| 待审批  | `unverified` | 注册后待管理员审批，仅可访问待审批页 |

### 权限体系

权限定义的**单一事实源**为 `permissions/permissions.json`（~140 个权限项，172 行）：

- **基础角色权限**: 每个权限直接映射到角色列表
- **对象级策略**: 某些权限绑定到对象创建者/审批人等（如 ECR 只有所有者可编辑、审批人可审批等）

```
permissions/permissions.json  (单一事实源)
    ├──→ tools/gen_permissions.py  (生成器)
    │       ├──→ backend/app/permissions/_generated.py
    │       └──→ frontend/src/constants/permissions.generated.ts
    └──→ backend/app/permissions/policies.py  (对象策略实现)
```

### API 权限控制

```python
from ..permissions import require_permission, has_permission, enforce_object_policy

# 路由依赖注入
current_user: User = Depends(require_permission("parts:read"))

# 内联检查
if not has_permission(current_user, "parts:delete"):
    raise HTTPException(403)

# 对象级策略（ECR 所有者 / 审批人等）
enforce_object_policy("ecr_owner_or_admin", current_user, ecr)
```

> **生成命令**: `python tools/gen_permissions.py` — `npm run build` 前自动执行（prebuild 钩子）。

### 前端权限检查

| 方法                   | 用途            | 底层                    |
| -------------------- | ------------- | --------------------- |
| `can('perm:action')` | **推荐**：精确权限判定 | `PERMISSIONS[perm]`   |
| `canEdit()`          | 新增/编辑按钮       | `can('parts:create')` |
| `canDownload()`      | 导出/下载         | `can('parts:export')` |
| `isAdmin()`          | 删除按钮          | `can('parts:delete')` |
| `canPreview()`       | PDF 预览        | 始终 true               |

---

## 🎯 开发指南

### 修改后端

后端目录通过 Docker volume 挂载，且开发环境已开启 `--reload`：

```yaml
volumes:
  - ./backend/app:/app/app
entrypoint: ... uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

改后端代码自动生效；如未生效可重启容器：

```powershell
docker restart bom_backend
```

本地开发（前端 dev server 代理目标为 8100 端口）：

```powershell
cd backend
uvicorn app.main:app --reload --port 8100
```

### 修改前端

1. 编辑 `frontend/src/` 下的源码
2. 构建：`cd frontend; npm run build`
3. 刷新浏览器（注意清缓存 Ctrl+F5）
4. **重要**：每次前端修改后必须立即构建，无需用户提醒
5. 浏览器标题可通过 `frontend/.env` 的 `VITE_APP_TITLE` 配置

### CAD 桥接服务

- 独立 Python 进程，须与 CATIA/SolidWorks 运行在**同一台 Windows 机器**
- 浏览器前端 → WebSocket(ws://127.0.0.1:9527) → COM 调用 CAD
- 详见 `cad_bridge/README.md`

### 新增 API

1. 在 `backend/app/routers/` 创建路由文件
2. 在 `backend/app/main.py` 注册路由
3. 在对应 `crud_*.py` / `schemas_*.py` 添加数据操作
4. 在 `permissions/permissions.json` 定义所需权限
5. 运行 `python tools/gen_permissions.py` 重新生成权限代码

---

## 🧪 测试

### 后端

```powershell
cd backend
pytest
# 或通过 Docker
docker-compose up -d --build backend
```

### 前端

```powershell
# 开发服务器（热更新，端口 8080，/api 代理到 localhost:8100）
cd frontend; npm run dev
# 测试（node 环境，匹配 src/**/*.test.ts）
cd frontend; npm run test
# 生产构建
cd frontend; npm run build
```

### API 文档

- **Swagger UI**（在线调试）：http://localhost:8000/api/docs
- **OpenAPI JSON**：http://localhost:8000/api/openapi.json

> 通过 Nginx (HTTPS) 访问时替换为 `https://localhost:${NGINX_HOST_PORT:-8080}/api/docs`

---

## 🚀 部署

### Docker Compose

```powershell
cd D:\OpenCode\myPDM
docker-compose up -d
```

### 构建前端后重启 Nginx

```powershell
cd frontend; npm run build
docker-compose up -d --force-recreate nginx
```

### 验证服务

```powershell
docker ps
```

4 个容器均为 Up 时正常：

| 容器           | 端口映射                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| bom_nginx    | :443 → `${NGINX_HOST_PORT:-8080}` (HTTPS), :80 → `${NGINX_HTTP_HOST_PORT:-8081}` |
| bom_backend  | :8000                                                                            |
| bom_postgres | :5432                                                                            |
| bom_redis    | :6379                                                                            |

### 新服务器部署

```powershell
# 1. 拉取代码
git clone <repo-url> myPDM
cd myPDM

# 2. 从旧服务器复制数据目录
#    scp -r old-server:~/myPDM/pgdata ./
#    scp -r old-server:~/myPDM/uploads ./

# 3. 安装依赖并构建前端
cd frontend; npm install; npm run build; cd ..

# 4. 配置 .env（AI Key / 安全密钥 / 飞书微信等）
#    必填: JWT_SECRET, REDIS_PASSWORD
#    可选: NGINX_HOST_PORT, PGDATA_HOST_PATH, UPLOADS_HOST_PATH, DEEPSEEK_API_KEY,
#          FEISHU_*（多路飞书）, WECHAT_*（微信扫码）

# 5. 一键启动所有服务
docker-compose up -d
```

> **注意**: 确保新旧服务器使用相同的 PostgreSQL 镜像版本（`postgres:16-alpine`），跨大版本不兼容。
> `./pgdata` 已存在时 PostgreSQL 会跳过 `./initdb/` 的初始化脚本。

---

## 📂 数据存储配置

### 存储路径总览

| 数据            | 宿主机默认路径      | 容器内路径                      | 配置方式                         |
| ------------- | ------------ | -------------------------- | ---------------------------- |
| Nginx 端口      | `8080`       | 443                        | `.env` → `NGINX_HOST_PORT`   |
| PostgreSQL 数据 | `./pgdata/`  | `/var/lib/postgresql/data` | `.env` → `PGDATA_HOST_PATH`  |
| 上传附件          | `./uploads/` | `/app/uploads`             | `.env` → `UPLOADS_HOST_PATH` |
| SSL 证书        | `./certs/`   | `/etc/nginx/certs`         | volume 挂载                    |

### 修改存储位置

通过 `.env` 文件配置宿主机路径（优先级高）：

```powershell
# .env 文件（推荐）
PGDATA_HOST_PATH=D:/data/pgdata
UPLOADS_HOST_PATH=D:/data/uploads
```

> 如果未创建 `.env` 文件，默认使用 `./pgdata` 和 `./uploads`。

---

## 🔧 常用命令

| 操作        | 命令                                                                     |
| --------- | ---------------------------------------------------------------------- |
| 启动所有服务    | `docker-compose up -d`                                                 |
| 停止服务      | `docker-compose down`                                                  |
| 清除数据（慎用）  | `docker-compose down -v`                                               |
| 查看后端日志    | `docker logs bom_backend -f`                                           |
| 重启后端      | `docker restart bom_backend`                                           |
| 本地启动后端    | `cd backend; uvicorn app.main:app --reload --port 8100`                |
| 构建前端      | `cd frontend; npm run build`                                           |
| 生成权限代码    | `cd frontend; npm run gen:perms`                                       |
| 重启 Nginx  | `docker-compose up -d --force-recreate nginx`                          |
| 备份数据库     | `docker exec bom_postgres pg_dump -U bomadmin bom_system > backup.sql` |
| 启动 CAD 桥接 | `cd cad_bridge; python server.py`                                      |
| 打包 CAD 桥接 | `cd cad_bridge; python build_exe.py`                                   |

---

## 👤 演示账号

| 角色   | 用户名        | 密码     |
| ---- | ---------- | ------ |
| 管理员  | admin      | 123456 |
| 工程师  | engineer   | 123456 |
| 生产人员 | production | 123456 |
| 访客   | guest      | 123456 |

---

## 📝 API 接口概览

### 认证

- `POST /api/auth/token` - 登录
- `GET /api/auth/me` - 当前用户
- `POST /api/auth/change-password` - 修改密码

### 飞书认证（多企业）

- `GET /api/auth/feishu/config` - 登录配置
- `GET /api/auth/feishu/authorize?provider=&intent=` - 发起授权
- `GET /api/auth/feishu/callback?code=&state=` - 授权回调
- `POST /api/auth/feishu/bind-intent` / `GET /api/auth/feishu/bindings` / `DELETE /api/auth/feishu/bindings/{provider}` - 账号绑定管理
- `POST /api/auth/feishu/jsapi` - 飞书 JSAPI 鉴权

### 微信认证（PC 扫码）

- `GET /api/auth/wechat/config` / `authorize` / `callback` / `bind-intent` / `bindings`（同飞书结构）

### 零部件管理（三层：物料/版本/迭代）

- `GET/POST /api/parts/` - 物料列表/创建
- `GET/PUT/DELETE /api/parts/{master_id}` - 物料详情/更新/软删除
- `GET /api/parts/{master_id}/revisions` - 版本列表
- `GET/DELETE /api/parts/revisions/{revision_id}` - 版本详情/删除
- `POST /api/parts/revisions/{revision_id}/checkout` / `checkin` / `undocheckout` / `force-checkin` - 检出/检入
- `POST /api/parts/revisions/{revision_id}/cascade-checkout` / `cascade-checkin` / `cascade-undocheckout` - 级联检出/检入
- `POST /api/parts/revisions/{revision_id}/release` / `freeze` / `unfreeze` / `obsolete` / `upgrade` - 状态流转/版本升级
- `GET/PUT/DELETE /api/parts/revisions/{revision_id}/iterations*` - 迭代管理
- `GET/POST/PUT/DELETE /api/parts/revisions/{revision_id}/bom[/items[/{item_id}]]` - 版本 BOM 维护
- `GET/POST/PUT/DELETE /api/parts/revisions/{revision_id}/documents[/{link_id}]` - 关联图文档
- `GET/POST/DELETE /api/parts/revisions/{revision_id}/attachments[/{attachment_id}]` + `chunk/init|complete` - 附件（分块上传）
- `POST /api/parts/cad/bom-match` - CAD BOM 匹配
- `POST /api/parts/revisions/{revision_id}/cad/bom-sync` - CAD BOM 实例同步
- `POST /api/parts/revisions/{revision_id}/import-assembly-step` - 装配 STEP 导入
- `GET /api/parts/revisions/{revision_id}/assembly-instances` / `assembly-tree` - 装配结构
- `GET /api/parts/revisions/{revision_id}/where-used/configurations` / `tasks` / `profiles` - Where-Used 反查
- `GET /api/parts/attachments/{attachment_id}/lod/{tier}` - LOD 多级细节预览

### BOM 管理

- `GET /api/bom/tree/{item_type}/{item_id}` - BOM 树
- `GET /api/bom/trace/{entity_type}/{entity_id}` - BOM 反查
- `GET /api/bom/references/{entity_type}/{entity_id}` - 图文档反查
- `POST /api/bom/items` / `DELETE /api/bom/items/{item_id}` - BOM 关系维护
- `POST /api/bom/compare` / `compare/component` - BOM 对比
- `GET /api/bom/export/{item_type}/{item_id}` - BOM 导出
- `GET /api/bom/items/all` - 全部 BOM 关系

### 图文档管理（三层：主档/版本/迭代）

- `GET/POST /api/documents/` - 列表/创建
- `GET/PUT/DELETE /api/documents/{revision_id}` - 版本详情/更新/软删除
- `GET /api/documents/{revision_id}/references` / `can-delete` - 引用检查
- `POST /api/documents/{revision_id}/checkout` / `checkin` / `undocheckout` / `force-checkin` - 检出/检入
- `POST /api/documents/{revision_id}/upgrade` / `freeze` / `unfreeze` / `release` / `obsolete` - 状态流转
- `GET /api/documents/{revision_id}/versions` / `iterations` - 版本/迭代历史
- `DELETE /api/documents/{revision_id}/iterations/{iteration_id}` - 删除迭代
- `GET/POST/DELETE /api/documents/{revision_id}/attachments[/{att_id}]` - 附件管理
- `GET /api/documents/revisions/{revision_id}/where-used/configurations` / `parts` / `tasks` / `ecos` / `ecrs` - Where-Used 反查

### 附件管理 (V2)

| 端点                                                    | 说明                         |
| ----------------------------------------------------- | -------------------------- |
| `POST /api/v2/attachments/upload`                     | Multipart 上传               |
| `GET /api/v2/attachments/{id}/stream`                 | 流式下载（二进制）                  |
| `GET /api/v2/attachments/{id}/download`               | Base64 下载                  |
| `GET /api/v2/attachments/{id}/preview?token=`         | **浏览器内联预览**（PDF 流式加载）      |
| `GET /api/v2/attachments/{id}/direct-download?token=` | 浏览器原生下载（显示进度）              |
| `GET /api/v2/attachments/{id}/gltf`                   | STP → glTF 3D 预览           |
| `POST /api/v2/attachments/chunk/*`                    | 分块上传（init/upload/complete） |
| `POST /api/v2/attachments/{id}/convert`               | 触发格式转换                     |
| `DELETE /api/v2/attachments/{id}`                     | 删除附件                       |

### ECR（工程变更请求）

- `GET/POST /api/ecrs/` - 列表/创建
- `GET/PUT/DELETE /api/ecrs/{id}` - 详情/更新/软删除
- `POST /api/ecrs/{id}/submit` / `withdraw` / `approve` / `close` - 流程
- `GET /api/ecrs/{id}/export-pdf` - 导出 PDF

### ECO（工程变更单）

- `GET/POST /api/ecos/` - 列表/创建
- `GET/PUT/DELETE /api/ecos/{id}` - 详情/更新/软删除
- `POST /api/ecos/{id}/submit` / `withdraw` / `close` / `execute` / `revise` / `restore` / `freeze` / `publish` - 流程
- `GET /api/ecos/{id}/export-pdf` - 导出 PDF

### 构型管理

- `GET/POST /api/configurations/items/` - 配置项列表/创建
- `GET/PUT/DELETE /api/configurations/items/{id}` - 配置项详情/更新/软删除
- `GET/POST /api/configurations/profiles/` - 配置概要列表/创建
- `GET/PUT/DELETE /api/configurations/profiles/{id}` - 配置概要详情/更新/删除
- `POST /api/configurations/profiles/{id}/activate` / `archive` - 激活/归档
- `GET /api/configurations/profiles/{id}/export-pdf` - 导出 PDF

### 库存管理

- `GET/POST /api/inventory/warehouses/` - 仓库列表/创建
- `GET/PUT/DELETE /api/inventory/warehouses/{id}` - 仓库详情/更新/删除
- `GET/POST /api/inventory/materials/` - 物料列表/创建
- `GET/PUT/DELETE /api/inventory/materials/{id}` - 物料详情/更新/删除
- `GET/POST /api/inventory/stock/` - 库存查询/盘点
- `GET/POST /api/inventory/documents/` - 库存单据列表/创建
- `GET/PUT/DELETE /api/inventory/documents/{id}` - 单据详情/更新/删除
- `POST /api/inventory/documents/{id}/submit` / `approve` / `post` - 单据流程

### 项目管理

- `GET/POST /api/projects/` - 项目列表/创建
- `GET/PUT/DELETE /api/projects/{id}` - 项目详情/更新/删除
- `GET/POST /api/projects/{id}/members` - 项目成员管理
- `GET/POST /api/projects/{id}/tasks` - 项目任务管理
- `POST /api/projects/{id}/tasks/rollup` - 任务日期汇总
- 交付物汇总（零部件/文档/构型项/变更，Excel 导出）

### 用户管理（仅 admin）

- `GET/POST /api/users/` - 用户列表/创建
- `GET/PUT/DELETE /api/users/{user_id}` - 用户 CRUD
- `POST /api/users/{user_id}/reset-password` - 重置密码
- `POST /api/users/import` / `export` - 导入/导出

### 用户组管理

- `GET/POST /api/user-groups/` - 用户组列表/创建
- `GET/PUT/DELETE /api/user-groups/{id}` - 详情/更新/删除
- `POST /api/user-groups/{id}/members` - 添加成员
- `DELETE /api/user-groups/{id}/members/{user_id}` - 移除成员

### 用户看板

- `GET /api/dashboard/` - 获取看板数据
- `POST /api/dashboard/folders` - 创建文件夹
- `POST /api/dashboard/items` - 关联项目
- `POST /api/dashboard/folders/{id}/share` - 共享文件夹

### 通知中心

- `GET /api/notifications/` - 通知列表
- `GET /api/notifications/unread-count` - 未读数
- `POST /api/notifications/{notification_id}/read` - 标记已读
- `POST /api/notifications/read-all` - 全部已读
- `DELETE /api/notifications/read` - 清理已读
- `POST /api/notifications/request-approval` - 发起审批请求

### 系统设置

- `GET /api/settings/cad-naming` - CAD 附件命名前缀配置（PDF 零件/装配、STP）

### 操作日志 / 自定义字段 / 数据同步 / 管理工具 / AI 助手

- `GET /api/logs/` - 查询操作日志（仅 admin）
- `GET/POST /api/custom-fields/definitions` - 字段定义
- `GET/POST /api/custom-fields/values` - 字段值
- `GET /api/sync/info` - 同步信息
- `POST /api/sync/pull` / `push` - 拉取/推送
- `GET /api/admin/soft-deletes` - 查询软删除数据
- `POST /api/admin/soft-deletes/cleanup` - 清理软删除数据
- `POST /api/assistant/chat` - 自然语言对话（SSE 流式，工具编排）
- `GET /api/assistant/artifacts/{doc_id}/download` - 下载 AI 生成的文档产物

---

## 🛠️ 关键设计决策

### 三层版本结构（零部件 / 图文档）

- **零部件**: `PartMaster`（物料）→ `PartRevision`（版本，A→B→…→ZZ）→ `PartIteration`（迭代，检出期间中间修改）
- **图文档**: `DocumentMaster` → `DocumentRevision` → `DocumentIteration`
- 检出/检入控制编辑权；`upgrade` 生成新版本；`release/freeze/obsolete` 控制状态
- 版本升级序列：24 进制不含 I/O（A→B→…→Z→AA→…→ZZ）
- 自动迁移在启动时执行（`migrations_components.py` / `migrations_project.py` 等）

### 弹窗统一整改（2026-08）

- 全桌面端弹窗统一走共享组件：`Modal` 基座（层级/滚动锁/Esc/焦点）+ `FormModal` / `ConfirmModal` / `EntityPickerModal` / `CheckinNoteModal` / `CcPicker` 分类组件；118 处原生 alert/confirm 已全部替换为 toast/ConfirmModal（移动端豁免）
- 三份 Picker（`AssemblyPartPicker` / `DocumentPicker` / `ConfigItemPicker`）为 `EntityPickerModal` 薄封装；签入说明 ×3 统一 `CheckinNoteModal`
- 实施台账：`.superpowers/sdd/2026-08-23-modal-style-unification-design/`（progress.md 含各任务评审结果与 deferred 清单）

### CAD 工作台与桥接服务

- `cad_bridge/` 为独立本地进程：WebSocket(9527) ↔ COM ↔ CATIA/SolidWorks，无 GUI、无业务逻辑、无状态
- JWT 令牌由前端传入、桥接服务透传 PDM，不存储任何凭据
- 字段映射单一事实源：`catia/field_mapping.json` / `solidworks/field_mapping.json`
- 后端 `cad/` 模块负责装配 STEP 解析（`assembly_parser.py`）与 BOM 匹配、实例矩阵（`matrix_utils.py`）

### 第三方登录

- 飞书：多企业（provider）配置，`FEISHU_PROVIDERS=feishu,companyB,...` 逗号分隔，每个 provider 对应 `FEISHU_<KEY>_APP_ID/_APP_SECRET/_NAME`
- 微信：开放平台「网站应用」OAuth2 PC 扫码，需企业认证，回调域需与 `WECHAT_REDIRECT_BASE` 一致
- 支持已有用户绑定（bind-intent）+ 解绑；状态签名防 CSRF

### 通知中心

- 各模块状态变更统一调用 `notifications.create_notifications()` 扇出写入
- 前端 `NotificationBell` + 通知页按模块筛选（变更/构型/库存/项目）、按天分组
- 审批类通知支持 `request-approval` 直达审批

### PDF 预览

- PDF 附件通过 `/api/v2/attachments/{id}/preview?token={jwt}` 端点流式加载
- 新标签页 `window.open()` 打开，浏览器原生 PDF 查看器渲染
- 后端 `Content-Disposition: inline` + Range 请求支持
- 非 PDF 格式弹窗提示"该格式暂不支持预览"

### 附件存储

- 文件存于 `./uploads/{entity_type}/{entity_id}/{filename}`
- 数据库 `document_attachments` / `part_attachments` 表仅存元数据（路径、大小、哈希）
- 支持分块上传（5MB/块），适合大文件

### 软删除

- PartMaster/DocumentMaster/BOMItem/ECR/ECO 等核心实体均支持软删除（`deleted_at` 列）
- 唯一约束使用部分索引（`WHERE deleted_at IS NULL`）避免冲突
- admin 可通过 `/api/admin/soft-deletes` 查看和清理软删除数据

### 自动迁移

- `main.py` 启动时自动检测数据库 schema，创建缺失的表和列
- 无需手动运行 migration 命令
- 增量迁移脚本在 `initdb/migrations/` 作为历史记录保留（001-013）

### Nginx HTTPS

- Nginx 监听 443（HTTPS）与 80（HTTP），使用 `certs/` 下的自签名证书
- 登录接口限流 `10r/s`、API 限流 `100r/s`、连接数限制，429 明确返回
- 支持 SSE 流式传输（`proxy_buffering off`）
- 支持大文件上传（`client_max_body_size 1G`）

### AI 助手

- 后端通过 OpenAI 兼容接口调用 DeepSeek
- SSE 流式返回，支持工具编排（查询 BOM/零件/ECR 等内部 API）
- 技能系统：加载 Markdown 定义的 domain 技能（BOM 变更影响分析、BOM 对比报告、零部件反查、项目总结报告）
- 配置通过 `.env`：`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `ASSISTANT_MAX_ITERS` 等

### STP 3D 查看器

- 前端 STPViewer 使用 Three.js + React Three Fiber
- 支持模型树、剖切面、测量工具、爆炸视图、零件高亮
- 后端使用 MayoConv AppImage 将 STP 转为 glTF/glb，支持 LOD 多级细节
- Draco 压缩数据通过 `public/draco/` 提供解码器

---

## 📞 何时询问用户

在以下情况前先询问：

- 添加新依赖项
- 重大架构变更
- 在多个有效方案中选择
- 删除或大幅重构现有代码

---

## 📂 配置层级

本文件是**项目级配置**，优先级高于 `D:\OpenCode\AGENTS.MD`。

当本文件与顶层文件冲突时，**以本文件为准**。

---

*最后更新: 2026-08-21*
