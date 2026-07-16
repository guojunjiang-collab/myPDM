# CAD 桥接服务使用说明

> myPDM 系统的本地 CAD 桥接服务，通过 COM 接口与 CATIA 互操作，为浏览器前端提供装配体读取、属性读写、附件中转能力。

---

## 1. 功能简介

| 功能 | 说明 |
| ---- | ---- |
| CATIA 检测 | 检测本机 CATIA 是否运行及活动文档信息 |
| 装配结构读取 | 递归读取活动装配体的产品结构树（含各级子项属性） |
| 属性双向同步 | 读取/写入零部件内置属性与自定义属性（UserRefProperties） |
| 附件中转 | 从 PDM 下载附件到本地工作目录、上传本地文件到 PDM（分块上传） |

架构说明：

```
┌──────────────────────────────────────────────────┐
│  用户本地 Windows 机器                             │
│  ┌───────────┐  WebSocket   ┌─────────────────┐  │
│  │ 浏览器前端 │ ◄──────────► │ CAD 桥接服务     │  │
│  │ (CAD入口) │              │ (本服务, :9527)  │  │
│  └─────┬─────┘              └────┬───────┬─────┘  │
│        │ HTTPS                COM│       │HTTPS   │
│        ▼                         ▼       ▼        │
│  ┌───────────┐              ┌───────┐ ┌────────┐  │
│  │ PDM 后端  │              │ CATIA │ │PDM 后端│  │
│  └───────────┘              └───────┘ └────────┘  │
└──────────────────────────────────────────────────┘
```

- 桥接服务为**纯后台进程**，无 GUI，不做业务逻辑，仅做 COM 调用和文件中转
- JWT 令牌由浏览器前端传入，桥接服务透传给 PDM 后端，**不存储任何凭据**
- 服务为无状态设计，可随时重启

---

## 2. 系统要求

| 项目 | 要求 |
| ---- | ---- |
| 操作系统 | Windows 10/11（COM 接口要求） |
| Python | 3.10 及以上（推荐 3.12） |
| CATIA | V5/V6，需与桥接服务运行在**同一台机器** |
| 网络 | 可访问 PDM 服务器（HTTPS） |

---

## 3. 安装

```powershell
# 进入项目目录
cd D:\OpenCode\myPDM

# 安装依赖
pip install -r cad_bridge\requirements.txt
```

依赖清单（`requirements.txt`）：

| 依赖 | 用途 |
| ---- | ---- |
| pywin32 | CATIA COM 互操作 |
| websockets | WebSocket 服务端 |
| httpx | PDM API 调用（附件上传/下载） |

---

## 4. 启动

```powershell
cd D:\OpenCode\myPDM
python -m cad_bridge
```

启动成功后输出：

```
CAD 桥接服务启动中...
  WebSocket: ws://127.0.0.1:9527
  PDM 后端: https://localhost:8080/api
```

### 命令行参数

| 参数 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `--port` | `9527` | WebSocket 监听端口 |
| `--host` | `127.0.0.1` | 监听地址（仅本机访问） |
| `--pdm-url` | `https://localhost:8080/api` | PDM 后端地址，附件上传/下载使用 |

示例（PDM 服务器在远程时）：

```powershell
python -m cad_bridge --port 9527 --pdm-url https://pdm.example.com:8080/api
```

### 停止服务

在运行窗口按 `Ctrl+C`，或：

```powershell
Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
  Where-Object { $_.CommandLine -match 'cad_bridge' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

---

## 5. 使用流程

1. **启动 CATIA**，打开要处理的装配体（CATProduct）
2. **启动桥接服务**（见上文）
3. 浏览器登录 myPDM，进入 **零部件管理** 页面
4. 点击工具栏 **"CAD入口"** 按钮，打开 CAD 工作台
5. 按三步流程操作：
   - **① 连接CATIA**：点击"检测 CATIA"确认连接，再点"读取装配结构"
   - **② BOM匹配**：查看装配树与 PDM 匹配结果，可编辑属性（即时写回 CATIA）、签出/签入、创建零件、上传附件
   - **③ 完成**：查看处理摘要

### 浏览器连接方式

| 页面协议 | 连接地址 | 说明 |
| -------- | -------- | ---- |
| HTTPS | `wss://<PDM地址>/ws/bridge` | 经 Nginx 代理转发到宿主机 9527 端口 |
| HTTP | `ws://<本机>:9527` | 直连桥接服务 |

> **注意**：Nginx 的 `/ws/bridge` 代理指向 Docker 宿主机（`host.docker.internal:9527`）。
> 当前方案要求**桥接服务与 PDM 服务器部署在同一台机器**（浏览器页面为 HTTPS 时）。
> 若桥接服务运行在其他机器，需调整 `nginx/nginx.conf` 中的代理目标地址。

---

## 6. 字段映射配置

文件：`cad_bridge/catia/field_mapping.json`，用户可自行修改，改后重启服务生效。

```json
{
  "builtin": {
    "PartNumber": "code",
    "Revision": "version",
    "Definition": "name"
  },
  "properties": {
    "规格型号": "spec",
    "重量(kg)": "重量(kg)",
    "存货类别": "存货类别",
    "物料类型": "物料类型"
  }
}
```

| 区块 | 规则 |
| ---- | ---- |
| `builtin` | CATIA 内置属性 → PDM 固定字段（`code`/`name`/`version`/`spec`） |
| `properties` | CATIA 自定义属性（UserRefProperties）→ PDM 字段，key 为 CATIA 属性名，value 为 PDM 字段名 |
| 未列出的属性 | 忽略，不参与同步 |

---

## 7. JSON-RPC 接口

WebSocket 消息格式（请求）：

```json
{ "id": 1, "method": "catia.detect", "params": {}, "token": "<JWT>" }
```

响应：

```json
{ "id": 1, "result": { "active": true, "has_document": true, "doc_name": "Product1.CATProduct" } }
```

| 方法 | 说明 |
| ---- | ---- |
| `catia.ping` | 检测桥接服务是否在线 |
| `catia.detect` | 检测 CATIA 是否运行，返回活动文档信息 |
| `catia.assembly.read_tree` | 读取活动装配体产品结构树（含各级属性） |
| `catia.assembly.read_properties` | 读取指定路径零部件的全部属性，参数 `{ "path": "0.1" }` |
| `catia.property.write` | 写入属性，参数 `{ "path": "0.1", "prop_name": "规格型号", "value": "M8x20" }` |
| `workspace.download` | 下载 PDM 附件到本地 `./cad_workspace/{零件号}/{版本号}/` |
| `workspace.upload` | 上传本地文件到 PDM 零部件附件（V2 分块上传） |

> **属性读写说明**：CATIA 装配中的子节点为实例（Instance），属性统一从其
> **ReferenceProduct（引用产品）** 读写，与 CATIA「属性」对话框行为一致。

---

## 8. 常见问题排查

| 现象 | 错误码 | 处理方法 |
| ---- | ------ | -------- |
| 前端提示"无法连接到 CAD 桥接服务" | — | 确认桥接服务已启动、端口 9527 未被占用；HTTPS 页面需确认 Nginx `/ws/bridge` 代理已配置并重启 Nginx |
| 提示"未检测到 CATIA 进程" | `CATIA_NOT_FOUND` | 先启动 CATIA，再点"检测 CATIA"；确认 CATIA 与桥接服务在同一台机器 |
| CATIA 已运行但检测失败 | `CATIA_NOT_FOUND` | CATIA COM 注册异常，以管理员身份运行一次 CATIA；查看服务日志中 `GetObject 失败` 详情 |
| 提示"未打开任何文档" | `NO_ACTIVE_DOC` | 在 CATIA 中打开装配体（CATProduct）后重试 |
| 子零件属性为空 | — | 确认属性写在零部件的引用文档上（CATIA 属性对话框可见）；升级到包含 ReferenceProduct 修复的版本 |
| COM 调用卡死/超时 | `COM_TIMEOUT` | CATIA 正在执行交互操作（如弹窗未关闭），关闭 CATIA 弹窗后重试；必要时重启 CATIA |
| 附件下载/上传失败 | — | 确认 `--pdm-url` 指向正确地址；自签名证书环境下服务默认跳过 SSL 校验 |

### 查看日志

服务日志直接输出到控制台。若以后台方式启动并重定向了日志：

```powershell
Get-Content <日志路径> -Tail 50
```

---

## 9. 文件结构

```
cad_bridge/
├── __main__.py              # 入口（参数解析 + 方法注册）
├── server.py                # WebSocket JSON-RPC 服务端
├── pdm_client.py            # PDM API 代理（附件下载/分块上传）
├── requirements.txt         # Python 依赖
└── catia/
    ├── client.py            # CATIA COM 互操作客户端
    └── field_mapping.json   # CATIA-PDM 属性映射配置（可自定义）
```

---

*配套设计文档：`docs/superpowers/specs/2026-07-15-catia-pdm-integration-design.md`*
