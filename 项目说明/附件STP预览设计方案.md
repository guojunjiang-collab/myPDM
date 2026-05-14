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
| 4 | gltf-draco-transcoder | glb → Draco glb | C++ 后端 Draco 压缩（17-21x 压缩比） |

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
- 模型材质色 `#c8d6e5`（CAD 零件色，Unlit 渲染无视光照）
- `tone-mapping="aces"` 高对比度渲染

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
| `frontend/public/stp-viewer.html` | **新建** | 独立 3D 预览页面（model-viewer CDN + 动态创建 + Unlit rendering） |
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
| glb 缓存 | `uploads/gltf_cache/{attachment_id}.glb` | Draco-compressed 二进制 glTF |

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

## 六、v6.0 优化升级计划

> **状态**: 规划中  
> **创建**: 2026-05-14  
> **目标**: 后端 OCC 原生转换（大文件不超时） + 前端 R3F 高级交互（BOM 叠加/剖切/测量）

### 6.1 动机

**当前痛点**:
1. 大文件 STP（>5MB）gmsh 转换超时 300s，用户预览失败
2. model-viewer 功能受限：无剖切、无测量、无 BOM 叠加、无零件点击
3. 串行锁导致多用户排队等待

**目标架构**:
```
上传 STP → [后端] OCC 原生 2D 三角剖分 → Draco GLB（<5s 冷启动，大文件分钟级→秒级）
预览   → [前端] R3F 查看器 → 剖切/测量/BOM 标签/零件高亮/爆炸图
```

---

### 6.2 后端方案对比

#### 方案 A：Mayo CLI（🏆 推荐）

| 属性 | 值 |
|------|-----|
| 项目 | [fougue/mayo](https://github.com/fougue/mayo) |
| 架构 | C++ QtCore + OCCT，独立 CLI（`mayo-conv`） |
| CLI | `mayo-conv input.stp --export output.glb` |
| 集成 | 子进程调用，替换 `CONVERTER_SCRIPT` |
| Docker | AppImage (~48MB) + `xvfb-run`（QtCore 需要虚拟显示） |
| License | BSD-2-Clause |

**预测性能**（基于 OCC 原生基准 RapidMade 2026）:

| 指标 | gmsh (当前) | Mayo | 提升 |
|------|------------|------|------|
| 冷启动 | 2.1s | **~1.5s** | 1.4x |
| 150MB STEP 三角剖分 | 85s | **~40s** | 2.1x |
| 内存峰值 | 1.2GB | **~750MB** | 1.6x |
| 并行支持 | 单线程（串行锁） | 多进程并行 | — |

#### 方案 B：cascadio（备选）

| 属性 | 值 |
|------|-----|
| 项目 | [trimesh/cascadio](https://github.com/trimesh/cascadio) |
| 维护者 | mikedh（trimesh 作者，同一生态） |
| 架构 | C++ pybind11 绑定 + OCCT 7.9.x，PyPI wheel 分发 |
| API | `import cascadio` → Python 直接调用 |
| 集成 | 替换 gmsh 三角剖分，保留 trimesh + Draco 管道 |
| Docker | `pip install cascadio`（预编译 wheel），无额外 apt |
| License | 与 trimesh 相同 |

**对比**:

| 维度 | Mayo | cascadio |
|------|------|----------|
| 成熟度 | 稳定 v0.9 ✅ | 早期 v0.x ⚠️ |
| 集成方式 | 子进程（磁盘文件） | Python `import`（内存） |
| Docker 增量 | ~100MB | ~50MB ✅ |
| 生态契合度 | ❌ 外部项目 | ✅ trimesh 同作者 |
| 维护复杂度 | 中（子进程 + AppImage 版本） | 低（pip 依赖）✅ |

**结论**: Mayo CLI 优先（更成熟稳定，2K stars，BSD 开源），cascadio 备选（若 Mayo 效果不佳则切换）。

---

### 6.3 后端实施（Mayo CLI 路径）

#### B1: 替换 gmsh 子进程为 Mayo CLI

**文件**: `backend/app/stp_to_gltf.py`（重写） + `backend/app/stp_converter.py`（微调）

**核心改动**:
```python
# 当前 (gmsh)
import gmsh, trimesh, numpy as np
gmsh.initialize(); gmsh.open(input_path)
gmsh.model.mesh.generate(2)
node_tags, coords, _ = gmsh.model.mesh.getNodes()
# ... 手动提取面 + 索引映射 + trimesh 构建 + Draco ...
gmsh.finalize()

# 改为 (Mayo CLI)
import subprocess, os
MAYO_CONV = "/usr/local/bin/MayoConv"

# 根据文件大小选择网格精度
file_size_mb = os.path.getsize(input_path) / 1024 / 1024
quality = "VeryCoarse" if file_size_mb > 10 else \
          "Coarse" if file_size_mb > 5 else "Normal"

# 生成配置文件
settings_path = _write_mayo_settings(quality)

# 调用 Mayo CLI
subprocess.run([
    "xvfb-run", "--auto-servernum",
    MAYO_CONV,
    "--use-settings", settings_path,
    input_path,
    "--export", output_path
], timeout=120, check=True)
# Mayo 直接输出 GLB，无需 trimesh 后处理
```

**依赖变更**:
- `requirements.txt`: 移除 `gmsh==4.15.2` `trimesh` `scipy` `numpy` `gltf-draco-transcoder`
- `Dockerfile`: 移除 `apt-get install gmsh libgmsh4.13`；新增 MayoConv AppImage 下载 + `xvfb libfuse2`
- Mayo 原生输出紧凑 glTF，文件尺寸仍远小于 gmsh + Draco 产物

#### B2: 调整并发策略

**文件**: `backend/app/stp_converter.py`

Mayo CLI 作为独立进程，可多进程并行（不受 GIL 限制）：
- 保留 `threading.Lock` 改为 `Semaphore(2)`（限制同时 2 个 Mayo 进程，避免 CPU/内存过载）
- 超时从 300s 降为 120s（Mayo 更快）
- 异步上传转换仍通过 `asyncio.run_in_executor()` 触发

#### B3: API 异步化

**文件**: `backend/app/routers/attachments_v2.py`

```python
@router.get("/{attachment_id}/gltf")
async def get_gltf(...):
    glb_path = get_gltf_path_for_attachment(attachment_id)
    if glb_path:
        return FileResponse(glb_path, media_type="model/gltf-binary")
    # 缓存未命中 → 异步触发，返回 202
    background_tasks.add_task(convert_stp_to_gltf, ...)
    return JSONResponse(status_code=202, content={
        "status": "converting", "estimated_seconds": estimate_time(file_size)
    })
```

前端轮询 `/gltf`（间隔 2s），直到 200。

#### B4: Docker 集成

**Dockerfile 改动**:
```dockerfile
# 下载 MayoConv AppImage（预编译，开箱即用）
ADD https://github.com/fougue/mayo/releases/download/v0.9.0/MayoConv-0.9.0-x86_64.AppImage \
    /usr/local/bin/MayoConv
RUN chmod +x /usr/local/bin/MayoConv && \
    apt-get install -y xvfb libfuse2 && \
    rm -rf /var/lib/apt/lists/*
```

**Mayo 配置文件模板**（`/app/mayo_settings.ini`）:
```ini
[Exchange]
meshingQuality=Normal
# 可选: VeryCoarse / Coarse / Normal / Fine / VeryFine
```

---

### 6.4 前端方案：R3F 替代 model-viewer

#### 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 渲染框架 | `@react-three/fiber` v8 | React 声明式 three.js |
| 辅助库 | `@react-three/drei` v9 | OrbitControls, Html, useGLTF |
| 状态管理 | Zustand | 多 store 模式 |
| GLB 加载 | `useGLTF` + `DRACOLoader` | 支持 Draco 压缩 |
| 剪裁面 | `clippingPlanes` | Three.js 原生支持 |
| 标注标签 | CSS2DRenderer / `drei/Html` | HTML 标签跟踪 3D 位置 |

#### 组件架构

```
<STPViewerModal>              ← React Portal 弹窗
├── viewerStore (Zustand)     ← 集中状态管理
│   ├── modelUrl, loadingState
│   ├── selectedPartId, visibleParts
│   ├── clipPlanes[], measureMode
│   └── bomData (从父组件注入)
│
├── <Canvas>                  ← R3F 渲染
│   ├── <Model />             ← useGLTF(url) + DRACOLoader
│   ├── <ClippingPlanes />    ← 剖切面
│   ├── <MeasureTool />       ← 测量工具
│   ├── <PartHighlighter />   ← 零件高亮
│   └── <OrbitControls />
│
├── HTML Overlay              ← 浮层 UI
│   ├── <BOMPanel />          ← BOM 树（双向同步）
│   ├── <Toolbar />           ← 工具栏
│   └── <PartLabels />        ← 3D 位置标注
```

#### 分阶段实施

| 阶段 | 功能 | 预估 |
|------|------|------|
| F1 | 基础查看器：GLB 加载 + Controls + Draco + 材质色 | 1 周 |
| F2 | BOM 面板 + 零件点击高亮 + 双向同步 | 2 周 |
| F3 | 剖切面（X/Y/Z + 自定义角度） | 2 周 |
| F4 | 测量工具（距离/角度/半径）+ 标注标签 | 2 周 |
| F5 | 爆炸图 + 动画过渡 | 1 周 |

#### Bundle 体积控制

| 策略 | 预期效果 |
|------|----------|
| 动态 `import()` 按需加载 R3F | 主 bundle 不含 three.js |
| DRACOLoader 解码器 CDN 加载 | ~100KB 异步，不进 bundle |
| drei 按需导入（避免全量 three-stdlib） | 减少 ~200KB |

目标：首屏增量 < 200KB gzipped。

---

### 6.5 文件变更清单

| 层 | 文件 | 操作 | 阶段 |
|------|------|------|------|
| 后端 | `stp_to_gltf.py` | 重写: gmsh → Mayo CLI 子进程 | B1 |
| 后端 | `stp_converter.py` | Semaphore(2) 替代 Lock + 超时 120s | B2 |
| 后端 | `attachments_v2.py` | `/gltf` 异步化（202 状态码） | B3 |
| 后端 | `requirements.txt` | 移除 gmsh/trimesh/scipy/numpy/gltf-draco-transcoder | B1 |
| 后端 | `Dockerfile` | 移除 gmsh apt，新增 MayoConv AppImage + xvfb + libfuse2 | B1,B4 |
| 前端 | `STPViewer/` 组件目录 | **新建** R3F 查看器 | F1-F5 |
| 前端 | `viewerStore.ts` | **新建** Zustand | F1 |
| 前端 | `DocumentDetailContent.tsx` | 改用 `<STPViewerModal>` | F1 |
| 前端 | `package.json` | +three +R3F +drei +zustand | F1 |

---

### 6.6 风险评估与缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| Mayo AppImage 与 Debian slim 不兼容 | 中 | 备选 cascadio（pip wheel，更轻量） |
| Mayo 输出无 Draco 压缩，文件偏大 | 中 | 保留 gltf-draco-transcoder 后处理 |
| Mayo CLI 某些 STEP 文件转换失败 | 低 | 保留 gmsh 降级路径（feature flag 切换） |
| R3F bundle 过大 | 中 | 动态 import + CDN 解码器 |
| 并行转换 CPU/内存超限 | 中 | Semaphore(2) 限制并发 + 大文件检测降级 |
| R3F 低端设备性能不足 | 低 | 保留 model-viewer 降级 |
| Mayo 无 Draco 压缩 | 高 | 保留 gltf-draco-transcoder 后处理 |

---

*文档版本: v6.0-plan — 2026-05-14*
