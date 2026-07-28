# myPDM 商业许可认证方案设计

- 日期：2026-07-28
- 状态：设计定稿，待实施
- 目标：为 myPDM 的商业销售提供密钥认证许可能力，控制**到期时间、用户数、功能模块、硬件绑定**四个维度

---

## 1. 目标与威胁模型

### 1.1 防护定位

防护到「一般技术人员」级别（客户方 IT 运维、普通 Python 开发者），不追求防专业破解。

判定标准：破解者必须逆向一个 Cython 编译的 `.so` 才能绕过校验，成本远高于付费意愿。

### 1.2 明确不做的事

- 不做在线激活服务器（客户多为工厂内网 Linux 服务器，无公网出口）
- 不做全量代码编译（Nuitka 全量编译与 SQLAlchemy/Pydantic 动态特性冲突，工程代价与收益不成比例）
- 不做数据量上限（条数限制易引发客户抵触，无商业必要）
- 不引入任何第三方商业授权库

### 1.3 部署前提（不满足则整套方案失效）

生产部署**必须**去掉 `docker-compose.yml` 中后端源码卷挂载 `./backend/app:/app/app` 和 `--reload`。当前开发配置带此挂载，客户可直接修改容器内 Python 文件。这是本方案的硬前提，通过独立的 `docker-compose.prod.yml` 落实。

---

## 2. 商业分级

### 2.1 两档标准版本

| 版本 | `edition` 值 | 包含能力 |
|---|---|---|
| 基础版 | `basic` | 用户看板、构型管理、零部件管理、图文档管理、AI 助手 |
| 全量版 | `full` | 基础版 + 变更管理、库存管理、项目管理、消息通知 |

### 2.2 模块门控范围

基础版 5 项能力为系统运行的必要组成（无零部件则无 BOM，无文档则无附件），**固化为恒开，不进门控表**。这样既简化逻辑，也避免签发时漏写模块导致客户系统瘫痪。

门控只作用于 3 个可选模块：

| 模块 | 路由前缀 | 说明 |
|---|---|---|
| `change` | `/api/ecrs`、`/api/ecos` | 变更管理 ECR/ECO |
| `inventory` | `/api/inventory` | 库存管理 |
| `project` | `/api/projects` | 项目管理 |

**消息通知（`/api/notifications`）不单独门控**，跟随全量模块自动开启：通知是变更/项目模块的配套设施，本身不产生独立业务价值；基础版无对应业务，通知列表天然为空。实现上 `/api/notifications` 始终放行。

### 2.3 恒开的基础设施路由

任何 license 状态下都不做模块门控（但仍受只读态约束）：

`/api/auth`、`/api/users`、`/api/user-groups`、`/api/parts`、`/api/bom`、`/api/documents`、`/api/dashboard`、`/api/configurations`、`/api/assistant`、`/api/custom-fields`、`/api/v2/attachments`、`/api/settings`、`/api/logs`、`/api/admin`、`/api/sync`、`/api/notifications`

---

## 3. License 文件格式

### 3.1 结构

`license.lic` 为 Base64 文本文件，解码后是 JSON：

```json
{
  "payload": {
    "license_id": "LIC-2026-0042",
    "customer": "某某机械有限公司",
    "machine_code": "a3f29c81-4d07e5b2-77c10fa9",
    "issued_at": "2026-07-28",
    "expires_at": "2027-07-28",
    "grace_days": 15,
    "max_users": 50,
    "modules": ["change", "inventory", "project"],
    "edition": "full"
  },
  "signature": "<Ed25519 签名, base64>"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `license_id` | string | 签发流水号，用于台账追溯 |
| `customer` | string | 客户名称，前端展示 |
| `machine_code` | string | 三段式硬件指纹，见 §4 |
| `issued_at` | date | 签发日期 `YYYY-MM-DD` |
| `expires_at` | date | 到期日期；永久授权写 `9999-12-31` |
| `grace_days` | int | 宽限天数，默认 15 |
| `max_users` | int | 启用状态用户数上限 |
| `modules` | string[] | 已授权的**可选**模块，取值域 `change`/`inventory`/`project` |
| `edition` | string | `basic` / `full`，仅用于前端展示，不参与校验 |

### 3.2 签名机制

算法：**Ed25519**。

选择理由：公钥仅 32 字节（便于内嵌进 `.so` 且不显眼）、签名验证快、`cryptography` 库原生支持、无参数选择陷阱（对比 RSA 需选 padding/hash）。

签名对象为 `payload` 的 canonical JSON 序列化，签发端与验证端必须使用**完全一致**的序列化方式：

```python
json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
```

这是最易出 bug 的环节，序列化方式在 `verifier.py` 和签发工具中必须共用同一份常量定义。

### 3.3 存放与审计

- 文件路径：`/app/uploads/license/license.lic`（复用已有 uploads 卷，客户升级镜像不丢失）
- 同时将 payload 落一份到数据库 `licenses` 表，**仅用于展示历史与审计**
- **校验永远以文件 + 验签为准，绝不读取数据库中的值**（否则改库即可提权）

### 3.4 密钥管理

- 密钥对由 `tools/license_issuer/keygen.py` **一次性生成，此后永不重新生成**
- 公钥在镜像构建期通过构建参数注入 `verifier.py` 源码，编译进 `.so`，不入版本库
- 私钥 `private_key.pem` 仅存于签发者本机，加入 `.gitignore`，**离线备份至少两份**

> **单点故障警示**：私钥丢失 = 所有存量客户无法续期、无法扩容。这是整套方案唯一的单点故障，必须在实施前完成备份方案。

---

## 4. 硬件指纹

### 4.1 三源特征

全部取**宿主机**特征（容器内 MAC/hostname 每次重建都变，不可用）：

| 源 | 宿主路径 | 容器内挂载点 | 稳定性 |
|---|---|---|---|
| 主板 UUID | `/sys/class/dmi/id/product_uuid` | `/host/product_uuid` | 最稳，虚拟机亦唯一 |
| machine-id | `/etc/machine-id` | `/host/machine-id` | 重装系统会变 |
| 网卡 MAC | `/sys/class/net` | `/host/net` | 换网卡会变 |

compose 中新增三条只读挂载：

```yaml
- /sys/class/dmi/id/product_uuid:/host/product_uuid:ro
- /etc/machine-id:/host/machine-id:ro
- /sys/class/net:/host/net:ro
```

MAC 采集规则：遍历 `/host/net/*/address`，排除 `lo` 及虚拟网卡（`docker*`、`veth*`、`br-*`、`virbr*`），剩余地址排序后取第一个。

### 4.2 机器码生成

三源各自 `sha256` 后取前 8 位 hex，以 `-` 拼接：

```
machine_code = f"{h(uuid)[:8]}-{h(machine_id)[:8]}-{h(mac)[:8]}"
```

展示给客户的机器码即此串。

### 4.3 容错匹配

验证时三源逐段比对，**≥2 段匹配即判定为同一台机器**。

效果：换网卡、重装系统仍可继续使用；整机更换则三段全不匹配，判定为非法。

### 4.4 降级兜底

某一源读不到时该段记为 `NULL`，不计入分母，规则变为「所有可读源全部匹配」。

三源全部读不到时，机器码退化为 `DOCKER-<uploads 卷首次初始化时生成的随机 UUID 前 8 位>`，该 UUID 写入 `/app/uploads/license/.machine`。

> 目标客户为 Linux 物理/虚拟服务器，兜底路径预期不会触发。若未来面向 Windows/Mac 的 Docker Desktop 客户，`product_uuid` 取到的是 Docker VM 的值、重建 VM 会变，届时硬件绑定强度会打折——但仍能防住「license 文件被拷贝给另一家公司」这一主要泄露场景。

---

## 5. 状态机与拦截

### 5.1 五种状态

由缓存的 license 计算得出，进程内缓存 TTL 60 秒，上传新 license 时主动失效。

| 状态 | 触发条件 | 行为 |
|---|---|---|
| `VALID` | 验签通过、指纹匹配、未过期 | 全放行 |
| `GRACE` | 已过期但在 `grace_days` 内 | 全放行 + 响应头 `X-License-Warning` |
| `READONLY` | 过期超出宽限期 | 写操作 403 |
| `TAMPERED` | 验签失败 或 指纹不匹配 | 写操作 403，**无宽限期** |
| `MISSING` | 无 license 文件（新部署） | 写操作 403，前端引导上传 |

指纹不匹配无宽限期，是防「license 文件拷贝到另一台机器」的硬边界。

### 5.2 中间件拦截逻辑

`middleware.py` 注册在 CORS 之后、鉴权之前：

```
1. 白名单直接放行：
   /api/license/*、/api/auth/login、/docs、/redoc、/openapi.json、静态资源
2. 请求路径命中未授权模块前缀 → 403（不区分请求方法，GET 亦拦截）
   {"detail": "该模块未授权", "license_state": "MODULE_DENIED"}
3. GET / HEAD / OPTIONS → 放行
   （只读能力永远保留，含所有 /export、/download 导出接口）
4. 写方法 且 state ∈ {READONLY, TAMPERED, MISSING} → 403
   {"detail": "许可证已过期或无效，系统处于只读模式", "license_state": "READONLY"}
5. 其余放行
```

模块门控（第 2 条）必须排在只读放行（第 3 条）**之前**，否则未授权模块的 GET 会被第 3 条提前放行，等于白送该模块的全部数据查看能力。

模块前缀映射表硬编码于 `state.py`，编译进 `.so`。

### 5.3 用户数上限

不走中间件，在两处 CRUD 入口单点校验：**创建用户**、**将用户由停用改为启用**。

```python
state.check_user_quota(db)  # 超限抛 403
```

- 统计口径：`is_active = True` 的用户数
- 超限提示：「已达授权用户数上限 N，请联系供应商扩容」
- 超限**不影响存量用户登录与使用**，仅阻止新增/启用

### 5.4 处置策略总览

| 情形 | 处置 |
|---|---|
| license 过期（宽限期内） | 正常使用，顶部黄色横幅告警 |
| license 过期（超宽限期） | 只读降级，数据可查可导出 |
| license 被篡改 / 指纹不符 | 立即只读，无宽限 |
| 用户数超限 | 不降级，仅阻止新建/启用用户 |
| 模块未授权 | 该模块路由 403，前端菜单隐藏 |

设计原则：客户数据始终可查看、可导出。避免把商务续费问题升级为「数据被扣押」的事故投诉。

---

## 6. 组件划分

新增自包含模块 `backend/app/licensing/`，与业务代码零耦合：

| 组件 | 文件 | 职责 | 是否编译 |
|---|---|---|---|
| 指纹采集 | `fingerprint.py` | 读三源特征，合成/比对机器码 | ✅ `.so` |
| 验签解析 | `verifier.py` | Ed25519 验签、解析 payload、内嵌公钥 | ✅ `.so` |
| 状态机 | `state.py` | 综合到期/宽限/指纹/模块/配额，产出 `LicenseState`；含模块前缀映射表 | ✅ `.so` |
| 中间件 | `middleware.py` | FastAPI 中间件，按状态拦截请求 | ❌ `.pyc` |
| 路由 | `router.py` | 许可相关 HTTP 接口 | ❌ `.pyc` |
| 模型 | `models_license.py` | `licenses` 审计表 | ❌ `.pyc` |

只编译前三个文件：破解者要绕过许可必须改的就是验签与状态判定这几十行，把这部分变为 `.so` 即可将成本推高到目标威胁模型之上。`middleware.py`/`router.py` 只是调用者，改不动结论。

新增外部依赖：仅 `cryptography`。

### 6.1 HTTP 接口

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/license/status` | 已登录 | 返回状态、客户名、版本、到期日、剩余天数、模块、用户数用量 |
| GET | `/api/license/machine-code` | 管理员 | 返回本机机器码 |
| POST | `/api/license/upload` | 管理员 | 上传 `.lic`，验签通过才落盘并失效缓存 |

`/api/license/*` 全部在中间件白名单内，保证只读态下仍可上传新 license 自救。

---

## 7. 前端

沿用现有页面（构型管理）风格：`primary-*` 配色、共享 Modal、统一表格与工具栏。

1. **许可管理页** `/settings/license`（仅管理员可见）
   展示客户名、版本、到期日、剩余天数、已授权模块、用户数用量 `12 / 50`、机器码（一键复制），以及 `.lic` 拖拽上传区。

2. **全局状态横幅**（主布局顶部）
   - `GRACE`：黄色横幅「许可证已过期，剩余 N 天宽限期，请尽快联系供应商续期」
   - `READONLY` / `TAMPERED` / `MISSING`：红色横幅 + 「上传许可证」按钮
   状态在登录后一次性 `GET /api/license/status` 获取，存入全局 store。

3. **菜单按模块隐藏**
   未授权模块的侧边栏入口不渲染。

4. **403 统一处理**
   axios 响应拦截器识别响应体中的 `license_state` 字段，弹出统一许可提示而非通用错误。

前端只负责**体验**，不负责**安全**。所有拦截以后端为准；隐藏菜单纯粹是不展示未购买的能力。

---

## 8. 签发工具

`tools/license_issuer/`，签发者本机运行的 Python CLI，**不进 Docker 镜像、不进客户交付物**。

```bash
# 一次性生成密钥对
python keygen.py --out ./keys

# 签发
python issue.py \
  --customer "某某机械有限公司" \
  --machine-code "a3f29c81-4d07e5b2-77c10fa9" \
  --expires 2027-07-28 \
  --max-users 50 \
  --edition full \
  --out ./licenses/某某机械_20260728.lic
```

- `--edition basic|full` 自动展开为 `modules` 数组（`basic` → `[]`，`full` → `["change","inventory","project"]`）
- 支持 `--modules` 覆盖，用于定制单
- 每次签发追加一行到 `issued.csv` 台账：流水号、客户、机器码、到期日、用户数、模块、签发时间

---

## 9. 打包与交付

### 9.1 镜像构建

`backend/Dockerfile` 增加编译阶段：

1. build stage 安装 `cython`，将 `licensing/{fingerprint,verifier,state}.py` 编译为 `.so`
2. 公钥在编译前由构建参数 `--build-arg LICENSE_PUBKEY=...` 注入源文件
3. 最终镜像只 COPY `.so`，对应 `.py` 源文件不进镜像
4. 业务代码以 `.pyc` 形式进入镜像，不含 `.py`

### 9.2 生产 compose

新增 `docker-compose.prod.yml`，与开发版的关键差异：

| 项 | 开发 | 生产 |
|---|---|---|
| 后端源码挂载 | `./backend/app:/app/app` | **删除** |
| uvicorn | `--reload` | 无 |
| `APP_ENV` | `development` | `production` |
| 指纹挂载 | 无 | 三条 `:ro` 挂载 |
| backend 镜像 | `build:` 本地构建 | `image:` 引用私有仓库预构建镜像 |

### 9.3 交付物清单

`docker-compose.prod.yml`、`nginx/nginx.conf`、`initdb/`、`frontend/dist/`、后端镜像 tar（或私有 registry 拉取凭据）、部署文档。

**不含 `backend/` 源码目录，不含 `tools/license_issuer/`。**

---

## 10. 测试

后端 pytest，遵循现有 `backend/tests/` 规范。指纹采集通过注入伪造的 `/host` 根目录隔离，不依赖真实硬件。

| 用例 | 断言 |
|---|---|
| 有效 license | `state == VALID`，写操作 200 |
| payload 篡改 1 字节 | `state == TAMPERED`，无宽限，写 403 |
| 签名字段被替换 | `state == TAMPERED` |
| 过期 1 天，`grace_days=15` | `state == GRACE`，写 200，响应头含 `X-License-Warning` |
| 过期 20 天，`grace_days=15` | `state == READONLY`，POST 403、GET 200 |
| 指纹 3 段全不匹配 | `state == TAMPERED` |
| 指纹 1 段不匹配 | `state == VALID`（容错生效） |
| 指纹 2 段不匹配 | `state == TAMPERED` |
| 单源不可读 + 其余匹配 | `state == VALID` |
| 三源全不可读 | 退化机器码生效且稳定（两次调用一致） |
| 无 license 文件 | `state == MISSING`，`/api/auth/login` 仍可用 |
| 未授权模块 `/api/inventory` | GET 与 POST 均 403 |
| 已授权模块 | 正常放行 |
| `/api/notifications` @ basic | 放行（不门控） |
| 用户数达上限时创建用户 | 403 |
| 用户数达上限时存量用户登录 | 200 |
| 导出接口 @ `READONLY` | 200 |
| `/api/license/upload` @ `READONLY` | 可用（白名单生效） |
| canonical JSON 序列化一致性 | 签发工具与 `verifier` 产出字节完全相同 |

---

## 11. 工期估算

| 阶段 | 人日 |
|---|---|
| 后端 `licensing` 模块 + 单元测试 | 2.0 |
| 前端许可页 / 横幅 / 菜单门控 / 403 处理 | 1.0 |
| Dockerfile 编译链 + `docker-compose.prod.yml` | 1.0 |
| 签发工具 CLI + 台账 | 0.5 |
| 端到端联调（真实 Linux 服务器） | 1.0 |
| **合计** | **5.5** |

---

## 12. 实施前必须完成的准备

1. 生成 Ed25519 密钥对，并完成私钥的两份离线备份
2. 准备一台 Linux 服务器用于端到端联调（Windows 本机无法验证真实指纹路径）
3. 确认私有镜像仓库地址（或确定以 tar 包方式交付）
