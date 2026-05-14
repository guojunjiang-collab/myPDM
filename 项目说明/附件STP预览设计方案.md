# 附件 STP 三维预览 —— 设计方案

> **状态**: 已实现  
> **创建**: 2026-05-14  
> **更新**: 2026-05-14（v6.0 完整实现）  
> **目标**: 图文档 STP/STEP 附件支持浏览器内三维模型预览——大文件不超时、准确测量、高级交互

---

## 一、技术栈

### 1.1 后端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | FastAPI | 0.115.11 | REST API |
| ASGI | Uvicorn | 0.35.0 | HTTP 服务器 |
| CAD 引擎 | Mayo CLI (OpenCASCADE) | v0.9.0 | STEP 解析 + 三角剖分 |
| 压缩 | gltf-draco-transcoder | 0.3.1 | Draco 网格压缩 |
| 虚拟显示 | xvfb | apt | Mayo CLI QtCore headless 运行 |
| 运行时 | libfuse2 + Qt 库 | apt | AppImage 挂载 + Qt 依赖 |
| 容器 | Docker (python:3.12-slim) | — | 部署环境 |

### 1.2 前端

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | React + TypeScript | 18.3.1 | UI |
| 构建 | Vite | 5.4.21 | 打包 |
| 样式 | Tailwind CSS | 3.x | 原子化样式 |
| 路由 | React Router | 6.26.0 | SPA 路由 |
| 状态 | Zustand | 4.5.4 | 全局状态 |
| HTTP | Axios | 1.7.7 | API 请求 |
| 3D 渲染 | Three.js | 0.17x | WebGL 渲染引擎 |
| 3D 框架 | @react-three/fiber | 8.x | React 声明式 Three.js |
| 3D 辅助 | @react-three/drei | 9.x | OrbitControls / Environment 等 |
| Draco 解码 | DRACOLoader (CDN) | 1.5.7 | 浏览器端解压 Draco GLB |

---

## 二、总体架构

```
┌─────────────────────────────────────────────────────────┐
│ 上传阶段（后端异步）                                      │
│                                                         │
│  STP 文件上传                                            │
│    ↓                                                    │
│  Semaphore(2) 获取槽位                                   │
│    ↓                                                    │
│  Mayo CLI (OCC 原生 C++)  读取 STP → 三角剖分            │
│    ├─ 自动选择网格精度（VeryCoarse~Fine，按文件大小）       │
│    └─ 导出 GLB（含顶点色 + 法线）                         │
│    ↓                                                    │
│  gltf-draco-transcoder  Draco 压缩（可选）                │
│    ↓                                                    │
│  存入 uploads/gltf_cache/{attachment_id}.glb             │
│    ↓                                                    │
│  释放 Semaphore 槽位                                     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ 预览阶段（前端）                                          │
│                                                         │
│  用户点击「预览」(.stp/.step)                              │
│    ↓                                                    │
│  window.open('/stp-viewer?id=&token=')                   │
│    ↓                                                    │
│  新标签页（路由懒加载，three.js 按需获取）                   │
│    ↓                                                    │
│  HEAD /api/v2/attachments/{id}/gltf?token=              │
│    ├─ 200 → axios GET 下载 GLB（onDownloadProgress）      │
│    │        ↓                                            │
│    │      创建 Blob URL → R3F Canvas 解析渲染              │
│    │        ↓                                            │
│    │      useLoader(GLTFLoader + DRACOLoader)             │
│    │        ↓                                            │
│    │      模型就绪 → 自动缩放 + 居中 + 单位检测(m→mm)       │
│    │        ↓                                            │
│    │      交互：旋转/缩放/平移 + 剖切 + 测量 + 爆炸 + 线框   │
│    │                                                     │
│    └─ 202 → "模型转换中，请稍后..." → 每 2s 轮询 HEAD       │
└─────────────────────────────────────────────────────────┘
```

---

## 三、API 接口

### 3.1 端点定义

| 方法 | 端点 | 认证 | Content-Type |
|------|------|------|-------------|
| `GET` | `/api/v2/attachments/{id}/gltf?token={jwt}` | URL 参数 JWT | `model/gltf-binary` |
| `HEAD` | `/api/v2/attachments/{id}/gltf?token={jwt}` | URL 参数 JWT | — |

> **为何用 URL 参数传 token**: 浏览器 `<model-viewer>` 和 `axios` 的 blob 下载均无法携带自定义 Header，必须通过 URL 参数传递 JWT。

### 3.2 响应规格

#### 200 OK — 缓存命中

```
HTTP/1.1 200 OK
Content-Type: model/gltf-binary
Content-Length: 49408

[二进制 GLB 数据]
```

#### 202 Accepted — 缓存未命中，后台转换中

```json
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "status": "converting",
  "message": "模型转换中，请稍后重试",
  "retry_seconds": 2
}
```

### 3.3 前端调用时序

```
STPViewerPage
  │
  ├─ HEAD /gltf ──────────────────────────► 后端
  │    ← 200 (缓存) ────► axios GET /gltf (onDownloadProgress)
  │    ← 202 (转换中) ──► 每 2s 轮询 HEAD ──► 200 ──► axios GET
  │
  ├─ axios GET /gltf (responseType: 'blob')
  │    │  onDownloadProgress → setDownloadPct(loaded/total*100)
  │    │
  │    └─ 完成 → URL.createObjectURL(blob) → setUrl(blobUrl)
  │
  └─ R3F Canvas
       │  useLoader(GLTFLoader, blobUrl, (loader) => {
       │    loader.setDRACOLoader(dracoLoader)  // CDN 解码器
       │  })
       │
       └─ gltf.scene 就绪 → ModelLoader.useEffect:
            ├─ setLoadingState('ready')   → 遮罩消失
            └─ requestAnimationFrame:
                 ├─ Box3 包围盒 → scale 计算
                 ├─ unitScale (m→mm 检测)
                 └─ groupRef.scale/position 设置
```

---

## 四、后端功能逻辑

### 4.1 转换管道

**文件**: `backend/app/stp_to_gltf.py`

```
convert(input_path, output_path):
  1. 根据文件大小选网格精度 (VeryCoarse/Coarse/Normal/Fine)
  2. _ensure_settings(quality) → 生成/更新 mayo_{quality}.ini
  3. subprocess.run([
       "xvfb-run", "--auto-servernum",
       MAYO_CONV, "--appimage-extract-and-run",
       "--use-settings", settings_path,
       input_path, "--export", output_path
     ], timeout=120)
  4. 可选: compress_gltf(output_path) → Draco 压缩
```

**网格精度选择逻辑**:

| 文件大小 | 精度 | 适用场景 |
|---------|------|---------|
| ≤5 MB | Fine | 小零件，高清预览 |
| 5-10 MB | Normal | 中等装配体 |
| 10-20 MB | Coarse | 大型装配体 |
| >20 MB | VeryCoarse | 超大文件，优先速度 |

### 4.2 缓存与并发管理

**文件**: `backend/app/stp_converter.py`

```
GLTF_CACHE_DIR = /app/uploads/gltf_cache/
_stp_semaphore = Semaphore(2)   ← 最多 2 个 Mayo 进程并发

convert_stp_to_gltf(stp_path, attachment_id):
  ├─ 检查缓存 gltf_cache/{id}.glb → 命中直接返回
  ├─ Semaphore.acquire() → 排队等待槽位
  ├─ 再次检查缓存（排队期间可能已生成）
  ├─ subprocess.run(python3 stp_to_gltf.py, timeout=120)
  ├─ 移动临时文件到缓存目录
  └─ Semaphore.release()
```

**上传触发**（3 处）:
- `attachments_v2.py` — multipart 上传
- `attachments_v2.py` — 分块上传完成
- `documents.py` — base64 上传

**删除联动**（3 处）:
- `attachments_v2.py` — DELETE /{id}
- `documents.py` — DELETE /{doc_id}
- `documents.py` — DELETE /{doc_id}/attachments/{att_id}

### 4.3 Docker 部署

**文件**: `backend/Dockerfile`

```dockerfile
FROM python:3.12-slim
# 系统依赖: xvfb + Qt 运行时 + AppImage 支持
apt-get install -y xvfb libfuse2 libfontconfig1 libgl1 libegl1 ...
# Mayo CLI (手动下载的 AppImage)
COPY MayoConv-0.9.0-x86_64.AppImage /usr/local/bin/MayoConv
# Python 依赖: 仅 gltf-draco-transcoder
pip install -r requirements.txt
```

**镜像大小**: 1.37 GB（含 OCC 内核 + Qt 运行时）

---

## 五、前端功能逻辑

### 5.1 路由与懒加载

**文件**: `frontend/src/App.tsx`

```tsx
const STPViewer = lazy(() => import('./pages/STPViewer'));

<Route path="/stp-viewer" element={
  <ProtectedRoute>
    <Suspense fallback={...}>
      <STPViewer />
    </Suspense>
  </ProtectedRoute>
} />
```

- 主 bundle: 878 KB（**不含** three.js）
- STPViewer chunk: 1,030 KB（含 three.js + R3F，按需加载）

### 5.2 预览入口

| 文件 | 函数 | 逻辑 |
|------|------|------|
| `DocumentDetailContent.tsx` | `handlePreview(attId, fileName)` | `.stp/.step` → `window.open('/stp-viewer?id=&token=', '_blank')` |
| `EntityDocumentSection.tsx` | `handlePreviewAttachment(fileId, fileName)` | 同上 |

### 5.3 加载状态机

```
checking ──HEAD──► 200 ──► loading (下载进度 %)
                  │           │
                  │           └── 完成 ──► parsing (解析脉冲)
                  │                          │
                  │                          └── ModelLoader ready ──► ready (模型可见)
                  │
                  202 ──► converting ("模型转换中")
                            │
                            └── 每 2s 轮询 ──► 200 ──► loading → ...
```

### 5.4 模型加载与自适应

**文件**: `ModelLoader.tsx`

```
useLoader(GLTFLoader, url):
  └─ gltf 就绪 → useEffect:
       ├─ setLoadingState('ready')        ← 立即标记，遮罩消失
       └─ requestAnimationFrame:
            ├─ Box3().setFromObject()     ← 包围盒
            ├─ maxDim → scale = 4/maxDim  ← 视觉缩放
            ├─ unitScale: maxDim<0.5 ? 1000 : 1  ← 单位检测
            ├─ modelScale = scale/unitScale      ← 测量转换因子
            ├─ groupRef.scale.setScalar(scale)
            └─ groupRef.position = -center*scale
```

**单位自动检测逻辑**:

| 条件 | 判定 | 处理 |
|------|------|------|
| `maxDim < 0.5` | 模型坐标单位为**米** | `unitScale=1000`，测量值 ×1000 显示 mm |
| `maxDim ≥ 0.5` | 模型坐标单位为**毫米** | `unitScale=1`，测量值不变 |

### 5.5 交互组件

#### 剖切面 (SectionPlanes)

```
useThree() → renderer.localClippingEnabled = true
clipPlanes[] → THREE.Plane(normal, -position)
  ├─ renderer.clippingPlanes = planes
  └─ 遍历所有 mesh.material.clippingPlanes = planes
```

#### 测量工具 (MeasureTool)

```
激活 measureMode='distance'
  ├─ pointerdown/up 监听 Canvas
  ├─ 点击区分 click vs drag (<3px 位移)
  ├─ Raycaster.setFromCamera → intersectObjects
  ├─ 排除 __measure_marker__ 自相交
  ├─ Phase 0→1: setPointA
  ├─ Phase 1→2: setPointB → 显示标注
  └─ Phase 2→0: 重新开始
```

测量标注:
- 红色球 (⌀0.06) + 连线 + `Html` 文字标签
- 标签内容: `{distance.toFixed(1)} mm`
- 距离 = `pointA.distanceTo(pointB) / Math.max(modelScale, 0.001)`

#### 爆炸图 (ExplodeView)

```
scene 加载后捕获所有 Mesh 世界坐标 → Map<Mesh, Vector3>
explodeDistance ≠ 0:
  遍历 Map → dir = normalize(origin - center)
           → target = origin + dir * explodeDistance
           → setWorldPosition(mesh, target)
explodeDistance = 0: 恢复原始位置
```

#### 工具栏 (Toolbar)

纯 HTML 组件（无 R3F hooks），`absolute top-0` 固定在 Canvas 上方:

```
[ X ▓ ] [ Y ▓ ] [ Z ▓ ] │ [测量] │ [爆炸 ▓▓▓░░░] │ [线框]
  ├─ checkbox 开关        ├─ 激活测距       ├─ 0~5 滑块    └─ wireframe 切换
  └─ 滑块调位置
```

### 5.6 交互参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `enableDamping` | false | 无惯性，鼠标停模型即刻停 |
| `zoomSpeed` | 1 | 标准缩放速度 |
| `minPolarAngle` | 0.01 | 避免正上方极点卡死 |
| `maxPolarAngle` | π - 0.01 | 避免正下方极点卡死 |
| 下载超时 | 60s (30 次 × 2s) | 转换轮询超时 |
| 转换超时 | 120s | Mayo 子进程超时 |

### 5.7 状态管理

**文件**: `stores/viewerStore.ts`

```typescript
interface ViewerState {
  // 模型
  modelUrl: string | null
  modelScale: number           // 测量转换因子 (scale / unitScale)
  loadingState: 'idle' | 'converting' | 'loading' | 'ready' | 'error'

  // 交互
  selectedPartId: string | null
  highlightedPartId: string | null
  visibleParts: Set<string>
  wireframe: boolean

  // 高级功能
  clipPlanes: { axis: 'x'|'y'|'z', position: number }[]
  measureMode: 'off' | 'distance'
  explodeDistance: number
}
```

---

## 六、文件清单

### 6.1 后端

| 文件 | 职责 |
|------|------|
| `backend/app/stp_to_gltf.py` | Mayo CLI 子进程调用 + Draco 后处理 |
| `backend/app/stp_converter.py` | 缓存管理 + Semaphore(2) 并发控制 |
| `backend/app/routers/attachments_v2.py` | `/gltf` 端点（200/202 + HEAD） |
| `backend/requirements.txt` | `gltf-draco-transcoder` |
| `backend/Dockerfile` | MayoConv AppImage + xvfb + Qt 运行时库 |

### 6.2 前端

| 文件 | 职责 |
|------|------|
| `pages/STPViewer.tsx` | 查看器页面：状态机 + 下载进度 + 解析进度 |
| `components/STPViewer/ViewerCanvas.tsx` | R3F Canvas：光照 + Controls + 组件组合 |
| `components/STPViewer/ModelLoader.tsx` | GLB 加载 + 自动缩放 + 居中 + 单位检测 |
| `components/STPViewer/Toolbar.tsx` | HTML 工具栏（剖切/测量/爆炸/线框） |
| `components/STPViewer/SectionPlanes.tsx` | 裁切面（renderer.clippingPlanes） |
| `components/STPViewer/MeasureTool.tsx` | 距离测量（Raycaster + Html 标签） |
| `components/STPViewer/ExplodeView.tsx` | 爆炸图（位置偏移） |
| `stores/viewerStore.ts` | Zustand 状态管理 |
| `components/DocumentDetailContent.tsx` | 图文档详情——预览入口 |
| `components/EntityDocumentSection.tsx` | 实体文档区——预览入口 |
| `App.tsx` | `/stp-viewer` 懒加载路由 |

---

## 七、实测性能

| 模型 | STP 大小 | 旧方案 (gmsh+Draco) | 新方案 (Mayo+Draco) | 提升 |
|------|---------|-------------------|-------------------|------|
| EngineBlock | 95 KB | 64.5 KB | **48 KB** | 更快 + 更小 |
| AssemblyExample | 503 KB | 92.6 KB | — | — |
| MD_V61 | 7 MB | ❌ 300s 超时 | **1,823 KB** ✅ | 从不可用到可用 |

| 指标 | v5.0 (gmsh) | v6.0 (Mayo) |
|------|-----------|-----------|
| 冷启动 | 2.1s | ~1.5s |
| 并发 | Lock(1) | Semaphore(2) |
| pip 依赖 | 15 个 | 10 个 |
| Docker 镜像 | 1.82 GB | 1.37 GB |
| Bundle (gzip) | — | 266 KB + 285 KB (懒加载) |

---

## 八、已知问题与修复记录

| 问题 | 根因 | 修复 |
|------|------|------|
| cad_to_gltf 不存在 / pythonocc-core 不可用 | PyPI 无此包 | gmsh → Mayo CLI |
| model-viewer 加载卡住 | 认证/标签升级/CDN 时序问题 | 认证改 ?token= / 动态创建元素 / R3F 替代 |
| v5.0 模型全黑/太暗 | 无法线 + export_glb 丢弃属性 + PBR 环境光 | fix_normals + export_glb(include_normals) + unlit |
| v6.0 大文件超时 | gmsh 150MB STP >300s | Mayo CLI OCC 原生替代 |
| v6.0 Toolbar 导致白屏 | useThree() 在 Canvas 外调用 | 移入 Canvas 或改为纯 HTML |
| v6.0 加载页死锁 | loading 状态不渲染 Canvas | Canvas 始终渲染，遮罩覆盖 |
| v6.0 解析遮罩不退 | setReady 被包围盒计算阻塞 | ready 先标记，包围盒 requestAnimationFrame |
| v6.0 测量值偏小 | 视觉缩放因子未还原 + m→mm 单位 | modelScale = scale/unitScale, distance/modelScale |
| v6.0 旋转极点卡死 | polarAngle 极值处轴退化 | 留 0.01 rad 裕度 |
| v6.0 缩放体验差 | 阻尼惯性 + 速度不适 | enableDamping=false, zoomSpeed=1 |
| v6.0 大模型无反馈 | GLB 下载+解析无进度 | axios onDownloadProgress + 双进度条 |

---

*文档版本: v6.0 — 2026-05-14*
