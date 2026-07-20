# 设计：CAD 工作台 PDF/STP 附件命名前缀配置

- 日期：2026-07-20
- 状态：已批准
- 范围：CAD 工作台 BOM 匹配表格 PDF/STP 按钮的文件命名规则

## 背景

CAD 工作台 BOM 匹配表格提供"PDF"和"STP"按钮，通过桥接程序将 CATIA 工程图转 PDF、零部件导出 STP 并上传到 PDM 生产附件。当前文件命名为 `${件号}.{ext}`，无类型标识和版本号。

需求：
1. PDF 文件按零部件类型区分前缀（零件 `DR_`、部件 `ASY_`）
2. STP 文件统一加前缀（`MD_`）
3. 所有文件加版本后缀（`_{version}`），便于识别版本
4. 前缀规则通过 `.env` 环境变量配置，无需改代码

## 文件命名规则

| 场景 | 类型 | 模板 | 示例 |
|------|------|------|------|
| CATDrawing→PDF | 零件 | `{pdf_part_prefix}_{code}_{version}.pdf` | `DR_ABC123_A.pdf` |
| CATDrawing→PDF | 部件 | `{pdf_asm_prefix}_{code}_{version}.pdf` | `ASY_XYZ456_B.pdf` |
| CATIA→STP | 通用 | `{stp_prefix}_{code}_{version}.stp` | `MD_ABC123_A.stp` |

- `code`：CATIA 件号（`row.part_number`），为空时回退 `drawing`/`export`
- `version`：PDM 匹配版本（`row.pdm_match.version`），为空时留空（形如 `DR_ABC123_.pdf`）

## 配置项

```bash
# 项目根 .env
CAD_PDF_PART_PREFIX=DR_
CAD_PDF_ASSEMBLY_PREFIX=ASY_
CAD_STP_PREFIX=MD_
```

三个变量均为可选；未配置时前缀为空字符串，兼容旧行为（`{code}_{version}.ext`）。

## 方案

### 1. 后端新增配置 API

**文件**: `backend/app/routers/settings.py`（新增，约 20 行）

端点：`GET /api/settings/cad-naming`，无需鉴权，公开读取。

```python
@router.get("/cad-naming")
def get_cad_naming():
    return {
        "pdf_part_prefix": os.environ.get("CAD_PDF_PART_PREFIX", ""),
        "pdf_assembly_prefix": os.environ.get("CAD_PDF_ASSEMBLY_PREFIX", ""),
        "stp_prefix": os.environ.get("CAD_STP_PREFIX", ""),
    }
```

**注册**: `main.py` 中注册新路由。

### 2. 前端 CADBOMMatchTable 命名逻辑变更

**文件**: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`

- 组件 mount 时 fetch `/api/settings/cad-naming` 获取前缀配置
- `handleUploadPDF`（约第 403 行）：

```
旧: const fileName = `${(row.part_number || 'drawing').trim()}.pdf`;
新: const prefix = row.is_assembly ? pdfAsmPrefix : pdfPartPrefix;
    const code = (row.part_number || 'drawing').trim();
    const ver = row.pdm_match?.version || '';
    const fileName = `${prefix}${code}_${ver}.pdf`;
```

- `handleUploadSTP`（约第 421 行）：

```
旧: const fileName = `${(row.part_number || 'export').trim()}.stp`;
新: const prefix = stpPrefix;
    const code = (row.part_number || 'export').trim();
    const ver = row.pdm_match?.version || '';
    const fileName = `${prefix}${code}_${ver}.stp`;
```

### 3. 前端 CADWorkspaceModal 配置加载

**文件**: `frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx`

- 打开工作台时 fetch 配置，传递给 `CADBOMMatchTable`

### 4. cad_bridge 同步修改

**文件**: `cad_bridge/catia/client.py`

- `export_stp()` 第 292 行 fallback 命名同步更新
- `export_drawing_pdf()` 第 325 行 fallback 命名同步更新
- cad_bridge 从同一 `.env` 文件读取配置（`__main__.py` 启动时加载 `os.environ`）

**注意**: 正常情况下前端已拼接完整 fileName 并通过 WebSocket 传给桥接程序，`client.py` 的 fallback 仅在 PartNumber 缺失时触发。

## 3D 预览兼容性

装配体 3D 预览的 GLB 加载链路通过 `_glb_url_resolver_factory`（`routers/parts.py:1070`）使用数据库外键（`PartIteration → PartAttachment`）+ `category='production'` + `is_stp_file()` 筛选附件，**不依赖文件名匹配**。

`is_stp_file()` 仅检查 `.stp`/`.step` 扩展名，新命名规则不影响识别。**3D 预览无需任何修改**。

## 不改动的文件

| 文件 | 原因 |
|------|------|
| `crud_parts.py:_write_production_step` / `generate_subitem_steps` | 装配 STEP 导入流程，非 CAD 工作台按钮，且消费者通过 DB 关联而非文件名查找 |
| `stp_converter.py:is_stp_file()` | 已按扩展名匹配，与文件名无关 |
| `AssemblyModelLoader.tsx` | 接收后端返回的 `glb_urls` 直接加载，不解析文件名 |
| `routers/parts.py:_glb_url_resolver_factory` | 通过 DB 外键关联筛选，不依赖文件名约定 |

## 数据流

```
.env (CAD_PDF_PART_PREFIX=DR_, ...)
  ├──→ 后端 os.environ 读取
  │      ↓
  │   GET /api/settings/cad-naming → { pdf_part_prefix: "DR_", ... }
  │      ↓
  │   前端 CADWorkspaceModal fetch 配置
  │      ↓
  │   CADBOMMatchTable 拼接文件名: prefix + "_" + code + "_" + version + ext
  │      ↓
  │   WebSocket → cad_bridge (携带完整 fileName)
  │      ↓
  └──→ cad_bridge os.environ（fallback 时使用）
         ↓
      CATIA COM 导出文件 → 上传到 PDM 生产附件
```

## 实现顺序

1. 后端新增 `routers/settings.py` + `main.py` 注册路由
2. 前端 `CADBOMMatchTable.tsx` 命名逻辑变更
3. 前端 `CADWorkspaceModal.tsx` 配置加载
4. `cad_bridge/catia/client.py` fallback 更新
5. `.env` 添加三个配置变量
6. 构建前端后测试
