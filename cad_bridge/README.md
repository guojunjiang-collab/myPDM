# CAD 桥接服务使用说明

> myPDM 系统的本地 CAD 桥接服务，通过 COM 接口与 CATIA 互操作，为浏览器前端提供装配体读取、属性读写、矩阵读取、STP/PDF 导出、附件中转能力。

---

## 1. 功能简介

| 功能       | 说明                                                                                |
| -------- | --------------------------------------------------------------------------------- |
| CATIA 检测 | 检测本机 CATIA 是否运行及活动文档信息                                                            |
| 装配结构读取   | 递归读取活动装配体的产品结构树（含各级子项属性、实例变换矩阵、源文档路径）                                             |
| 属性双向同步   | 读取/写入零部件内置属性与自定义属性（UserRefProperties）                                             |
| 字段映射下发   | 向前端提供 CATIA-PDM 字段映射（`field_mapping.json`），作为属性推送的单一事实源                           |
| 源文件直传    | 将 CATIA 源文件（.CATPart/.CATProduct）直接上传为 PDM CAD 附件，同名覆盖；同目录同名 .CATDrawing 工程图可一并上传 |
| STP 导出上传 | 将零部件导出为 STP 并上传为 PDM 生产附件（同名覆盖）                                                   |
| 工程图转 PDF | 查找零部件同目录同名 .CATDrawing，后台转 PDF 并上传为生产附件（同名覆盖）                                     |
| 附件中转     | 从 PDM 下载附件到本地工作目录、上传本地文件到 PDM（分块上传）                                               |

架构说明：

```
┌──────────────────────────────────────┐
│  用户本地 Windows 机器                 │
│  ┌───────────┐  WebSocket            │        ┌───────────┐
│  │ 浏览器前端 │ ◄──────────►  CAD 桥接服务      │ PDM 服务器 │
│  │ (CAD入口) │  ws://127.0.0.1:9527  │        │ (可为远程) │
│  └─────┬─────┘         COM│    │HTTPS │        └───────────┘
│        │ HTTPS            ▼    └──────┼──────────────▲
│        └──────────────► CATIA         │  附件上传/下载 │
└──────────────────────────────────────┘
```

- 桥接服务为**纯后台进程**，无 GUI，不做业务逻辑，仅做 COM 调用和文件中转
- JWT 令牌由浏览器前端传入，桥接服务透传给 PDM 后端，**不存储任何凭据**
- 服务为无状态设计，可随时重启
- 桥接服务必须与 CATIA 运行在**同一台机器**；PDM 服务器可以是本机或远程

---

## 2. 系统要求

| 项目     | 要求                                                       |
| ------ | -------------------------------------------------------- |
| 操作系统   | Windows 10/11（COM 接口要求）                                  |
| Python | 3.10 及以上（推荐 3.12）                                        |
| CATIA  | V5/V6，需与桥接服务运行在**同一台机器**                                 |
| 网络     | 可访问 PDM 服务器（HTTPS）                                       |
| 浏览器    | Chrome / Edge / Firefox（HTTPS 页面直连本机回环 WebSocket 需现代浏览器） |

---

## 3. 安装

```powershell
# 进入项目目录
cd D:\OpenCode\myPDM

# 安装依赖
pip install -r cad_bridge\requirements.txt
```

依赖清单（`requirements.txt`）：

| 依赖         | 用途                  |
| ---------- | ------------------- |
| pywin32    | CATIA COM 互操作       |
| websockets | WebSocket 服务端       |
| httpx      | PDM API 调用（附件上传/下载） |

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
  PDM 地址由浏览器前端动态提供（无需手动指定）
```

> **注意**：PDM 地址由浏览器前端自动传入（基于当前浏览器地址栏），无需也不应手动指定 `--pdm-url`。
> 无论 PDM 部署在本机还是远程服务器，前端会自动将正确的地址传给桥接服务。

### 命令行参数

| 参数          | 默认值                          | 说明                 |
| ----------- | ---------------------------- | ------------------ |
| `--port`    | `9527`                       | WebSocket 监听端口     |
| `--host`    | `127.0.0.1`                  | 监听地址（仅本机访问）        |
| `--pdm-url` | （空）                      | PDM 后端回退地址（通常无需指定） |



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
2. **启动桥接服务**：`python -m cad_bridge`（PDM 地址由浏览器自动传入，无需额外参数）
3. 浏览器登录 myPDM，进入 **零部件管理** 页面
4. 点击工具栏 **"CAD入口"** 按钮，打开 CAD 工作台
5. 按三步流程操作：
   - **① 连接CATIA**：点击"检测 CATIA"确认连接，再点"读取装配结构"
   - **② BOM匹配**：
     - 进入时自动按 **件号+版本** 匹配 PDM（已匹配/版本冲突/可新建）；「重新匹配」会重新读取 CATIA 装配树并刷新全部数据
     - 同层级相同件号实例合并为一行并显示**用量**
     - 可编辑内置属性（版本/定义/术语/描述）与自定义属性，即时写回 CATIA 并按同件号实例同步
     - 「属性→」推送属性到 PDM（按字段映射，含自定义字段）；部件行同时推送 **BOM 直接子项**（新子项自动创建零部件，含实例变换矩阵）
     - 「上传源文件」直传 CATIA 源文件（+同名 CATDrawing）为 CAD 附件；「STP」/「PDF」导出并上传生产附件——均**同名覆盖**
   - **③ 完成**：查看处理摘要

### 浏览器连接方式

前端**固定直连本机** `ws://127.0.0.1:9527`。浏览器将回环地址视为可信来源，
HTTPS 页面直连 `ws://127.0.0.1` 不属于混合内容（Chrome/Edge/Firefox 均允许）。

> 历史方案（HTTPS 页面经 Nginx `/ws/bridge` 反代到宿主机 9527）已废弃：
> PDM 部署在远程服务器时，反代指向的是"服务器"的 9527 端口，而桥接运行在用户本机，
> 会导致连接一直失败。`nginx/nginx.conf` 中的 `/ws/bridge` 配置仅作保留，前端不再使用。

---

## 6. 字段映射配置

文件：`cad_bridge/catia/field_mapping.json`，用户可自行修改，改后重启服务生效。
前端通过 `mapping.get` 方法获取此映射，作为「属性→PDM」推送的单一事实源。

```json
{
  "builtin": {
    "PartNumber": "code",
    "Revision": "version",
    "Nomenclature": "name"
  },
  "properties": {
    "规格型号": "spec",
    "重量(kg)": "重量(kg)",
    "存货类别": "存货类别",
    "物料类型": "物料类型"
  }
}
```

| 区块           | 规则                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `builtin`    | CATIA 内置属性 → PDM 固定字段。`PartNumber→code`（件号）、`Nomenclature→name`（中文名称）、`Revision→version`（仅用于匹配，不推送）                     |
| `properties` | CATIA 自定义属性（UserRefProperties）→ PDM 字段。`规格型号→spec` 为固定字段；其余按 **PDM 自定义字段显示名精确匹配** 写入自定义字段值（number 类型自动转数值，PDM 未定义的字段跳过） |
| 未列出的属性       | 忽略，不参与同步                                                                                                                |

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

| 方法                               | 说明                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `catia.ping`                     | 检测桥接服务是否在线                                                                                                                  |
| `catia.detect`                   | 检测 CATIA 是否运行，返回活动文档信息                                                                                                      |
| `catia.assembly.read_tree`       | 读取活动装配体产品结构树。每节点含 `builtin`/`user_properties`/`matrix`（实例相对父装配的 4x4 行主序矩阵，平移 mm）/`doc_path`（源文档路径）                          |
| `catia.assembly.read_properties` | 读取指定路径零部件的全部属性，参数 `{ "path": "0.1" }`                                                                                       |
| `catia.property.write`           | 写入属性，参数 `{ "path": "0.1", "prop_name": "规格型号", "value": "M8x20" }`                                                          |
| `mapping.get`                    | 获取 CATIA-PDM 字段映射（`field_mapping.json` 内容）                                                                                  |
| `workspace.download`             | 下载 PDM 附件到本地 `./cad_workspace/{零件号}/{版本号}/`                                                                                 |
| `workspace.upload`               | 上传本地文件到 PDM 零部件附件（分块上传）。参数：`file_path`/`revision_id`/`category`/`overwrite`（同名覆盖）/`include_drawing`（同目录同名 .CATDrawing 一并上传） |
| `workspace.export_stp_upload`    | 将零部件导出 STP 并上传为生产附件（同名覆盖）。参数：`path`/`file_name`/`revision_id`                                                               |
| `workspace.export_pdf_upload`    | 将零部件同目录同名 .CATDrawing 转 PDF 并上传为生产附件（同名覆盖）。参数：`path`/`file_name`/`revision_id`                                              |

> **属性读写说明**：CATIA 装配中的子节点为实例（Instance），属性统一从其
> **ReferenceProduct（引用产品）** 读写，与 CATIA「属性」对话框行为一致。
> 
> **矩阵读取说明**：优先直接 COM 调用 `Position.GetComponents`；pywin32 对
> SAFEARRAY 按引用回写支持不完整时，自动回退 `SystemService.Evaluate` 执行
> VBScript 读取。读取统计见服务日志「装配树读取完成: 实例 N 个, 矩阵读取成功 M 个」。
> 
> **工程图约定**：CATDrawing 工程图需与零件源文件**同目录同名**（CATIA 常规
> 存盘习惯），`include_drawing` 上传与 PDF 导出均按此约定查找。

---

## 8. 常见问题排查

| 现象                          | 错误码               | 处理方法                                                               |
| --------------------------- | ----------------- | ------------------------------------------------------------------ |
| 前端提示"无法连接到 CAD 桥接服务"/检测一直转圈 | —                 | 确认桥接服务已启动、端口 9527 未被占用；前端固定直连 `ws://127.0.0.1:9527`，桥接必须与浏览器在同一台机器 |
| 提示"未检测到 CATIA 进程"           | `CATIA_NOT_FOUND` | 先启动 CATIA，再点"检测 CATIA"；确认 CATIA 与桥接服务在同一台机器                        |
| CATIA 已运行但检测失败              | `CATIA_NOT_FOUND` | CATIA COM 注册异常，以管理员身份运行一次 CATIA；查看服务日志中 `GetObject 失败` 详情          |
| 提示"未打开任何文档"                 | `NO_ACTIVE_DOC`   | 在 CATIA 中打开装配体（CATProduct）后重试                                      |
| 子零件属性为空                     | —                 | 确认属性写在零部件的引用文档上（CATIA 属性对话框可见）                                     |
| 推送 BOM 无变换矩阵                | —                 | 重启桥接服务并重新"读取装配结构"；查看日志矩阵读取统计与"读取实例矩阵失败"警告                          |
| "未获取到 CATIA 源文件路径"          | —                 | 在 CATIA 中保存文档（新建未存盘的文档无路径）后重新读取装配结构；重启桥接服务确保为含 `doc_path` 的版本      |
| "未找到工程图文件"                  | —                 | 确认 .CATDrawing 与零件源文件同目录同名                                         |
| COM 调用卡死/超时                 | `COM_TIMEOUT`     | CATIA 正在执行交互操作（如弹窗未关闭），关闭 CATIA 弹窗后重试；必要时重启 CATIA                  |
| 附件下载/上传失败                   | —                 | 确认 `--pdm-url` 指向正确地址（远程部署必须显式指定）；自签名证书环境下服务默认跳过 SSL 校验            |

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
├── pdm_client.py            # PDM API 代理（附件下载/分块上传/覆盖模式）
├── requirements.txt         # Python 依赖
└── catia/
    ├── client.py            # CATIA COM 互操作客户端（属性/矩阵/STP/PDF 导出）
    └── field_mapping.json   # CATIA-PDM 属性映射配置（可自定义）

cad_workspace/               # 本地工作目录（运行时生成，已加入 .gitignore）
├── {零件号}/{版本号}/        # 附件下载目录
├── stp_export/              # STP 导出临时目录
└── pdf_export/              # PDF 导出临时目录
```

---

*配套设计文档：`docs/superpowers/specs/2026-07-15-catia-pdm-integration-design.md`*
