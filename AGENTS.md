# AGENTS.md - myPDM 项目开发指南

> **角色**: 你是负责本项目开发的 AI 开发助手。
> **用户**: 产品经理，专注 BOM/PDM 系统开发。
> **工作空间**: D:\OpenCode\myPDM

---

## 📋 项目概述

### 基本信息

| 属性     | 値                                    |
| ------ | ------------------------------------ |
| 项目名称   | 网页版 BOM 管理工具 (PDM 系统)                |
| 项目类型   | 前后端分离 Web 应用                         |
| 版本     | v1.6.1                               |
| 架构     | React SPA + RESTful API (Docker 部署)  |
| 语言     | TypeScript + Python                   |

### 核心功能

- **零件管理**: 物料清单全生命周期管理（版本、自定义字段、软删除）
- **部件管理**: 部件层级管理（树形 BOM、BOM 导出）
- **零件/部件合并**: 零件与部件统一为「零部件」管理（Components 表，type 字段区分）
- **图文档管理**: 图纸文档与附件管理（Office 文档在线预览）
- **BOM 管理**: BOM 树、BOM 对比、BOM 反查、图文档反查、BOM 导出
- **ECR/ECO 变更管理**: 工程变更请求/变更单全生命周期（创建→提交→审批→执行→关闭）
- **配置管理**: 配置项与配置概要管理（BOM 配置对比、PDF 导出）
- **库存管理**: 仓库/物料/库存/单据管理（入库/出库/盘点）
- **项目管理**: 项目任务管理（甘特图、任务依赖关系、日期自动汇总）
- **用户组管理**: 用户组与文档共享权限
- **用户看板**: 用户自定义文件夹式数据看板（支持共享）
- **附件管理**: 上传/下载/PDF 预览/STP 三维预览/Office 预览/压缩包浏览
- **AI 助手**: DeepSeek 驱动的自然语言交互（SSE 流式、工具编排、文档生成）
- **数据导入导出**: 零部件/文档 Excel 批量导入导出
- **数据同步**: 跨环境数据同步 API
- **操作日志**: 全量操作审计追踪（仅管理员可见）
- **版本管理**: 零部件/文档版本升级（A→B→...→ZZ 序列，24 进制不含 I/O）

---

## 🏗️ 技术栈

### 后端

| 类别       | 技术                                       |
| -------- | ---------------------------------------- |
| 框架       | FastAPI                                   |
| ASGI 服务器 | Uvicorn                                   |
| ORM      | SQLAlchemy 2.0                            |
| 数据验证     | Pydantic 2.x                              |
| 认证       | JWT (python-jose + passlib/bcrypt)        |
| 数据库      | PostgreSQL 16                             |
| 缓存       | Redis 7                                   |
| 文件存储     | 本地文件系统 (`./uploads/`)                    |
| 3D 转换    | MayoConv (STP → glTF/glb via AppImage)    |
| Office 转换 | LibreOffice (Office → PDF 在线预览)           |
| AI 模型   | DeepSeek (OpenAI 兼容接口)                    |
| 文档生成     | python-docx, openpyxl, pypdf              |
| 测试       | pytest                                    |

**依赖文件**: `backend/requirements.txt`

### 前端

| 类别       | 技术                                       |
| -------- | ---------------------------------------- |
| 框架       | React 18 + TypeScript                    |
| 构建工具     | Vite 5                                   |
| 样式       | Tailwind CSS 3 + @tailwindcss/typography |
| 路由       | React Router 6                           |
| 状态管理     | Zustand (persist 持久化)                    |
| HTTP 客户端 | Axios                                    |
| 3D 渲染   | Three.js + @react-three/fiber + @react-three/drei |
| Markdown | react-markdown + remark-gfm + marked     |
| 电子表格     | xlsx                                     |
| 日期       | dayjs                                    |
| 测试       | Vitest                                   |

**源码目录**: `frontend/`
**构建输出**: `frontend/dist/`

### 基础设施

| 服务         | 容器名           | 端口                                     |
| ---------- | ------------- | -------------------------------------- |
| Nginx      | bom_nginx     | 443 HTTPS (映射 `${NGINX_HOST_PORT:-8080}`) |
| FastAPI    | bom_backend   | 8000                                   |
| PostgreSQL | bom_postgres  | 5432                                   |
| Redis      | bom_redis     | 6379                                   |

---

## 📂 项目结构

```
D:\OpenCode\myPDM\
├── frontend/                     # React + Vite 前端项目
│   ├── src/
│   │   ├── App.tsx               # 根组件（路由定义）
│   │   ├── main.tsx              # 入口
│   │   ├── index.css             # Tailwind 全局样式
│   │   ├── components/           # 可复用组件
│   │   │   ├── Layout.tsx        # 导航布局（侧边栏+顶栏）
│   │   │   ├── Modal.tsx / Toast.tsx / Loading.tsx
│   │   │   ├── BOMTreeTable.tsx / ArchiveTreeModal.tsx / BOMTraceModal.tsx
│   │   │   ├── EntityEditModal.tsx / EntityDocumentSection.tsx
│   │   │   ├── ImportPreviewModal.tsx
│   │   │   ├── VersionHistory.tsx / VersionSelectModal.tsx
│   │   │   ├── PartDetailContent.tsx / AssemblyDetailContent.tsx / DocumentDetailContent.tsx
│   │   │   ├── AssemblyPartPicker.tsx / DocumentPicker.tsx / ECPicker.tsx
│   │   │   ├── ComponentAttachmentBucket.tsx
│   │   │   ├── assistant/       # AI 助手组件
│   │   │   │   ├── FloatingAssistant.tsx / ChatInput.tsx / MessageList.tsx / Markdown.tsx
│   │   │   │   └── cards/       # 消息卡片（TextCard/MarkdownCard/TableCard/LinkCard/DownloadCard）
│   │   │   ├── Configuration/   # 配置管理组件（ConfigItemPicker/ConfigList/ProfileList 等）
│   │   │   ├── ECO/             # ECO 组件（ECOList/ECOCreateModal/ECODetailModal/ECOExecutionPanel 等）
│   │   │   ├── ECR/             # ECR 组件（ECRList/ECRCreateModal/ECRDetailModal/ECRReviewPanel 等）
│   │   │   ├── Inventory/       # 库存组件（WarehouseTab/MaterialTab/StockTab/DocumentTab 等）
│   │   │   └── STPViewer/       # STP 3D 查看器组件
│   │   │       ├── index.tsx / ViewerCanvas.tsx / CameraController.tsx
│   │   │       ├── ModelLoader.tsx / ModelTreePanel.tsx / Toolbar.tsx
│   │   │       ├── MeasureTool.tsx / SectionPlanes.tsx / ExplodeView.tsx
│   │   │       ├── PartHighlighter.tsx / ViewCube.tsx / AxisGizmo.tsx
│   │   │       ├── GLTFErrorBoundary.tsx
│   │   │       ├── buildModelTree.ts + test / autoColor.ts + test / treeTypes.ts
│   │   ├── pages/               # 页面组件
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx / Board.tsx
│   │   │   ├── ComponentsPage.tsx / Documents.tsx
│   │   │   ├── Configuration.tsx
│   │   │   ├── EC.tsx / ECN.tsx     # ECR/ECO 工程变更
│   │   │   ├── Inventory.tsx    # 库存管理
│   │   │   ├── DataManagement.tsx
│   │   │   ├── Users.tsx / Logs.tsx / Settings.tsx
│   │   │   ├── STPViewer.tsx / OfficeReader.tsx    # 3D 查看器与 Office 阅读器（懒加载）
│   │   │   ├── BOM/             # BOM 工具页面
│   │   │   │   ├── BOM.tsx / BOMTreePanel.tsx / BOMComparePanel.tsx
│   │   │   │   ├── BOMTracePanel.tsx / DocTracePanel.tsx
│   │   │   │   └── helpers.ts / types.ts
│   │   │   └── Project/         # 项目管理页面
│   │   │       ├── Projects.tsx / MemberManageModal.tsx
│   │   │       ├── TaskEditModal.tsx / TaskRowCells.tsx
│   │   │       └── gantt/       # 甘特图
│   │   │           ├── GanttView.tsx / ganttUtils.ts
│   │   ├── services/            # API 客户端
│   │   │   ├── api.ts           # 主 API 客户端
│   │   │   ├── assistantApi.ts  # AI 助手 API
│   │   │   ├── inventoryApi.ts  # 库存 API
│   │   │   ├── projectApi.ts    # 项目 API
│   │   │   ├── syncApi.ts / syncService.ts
│   │   │   ├── importExport.ts  # 导入导出
│   │   │   ├── ecPdfExport.ts / ecMarkdownExport.ts
│   │   │   └── configProfilePdfExport.ts
│   │   ├── stores/              # Zustand 状态管理
│   │   │   ├── auth.ts          # 认证状态（persist 持久化）
│   │   │   ├── data.ts / assistant.ts / inventory.ts
│   │   │   ├── project.ts / pageHeader.ts
│   │   │   └── viewerStore.ts   # 3D 查看器状态
│   │   ├── hooks/               # 自定义 Hooks
│   │   │   ├── useAssistantChat.ts / useCommon.ts
│   │   │   └── useResizable.ts / useTableSort.ts / useHeaderTabs.tsx
│   │   ├── types/               # TypeScript 类型
│   │   │   ├── index.ts         # 全体类型定义
│   │   │   ├── assistant.ts
│   │   │   └── project.ts
│   │   ├── constants/           # 常量
│   │   │   ├── index.ts         # APP_VERSION=v1.6.1 / 状态/角色/分页/文件限制
│   │   │   └── permissions.generated.ts  # 自动生成的权限矩阵
│   │   ├── lib/                 # 工具库
│   │   │   ├── date.ts / file.ts / utils.ts
│   │   └── utils/               # 工具函数
│   │       └── date.ts / attachmentPreview.ts
│   ├── public/draco/            # Draco 解压 (glTF 压缩)
│   ├── index.html               # 入口 HTML (lang=zh-CN)
│   ├── vite.config.ts           # Vite + Vitest 配置 (路径别名 @, proxy)
│   ├── tailwind.config.js       # 主题扩展 (primary color, Inter 字体)
│   ├── tsconfig.json            # TypeScript 配置
│   └── package.json
├── backend/                     # FastAPI 后端
│   ├── app/
│   │   ├── main.py              # FastAPI 入口（启动自动建表/迁移）
│   │   ├── database.py          # 数据库 + Redis 连接
│   │   ├── models.py            # 核心模型（User/Component/BOMItem/Document/Dashboard/UserGroup/CustomField）
│   │   ├── models_ecr.py        # ECR 模型
│   │   ├── models_eco.py        # ECO 模型
│   │   ├── models_configuration.py  # 配置管理模型
│   │   ├── models_inventory.py      # 库存管理模型
│   │   ├── models_project.py        # 项目管理模型
│   │   ├── schemas.py           # 核心 Pydantic Schema
│   │   ├── schemas_ecr.py / schemas_eco.py / schemas_configuration.py / schemas_inventory.py / schemas_project.py
│   │   ├── crud.py              # 核心数据库操作（含版本升级/软删除恢复）
│   │   ├── crud_ecr.py / crud_eco.py / crud_configuration.py / crud_inventory.py / crud_project.py / crud_groups.py
│   │   ├── file_storage.py      # 文件存储服务（分块上传 5MB/块）
│   │   ├── stp_converter.py     # STP → glTF 转换服务
│   │   ├── stp_to_gltf.py       # 替代 STP→glTF 流水线
│   │   ├── office_converter.py  # Office 文档转 PDF
│   │   ├── media_token.py       # 媒体访问令牌
│   │   ├── permissions/         # 权限系统
│   │   │   ├── __init__.py      # require_permission / has_permission / enforce_object_policy
│   │   │   ├── _generated.py    # 自动生成（from permissions.json）
│   │   │   └── policies.py      # 对象级策略（owner/approver/admin）
│   │   ├── routers/             # API 路由（18 个文件，17 个活动路由）
│   │   │   ├── auth.py          # JWT 认证（登录/令牌/修改密码/当前用户）
│   │   │   ├── users.py         # 用户管理（仅 admin）
│   │   │   ├── user_groups.py   # 用户组管理
│   │   │   ├── components.py    # 零部件 CRUD + 导入导出 + 版本（零件+部件统一）
│   │   │   ├── bom.py           # BOM 树/对比/反查/关系
│   │   │   ├── documents.py     # 图文档 CRUD + 附件
│   │   │   ├── attachments_v2.py# V2 附件（multipart/分块/预览/stream）
│   │   │   ├── dashboard.py     # 用户看板
│   │   │   ├── custom_fields.py # 自定义字段
│   │   │   ├── ecrs.py          # ECR（工程变更请求）
│   │   │   ├── ecos.py          # ECO（工程变更单）
│   │   │   ├── configuration.py # 配置项与配置概要
│   │   │   ├── inventory.py     # 库存管理
│   │   │   ├── projects.py      # 项目管理
│   │   │   ├── sync.py          # 数据同步
│   │   │   ├── admin.py         # 管理工具（软删除清理等）
│   │   │   ├── assistant.py     # AI 助手（SSE 聊天 + 产物下载）
│   │   │   └── logs.py          # 操作日志
│   │   ├── assistant/           # AI 助手引擎
│   │   │   ├── agent.py         # 核心编排
│   │   │   ├── api_gateway.py   # 内部 API 网关
│   │   │   ├── llm_client.py    # LLM 客户端 (DeepSeek)
│   │   │   ├── tools.py         # 工具定义
│   │   │   ├── knowledge.py / knowledge_glossary.py
│   │   │   ├── attachment_reader.py / document_builder.py
│   │   │   ├── skills_loader.py / sanitizer.py
│   │   │   ├── system_prompt.md
│   │   │   └── skills/          # 技能定义（bom_change_impact/bom_compare_report/part_where_used/project_summary_report）
│   │   └── bom/                 # BOM 工具
│   │       ├── compare.py       # BOM 对比算法
│   │       └── archive_reader.py # 压缩包读取
│   ├── Dockerfile               # Python 3.12-slim, MayoConv AppImage
│   └── requirements.txt
├── nginx/                       # Nginx 配置
│   └── nginx.conf               # HTTPS (443), SSE 流式支持, 1G 上传限制
├── certs/                       # SSL 自签名证书
│   ├── selfsigned.crt
│   └── selfsigned.key
├── initdb/                      # 数据库初始化
│   ├── init.sql                 # 全套建表（~20 张表）
│   ├── test_data.sql            # 测试数据
│   └── migrations/              # 增量迁移脚本 (001-006)
├── permissions/                 # 权限定义单一事实源
│   └── permissions.json         # 权限矩阵 JSON (155 行, ~140 权限项)
├── tools/                       # 工具脚本
│   └── gen_permissions.py       # 从 permissions.json 生成后端+前端权限代码
├── docs/                        # 设计文档与规格
│   └── superpowers/
│       ├── plans/               # 实施计划
│       └── specs/               # 设计文档
├── uploads/                     # 上传文件存储目录
├── docker-compose.yml
├── Dockerfile.nginx
├── .env                         # 环境变量（端口/路径/AI配置）
└── 项目说明/                     # 项目文档（中文）
```

---

## 📋 代码规范

### 后端 (Python)

遵循 `D:\OpenCode\AGENTS.MD` 顶层规范，按以下优先级：

1. **项目级**: 本文件 (如与顶层冲突，以本文件为准)
2. **顶层**: `D:\OpenCode\AGENTS.MD`
3. **OpenCode 默认**

**Python 特定规则**:

- **类型注解**: 必须使用 Type Hints（函数参数、返回值）
- **Pydantic**: 用于 API 请求/响应验证
- **SQLAlchemy 2.0**: 使用新版 Declarative API
- **异常处理**: 使用 `HTTPException` 而非裸 raise
- **模型文件**: 核心模型在 `models.py`，领域模块独立文件（`models_ecr.py` / `models_eco.py` / `models_configuration.py` / `models_inventory.py` / `models_project.py`），Schema 和 CRUD 同理

### 前端 (React + TypeScript)

- **组件**: `src/components/` 下每个组件一个文件，使用 `export default`，领域组件分目录（如 `ECO/`, `STPViewer/`）
- **页面**: `src/pages/` 下按功能命名，路由组件
- **类型**: 统一在 `src/types/` 定义（`index.ts` 为通用类型，`assistant.ts` 为 AI 类型）
- **状态管理**: Zustand store 放在 `src/stores/`（支持 persist 持久化）
- **API 调用**: 按领域分文件（`api.ts` 主客户端，`inventoryApi.ts` / `assistantApi.ts` / `syncApi.ts` 等）
- **样式**: Tailwind CSS 原子类，避免自定义 CSS
- **排序图标**: 可排序列表头添加 `cursor-pointer select-none whitespace-nowrap`

---

## 🔐 权限模型

### 用户角色

| 角色     | 标识            | 说明             |
| ------ | ------------- | -------------- |
| 管理员    | `admin`       | 全部功能，用户管理, 软删除管理 |
| 工程师    | `engineer`    | 创建/编辑，CRU 大部分资源  |
| 生产人员   | `production`  | 查看、下载、导出，库存单据操作 |
| 访客     | `guest`       | 仅查看            |

### 权限体系

权限定义的**单一事实源**为 `permissions/permissions.json`（~140 个权限项）：

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

| 方法                           | 用途                     | 底层                        |
| ---------------------------- | ---------------------- | ------------------------- |
| `can('perm:action')`         | **推荐**：精确权限判定          | `PERMISSIONS[perm]`       |
| `canEdit()`                  | 新增/编辑按钮                | `can('parts:create')`    |
| `canDownload()`              | 导出/下载                  | `can('parts:export')`    |
| `isAdmin()`                  | 删除按钮                   | `can('parts:delete')`    |
| `canPreview()`               | PDF 预览                 | 始终 true                  |

---

## 🎯 开发指南

### 修改后端

后端目录通过 Docker volume 挂载：

```yaml
volumes:
  - ./backend/app:/app/app
```

修改后需重启容器：

```powershell
docker restart bom_backend
```

### 修改前端

1. 编辑 `frontend/src/` 下的源码
2. 构建：`cd frontend; npm run build`
3. 刷新浏览器（注意清缓存 Ctrl+F5）
4. **重要**：每次前端修改后必须立即构建，无需用户提醒

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
# 开发服务器（热更新，端口 8080）
cd frontend; npm run dev
# 测试
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

| 容器           | 端口映射                         |
| ------------ | ---------------------------- |
| bom_nginx    | :443 → `${NGINX_HOST_PORT:-8080}` (HTTPS) |
| bom_backend  | :8000                        |
| bom_postgres | :5432                        |
| bom_redis    | :6379                        |

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

# 4. 配置 .env（AI Key 等）
#    可选配置: NGINX_HOST_PORT, PGDATA_HOST_PATH, UPLOADS_HOST_PATH, DEEPSEEK_API_KEY

# 5. 一键启动所有服务
docker-compose up -d
```

> **注意**: 确保新旧服务器使用相同的 PostgreSQL 镜像版本（`postgres:16-alpine`），跨大版本不兼容。
> `./pgdata` 已存在时 PostgreSQL 会跳过 `./initdb/` 的初始化脚本。

---

## 📂 数据存储配置

### 存储路径总览

| 数据            | 宿主机默认路径       | 容器内路径                       | 配置方式                           |
| ------------- | ------------- | --------------------------- | ------------------------------ |
| Nginx 端口      | `8080`        | 443                         | `.env` → `NGINX_HOST_PORT`     |
| PostgreSQL 数据 | `./pgdata/`   | `/var/lib/postgresql/data`  | `.env` → `PGDATA_HOST_PATH`    |
| 上传附件          | `./uploads/`  | `/app/uploads`              | `.env` → `UPLOADS_HOST_PATH`   |
| SSL 证书        | `./certs/`    | `/etc/nginx/certs`          | volume 挂载                      |

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

| 操作          | 命令                                                                      |
| ----------- | ----------------------------------------------------------------------- |
| 启动所有服务      | `docker-compose up -d`                                                  |
| 停止服务        | `docker-compose down`                                                   |
| 清除数据（慎用）    | `docker-compose down -v`                                                |
| 查看后端日志      | `docker logs bom_backend -f`                                            |
| 重启后端        | `docker restart bom_backend`                                            |
| 构建前端        | `cd frontend; npm run build`                                            |
| 生成权限代码      | `cd frontend; npm run gen:perms`                                        |
| 重启 Nginx    | `docker-compose up -d --force-recreate nginx`                           |
| 备份数据库       | `docker exec bom_postgres pg_dump -U bomadmin bom_system > backup.sql`  |

---

## 👤 演示账号

| 角色     | 用户名         | 密码      |
| ------ | ----------- | ------- |
| 管理员    | admin       | 123456  |
| 工程师    | engineer    | 123456  |
| 生产人员   | production  | 123456  |
| 访客     | guest       | 123456  |

---

## 📝 API 接口概览

### 认证

- `POST /api/auth/token` - 登录
- `GET /api/auth/me` - 当前用户
- `POST /api/auth/change-password` - 修改密码

### 零部件（零件/部件）管理

- `GET/POST /api/components/` - 列表/创建（类型筛选：part/assembly）
- `GET/PUT/DELETE /api/components/{id}` - 详情/更新/软删除
- `POST /api/components/import` - 批量导入
- `GET /api/components/export` - 批量导出
- `GET /api/components/{id}/versions` - 版本历史
- `POST /api/components/{id}/upgrade` - 版本升级
- `GET /api/components/{id}/bom/export` - BOM 导出（仅部件）

### BOM 管理

- `GET /api/bom/tree/{type}/{id}` - BOM 树
- `POST /api/bom/items` - 创建 BOM 关系
- `DELETE /api/bom/items/{item_id}` - 删除 BOM 关系
- `POST /api/bom/compare` - BOM 对比
- `POST /api/bom/trace` - BOM 反查
- `POST /api/bom/doc-refs` - 图文档反查

### 图文档管理

- `GET/POST /api/documents/` - 列表/创建
- `GET/PUT/DELETE /api/documents/{doc_id}` - 详情/更新/软删除
- `POST /api/documents/{doc_id}/attachments` - 上传附件 (base64)
- `GET /api/documents/{doc_id}/attachments/` - 附件列表

### 附件管理 (V2)

| 端点                                                     | 说明                         |
| ------------------------------------------------------ | -------------------------- |
| `POST /api/v2/attachments/upload`                      | Multipart 上传               |
| `GET /api/v2/attachments/{id}/stream`                  | 流式下载（二进制）                  |
| `GET /api/v2/attachments/{id}/download`                | Base64 下载                  |
| `GET /api/v2/attachments/{id}/preview?token=`          | **浏览器内联预览**（PDF 流式加载）      |
| `GET /api/v2/attachments/{id}/direct-download?token=`  | 浏览器原生下载（显示进度）              |
| `GET /api/v2/attachments/{id}/gltf`                    | STP → glTF 3D 预览           |
| `POST /api/v2/attachments/chunk/*`                     | 分块上传（init/upload/complete） |
| `POST /api/v2/attachments/{id}/convert`                | 触发格式转换                     |
| `DELETE /api/v2/attachments/{id}`                      | 删除附件                       |

### ECR（工程变更请求）

- `GET/POST /api/ecrs/` - 列表/创建
- `GET/PUT/DELETE /api/ecrs/{id}` - 详情/更新/软删除
- `POST /api/ecrs/{id}/submit` - 提交
- `POST /api/ecrs/{id}/withdraw` - 撤回
- `POST /api/ecrs/{id}/approve` - 审批
- `POST /api/ecrs/{id}/close` - 关闭
- `GET /api/ecrs/{id}/export-pdf` - 导出 PDF

### ECO（工程变更单）

- `GET/POST /api/ecos/` - 列表/创建
- `GET/PUT/DELETE /api/ecos/{id}` - 详情/更新/软删除
- `POST /api/ecos/{id}/submit` - 提交
- `POST /api/ecos/{id}/withdraw` - 撤回
- `POST /api/ecos/{id}/close` - 关闭
- `POST /api/ecos/{id}/execute` - 执行
- `POST /api/ecos/{id}/revise` - 修订
- `POST /api/ecos/{id}/restore` - 恢复
- `POST /api/ecos/{id}/freeze` / `publish` - 冻结/发布
- `GET /api/ecos/{id}/export-pdf` - 导出 PDF

### 配置管理

- `GET/POST /api/configuration/items/` - 配置项列表/创建
- `GET/PUT/DELETE /api/configuration/items/{id}` - 配置项详情/更新/软删除
- `GET/POST /api/configuration/profiles/` - 配置概要列表/创建
- `GET/PUT/DELETE /api/configuration/profiles/{id}` - 配置概要详情/更新/删除
- `POST /api/configuration/profiles/{id}/activate` / `archive` - 激活/归档
- `GET /api/configuration/profiles/{id}/export-pdf` - 导出 PDF

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

### 操作日志

- `GET /api/logs/` - 查询操作日志（仅 admin）

### 自定义字段

- `GET/POST /api/custom-fields/definitions` - 字段定义
- `GET/POST /api/custom-fields/values` - 字段值

### 数据同步

- `GET /api/sync/info` - 同步信息
- `POST /api/sync/pull` / `push` - 拉取/推送

### 管理工具

- `GET /api/admin/soft-deletes` - 查询软删除数据
- `POST /api/admin/soft-deletes/cleanup` - 清理软删除数据

### AI 助手

- `POST /api/assistant/chat` - 自然语言对话（SSE 流式，工具编排）
- `GET /api/assistant/artifacts/{doc_id}/download` - 下载 AI 生成的文档产物

---

## 🛠️ 关键设计决策

### PDF 预览

- PDF 附件通过 `/api/v2/attachments/{id}/preview?token={jwt}` 端点流式加载
- 新标签页 `window.open()` 打开，浏览器原生 PDF 查看器渲染
- 后端 `Content-Disposition: inline` + Range 请求支持
- 非 PDF 格式弹窗提示"该格式暂不支持预览"

### 附件存储

- 文件存于 `./uploads/{entity_type}/{entity_id}/{filename}`
- 数据库 `document_attachments` 表仅存元数据（路径、大小、哈希）
- 支持分块上传（5MB/块），适合大文件

### 软删除

- Component/Document/BOMItem/ECR/ECO 等核心实体均支持软删除（`deleted_at` 列）
- 唯一约束使用部分索引（`WHERE deleted_at IS NULL`）避免冲突
- admin 可通过 `/api/admin/soft-deletes` 查看和清理软删除数据

### 零部件统一管理

- 零件（Part）和部件（Assembly）统一为「零部件」（Component）
- 数据库使用单一 `components` 表，通过 `component_type` 字段区分（`part` / `assembly`）
- API 路由合并为 `/api/components/`，前端页面合并为 `ComponentsPage`
- 自动迁移在启动时执行（`migrations_components.py`）

### 自动迁移

- `main.py` 启动时自动检测数据库 schema，创建缺失的表和列
- 无需手动运行 migration 命令
- 增量迁移脚本在 `initdb/migrations/` 作为历史记录保留

### Nginx HTTPS

- Nginx 监听 443 端口（HTTPS），使用 `certs/` 下的自签名证书
- 宿主机映射到 `${NGINX_HOST_PORT:-8080}`
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
- 后端使用 MayoConv AppImage 将 STP 转为 glTF/glb
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

*最后更新: 2026-06-30*
