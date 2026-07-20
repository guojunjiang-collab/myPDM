# CAD 工作台 PDF/STP 附件命名前缀配置 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAD 工作台 PDF/STP 按钮生成的文件名增加类型前缀和版本后缀，并通过 .env 环境变量可配置。

**Architecture:** 后端新增公开配置端点 `GET /api/settings/cad-naming` 从 `os.environ` 读取三个前缀变量；前端 CADWorkspaceModal 打开时 fetch 配置并传给 CADBOMMatchTable 用于拼接文件名；cad_bridge fallback 命名同步更新。

**Tech Stack:** FastAPI (Python) + React/TypeScript + WebSocket (cad_bridge)

## 全局约束

- 命名模板：`{prefix}_{code}_{version}.{ext}`
- PDF 零件前缀默认 `DR_`，PDF 部件前缀默认 `ASY_`，STP 前缀默认 `MD_`
- 环境变量可选，未配置时前缀为空字符串（兼容旧行为）
- version 为空时留空（形如 `DR_ABC123_.pdf`）
- 3D 预览链路通过 DB 外键筛选附件，不受重命名影响
- cad_bridge `client.py` 仅 fallback 分支需改（正常路径由前端拼好名传入）
- 前端构建输出目录：`frontend/dist/`

---

### Task 1: .env 新增三个配置变量

**Files:**
- Modify: `D:\OpenCode\myPDM\.env:40`

**Interfaces:**
- Produces: `os.environ["CAD_PDF_PART_PREFIX"]`, `os.environ["CAD_PDF_ASSEMBLY_PREFIX"]`, `os.environ["CAD_STP_PREFIX"]`

- [ ] **Step 1: 在 .env 末尾追加 CAD 命名前缀配置变量**

在 `D:\OpenCode\myPDM\.env` 末尾（第 43 行之后）追加以下内容：

```
# ============================================================
# CAD 工作台附件命名前缀配置
# ============================================================
# PDF 文件：零件类型前缀
CAD_PDF_PART_PREFIX=DR_
# PDF 文件：部件/装配类型前缀
CAD_PDF_ASSEMBLY_PREFIX=ASY_
# STP 文件前缀
CAD_STP_PREFIX=MD_
```

- [ ] **Step 2: 验证 .env 文件**

```powershell
Get-Content -Path ".env" -Tail 10
```

预期：输出末尾包含三个 `CAD_` 前缀变量。

- [ ] **Step 3: 提交**

```powershell
git add .env
git commit -m "feat: add CAD attachment naming prefix env vars"
```

---

### Task 2: 后端新增 settings 路由（GET /api/settings/cad-naming）

**Files:**
- Create: `D:\OpenCode\myPDM\backend\app\routers\settings.py`

**Interfaces:**
- Produces: `GET /api/settings/cad-naming` → `{ pdf_part_prefix: str, pdf_assembly_prefix: str, stp_prefix: str }`

- [ ] **Step 1: 创建 settings.py 路由文件**

新建文件 `D:\OpenCode\myPDM\backend\app\routers\settings.py`，内容：

```python
"""系统配置 API 路由"""
from __future__ import annotations
import os
from fastapi import APIRouter

router = APIRouter(tags=["settings"])


@router.get("/cad-naming")
def get_cad_naming():
    """获取 CAD 工作台附件命名前缀配置"""
    return {
        "pdf_part_prefix": os.environ.get("CAD_PDF_PART_PREFIX", ""),
        "pdf_assembly_prefix": os.environ.get("CAD_PDF_ASSEMBLY_PREFIX", ""),
        "stp_prefix": os.environ.get("CAD_STP_PREFIX", ""),
    }
```

- [ ] **Step 2: 在 main.py 注册路由**

修改 `D:\OpenCode\myPDM\backend\app\main.py`。

第 6 行，在 `from .routers import` 语句末尾追加 `, settings_router`：

```python
from .routers import auth_router, users_router, bom_router, logs_router, custom_fields_router, documents_router, user_groups_router, dashboard_router, ecr_router, eco_router, config_router, inventory_router, notifications_router, parts_router, settings_router
```

第 50 行之后，追加路由注册（放在 `projects_router` 之后）：

```python
app.include_router(settings_router, prefix="/api")
```

- [ ] **Step 3: 验证后端启动**

```powershell
docker restart bom_backend
```

然后访问 `GET /api/settings/cad-naming` 检查返回：

```powershell
curl -k https://localhost:8080/api/settings/cad-naming
```

预期输出：
```json
{"pdf_part_prefix":"DR_","pdf_assembly_prefix":"ASY_","stp_prefix":"MD_"}
```

- [ ] **Step 4: 提交**

```powershell
git add backend/app/routers/settings.py backend/app/main.py
git commit -m "feat: add GET /api/settings/cad-naming endpoint"
```

---

### Task 3: 前端 API 服务新增 settingsApi

**Files:**
- Modify: `D:\OpenCode\myPDM\frontend\src\services\api.ts:790`

**Interfaces:**
- Produces: `settingsApi.cadNaming()` → `Promise<{ pdf_part_prefix: string, pdf_assembly_prefix: string, stp_prefix: string }>`

- [ ] **Step 1: 在 api.ts 末尾追加 settingsApi**

在 `D:\OpenCode\myPDM\frontend\src\services\api.ts` 第 803 行之后追加：

```typescript
export const settingsApi = {
  cadNaming: () =>
    api.get<{ pdf_part_prefix: string; pdf_assembly_prefix: string; stp_prefix: string }>('/settings/cad-naming').then((r) => r.data),
};
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/services/api.ts
git commit -m "feat: add settingsApi.cadNaming to frontend API service"
```

---

### Task 4: CADBOMMatchTable 命名逻辑变更

**Files:**
- Modify: `D:\OpenCode\myPDM\frontend\src\components\CADWorkspace\CADBOMMatchTable.tsx:10-41, 398-430`

**Interfaces:**
- Consumes: `Props.namingPrefixes: { pdfPartPrefix: string; pdfAssemblyPrefix: string; stpPrefix: string }`

- [ ] **Step 1: 扩展 Props 接口和组件参数**

在 `CADBOMMatchTable.tsx` 第 10 行 BOMRow 接口定义之前，新增 `NamingPrefixes` 接口：

```typescript
export interface NamingPrefixes {
  pdfPartPrefix: string;
  pdfAssemblyPrefix: string;
  stpPrefix: string;
}
```

在第 35-38 行 Props 接口中增加 `namingPrefixes` 属性：

```typescript
interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  rows: BOMRow[];
  onComplete: (count: number) => void;
  namingPrefixes: NamingPrefixes;
}
```

- [ ] **Step 2: 修改 handleUploadPDF 文件命名（第 398-412 行）**

将第 402-404 行：
```typescript
      const fileName = `${(row.part_number || 'drawing').trim()}.pdf`;
      await bridge.exportPdfUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`工程图 PDF 已上传: ${fileName}`);
```

替换为：
```typescript
      const prefix = row.is_assembly ? namingPrefixes.pdfAssemblyPrefix : namingPrefixes.pdfPartPrefix;
      const code = (row.part_number || 'drawing').trim();
      const ver = row.pdm_match?.version || '';
      const fileName = `${prefix}${code}_${ver}.pdf`;
      await bridge.exportPdfUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`工程图 PDF 已上传: ${fileName}`);
```

- [ ] **Step 3: 修改 handleUploadSTP 文件命名（第 416-430 行）**

将第 420-423 行：
```typescript
      const fileName = `${(row.part_number || 'export').trim()}.stp`;
      await bridge.exportStpUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`STP 已导出并上传: ${fileName}`);
```

替换为：
```typescript
      const prefix = namingPrefixes.stpPrefix;
      const code = (row.part_number || 'export').trim();
      const ver = row.pdm_match?.version || '';
      const fileName = `${prefix}${code}_${ver}.stp`;
      await bridge.exportStpUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`STP 已导出并上传: ${fileName}`);
```

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: apply configurable naming prefixes to PDF/STP export filenames"
```

---

### Task 5: CADWorkspaceModal 配置加载并传递

**Files:**
- Modify: `D:\OpenCode\myPDM\frontend\src\components\CADWorkspace\CADWorkspaceModal.tsx:1-89`

**Interfaces:**
- Consumes: `settingsApi.cadNaming()` from `../../services/api`
- Produces: `namingPrefixes` prop passed to `CADBOMMatchTable`

- [ ] **Step 1: 修改导入语句（第 1-4 行）**

添加 `settingsApi` 导入和 `NamingPrefixes` 类型导入：

```typescript
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow, type NamingPrefixes } from './CADBOMMatchTable';
import { CADCompleteStep } from './CADCompleteStep';
import { useCADBridge } from '../../hooks/useCADBridge';
import { settingsApi } from '../../services/api';
```

- [ ] **Step 2: 添加命名前缀状态和加载逻辑（第 15-24 行之间）**

在组件 state 声明处（第 17 行 `bomRows` 状态之后），添加：

```typescript
  const [namingPrefixes, setNamingPrefixes] = useState<NamingPrefixes>({
    pdfPartPrefix: '',
    pdfAssemblyPrefix: '',
    stpPrefix: '',
  });

  useEffect(() => {
    if (open) {
      settingsApi.cadNaming().then(setNamingPrefixes).catch(() => {});
    }
  }, [open]);
```

- [ ] **Step 3: 传递命名前缀给 CADBOMMatchTable（第 72-77 行）**

修改 `CADBOMMatchTable` 组件调用，增加 `namingPrefixes` prop：

```typescript
          {step === 'match' && (
            <CADBOMMatchTable
              bridge={bridge}
              rows={bomRows}
              onComplete={handleMatchComplete}
              namingPrefixes={namingPrefixes}
            />
          )}
```

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx
git commit -m "feat: load CAD naming config on workspace open and pass to match table"
```

---

### Task 6: cad_bridge fallback 命名同步

**Files:**
- Modify: `D:\OpenCode\myPDM\cad_bridge\catia\client.py:292, 325`

**Interfaces:**
- Consumes: `os.environ["CAD_PDF_PART_PREFIX"]`, `os.environ["CAD_PDF_ASSEMBLY_PREFIX"]`, `os.environ["CAD_STP_PREFIX"]`

**说明:** 正常路径下前端已将完整 fileName 通过 WebSocket 传入（第 292/325 行 `params.get("file_name")` 优先），fallback 仅在 fileName 未传时生效。此处同步更新以保证一致性。

- [ ] **Step 1: 修改 export_stp 的 fallback 命名（第 292 行）**

第 292 行：
```python
        file_name = params.get("file_name") or f"{getattr(ref, 'PartNumber', '') or 'export'}.stp"
```

替换为：
```python
        if params.get("file_name"):
            file_name = params["file_name"]
        else:
            code = getattr(ref, 'PartNumber', '') or 'export'
            ver = getattr(ref, 'Revision', '') or ''
            prefix = os.environ.get("CAD_STP_PREFIX", "")
            file_name = f"{prefix}{code}_{ver}.stp"
```

- [ ] **Step 2: 修改 export_drawing_pdf 的 fallback 命名（第 325 行）**

第 325 行：
```python
        file_name = params.get("file_name") or f"{getattr(ref, 'PartNumber', '') or 'drawing'}.pdf"
```

替换为：
```python
        if params.get("file_name"):
            file_name = params["file_name"]
        else:
            code = getattr(ref, 'PartNumber', '') or 'drawing'
            ver = getattr(ref, 'Revision', '') or ''
            prefix_key = "CAD_PDF_ASSEMBLY_PREFIX" if self._is_assembly(product) else "CAD_PDF_PART_PREFIX"
            prefix = os.environ.get(prefix_key, "")
            file_name = f"{prefix}{code}_{ver}.pdf"
```

> 注：`_is_assembly()` 方法需在第 305 行之前新增辅助方法（判断 product 是否为装配体），若 CATIA COM 无直接 API，可简化为统一用 `CAD_PDF_PART_PREFIX`（fallback 场景极少触发）。

- [ ] **Step 3: 提交**

```powershell
git add cad_bridge/catia/client.py
git commit -m "feat: sync cad_bridge fallback file naming with new prefix convention"
```

---

### Task 7: 构建前端并验证

**Files:**
- Modify: (none — `frontend/dist/` 为构建输出)

- [ ] **Step 1: 构建前端**

```powershell
cd frontend; if ($?) { npm run build }
```

检查：构建无报错，`frontend/dist/` 生成新的构建产物。

- [ ] **Step 2: 重启 Nginx 容器使新前端生效**

```powershell
docker-compose up -d --force-recreate nginx
```

- [ ] **Step 3: 验证目标 API 可达**

```powershell
curl -k https://localhost:8080/api/settings/cad-naming
```

预期输出三个前缀值。

- [ ] **Step 4: 浏览器验证**

打开应用 → 零部件管理 → CAD 入口 → 进入 BOM 匹配步骤，在浏览器开发者工具 Network 面板确认 `/api/settings/cad-naming` 请求成功返回。

- [ ] **Step 5: 提交（无文件变更，确认构建产物后跳过）**

构建产物 `frontend/dist/` 在 `.gitignore` 中，无需提交。此步骤仅做验证标记。

---
