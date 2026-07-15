# CATIA PDM 集成 — 设计文档

> **日期**: 2026-07-15
> **分支**: `feat/cad-pdm-integration`
> **阶段**: 一期 — CATIA 支持

---

## 1. 概述

### 1.1 目标

在 myPDM 系统中集成 CATIA CAD 软件，实现在浏览器前端直接操作 CATIA 装配体，完成 BOM 识别、属性双向同步、签入签出和附件管理。

### 1.2 核心思路

在用户本地 Windows 机器上运行一个 **CAD 桥接服务**（Python 后台进程），通过 COM 接口与 CATIA 互操作，通过 WebSocket 与浏览器前端通信。所有业务逻辑和 UI 均在浏览器前端实现，桥接服务仅做 COM 调用和文件中转。

### 1.3 范围（一期）

| 功能 | 说明 |
|------|------|
| CATIA 装配体 BOM 识别 | 读取 CATIA 活动文档的产品结构树 |
| 零部件属性双向同步 | CATIA ↔ PDM 按名称匹配属性，可编辑写回 CATIA |
| 零部件签入签出 | 复用现有 PDM 签入签出机制，手动文件同步 |
| CAD 附件上传 | CATPart/CATProduct/CATDrawing 上传到 PDM |
| 生产附件上传 | PDF + STP 上传到 PDM |
| BOM 匹配与创建 | CATIA 零件号匹配 PDM 件号，自动创建新零部件 |

---

## 2. 架构

### 2.1 三层模型

```
┌─────────────────────────────────────────────────┐
│                 用户机器 (Windows)                 │
│                                                   │
│  ┌──────────┐   WebSocket    ┌───────────────┐   │
│  │ 浏览器前端 │ ◄──────────► │ CAD 桥接服务    │   │
│  │ React SPA │  ws://127.0.0.1│ Python+pywin32 │   │
│  └────┬─────┘               └───────┬───────┘   │
│       │ HTTPS                        │ COM        │
│       ▼                              ▼            │
│  ┌──────────┐               ┌───────────┐       │
│  │ PDM 后端  │               │  CATIA    │       │
│  │ FastAPI  │               │  Application│      │
│  └──────────┘               └───────────┘       │
└─────────────────────────────────────────────────┘
```

### 2.2 组件划分

| 组件 | 技术 | 职责 |
|------|------|------|
| **浏览器前端** | React + TypeScript | CAD 工作台 UI、BOM 匹配面板、签入签出操作、附件管理 |
| **CAD 桥接服务** | Python 3.12 + pywin32 + websockets | CATIA COM 互操作、PDM API 代理、文件下载/上传中转 |
| **CATIA** | CATIA V5/V6 COM Server | 装配体数据源、属性读写、文件保存/导出 |
| **PDM 后端** | FastAPI（现有） | 零部件/BOM CRUD、签入签出、附件存储 |

### 2.3 桥接服务模块

```
cad_bridge/
├── __main__.py              # 统一入口，启动 WebSocket 服务
├── server.py                # WebSocket 服务端，JSON-RPC 消息路由（共用）
├── pdm_client.py            # PDM API 代理（附件上传/下载，JWT 透传）（共用）
├── catia/                   # CATIA 桥接
│   ├── client.py            # CATIA COM 互操作（检测/读取/写入）
│   └── field_mapper.py      # 字段映射（CATIA属性 ↔ PDM字段）
└── sw/                      # SolidWorks 桥接（二期）
    ├── client.py            # SolidWorks COM 互操作
    └── field_mapper.py      # 字段映射（SW属性 ↔ PDM字段）
```

### 2.4 关键设计原则

- 桥接服务为**纯后台进程**，无 GUI，命令行启动
- 桥接服务**不做业务逻辑**，仅做 COM 调用和 PDM API 中转
- JWT 令牌由**浏览器前端传入**，桥接服务透传给 PDM 后端
- WebSocket 仅在 **127.0.0.1** 监听，外部无法访问
- 桥接服务为**无状态**设计，不持久化任何数据

---

## 3. WebSocket 协议

### 3.1 消息格式

采用 JSON-RPC 风格，所有消息为 JSON 文本帧：

**请求：**
```json
{
  "id": 1,
  "method": "catia.detect",
  "params": {},
  "token": "eyJ..."
}
```

**响应：**
```json
{
  "id": 1,
  "result": { "active_doc": "FRONT-ASSY.CATProduct", "doc_type": "Product" }
}
```

**错误：**
```json
{
  "id": 1,
  "error": { "code": "CATIA_NOT_FOUND", "message": "未检测到 CATIA 进程" }
}
```

### 3.2 命令清单

| # | Method | 说明 | 分类 |
|---|--------|------|------|
| 1 | `catia.ping` | 检测桥接服务是否在线 | 状态 |
| 2 | `catia.detect` | 检测 CATIA 是否运行，返回活动文档信息 | 状态 |
| 3 | `catia.assembly.read_tree` | 读取当前装配体的完整产品结构树 | BOM |
| 4 | `catia.assembly.read_properties` | 读取指定零部件的所有属性和自定义参数 | BOM |
| 5 | `catia.property.write` | 写入指定零部件的属性（即时生效到 CATIA） | 属性 |
| 6 | `catia.file.export` | 导出 STP/IGS 等中性格式到本地（可选） | 文件 |
| 7 | `workspace.download` | 从 PDM 下载附件到本地工作目录 | 文件 |
| 8 | `workspace.upload` | 上传本地文件到 PDM 附件（透传） | 文件 |

### 3.3 明确不纳入 Bridge 的操作

以下操作由浏览器前端直接调用 PDM HTTPS API，不经过桥接服务：

- 零部件 CRUD（创建/更新/查询/软删除）
- BOM 关系 CRUD（创建/删除 BOM 关联）
- 签出/签入/撤销签出（调用现有 PDM API）
- 版本升级、状态变更（冻结/发布/作废）
- 自定义字段读写

---

## 4. 前端 UI 设计

### 4.1 CAD 入口按钮

**位置**：`PartsPage.tsx` 工具栏，"新增零件"按钮左侧

```
[搜索字段▼] [搜索框] [状态▼] [✓全部版本]  ...  [⚙️ CAD入口] [+ 新增零件]
```

- 天蓝色 (`bg-sky-500`) 按钮，与蓝色 `+ 新增零件` 区分
- 点击后打开 CAD 工作台 Modal

### 4.2 CAD 工作台 — 三步流程

Modal 全屏，分三个步骤标签页：

| 步骤 | 内容 | 操作 |
|------|------|------|
| ① 连接 CATIA | 显示 CATIA 连接状态 + 活动文档信息 | "读取装配结构" |
| ② BOM 匹配 | 13 列匹配表格（核心界面） | 匹配确认、属性编辑、签入签出、附件上传 |
| ③ 完成 | 操作结果摘要 | 关闭 |

### 4.3 BOM 匹配面板（13 列）

| # | 列名 | 说明 | 分类 |
|---|------|------|------|
| 1 | 层级 | BOM 树层级编号（0, 1.1, 1.1.1...） | 结构 |
| 2 | CATIA PartNumber | CATIA 零件号 | 标识 |
| 3 | CATIA 名称 | CATIA 零部件实例名 | 标识 |
| 4 | 规格型号 | CATIA 属性，可编辑→写回 CATIA | 双向编辑 |
| 5 | 重量(kg) | CATIA 属性，可编辑→写回 CATIA | 双向编辑 |
| 6 | 存货类别 | CATIA 属性，可编辑→写回 CATIA | 双向编辑 |
| 7 | 物料类型 | CATIA 属性，可编辑→写回 CATIA | 双向编辑 |
| 8 | 📐 CAD附件 | 已有数量 + 上传按钮(签出时) | 附件 |
| 9 | 📦 生产附件 | 已有数量 + PDF上传 + STP上传(签出时) | 附件 |
| 10 | PDM匹配 | 匹配到的 PDM 零部件（件号+版本） | 匹配 |
| 11 | 匹配状态 | 已匹配 / 可新建 / 冲突 | 匹配 |
| 12 | 签出状态 | 未签出 / 已签出 / 他人签出 | 签出 |
| 13 | 操作 | 签出/签入/撤销/属性→PDM/属性←PDM/创建零件 | 操作 |

### 4.4 操作按钮可见性矩阵

| 签出状态 | 签出 | 签入 | 属性→PDM | 属性←PDM | 撤销 | 创建零件 | 上传附件 |
|----------|------|------|----------|----------|------|----------|----------|
| 未签出 | ✓ | — | — | ✓ | — | — | — |
| 已签出(本用户) | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| 他人签出 | — | — | — | ✓ | — | — | — |
| 可新建(无PDM) | — | — | — | — | — | ✓ | — |

### 4.5 附件上传规则

- **CAD附件列**：⬆ 上传按钮 → 上传 CATPart/CATProduct/CATDrawing
- **生产附件列**：⬆ PDF 按钮 + ⬆ STP 按钮 → 分别上传 PDF/STP
- 所有上传按钮**仅本用户签出状态可用**
- 未签出/他人签出时显示灰色禁用态 + 已有文件数量

### 4.6 属性编辑规则

- 未签出和已签出状态：属性输入框可编辑，修改后即时通过 `catia.property.write` 写回 CATIA
- 他人签出状态：属性输入框禁用（灰底）

---

## 5. CATIA COM 互操作

### 5.1 COM 对象层次

```
CATIA.Application
  └── Documents
       └── ActiveDocument (ProductDocument)
            └── Product (根产品)
                 ├── PartNumber, Name, Nomenclature, Revision
                 ├── ReferenceProduct → Document
                 ├── Position (位置矩阵)
                 ├── Products (子产品集合)
                 │    └── Product[0]...Product[n] → 递归
                 ├── UserRefProperties (自定义属性)
                 └── Parameters (参数集合)
```

### 5.2 核心方法

```python
def detect_catia() -> dict:
    """COM GetObject 检测已运行的 CATIA，返回活动文档信息"""

def read_assembly_tree(product, level=0) -> dict:
    """递归读取 Product 树，返回 BOM 结构（含层级、零件号、实例名、是否装配）"""

def read_properties(product) -> dict:
    """读取内置属性(PartNumber/Revision/Definition)
     + 所有 UserRefProperties 自定义属性，以字典返回"""

def write_property(product, prop_name, value) -> None:
    """写入属性。内置属性直接 setattr，自定义属性写入 UserRefProperties
     （不存在则 Add，存在则修改 Value）"""
```

### 5.3 字段映射规则

| CATIA 属性 | 来源 | PDM 字段 | 方向 |
|------------|------|----------|------|
| PartNumber | 内置 | 件号 (code) | 双向 |
| Revision | 内置 | 版本 (version) | 双向 |
| Definition | 内置 | 中文名称 (name) | 双向 |
| 规格型号 | UserRefProperties | 规格型号 (spec) | 双向 |
| 重量(kg) | UserRefProperties | 自定义字段 "重量(kg)" | 双向 |
| 存货类别 | UserRefProperties | 自定义字段 "存货类别" | 双向 |
| 物料类型 | UserRefProperties | 自定义字段 "物料类型" | 双向 |
| ...任意属性名 | UserRefProperties | 同名的 PDM 自定义字段 | 双向 |

**匹配逻辑**：
1. `PartNumber` → `code`（固定映射）
2. `Revision` → `version`（固定映射）
3. `Definition` → `name`（固定映射）
4. CATIA UserRefProperties 属性名直接作为 PDM 字段名查找：
   - 先匹配 PDM 内置字段（如 spec）
   - 再匹配 PDM 自定义字段
   - 同名即匹配，无需前缀，无需额外配置
5. CATIA 中有但 PDM 中不存在的属性名 → 忽略

---

## 6. 数据流

### 6.1 CAD 入口完整流程

```
1. 用户点击 "CAD入口"
2. 前端通过 WebSocket 调用 catia.ping → 确认桥接服务在线
3. 前端通过 WebSocket 调用 catia.detect → 获取 CATIA 活动文档信息
4. 显示 "① 连接CATIA" 步骤，展示连接状态
5. 用户点击 "读取装配结构"
6. 前端通过 WebSocket 调用 catia.assembly.read_tree → 获取产品树
7. 前端通过 WebSocket 批量调用 catia.assembly.read_properties → 获取各节点属性
8. 前端批量调用 PDM API 搜索匹配（件号匹配） → 标记匹配状态
9. 展示 "② BOM匹配" 面板，13列表格
10. 用户操作：
    a. 编辑 CATIA 属性 → catia.property.write → 即时写回 CATIA
    b. 创建新零件 → PDM HTTPS API → 创建 PartMaster
    c. 签出 → PDM HTTPS API → 签出零部件
    d. 签入 → 上传 CAD 附件 → PDM HTTPS API → 签入零部件
    e. 属性→PDM → PDM HTTPS API → 更新零部件属性和自定义字段
    f. 属性←PDM → PDM HTTPS API 查询 → catia.property.write → 写回 CATIA
    g. 上传附件 → workspace.upload → PDM 附件 API
11. 完成，关闭 Modal
```

### 6.2 签出文件同步流程

```
签出：
1. 前端调用 PDM API: POST /parts/revisions/{id}/checkout
2. 前端调用 bridge: workspace.download(attachment_id, local_dir)
3. 桥接服务下载附件到 ./cad_workspace/{零件号}/{版本号}/
4. 用户在 CATIA 中打开/修改文件

签入：
1. 用户在 CATIA 中保存修改
2. 用户点击 "上传" → 选择本地的 CATPart 文件
3. 前端调用 bridge: workspace.upload(file_path, revision_id, category="cad")
4. 桥接服务上传文件到 PDM 附件 API (V2 分块上传)
5. 前端调用 PDM API: POST /parts/revisions/{id}/checkin
```

---

## 7. 错误处理

| 场景 | 桥接服务返回 | 前端处理 |
|------|------------|---------|
| CATIA 未运行 | `CATIA_NOT_FOUND` | 提示用户启动 CATIA |
| CATIA 无活动文档 | `NO_ACTIVE_DOC` | 提示用户打开装配体 |
| COM 调用超时 | `COM_TIMEOUT` | 提示重试，建议关闭重开 CATIA |
| PDM API 调用失败 | 透传错误响应 | 标准错误提示 |
| 文件上传失败 | `UPLOAD_FAILED` | 提示重试或手动上传 |
| WebSocket 断连 | — | 自动重连 UI 提示 |

---

## 8. 部署与启动

### 8.1 桥接服务安装

```powershell
# 在用户 Windows 机器上
cd cad_bridge
pip install -r requirements.txt  # pywin32, websockets, httpx
```

### 8.2 桥接服务启动

```powershell
python -m cad_bridge --port 9527 --pdm-url https://localhost:8080/api
```

### 8.3 开机自启（可选）

使用 Windows Task Scheduler 或 startup 文件夹配置自动启动。

---

## 9. 文件结构

### 新增文件

```
myPDM/
├── cad_bridge/                         # 新增：CAD 桥接服务
│   ├── __main__.py                     # 统一入口
│   ├── server.py                       # WebSocket 服务（共用）
│   ├── pdm_client.py                   # PDM API 代理（共用）
│   ├── catia/                          # CATIA 桥接
│   │   ├── client.py
│   │   └── field_mapper.py
│   ├── sw/                             # SolidWorks 桥接（二期）
│   │   ├── client.py
│   │   └── field_mapper.py
│   └── requirements.txt
├── frontend/src/
│   ├── components/CADWorkspace/       # 新增：CAD 工作台组件
│   │   ├── CADWorkspaceModal.tsx      # 三步流程 Modal 容器
│   │   ├── CADConnectStep.tsx         # ① 连接CATIA
│   │   ├── CADBOMMatchTable.tsx       # ② BOM 匹配表格（核心）
│   │   ├── CADCompleteStep.tsx        # ③ 完成
│   │   └── useCADBridge.ts            # WebSocket 连接管理 Hook
│   └── services/
│       └── cadBridge.ts               # 桥接服务 API 封装
```

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/pages/PartsPage.tsx` | 工具栏增加 "CAD入口" 按钮 |

---

## 10. 二期展望

- SolidWorks 支持（复用同一桥接架构，增加 `sw/client.py`）
- CATIA 选择联动（选择 CATIA 中的零件 → BOM 面板高亮对应行）
- 级联签出/签入（BOM 树批量操作）
- 自动目录同步（签出时自动下载，保存时自动上传）

---

*设计文档版本: v1.0 · 2026-07-15*
