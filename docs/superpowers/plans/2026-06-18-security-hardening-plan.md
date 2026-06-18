# 安全加固实施计划

> **关联 Spec**: `docs/superpowers/specs/2026-06-18-security-hardening-design.md`
> **日期**: 2026-06-18
> **状态**: 待执行

---

## 执行概览

| 阶段 | 内容 | 涉及文件 | 预计影响 |
|------|------|---------|---------|
| 1 | Nginx 安全加固 | `nginx/nginx.conf` | 需重启 Nginx |
| 2 | 基础设施加固 | `docker-compose.yml`, `backend/Dockerfile` | 需重建容器 |
| 3 | 应用层加固 | `auth.py`, `main.py`, `file_storage.py`, `database.py` | 需重启后端 |
| 4 | 密钥轮换 | `.env`, Git 历史 | 需重启后端 |

---

## 阶段 1: Nginx 安全加固

### 文件: `nginx/nginx.conf`

| 步骤 | 操作 |
|------|------|
| 1.1 | 在 `server` 块 SSL 配置后添加 6 个安全响应头 |
| 1.2 | 在 `http` 上下文（通过 `server` 前插入）添加 `limit_req_zone` 和 `limit_conn_zone` |
| 1.3 | 在 `/api/auth/token` location 添加 `limit_req zone=login burst=5 nodelay` |
| 1.4 | 在 `/api/` location 添加 `limit_req zone=api burst=20 nodelay` 和 `limit_conn connperip 20` |
| 1.5 | 全局 `client_max_body_size` 从 `1G` 改为 `10m` |
| 1.6 | `/api/` location 内设置 `client_max_body_size 100m` |
| 1.7 | 添加 `ssl_prefer_server_ciphers on`, `server_tokens off` |
| 1.8 | 添加 `proxy_hide_header X-Powered-By` |

### 验证

```powershell
docker-compose up -d --force-recreate nginx
# 检查响应头
curl -k -I https://localhost:8080
# 验证登录限流
for i in {1..20}; do curl -k -X POST https://localhost:8080/api/auth/token -H "Content-Type: application/json" -d '{"username":"test","password":"wrong"}'; done
```

---

## 阶段 2: 基础设施加固

### 2.1 文件: `docker-compose.yml`

| 步骤 | 操作 |
|------|------|
| 2.1a | 移除 backend 服务的 `ports: - "8000:8000"` |
| 2.1b | 为所有 4 个服务添加 `restart: unless-stopped` |
| 2.1c | Redis 服务添加 `command: redis-server --requirepass ${REDIS_PASSWORD}` |
| 2.1d | Backend 环境变量添加 `JWT_SECRET=${JWT_SECRET}` 和 `REDIS_PASSWORD=${REDIS_PASSWORD}` |

### 2.2 文件: `backend/Dockerfile`

| 步骤 | 操作 |
|------|------|
| 2.2a | 在 `COPY ./app ./app` 之后添加: `RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app` |
| 2.2b | 在 `CMD` 之前添加: `USER appuser` |

### 2.3 文件: `backend/app/database.py`

| 步骤 | 操作 |
|------|------|
| 2.3a | 添加 `REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")` |
| 2.3b | Redis 连接添加 `password=REDIS_PASSWORD if REDIS_PASSWORD else None` |

### 验证

```powershell
docker-compose up -d --force-recreate postgres redis backend
# 确认 8000 端口不可访问
curl http://localhost:8000/health   # 应失败
# 确认通过 Nginx 可访问
curl -k https://localhost:8080/api/health
```

---

## 阶段 3: 应用层加固

### 3.1 文件: `backend/app/routers/auth.py`

| 步骤 | 操作 |
|------|------|
| 3.1a | 修改 `SECRET_KEY` 获取逻辑：无默认值，强制从环境变量读取 |
| 3.1b | 移除 `APP_ENV=production` 的条件判断，始终检查密钥安全性 |

```python
# 变更前:
SECRET_KEY = os.getenv("JWT_SECRET", "bom-secret-key-change-in-production")
if os.getenv("APP_ENV", "production") == "production" and SECRET_KEY == "bom-secret-key-change-in-production":
    raise RuntimeError("生产环境必须设置 JWT_SECRET")

# 变更后:
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError("必须设置 JWT_SECRET 环境变量，生成命令: openssl rand -hex 32")
if len(SECRET_KEY) < 32:
    raise RuntimeError("JWT_SECRET 长度不足，至少需要 32 个字符")
```

### 3.2 文件: `backend/app/main.py`

| 步骤 | 操作 |
|------|------|
| 3.2a | CORS `allow_origins` 从 `["*"]` 改为从 `CORS_ORIGINS` 环境变量读取 |
| 3.2b | `allow_methods` 从 `["*"]` 改为显式列表 |

```python
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "https://localhost:8080").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["*"],
)
```

### 3.3 文件: `backend/app/file_storage.py`

| 步骤 | 操作 |
|------|------|
| 3.3a | 添加 `ALLOWED_ENTITY_TYPES` 白名单并校验 `entity_type` |
| 3.3b | 添加 `ALLOWED_EXTENSIONS` 白名单和 `_validate_filename()` 方法 |
| 3.3c | `_get_file_path()` 添加 `..` 过滤和 `resolve()` + `is_relative_to()` 校验 |
| 3.3d | `read_file()` 添加路径遍历防护 |
| 3.3e | `delete_file()` 添加路径遍历防护 |
| 3.3f | 在 `save_file()` 中调用 `_validate_filename()` |

### 3.4 文件: `backend/app/schemas.py`

| 步骤 | 操作 |
|------|------|
| 3.4a | 在 `ChangePasswordRequest` 添加 `new_password` 复杂度校验（>=8位, 含大小写数字） |

### 验证

```powershell
docker restart bom_backend
# 确认 JWT_SECRET 未设置时后端拒绝启动
# 确认正常启动后 API 可访问
```

---

## 阶段 4: 密钥轮换

### 4.1 DeepSeek API Key

| 步骤 | 操作 |
|------|------|
| 4.1a | 登录 https://platform.deepseek.com → API Keys → 删除旧 key |
| 4.1b | 创建新 key |
| 4.1c | 更新 `.env` 中的 `DEEPSEEK_API_KEY` |
| 4.1d | `docker restart bom_backend` |

### 4.2 JWT Secret

| 步骤 | 操作 |
|------|------|
| 4.2a | `openssl rand -hex 32` 生成密钥 |
| 4.2b | 写入 `.env`: `JWT_SECRET=<生成的密钥>` |
| 4.2c | `docker restart bom_backend`（所有用户需重新登录） |

### 4.3 PostgreSQL 密码

| 步骤 | 操作 |
|------|------|
| 4.3a | `openssl rand -base64 24` 生成密码 |
| 4.3b | 更新 `.env`: `POSTGRES_PASSWORD=<新密码>` |
| 4.3c | 更新 `docker-compose.yml` postgres 和 backend 服务的 `POSTGRES_PASSWORD` |
| 4.3d | `docker-compose up -d --force-recreate postgres backend` |
| 4.3e | 若使用已有 pgdata，需同步修改数据库内密码 |

### 4.4 Git 历史清理

```powershell
# 从所有历史记录中移除 .env
git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch .env' --prune-empty --tag-name-filter cat -- --all
# 强制推送
git push origin --force --all
git push origin --force --tags
```

---

## 执行顺序

```
阶段 1 (Nginx) ──→ 阶段 2 (基础设施) ──→ 阶段 3 (应用层) ──→ 阶段 4 (密钥)
     │                    │                      │                  │
     └─ 重启 nginx        └─ 重建容器             └─ 重启后端        └─ 手动操作
```

---

## 回滚方案

如需回滚全部变更:

```powershell
git checkout <变更前 commit SHA> -- nginx/nginx.conf docker-compose.yml backend/Dockerfile backend/app/
docker-compose up -d --force-recreate
```

---

## 检查清单

- [ ] 安全响应头出现在所有页面响应中
- [ ] 登录接口速率限制可触发 503
- [ ] 正常使用频率不触发速率限制
- [ ] 上传白名单内文件类型成功
- [ ] 上传被禁止的文件类型返回错误
- [ ] 路径遍历攻击尝试被阻止
- [ ] 后端 8000 端口不可从宿主机直接访问
- [ ] API 仅可通过 Nginx HTTPS 访问
- [ ] CORS 非白名单来源被拒绝
- [ ] 容器以非 root 用户运行
- [ ] AI 助手功能正常（新 API Key 生效）
- [ ] 用户登录正常（JWT 签发和验证）
- [ ] 文件上传/下载功能正常
