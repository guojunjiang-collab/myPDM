# 安全加固方案设计

> **状态**: 草稿
> **日期**: 2026-06-18
> **版本**: v1.0
> **关联**: myPDM 系统安全审计报告

---

## 1. 背景与范围

### 1.1 背景

对 myPDM 系统进行了全面安全审查，发现 CRITICAL 6 项、HIGH 6 项、MEDIUM 5 项安全漏洞。本方案针对这些漏洞提出系统性加固措施。

### 1.2 范围

| 层 | 涉及组件 | 加固项数 |
|---|---------|---------|
| 网络层 | Nginx | 5 |
| 基础设施层 | Docker Compose / Dockerfile | 4 |
| 应用层 | FastAPI (main.py, auth.py, file_storage.py) | 5 |
| 密钥管理 | .env / Git | 2 |

### 1.3 不在范围

- CA 签发证书（当前自签名证书适用于内网/开发环境，生产部署时再替换）
- WAF / IDS 部署
- 第三方渗透测试

---

## 2. 加固方案详设

### 2.1 Nginx 安全加固

**目标**: 防御点击劫持、MIME 嗅探、XSS、降级攻击、暴力破解、DoS

#### 2.1.1 安全响应头

在 `server` 块中添加以下响应头：

| 响应头 | 值 | 防护目标 |
|--------|-----|---------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | 强制 HTTPS，防降级攻击 |
| `X-Frame-Options` | `DENY` | 防止点击劫持 |
| `X-Content-Type-Options` | `nosniff` | 防止 MIME 类型嗅探 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 限制 Referer 泄露 |
| `X-XSS-Protection` | `1; mode=block` | 启用浏览器 XSS 过滤器 |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | 限制浏览器特性滥用 |

> 不添加 CSP（Content-Security-Policy）：SPA 应用的 CSP 需要精细调校，容易误拦合法资源，待后续迭代专项处理。

#### 2.1.2 速率限制

```nginx
# 定义限速区域: 10MB 内存, 10 请求/秒
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

# 连接数限制: 每个 IP 最多 20 并发
limit_conn_zone $binary_remote_addr zone=connperip:10m;
```

- `/api/auth/token` 登录接口: `limit_req zone=login burst=5 nodelay`（10r/s，突发 5）
- `/api/` 其他接口: `limit_req zone=api burst=20 nodelay`（30r/s，突发 20）
- 全局限流: `limit_conn connperip 20`（每 IP 20 并发连接）

#### 2.1.3 请求体大小分层限制

```nginx
# 全局默认（静态资源/前端路由）
client_max_body_size 10m;

# /api/ 接口（含附件上传）
location /api/ {
    client_max_body_size 100m;  # 上传限制 100MB，与后端 MAX_FILE_SIZE 对齐
}
```

> 原配置 1G 过大，且对前端静态路由 `/` 也生效造成 DoS 风险。

#### 2.1.4 其他 Nginx 加固

- `ssl_prefer_server_ciphers on;` — 强制使用服务器端密码套件偏好
- `server_tokens off;` — 隐藏 Nginx 版本号
- `proxy_hide_header X-Powered-By;` — 隐藏后端框架信息

---

### 2.2 基础设施加固

#### 2.2.1 移除后端端口直接暴露

**文件**: `docker-compose.yml`

```yaml
# 移除以下行:
#   ports:
#     - "8000:8000"
```

后端仅通过 `bom_network` 内部网络供 Nginx 代理访问，不直接暴露到宿主机。

#### 2.2.2 容器非 root 运行

**文件**: `backend/Dockerfile`

```dockerfile
# 在 COPY 之后、CMD 之前添加:
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser
```

**文件**: `Dockerfile.nginx`

`nginx:alpine` 基础镜像已使用 `nginx` 用户，无需额外修改，但需确认 `/usr/share/nginx/html` 权限正确。

#### 2.2.3 服务自动重启与资源限制

**文件**: `docker-compose.yml`

为每个服务添加:
```yaml
restart: unless-stopped
# 可选资源限制（适量配置）
# deploy:
#   resources:
#     limits:
#       memory: 512M
```

#### 2.2.4 Redis 密码认证

**文件**: `docker-compose.yml`

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD not set}
```

**文件**: `backend/app/database.py`

```python
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
redis_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASSWORD if REDIS_PASSWORD else None,
    decode_responses=True,
)
```

---

### 2.3 应用层加固

#### 2.3.1 JWT 密钥强化

**文件**: `backend/app/routers/auth.py`

```python
# 前:
SECRET_KEY = os.getenv("JWT_SECRET", "bom-secret-key-change-in-production")
if os.getenv("APP_ENV", "production") == "production" and SECRET_KEY == "bom-secret-key-change-in-production":
    raise RuntimeError("生产环境必须设置 JWT_SECRET")

# 后:
SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError("必须设置 JWT_SECRET 环境变量")
if SECRET_KEY == "bom-secret-key-change-in-production":
    raise RuntimeError("JWT_SECRET 不能使用默认弱密钥")
ALGORITHM = "HS256"
```

**配套变更**:
- `docker-compose.yml` backend 环境变量中添加 `JWT_SECRET=${JWT_SECRET}`
- `.env` 中添加 `JWT_SECRET=<生成强随机值>`
- 生成命令: `openssl rand -hex 32`

#### 2.3.2 CORS 限制

**文件**: `backend/app/main.py`

```python
# 前:
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    ...
)

# 后:
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "https://localhost:8080").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["*"],
)
```

`CORS_ORIGINS` 支持逗号分隔多域名，开发环境默认 `https://localhost:8080`。

#### 2.3.3 文件上传安全加固

**文件**: `backend/app/file_storage.py`

**a) 路径遍历防护**

在 `_get_file_path()` 方法中:
1. `entity_type` 必须匹配白名单: `{"document", "part", "assembly"}`
2. `folder_name` 阻止 `..` 序列和空字节
3. 最终路径做 `resolve()` 后校验 `is_relative_to(base_dir)`

```python
ALLOWED_ENTITY_TYPES = {"document", "part", "assembly"}

def _get_file_path(self, entity_type, entity_id, filename, folder_name=None):
    if entity_type not in ALLOWED_ENTITY_TYPES:
        raise ValueError(f"无效的实体类型: {entity_type}")

    dir_name = str(entity_id)
    if folder_name:
        sanitized = folder_name.strip().strip('.')
        illegal_chars = r'\/:*?"<>|\x00'
        for ch in illegal_chars:
            sanitized = sanitized.replace(ch, '_')
        dir_name = sanitized if sanitized else str(entity_id)

    entity_dir = (self.base_dir / entity_type / dir_name).resolve()
    if not entity_dir.is_relative_to(self.base_dir.resolve()):
        raise ValueError("非法文件路径")
    entity_dir.mkdir(parents=True, exist_ok=True)

    file_path = (entity_dir / filename).resolve()
    if not file_path.is_relative_to(self.base_dir.resolve()):
        raise ValueError("非法文件路径")
    return file_path
```

**b) 文件扩展名白名单**

```python
ALLOWED_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.dwg', '.dxf', '.stp', '.step', '.igs', '.iges',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.zip', '.rar', '.7z',
    '.glb', '.gltf', '.obj',
    '.txt', '.csv',
}

def _validate_filename(self, filename: str):
    ext = filename.lower().rsplit('.', maxsplit=1)[-1]
    if f'.{ext}' not in ALLOWED_EXTENSIONS:
        raise ValueError(f"不允许的文件类型: .{ext}")
    if '..' in filename or '/' in filename or '\\' in filename:
        raise ValueError("文件名包含非法字符")
```

**c) 文件读取/删除路径遍历防护**

`read_file()` / `delete_file()` 添加 resolve + is_relative_to 校验:

```python
def read_file(self, file_path):
    full_path = (self.base_dir / file_path).resolve()
    if not full_path.is_relative_to(self.base_dir.resolve()):
        raise ValueError("非法文件路径")
    if not full_path.exists():
        raise FileNotFoundError(...)
    with open(full_path, 'rb') as f:
        return f.read()
```

#### 2.3.4 密码复杂度校验

**文件**: `backend/app/schemas.py`

在 `ChangePasswordRequest` 中添加:

```python
@validator('new_password')
def validate_password_strength(cls, v):
    if len(v) < 8:
        raise ValueError('密码长度不能少于8位')
    if not re.search(r'[A-Z]', v):
        raise ValueError('密码需包含大写字母')
    if not re.search(r'[a-z]', v):
        raise ValueError('密码需包含小写字母')
    if not re.search(r'\d', v):
        raise ValueError('密码需包含数字')
    return v
```

---

### 2.4 密钥管理

#### 2.4.1 DeepSeek API Key 轮换

| 步骤 | 操作 |
|------|------|
| 1 | 登录 DeepSeek 平台，吊销旧 key `sk-8452898bce93...` |
| 2 | 生成新 key |
| 3 | 更新 `.env` 中的 `DEEPSEEK_API_KEY` |
| 4 | 清理 Git 历史: `git filter-branch` 移除含 key 的提交 |
| 5 | `docker restart bom_backend` 使新 key 生效 |

#### 2.4.2 PostgreSQL 密码强化

| 步骤 | 操作 |
|------|------|
| 1 | 生成强密码: `openssl rand -base64 24` |
| 2 | 更新 `docker-compose.yml` 中 `POSTGRES_PASSWORD` |
| 3 | 更新 `.env` 中 `POSTGRES_PASSWORD` |
| 4 | 重建数据库容器 `docker-compose up -d --force-recreate postgres` |

---

## 3. 变更影响评估

| 变更项 | 影响范围 | 风险 |
|--------|---------|------|
| Nginx 安全头 | 所有页面 | 低 — 标准安全头，不影响功能 |
| Nginx 速率限制 | API 请求 | **中** — 需确认系统正常使用不触发限制（10r/s 登录, 30r/s API）|
| Nginx body 限制 | 大文件上传 | 低 — 100MB 对附件上传足够 |
| 移除 8000 端口 | 直接 API 访问 | **中** — 用户/脚本若直连 8000 端口将不可用 |
| CORS 限制 | 跨域访问 | 低 — 仅影响非白名单来源 |
| 容器非 root | 文件系统写入 | 低 — uploads 目录需调整权限 |
| JWT 密钥变更 | 令牌有效性 | 低 — 重启后旧令牌全部失效，用户需重新登录 |
| 文件扩展名白名单 | 文件上传 | 低 — 只拦截非业务文件类型 |
| 路径遍历防护 | 文件读写 | 低 — 正常业务路径不受影响 |

---

## 4. 测试要点

- [ ] 登录接口速率限制触发后返回 503
- [ ] 正常操作频率下 API 不限流
- [ ] 安全响应头存在于所有响应
- [ ] 上传允许的文件类型成功
- [ ] 上传被禁止的文件类型返回错误
- [ ] 路径遍历攻击路径被阻止
- [ ] 修改密码后旧 JWT 仍有效（当前行为，后续迭代增加吊销）
- [ ] CORS 非白名单来源被拒绝
- [ ] 后端 8000 端口不可从宿主机访问
- [ ] 容器内非 root 用户可读写 uploads

---

## 5. 后续迭代建议（不在本期范围）

| 项目 | 优先级 | 说明 |
|------|--------|------|
| CSP 策略 | P1 | 细粒度内容安全策略，防 XSS |
| JWT 令牌吊销 | P1 | 添加 `jti` + Redis 黑名单 |
| Refresh Token 轮换 | P1 | 每次刷新时换发新 token |
| 文件恶意软件扫描 | P2 | 集成 ClamAV |
| 镜像 digest 固定 | P2 | `docker-compose.yml` 使用 SHA256 |
| 数据库连接 SSL | P3 | `sslmode=require` |
| 容器健康检查 | P3 | Docker healthcheck |
