# AGENTS.md - myPDM 项目开发指南

> **角色**: 你是负责本项目开发的 AI 开发助手。
> **用户**: 产品经理，专注 BOM/PDM 系统开发。
> **工作空间**: D:\OpenCode\myPDM

---

## 📋 项目概述

### 基本信息

| 属性 | 值 |
|------|-----|
| 项目名称 | 网页版 BOM 管理工具 (PDM 系统) |
| 项目类型 | 前后端分离 Web 应用 |
| 版本 | v1.0.0 |
| 架构 | React SPA + RESTful API (Docker 部署) |

### 核心功能

- **零件管理**: 物料清单全生命周期管理
- **部件管理**: 部件层级管理（树形 BOM）
- **图文档管理**: 图纸文档与附件管理
- **BOM 管理**: BOM 对比、BOM 反查、图文档反查
- **用户看板**: 用户自定义文件夹式数据看板
- **附件管理**: 上传 / 下载 / PDF 预览 / STP 三维预览

---

## 🏗️ 技术栈

### 后端

| 类别 | 技术 |
|------|------|
| 框架 | FastAPI |
| ASGI 服务器 | Uvicorn |
| ORM | SQLAlchemy 2.0 |
| 数据验证 | Pydantic 2.x |
| 认证 | JWT (python-jose + passlib/bcrypt) |
| 数据库 | PostgreSQL 16 |
| 缓存 | Redis 7 |
| 文件存储 | 本地文件系统 (`./uploads/`) |
| 3D 转换 | PythonOCC (STP → glTF/glb) |

**依赖文件**: `backend/requirements.txt`

### 前端

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 路由 | React Router 6 |
| 状态管理 | Zustand |
| HTTP 客户端 | Axios |
| 存储 | localStorage + sessionStorage |

**源码目录**: `frontend/`
**构建输出**: `frontend/dist/`

### 基础设施

| 服务 | 容器名 | 端口 |
|------|--------|------|
| Nginx | bom_nginx | 80 (映射 `${NGINX_HOST_PORT:-8080}`) |
| FastAPI | bom_backend | 8000 |
| PostgreSQL | bom_postgres | 5432 |
| Redis | bom_redis | 6379 |

---

## 📂 项目结构

```
D:\OpenCode\myPDM\
├── frontend/                  # React + Vite 前端项目
│   ├── src/                # TypeScript 源码
│   │   ├── components/     # 可复用组件
│   │   ├── pages/          # 页面组件
│   │   ├── services/       # API 客户端
│   │   ├── stores/         # Zustand 状态管理
│   │   ├── hooks/          # 自定义 Hooks
│   │   ├── utils/          # 工具函数
│   │   ├── constants/      # 常量定义
│   │   └── types/          # TypeScript 类型定义
│   ├── dist/               # Vite 构建输出（nginx 挂载）
│   ├── index.html          # 入口 HTML
│   ├── vite.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── tailwind.config.js
├── backend/                 # FastAPI 后端
│   ├── app/
│   │   ├── main.py         # FastAPI 入口
│   │   ├── models.py       # SQLAlchemy 模型
│   │   ├── schemas.py      # Pydantic schemas
│   │   ├── crud.py         # 数据库操作
│   │   ├── database.py     # 数据库连接
│   │   ├── file_storage.py # 文件系统存储服务
│   │   ├── stp_converter.py# STP → glTF 转换
│   │   └── routers/        # API 路由
│   │       ├── auth.py
│   │       ├── users.py
│   │       ├── parts.py
│   │       ├── assemblies.py
│   │       ├── bom.py
│   │       ├── documents.py
│   │       ├── attachments_v2.py  # 新版附件 API（含预览/流式下载）
│   │       ├── dashboard.py
│   │       ├── custom_fields.py
│   │       └── logs.py
│   ├── requirements.txt
│   └── Dockerfile
├── nginx/                   # Nginx 配置
│   └── nginx.conf
├── initdb/                  # 数据库初始化
│   └── init.sql
├── migrations/              # 数据库迁移脚本
├── uploads/                 # 上传文件存储目录
├── docker-compose.yml
└── 项目说明/                # 项目文档
    ├── 项目说明.md
    ├── 用户权限说明.md
    └── ...
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

### 前端 (React + TypeScript)

- **组件**: `src/components/` 下每个组件一个文件，使用 `export default`
- **页面**: `src/pages/` 下按功能命名，路由组件
- **类型**: 统一在 `src/types/index.ts` 定义
- **状态管理**: Zustand store 放在 `src/stores/`
- **API 调用**: 在 `src/services/api.ts` 集中管理
- **样式**: Tailwind CSS 原子类，避免自定义 CSS
- **排序图标**: 可排序列表头添加 `cursor-pointer select-none whitespace-nowrap`

---

## 🔐 权限模型

### 用户角色

| 角色 | 标识 | 说明 |
|------|------|------|
| 管理员 | `admin` | 全部功能，管理用户 |
| 工程师 | `engineer` | 创建/编辑，无删除主体权限 |
| 生产人员 | `production` | 查看、下载、导出 |
| 访客 | `guest` | 仅查看 |

### API 权限控制

通过 `require_role()` 装饰器实现：

```python
# 仅管理员
current_user: User = Depends(require_role(["admin"]))

# 管理员 + 工程师
current_user: User = Depends(require_role(["admin", "engineer"]))

# 所有已登录用户
current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
```

### 前端权限检查

| 方法 | 用途 |
|------|------|
| `Auth.isAdmin()` | 删除按钮 |
| `Auth.canEdit()` | 新增/编辑按钮 |
| `Auth.canDownload()` | 导出/下载 |
| `Auth.canPreview()` | PDF 预览 |

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
2. 构建：`cd frontend; npm run build`（PowerShell 不支持 `&&`，需分开执行）
3. 刷新浏览器（注意清缓存 Ctrl+F5）
4. **重要**：每次前端修改后必须立即构建，无需用户提醒

### 新增 API

1. 在 `backend/app/routers/` 创建路由文件
2. 在 `backend/app/main.py` 注册路由
3. 在对应 `crud.py` / `schemas.py` 添加数据操作

---

## 🧪 测试

### 后端测试

```powershell
# 启动后端（开发模式）
cd backend
uvicorn app.main:app --reload --port 8000

# 或通过 Docker
docker-compose up -d --build backend
```

### 前端测试

```powershell
# 开发服务器（热更新）
cd frontend && npm run dev

# 生产构建
cd frontend && npm run build
```

### API 文档

- **Swagger UI**（在线调试）：http://localhost:8000/api/docs
- **ReDoc**（阅读友好）：http://localhost:8000/api/redoc
- **OpenAPI JSON**：http://localhost:8000/api/openapi.json

> 通过 Nginx 访问时替换为 `http://localhost:${NGINX_HOST_PORT:-8080}/api/docs`

---

## 🚀 部署

### Docker Compose

```powershell
cd D:\OpenCode\myPDM
docker-compose up -d
```

### 构建前端后重启 Nginx

```powershell
cd frontend && npm run build
docker-compose up -d --force-recreate nginx
```

### 验证服务

```powershell
docker ps
```

4 个容器均为 Up 时正常：
- bom_nginx      :80 → localhost:${NGINX_HOST_PORT:-8080}
- bom_backend   :8000
- bom_postgres  :5432
- bom_redis    :6379

### 新服务器部署

从旧环境迁移到新服务器，数据库和附件自动恢复：

```powershell
# 1. 拉取代码
git clone <repo-url> myPDM
cd myPDM

# 2. 从旧服务器复制数据目录
#    scp -r old-server:~/myPDM/pgdata ./
#    scp -r old-server:~/myPDM/uploads ./

# 3. 安装依赖并构建前端
cd frontend
npm install
npm run build
cd ..

# 4. 一键启动所有服务
docker-compose up -d
```

> **注意**：确保新旧服务器使用相同的 PostgreSQL 镜像版本（`postgres:16-alpine`），跨大版本不兼容。
> `./pgdata` 已存在时 PostgreSQL 会跳过 `./initdb/` 的初始化脚本，避免重复执行。

---

## 📂 数据存储配置

### 存储路径总览

| 数据 | 宿主机默认路径 | 容器内路径 | 配置方式 |
|------|---------------|-----------|---------|
| Nginx 端口 | `8080` | 80 | `.env` → `NGINX_HOST_PORT` |
| PostgreSQL 数据 | `./pgdata/` | `/var/lib/postgresql/data` | `.env` → `PGDATA_HOST_PATH` |
| 上传附件 | `./uploads/` | `/app/uploads` | `.env` → `UPLOADS_HOST_PATH` |

### 修改存储位置

通过 `.env` 文件配置宿主机路径（优先级高），或直接修改 `docker-compose.yml` 中的默认值：

```powershell
# 方式一: .env 文件（推荐）
# 编辑项目根目录的 .env 文件:
PGDATA_HOST_PATH=D:/data/pgdata
UPLOADS_HOST_PATH=D:/data/uploads

# 方式二: 直接在 docker-compose.yml 的 volumes 里改路径
```

> 如果未创建 `.env` 文件，默认使用 `./pgdata` 和 `./uploads`。

### 修改后生效

```powershell
docker-compose up -d
```

> **注意**: 修改路径后旧数据不会自动迁移，需手动复制：
> ```powershell
> # 停服务
> docker-compose down
> # 复制旧数据到新目录
> Copy-Item ./pgdata D:/data/pgdata -Recurse
> Copy-Item ./uploads D:/data/uploads -Recurse
> # 重新启动
> docker-compose up -d
> ```

### 附件上传路径（后端内部）

后端 `backend/app/file_storage.py` 通过环境变量读取容器内路径：

| 环境变量 | 当前值 | 说明 |
|---------|--------|------|
| `UPLOAD_DIR` | `/app/uploads` | 附件根目录（容器内） |
| `CHUNK_DIR` | `/app/uploads/chunks` | 分块上传临时目录 |

一般无需修改——宿主机路径通过 volume 映射到容器内，改 `UPLOADS_HOST_PATH` 即可。

---

## 🔧 常用命令

| 操作 | 命令 |
|------|------|
| 启动所有服务 | `docker-compose up -d` |
| 停止服务 | `docker-compose down` |
| 清除数据（慎用） | `docker-compose down -v` |
| 查看后端日志 | `docker logs bom_backend -f` |
| 重启后端 | `docker restart bom_backend` |
| 构建前端 | `cd frontend && npm run build` |
| 重启 Nginx | `docker-compose up -d --force-recreate nginx` |
| 备份数据库 | `docker exec bom_postgres pg_dump -U bomadmin bom_system > backup.sql` |

---

## 👤 演示账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | 123456 |
| 工程师 | engineer | 123456 |
| 生产人员 | production | 123456 |
| 访客 | guest | 123456 |

---

## 📝 API 接口概览

### 认证

- `POST /api/auth/token` - 登录
- `GET /api/auth/me` - 当前用户
- `POST /api/auth/change-password` - 修改密码

### 零件管理

- `GET/POST /api/parts/` - 列表/创建
- `GET/PUT/DELETE /api/parts/{part_id}` - 详情/更新/删除

### 部件管理

- `GET/POST /api/assemblies/` - 列表/创建
- `GET/PUT/DELETE /api/assemblies/{id}` - 详情/更新/删除

### BOM 管理

- `GET /api/bom/tree/{type}/{id}` - BOM 树
- `POST /api/bom/items` - 创建 BOM 关系
- `DELETE /api/bom/items/{item_id}` - 删除 BOM 关系
- `GET /api/bom/compare` - BOM 对比
- `GET /api/bom/trace` - BOM 反查

### 图文档管理

- `GET/POST /api/documents/` - 列表/创建
- `GET/PUT/DELETE /api/documents/{doc_id}` - 详情/更新/删除
- `POST /api/documents/{doc_id}/attachments` - 上传附件 (base64)
- `GET /api/documents/{doc_id}/attachments/` - 附件列表

### 附件管理 (V2)

| 端点 | 说明 |
|------|------|
| `POST /api/v2/attachments/upload` | Multipart 上传 |
| `GET /api/v2/attachments/{id}/stream` | 流式下载（二进制） |
| `GET /api/v2/attachments/{id}/download` | Base64 下载 |
| `GET /api/v2/attachments/{id}/preview?token=` | **浏览器内联预览**（PDF 流式加载） |
| `GET /api/v2/attachments/{id}/direct-download?token=` | 浏览器原生下载（显示进度） |
| `GET /api/v2/attachments/{id}/gltf` | STP → glTF 3D 预览 |
| `POST /api/v2/attachments/chunk/*` | 分块上传（init/upload/complete） |
| `DELETE /api/v2/attachments/{id}` | 删除附件 |

### 用户管理（仅 admin）

- `GET/POST /api/users/` - 用户列表/创建
- `GET/PUT/DELETE /api/users/{user_id}` - 用户 CRUD

### 用户看板

- `GET /api/dashboard/` - 获取看板数据
- `POST /api/dashboard/folders` - 创建文件夹
- `POST /api/dashboard/items` - 关联项目
- `POST /api/dashboard/folders/{id}/share` - 共享文件夹

---

## 🛠️ 关键设计决策

### PDF 预览

- PDF 附件通过 `/api/v2/attachments/{id}/preview?token={jwt}` 端点流式加载
- 新标签页 `window.open()` 打开，浏览器原生 PDF 查看器渲染
- 后端 `Content-Disposition: inline` + Range 请求支持，自动显示加载进度
- 非 PDF 格式弹窗提示"该格式暂不支持预览"

### 附件存储

- 文件存于 `./uploads/{entity_type}/{entity_id}/{filename}`
- 数据库 `document_attachments` 表仅存元数据（路径、大小、哈希）
- 支持分块上传（5MB/块），适合大文件

### 前端目录合并

- 源码目录 `frontend-next/` 已合并至 `frontend/`
- `frontend/` 为源码 + `dist/` 为构建输出
- Nginx 挂载 `./frontend/dist:/usr/share/nginx/html`

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

*最后更新: 2026-05-08*
