# 附件 STP 三维预览 —— 设计方案

> **状态**: 已实现（v5.0 优化版）  
> **创建**: 2026-05-14  
> **更新**: 2026-05-14（Draco 压缩 + 内存网格提取 + Unlit 渲染 + 法线计算）  
> **目标**: 图文档 STP/STEP 附件支持浏览器内三维模型预览，快速转换 + 极小文件 + 无视光照的准确着色

---

## 一、总体架构

```
用户上传 .stp/.step 附件
  ↓ (后端异步，串行队列)
gmsh 读取 STP → 曲率自适应网格化 → 内存提取顶点/面 → trimesh 构建网格 + 赋材质色
  ↓
计算法线 → 导出无压缩 glb → gltf-draco-transcoder 压缩 → 存入 gltf_cache/
  ↓
存入 uploads/gltf_cache/{attachment_id}.glb (Draco 压缩 + NORMAL + COLOR_0 + POSITION)
  ↓
用户点击「预览」→ window.open('/stp-viewer.html?id=&token=')
  ↓
独立页面动态创建 <model-viewer> Web Component (jsdelivr CDN)
  ↓
<model-viewer> 加载 GET /api/v2/attachments/{id}/gltf?token={jwt}
  ↓
后端从 gltf_cache/ 读取 Draco-compressed .glb → 返回 model/gltf-binary
  ↓
model-viewer 自动加载 Draco 解码器 (Google CDN) → Unlit 渲染（准确材质色，无视光照）
  ↓
浏览器渲染三维模型（旋转/缩放/平移，#c8d6e5 浅蓝灰）
```

---

## 二、后端

### 2.1 转换管道

**文件**: `backend/app/stp_to_gltf.py`

| 步骤 | 工具 | 格式 | 说明 |
|------|------|------|------|
| 1 | gmsh (Python API) | STP → 内存网格 | 曲率自适应三角网格，直接提取顶点/面（无 STL 中间文件） |
| 2 | trimesh | 内存网格 → glb | 构建 Trimesh 对象，赋材质色，计算法线 |
| 3 | export_glb() | glb → bytes | 显式导出 NORMAL + COLOR_0 + POSITION |
| 3 | gltf-draco-transcoder | glb → Draco glb | C++ 后端 Draco 压缩（17-21x 压缩比） |

**关键优化**（v5.0）:
- **消除 STL 中间文件**: gmsh `getNodes()/getElements()` 直接内存提取，跳过磁盘 I/O
- **Draco 压缩**: 使用 `gltf-draco-transcoder`（C++ 后端），文件体积减少 17-21x
- **KHR_materials_unlit**: 创建 unlit 材质并绑定 primitive，模型以原始颜色渲染，不受环境光照影响
- **法线保留**: 使用 `export_glb(include_normals=True)` 显式导出法线（`mesh.export()` 在设置颜色后会自动丢弃法线）

#### 2.1.1 曲率自适应网格参数

```
Mesh.MeshSizeFromCurvature = 18    每 π 弧度 18 个单元（预览模式，平衡质量与速度）
Mesh.MeshSizeExtendFromBoundary = 1  边界细网格向内部传播
Mesh.MeshSizeFromPoints = 1          几何特征点参与尺寸计算
Mesh.MeshSizeMax = 50               平面区域最大面尺寸（限制面数）
Mesh.Algorithm = 6                   Frontal-Delaunay，三角形更规整
```

**效果**: 曲面自动加密，平面自动减面。相比旧参数（`MeshSizeFromCurvature=22`, `MeshSizeMax=1e6`），面数更少、转换更快。

| 指标 | 旧参数 | 新参数 |
|------|--------|--------|
| 曲率精度 | 22 单元/π | 18 单元/π |
| 平面最大尺寸 | 无限制 | 50mm |
| 典型面数 | 更高 | 更低（约减 20-30%） |

#### 2.1.2 材质着色与渲染

**Unlit 渲染模式**（v5.0）: 通过 glTF `KHR_materials_unlit` 扩展，模型以原始顶点颜色渲染，不受 PBR 环境光照影响。这是 CAD 预览的标准做法，确保零件在任何环境下都显示准确的材质色。

**材质色**: CAD 零件色 `[200, 214, 229, 255]`（`#c8d6e5` 浅蓝灰）。

**法线**: `mesh.fix_normals()` 计算顶点法线后用 `export_glb(include_normals=True)` 显式导出，保留用于潜在的着色模式切换。

#### 2.1.3 依赖

| 依赖 | 来源 | 说明 |
|------|------|------|
| `gmsh==4.15.2` | pip | Python 绑定 |
| `gmsh libgmsh4.13` | apt | OpenCASCADE 7.8.1 CAD 内核 + 运行时库 |
| `trimesh` | pip | 网格构建 + glTF 导出 |
| `numpy` | pip | 网格数据数组运算 |
| `gltf-draco-transcoder` | pip | Draco 压缩（C++ 后端，预编译 wheels，跨平台） |
| `scipy` | pip | trimesh 依赖 |

### 2.2 端点

#### `GET /api/v2/attachments/{id}/gltf?token={jwt}`

**文件**: `backend/app/routers/attachments_v2.py`

**认证**: `?token=` JWT 查询参数（与 `/preview`、`/archive-tree` 一致）

**处理逻辑**:
1. JWT 解码验证 → 权限检查 (guest 拒绝)
2. 查 `document_attachments` 表获取附件记录
3. 检查 `file_name` 扩展名是否为 `.stp` / `.step`
4. 从 `uploads/gltf_cache/{attachment_id}.glb` 读取缓存
5. 若无缓存 → 同步触发 `convert_stp_to_gltf()` 转换（300s 超时）
6. 返回 `FileResponse` (media_type=`model/gltf-binary`)

**重要**: 此端点不使用 `require_role` Depends，因为浏览器 `<model-viewer>` 的 `src` 加载无法携带 Cookie/Header，必须通过 URL 参数传递 token。

### 2.3 缓存管理

**文件**: `backend/app/stp_converter.py`

| 函数 | 说明 |
|------|------|
| `convert_stp_to_gltf(stp_path, attachment_id)` | 转换 STP → glb，存入 `gltf_cache/{id}.glb`（内部 `threading.Lock` 串行化） |
| `get_gltf_path_for_attachment(attachment_id)` | 获取缓存路径（不触发转换） |
| `delete_glb_cache(attachment_id)` | 删除缓存文件 |
| `is_stp_file(filename)` | 判断是否为 STP/STEP 文件 |

#### 串行转换锁

模块级 `threading.Lock` 确保同一时间只有一个 gmsh 进程在运行，防止并发转换占满 CPU 导致后端卡死。

```
上传 STP-1 → 线程获取锁 → gmsh 运行
上传 STP-2 → 线程排队等待锁 → 前一个完成后自动开始
```

**上传触发**（三处）:
- `attachments_v2.py` — multipart 上传后 `asyncio.run_in_executor()` 异步转换
- `attachments_v2.py` — 分块上传完成后异步转换
- `documents.py` — base64 上传后异步转换

**删除联动**（三处，全覆盖）:
- `attachments_v2.py` — `DELETE /{id}` 删除附件时调用 `delete_glb_cache()`
- `documents.py` — `DELETE /{doc_id}` 删除文档时遍历附件清理
- `documents.py` — `DELETE /{doc_id}/attachments/{att_id}` 删除单个附件时清理

---

## 三、前端

### 3.1 独立预览页面

**文件**: `frontend/public/stp-viewer.html`

不使用 Modal 弹窗，而是用 `window.open()` 打开独立浏览器窗口（不影响主界面操作）。

**视觉风格**:
- 白底 (`#ffffff`) + 浅灰工具栏
- 模型材质色 `#c8d6e5`（CAD 零件色）
- `tone-mapping="aces"` 高对比度渲染
- `shadow-intensity="1"` 全强度阴影增强立体感

**核心实现**:
1. 从 CDN (jsdelivr) 加载 `<model-viewer>` Web Component
2. 从 URL 参数获取 `id`（附件 UUID）和 `token`（JWT）
3. 使用 `customElements.whenDefined('model-viewer')` 等待组件注册
4. **动态创建** `<model-viewer>` 元素（`document.createElement`），设置所有属性后再 `appendChild` 到 DOM
5. 监听 `load` / `error` 事件处理加载状态
6. 提供工具栏：重置视角、自动旋转开关

**为何动态创建元素**:
HTML 中的 `<model-viewer>` 标签在 CDN 脚本加载前被解析为未知元素，后续升级为 Web Component 时，通过 `setAttribute('src')` 设置的 src 不会被正确识别。动态创建元素确保 model-viewer 从一开始就是完整的自定义元素。

**model-viewer 属性**:

| 属性 | 值 | 说明 |
|------|-----|------|
| `src` | `/api/v2/attachments/{id}/gltf?token=` | 模型 URL |
| `camera-controls` | — | 鼠标旋转/缩放/平移 |
| `auto-rotate` | — | 自动旋转 |
| `auto-rotate-delay` | 3000 | 3 秒后开始自动旋转 |
| `environment-image` | neutral | 中性环境光 |
| `exposure` | 1.3 | 提高曝光度 |
| `shadow-intensity` | 0.6 | 柔化阴影（unlit 模式下不影响模型色） |
| `shadow-softness` | 1 | 阴影柔和 |
| `tone-mapping` | aces | 高对比度色调映射 |

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

## 四、涉及文件与 API 接口汇总

### 4.1 后端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/stp_to_gltf.py` | 修改 | STP→Draco glb 转换脚本：内存网格提取(gmsh) + 法线计算 + Unlit 材质(trimesh) + Draco 压缩(gltf-draco-transcoder) |
| `backend/app/stp_converter.py` | 修改 | 缓存管理 + 串行锁(`threading.Lock`) + 超时 300s |
| `backend/app/routers/attachments_v2.py` | 修改 | `/gltf` 端点；上传异步转换；删除清理缓存 |
| `backend/app/routers/documents.py` | 修改 | 上传异步转换；删除文档/附件时清理缓存（三处全覆盖） |
| `backend/requirements.txt` | 修改 | 新增 `gmsh==4.15.2` + `trimesh` + `scipy` + `numpy` + `gltf-draco-transcoder` |
| `backend/Dockerfile` | 修改 | apt 安装 `gmsh libgmsh4.13`；pip 安装增加 PyPI 回退源 |

### 4.2 前端文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/public/stp-viewer.html` | **新建** | 独立 3D 预览页面（model-viewer CDN + 动态创建 + 白底 + aces 色调映射） |
| `frontend/src/components/DocumentDetailContent.tsx` | 修改 | `handlePreview()` 增加 `.stp/.step` → `window.open()` |
| `frontend/src/components/EntityDocumentSection.tsx` | 修改 | `handlePreviewAttachment()` 同上 |

### 4.3 API 接口

| 方法 | 端点 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/api/v2/attachments/{id}/gltf` | `?token=` JWT 查询参数 | 返回 `.glb` 模型文件（`model/gltf-binary`）。若缓存不存在则同步触发转换 |

### 4.4 存储路径

| 数据 | 路径 | 格式 |
|------|------|------|
| STP 源文件 | `uploads/documents/{doc_id}/{file_name}.stp` | STEP |
| glb 缓存 | `uploads/gltf_cache/{attachment_id}.glb` | 二进制 glTF |

### 4.5 数据流

```
上传阶段:
  POST /api/v2/attachments/upload (multipart)
  或 POST /api/v2/attachments/chunk/* (分块)
  或 POST /api/documents/{id}/attachments (base64)
    → 后端异步: run_in_executor(convert_stp_to_gltf)
    → 获取 threading.Lock（排队等待）
    → gmsh 读取 STP → 内存提取顶点/面（无 STL 中间文件）
    → trimesh 构建网格 → fix_normals → 赋材质色 #c8d6e5
    → export_glb(include_normals=True) + unlit 后处理 → 无压缩 glb
    → gltf-draco-transcoder Draco 压缩（17-21x）
    → 存入 uploads/gltf_cache/{attachment_id}.glb
    → 释放 Lock

预览阶段:
  用户点击「预览」(.stp/.step 附件)
    → window.open('/stp-viewer.html?id={attachment_id}&token={jwt}')
    → stp-viewer.html 加载 model-viewer CDN (jsdelivr)
    → customElements.whenDefined() 等待组件注册
    → 动态创建 <model-viewer> 元素
    → 浏览器请求 GET /api/v2/attachments/{id}/gltf?token={jwt}
    → 后端: JWT 验证 → 检查 gltf_cache/ → 返回 Draco-compressed .glb
    → model-viewer 自动加载 Draco 解码器 (Google CDN)
    → KHR_materials_unlit → 以原始材质色渲染（无视环境光）
    → 用户旋转/缩放/平移模型

删除阶段:
  DELETE /api/v2/attachments/{id}
  或 DELETE /api/documents/{id}
  或 DELETE /api/documents/{id}/attachments/{att_id}
    → 后端: is_stp_file 检查 → delete_glb_cache(attachment_id)
    → 删除 uploads/gltf_cache/{attachment_id}.glb
```

---

## 五、已知问题与修复记录

| 问题 | 根因 | 修复 |
|------|------|------|
| 原设计 `cad_to_gltf` 不存在 | PyPI 无此包 | 改用 gmsh + trimesh |
| gmsh 直接写 `.glb` 失败 | gmsh 不支持该输出格式 | 中间格式 STL → trimesh 转 glb |
| Docker 构建失败 | `pythonocc-core` 不存在于 PyPI | 移除，改用系统 gmsh |
| 浏览器「模型加载中」卡住 | `require_role` Depends 在 token 检查前执行 | `/gltf` 改为纯 `?token=` 认证 |
| 仍「模型加载中」 | `<script>` 同步执行早于 CDN 模块加载 | `customElements.whenDefined()` 等待 |
| 仍「模型加载中」 | HTML 预定义 `<model-viewer>` 升级后不读 src | 动态 `createElement('model-viewer')` |
| 删除文档后 glb 残留 | `documents.py` 删除时未清理 gltf_cache | 增加 `delete_glb_cache()` 调用 |
| 删除附件后 glb 残留 | `documents.py:delete_attachment` 未清理 | 增加 glb 缓存清理（三处全覆盖） |
| 黑底白模看不清 | 默认深色背景 + STL 无材质信息 | 白底 CSS + trimesh 赋 CAD 材质色 `#c8d6e5` |
| 材质着色导致导出崩溃 | `face_colors` 单行需 `scipy.sparse` | 广播为 `[color] * len(faces)` + 安装 scipy |
| 模型精度损失严重 | gmsh 默认网格参数太粗（每 π 弧度 18 点） | 曲率自适应：`MeshSizeFromCurvature=22` + Frontal-Delaunay |
| 大文件转换超时 | 6MB+ STP 默认 120s 不够 | 超时提高到 300s |
| 并发转换 CPU 爆满 | 两个 gmsh 同时运行占满 CPU | `threading.Lock` 串行化，同时只跑一个 |
| **v5.0** 模型渲染全黑 | `process=False` 跳过法线计算，PBR 无光线全黑 | `mesh.fix_normals()` 计算法线 |
| **v5.0** 有法线仍全黑 | `mesh.export()` 设置颜色后自动丢弃 NORMAL 属性 | 改用 `export_glb(include_normals=True)` 显式导出 |
| **v5.0** 有法线仍太暗 | PBR 环境光调制颜色，浅蓝灰在 neutral 环境下偏暗 | `KHR_materials_unlit` — CAD 预览标准做法，无视光照渲染原始色 |
| **v5.0** Unlit 不生效 | 材质列表为空，primitive 未绑定 material | `tree_postprocessor` 创建材质并绑定 `material=0` |
| **v5.0** 转换慢 + 文件大 | STL 中间文件写盘/读盘（~60MB I/O）+ 无压缩 | 内存网格提取 + Draco 压缩（17-21x），90KB 级文件 |

---

*文档版本: v5.0 — 2026-05-14*
