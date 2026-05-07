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
| 架构 | 单页应用 (SPA) + RESTful API |

### 核心功能

- **零件管理**: 物料清单全生命周期管理
- **部件管理**: 部件层级管理
- **图文档管理**: 图纸文档与附件管理
- **BOM 管理**: BOM 对比、BOM 反查、图文档反查
- **用户看板**: 用户自定义数据看板
- **数据同步**: 本地缓存与服务器同步

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
| 文件处理 | aiofiles |

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

**入口目录**: `frontend-next/` (开发中)
**构建输出**: `frontend/`

### 基础设施

| 服务 | 容器名 | 端口 |
|------|--------|------|
| Nginx | bom_nginx | 80 (映射 8080) |
| FastAPI | bom_backend | 8000 |
| PostgreSQL | bom_postgres | 5432 |
| Redis | bom_redis | 6379 |

---

## 📂 项目结构

```
D:\OpenCode\myPDM\
├── frontend/                  # 前端单文件 SPA
│   ├── index.html          # 主入口
│   ├── preview.html      # 附件预览页
│   ├── js/             # JavaScript 模块
│   ├── css/             # 样式文件
│   └── html/            # HTML 片段
├── backend/               # FastAPI 后端
│   ├── app/
│   │   ├── main.py      # FastAPI 入口
│   │   ├── models.py    # SQLAlchemy 模型
│   │   ├── schemas.py   # Pydantic schemas
│   │   ├── crud.py     # 数据库操作
│   │   ├── database.py # 数据库连接
│   │   ├── routers/   # API 路由
│   │   │   ├── auth.py
│   │   │   ├── parts.py
│   │   │   ├── assemblies.py
│   │   │   ├── bom.py
│   │   │   ├── documents.py
│   │   │   ├── attachments*.py
│   │   │   ├── users.py
│   │   │   ├── logs.py
│   │   │   ├── dashboard.py
│   │   │   ├── custom_fields.py
│   │   │   └── dict.py
│   │   ├── bom/         # BOM 业务逻辑
│   │   │   ├── compare.py
│   │   │   └── ...
│   │   └── file_storage.py  # 文件存储
│   ├── requirements.txt
│   └── Dockerfile
├── nginx/                  # Nginx 配置
│   └── nginx.conf
├── initdb/                # 数据库初始化
│   └── init.sql
├── uploads/               # 上传文件目录
├── docker-compose.yml
├── Dockerfile.nginx
└── 项目说明/               # 项目文档
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

### 前端 (HTML/CSS/JS)

- **文件结构**: 单一 `index.html` 文件（包含所有页面模块）
- **JavaScript**: 原生 ES6+，使用 async/await
- **CSS**: 模块化（base.css, components.css, pages.css）
- **HTML 片段**: 放在 `frontend/html/` 目录，按需加载

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
| `Auth.canPreview()` | 预览 |

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

直接编辑 `frontend/index.html`，浏览器刷新即可。

### 新增 API

1. 在 `backend/app/routers/` 创建路由文件
2. 在 `backend/app/main.py` 注册路由
3. 在对应 `crud.py` / `schemas.py` 添加数据操作

---

## 🧪 测试

### 后端测试

```powershell
# 启动后端
cd backend
uvicorn app.main:app --reload --port 8000

# 或通过 Docker
docker-compose up -d --build backend
```

### 前端测试

直接访问 http://localhost:8080

### API 文档

http://localhost:8080/api/docs

---

## 🚀 部署

### Docker Compose

```powershell
cd D:\OpenCode\myPDM
docker-compose up -d
```

### 验证服务

```powershell
docker ps
```

4 个容器均为 Up 时正常：
- bom_nginx      :80
- bom_backend   :8000
- bom_postgres  :5432
- bom_redis    :6379

---

## 🔧 常用命令

| 操作 | 命令 |
|------|------|
| 启动所有服务 | `docker-compose up -d` |
| 停止服务 | `docker-compose down` |
| 清除数据（慎用） | `docker-compose down -v` |
| 查看后端日志 | `docker logs bom_backend -f` |
| 重启后端 | `docker restart bom_backend` |
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
- `POST /api/attachments/upload` - 上传附件
- `GET /api/attachments/{id}/download` - 下载
- `GET /api/attachments/{id}/preview` - 预览

### 用户管理（仅 admin）

- `GET/POST /api/users/` - 用户列表/创建
- `GET/PUT/DELETE /api/users/{user_id}` - 用户 CRUD

---

## 🛠️ 工具偏好

| 类别 | 工具 |
|------|------|
| API 测试 | Swagger UI (/api/docs) |
| 数据库客户端 | psql、DBeaver |
| 容器管理 | Docker Desktop |
| 日志查看 | docker logs |

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

*最后更新: 2026-05-07*