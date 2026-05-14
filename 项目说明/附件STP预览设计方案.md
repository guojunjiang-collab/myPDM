# 附件 STP 三维预览 —— 设计方案

> **状态**: 已实现  
> **创建**: 2026-05-14  
> **更新**: 2026-05-14（根据实际实现更新）  
> **目标**: 图文档 STP/STEP 附件支持浏览器内三维模型预览

---

## 一、总体架构

```
用户上传 .stp/.step 附件
  ↓ (后端异步)
gmsh 读取 STP → 网格化 → 导出 STL → trimesh 转 glb
  ↓
存入 uploads/gltf_cache/{attachment_id}.glb
  ↓
用户点击「预览」→ window.open('/stp-viewer.html?id=&token=')
  ↓
独立页面动态创建 <model-viewer> Web Component (jsdelivr CDN)
  ↓
<model-viewer> 加载 GET /api/v2/attachments/{id}/gltf?token={jwt}
  ↓
后端从 gltf_cache/ 读取 .glb → 返回 model/gltf-binary
  ↓
浏览器渲染三维模型（旋转/缩放/平移）
```

---

## 二、后端

### 2.1 转换管道

**文件**: `backend/app/stp_to_gltf.py`

| 步骤 | 工具 | 格式 | 说明 |
|------|------|------|------|
| 1 | gmsh (Python API) | STP → STL | 读取 STEP 几何，生成三角网格 |
| 2 | trimesh | STL → glb | 加载网格，导出二进制 glTF |

**依赖**:
- `gmsh` pip 包 (4.15.2) — 需要系统 `libgmsh4.13` (apt)
- `gmsh` 系统包 (apt) — 提供 OpenCASCADE 7.8.1 CAD 内核
- `trimesh` pip 包 (4.12.2)

**Dockerfile** 配置:
- `apt-get install gmsh libgmsh4.13` — CAD 内核 + 运行时库
- `pip install gmsh trimesh` — Python 绑定

### 2.2 端点

#### `GET /api/v2/attachments/{id}/gltf?token={jwt}`

**文件**: `backend/app/routers/attachments_v2.py`

**认证**: `?token=` JWT 查询参数（与 `/preview`、`/archive-tree` 一致）

**处理逻辑**:
1. JWT 解码验证 → 权限检查 (guest 拒绝)
2. 查 `document_attachments` 表获取附件记录
3. 检查 `file_name` 扩展名是否为 `.stp` / `.step`
4. 从 `uploads/gltf_cache/{attachment_id}.glb` 读取缓存
5. 若无缓存 → 同步触发 `convert_stp_to_gltf()` 转换（120s 超时）
6. 返回 `FileResponse` (media_type=`model/gltf-binary`)

**重要**: 此端点不使用 `require_role` Depends，因为浏览器 `<model-viewer>` 的 `src` 加载无法携带 Cookie/Header，必须通过 URL 参数传递 token。

### 2.3 缓存管理

**文件**: `backend/app/stp_converter.py`

| 函数 | 说明 |
|------|------|
| `convert_stp_to_gltf(stp_path, attachment_id)` | 转换 STP → glb，存入 `gltf_cache/{id}.glb` |
| `get_gltf_path_for_attachment(attachment_id)` | 获取缓存路径（不触发转换） |
| `delete_glb_cache(attachment_id)` | 删除缓存文件 |
| `is_stp_file(filename)` | 判断是否为 STP/STEP 文件 |

**上传触发**（两处）:
- `attachments_v2.py` — multipart 上传后 `asyncio.run_in_executor()` 异步转换
- `documents.py` — base64 上传后同样异步触发

**删除联动**（两处）:
- `attachments_v2.py` — `DELETE /{id}` 删除附件时调用 `delete_glb_cache()`
- `documents.py` — `DELETE /{doc_id}` 删除文档时遍历附件清理

---

## 三、前端

### 3.1 独立预览页面

**文件**: `frontend/public/stp-viewer.html`

不使用 Modal 弹窗，而是用 `window.open()` 打开独立浏览器窗口（不影响主界面操作）。

**核心实现**:
1. 从 CDN (jsdelivr) 加载 `<model-viewer>` Web Component
2. 从 URL 参数获取 `id`（附件 UUID）和 `token`（JWT）
3. 使用 `customElements.whenDefined('model-viewer')` 等待组件注册
4. **动态创建** `<model-viewer>` 元素（`document.createElement`），设置所有属性后再 `appendChild` 到 DOM
5. 监听 `load` / `error` 事件处理加载状态
6. 提供工具栏：重置视角、自动旋转开关

**为何动态创建元素**:
HTML 中的 `<model-viewer>` 标签在 CDN 脚本加载前被解析为未知元素，后续升级为 Web Component 时，通过 `setAttribute('src')` 设置的 src 不会被正确识别。动态创建元素确保 model-viewer 从一开始就是完整的自定义元素。

### 3.2 预览入口

| 文件 | 函数 | 改动 |
|------|------|------|
| `DocumentDetailContent.tsx` | `handlePreview` | 扩展名 `.stp` / `.step` → `window.open('/stp-viewer.html?id=&token=')` |
| `EntityDocumentSection.tsx` | `handlePreviewAttachment` | 同上 |

### 3.3 CDN 选择

使用 `cdn.jsdelivr.net` 而非 `unpkg.com`，因为国内网络对 unpkg 访问不稳定。

```html
<script type="module" 
  src="https://cdn.jsdelivr.net/npm/@google/model-viewer/dist/model-viewer.min.js">
</script>
```

**零 npm 依赖**。model-viewer 仅通过 CDN 在独立页面中加载，不影响主应用构建。

---

## 四、文件清单

| 层 | 文件 | 操作 | 说明 |
|------|------|------|------|
| 后端 | `backend/app/stp_to_gltf.py` | 修改 | gmsh(STP→STL) + trimesh(STL→glb) |
| 后端 | `backend/app/stp_converter.py` | 修改 | 新增 gltf_cache/ 缓存管理 + 删除联动 |
| 后端 | `backend/app/routers/attachments_v2.py` | 修改 | `/gltf` 端点改为 `?token=` 认证 |
| 后端 | `backend/app/routers/documents.py` | 修改 | 上传异步转换 + 删除清理缓存 |
| 后端 | `backend/requirements.txt` | 修改 | 新增 `gmsh` + `trimesh` |
| 后端 | `backend/Dockerfile` | 修改 | apt 安装 `gmsh libgmsh4.13` |
| 前端 | `frontend/public/stp-viewer.html` | **新建** | 独立 3D 预览页面 |
| 前端 | `frontend/src/components/DocumentDetailContent.tsx` | 修改 | 预览入口 + `.stp/.step` |
| 前端 | `frontend/src/components/EntityDocumentSection.tsx` | 修改 | 同上 |

---

## 五、涉及文件与 API 接口汇总

### 5.1 后端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/stp_to_gltf.py` | 修改 | STP→glb 转换脚本（gmsh+trimesh） |
| `backend/app/stp_converter.py` | 修改 | 缓存管理：`convert_stp_to_gltf()`, `get_gltf_path_for_attachment()`, `delete_glb_cache()`, `is_stp_file()` |
| `backend/app/routers/attachments_v2.py` | 修改 | `/gltf` 端点（`?token=` 认证）；上传异步转换；删除清理缓存 |
| `backend/app/routers/documents.py` | 修改 | 文档上传异步转换；删除文档时清理附件缓存 |
| `backend/requirements.txt` | 修改 | 新增 `gmsh` 和 `trimesh` 依赖 |
| `backend/Dockerfile` | 修改 | apt 安装 `gmsh libgmsh4.13`（CAD 内核+运行时库） |

### 5.2 前端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/public/stp-viewer.html` | **新建** | 独立 3D 预览页面（model-viewer CDN + 动态创建元素） |
| `frontend/src/components/DocumentDetailContent.tsx` | 修改 | `handlePreview()` 增加 `.stp/.step` → `window.open('/stp-viewer.html')` |
| `frontend/src/components/EntityDocumentSection.tsx` | 修改 | `handlePreviewAttachment()` 同上 |

### 5.3 API 接口

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/v2/attachments/{id}/gltf` | `?token=` JWT 查询参数 | 返回 `.glb` 模型文件（`model/gltf-binary`）。若缓存不存在则同步触发 STP→glb 转换 |

**认证方式**: 使用 `?token=` 查询参数传递 JWT，与 `/preview`、`/archive-tree` 端点一致。不使用 `require_role` Depends（因为浏览器 `<model-viewer>` 的 `src` 加载无法携带 HTTP Header）。

### 5.4 存储路径

| 数据 | 路径 | 格式 |
|------|------|------|
| STP 源文件 | `uploads/documents/{doc_id}/{file_name}.stp` | STEP 文本/二进制 |
| glb 缓存 | `uploads/gltf_cache/{attachment_id}.glb` | 二进制 glTF |

### 5.5 数据流

```
上传阶段:
  POST /api/v2/attachments/upload (multipart)
  或 POST /api/documents/{id}/attachments (base64)
    → 后端异步: asyncio.run_in_executor(convert_stp_to_gltf)
    → gmsh 读取 STP → 生成网格 → 导出 STL
    → trimesh 读取 STL → 导出 .glb
    → 存入 uploads/gltf_cache/{attachment_id}.glb

预览阶段:
  用户点击「预览」(.stp/.step 附件)
    → window.open('/stp-viewer.html?id={attachment_id}&token={jwt}')
    → stp-viewer.html 加载 model-viewer CDN (jsdelivr)
    → customElements.whenDefined() 等待组件注册
    → 动态创建 <model-viewer> 元素并设置 src
    → 浏览器请求 GET /api/v2/attachments/{id}/gltf?token={jwt}
    → 后端: JWT 验证 → 检查 gltf_cache/ → 返回 .glb
    → <model-viewer> 渲染 3D 模型（旋转/缩放/平移）

删除阶段:
  DELETE /api/v2/attachments/{id}
  或 DELETE /api/documents/{id}
    → 后端: delete_glb_cache(attachment_id)
    → 删除 uploads/gltf_cache/{attachment_id}.glb
```

---

## 六、已知问题与修复记录

| 问题 | 根因 | 修复 |
|------|------|------|
| 原设计 `cad_to_gltf` 不存在 | PyPI 无此包 | 改用 gmsh + trimesh |
| gmsh 直接写 `.glb` 失败 | gmsh 不支持该输出格式 | 中间格式 STL → trimesh 转 glb |
| Docker 构建失败 | `pythonocc-core` 不存在于 PyPI | 移除，改用系统 gmsh |
| 浏览器「模型加载中」卡住 | `require_role` Depends 在 token 检查前执行 | `/gltf` 改为纯 `?token=` 认证 |
| 仍「模型加载中」 | `<script>` 同步执行早于 CDN 模块加载 | `customElements.whenDefined()` 等待 |
| 仍「模型加载中」 | HTML 中预定义的 `<model-viewer>` 升级后不读 src | 动态 `createElement('model-viewer')` 创建 |
| 删除文档后 glb 残留 | `documents.py` 删除时未清理 gltf_cache | 增加 `delete_glb_cache()` 调用 |

---

*文档版本: v3.0 — 2026-05-14*
