# CAD文件夹导入功能 设计文档

> 日期: 2026-07-13
> 状态: 已确认

---

## 1. 功能概述

在零部件详情弹窗（PartDetailModal）中增加「导入CAD文件夹」功能。用户选择一个本地文件夹，系统自动匹配文件夹中与当前部件及其BOM树所有子孙件同名的文件，批量导入为各零部件的CAD附件。

## 2. 需求决策记录

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 导入范围 | 当前部件 + 全部子孙项 | 递归遍历BOM树 |
| 匹配规则 | 文件名(去扩展名) = 零部件件号(code) | 精确匹配 |
| 文件类型 | 不限格式 | 所有文件类型都接受 |
| 重复处理 | 覆盖已存在 | 同名旧附件先删除再上传 |
| 交互流程 | 预览后批量上传 | 匹配预览 → 用户确认 → 上传 |
| 签出校验 | 仅当前用户签出的零部件可上传 | 未签出项在预览中标注并过滤 |
| 入口位置 | PartDetailModal BOM结构标签页，「导入装配STEP」按钮左侧 | 仅签出状态可点击 |

## 3. 整体架构（方案B：前后端协作）

```
用户点击「导入CAD文件夹」
    │
    ▼
前置校验：当前部件是否被当前用户签出
    │ 否 → 提示"请先签出零部件后再导入CAD附件"
    │ 是
    ▼
<input webkitdirectory> 选择文件夹 → 收集文件名列表（不读内容）
    │
    ▼
POST /api/parts/revisions/{id}/cad/import-preview
    → 后端递归BOM树 + 匹配 + 签出校验 → 返回匹配明细
    │
    ▼
前端预览弹窗：展示匹配/未匹配/覆盖/不可上传明细
    │ 用户取消 → 结束
    │ 用户确认
    ▼
前端逐文件上传（复用现有上传API，overwrite=true）
    → 进度条反馈 → 刷新附件列表 → 完成
```

## 4. 后端设计

### 4.1 新增端点

#### `POST /api/parts/revisions/{revision_id}/cad/import-preview`

匹配预览接口，接收文件名列表，返回匹配结果。

**请求体**:
```json
{
    "file_names": ["BRACKET.stp", "BASE.prt", "其他.txt"]
}
```

**响应体**:
```json
{
    "matched": [
        {
            "file_name": "BRACKET.stp",
            "code": "BRACKET",
            "name": "支架",
            "revision_id": "uuid-xxx",
            "revision_version": "B",
            "iteration_id": "uuid-yyy",
            "existing_count": 0,
            "can_upload": true,
            "block_reason": null
        }
    ],
    "unmatched": ["其他.txt"],
    "summary": {
        "total_files": 3,
        "matched_count": 1,
        "unmatched_count": 1,
        "will_overwrite_count": 0,
        "blocked_count": 0
    }
}
```

**权限**: `parts:update`

### 4.2 增强现有端点

#### `POST /api/parts/revisions/{revision_id}/attachments`

新增 `overwrite` 表单参数（默认 `False`）。当 `overwrite=true` 时，先删除目标迭代下同 `category='cad'` 且同 `file_name` 的旧附件，再写入新附件。

### 4.3 新增 Schema (schemas.py)

```python
class CadImportPreviewRequest(BaseModel):
    file_names: list[str]

class MatchedFileItem(BaseModel):
    file_name: str
    code: str
    name: str
    revision_id: str
    revision_version: str
    iteration_id: str
    existing_count: int
    can_upload: bool
    block_reason: str | None

class CadImportPreviewResponse(BaseModel):
    matched: list[MatchedFileItem]
    unmatched: list[str]
    summary: dict
```

### 4.4 新增 CRUD 函数 (crud_parts.py)

```python
def get_bom_descendants(revision_id: str, db: Session) -> list[dict]:
    """
    递归遍历BOM树，返回所有子孙零部件的展开清单。
    广度优先遍历，按(件号, revision_id)去重。
    返回: [{code, name, revision_id, revision_version, iteration_id, check_out_user_id}, ...]
    """

def match_cad_files(
    revision_id: str, 
    file_names: list[str], 
    current_user: User, 
    db: Session
) -> CadImportPreviewResponse:
    """
    1. 调用 get_bom_descendants() 获取BOM子孙件
    2. 建立 code -> component_info 映射
    3. 遍历 file_names，去扩展名匹配
    4. 对每个命中项检查签出状态、已有附件
    5. 返回 CadImportPreviewResponse
    """
```

**签出校验逻辑**:
- 匹配到的零部件 revision 的 `check_out_user_id` 必须等于 `current_user.id`
- 不匹配 → `can_upload=False, block_reason="未签出"`
- 注意：签出校验针对的是**每个匹配到的子零部件**，不是仅校验当前根部件

### 4.5 修改文件清单

| 文件 | 修改 |
|------|------|
| `backend/app/routers/parts.py` | 新增 `/cad/import-preview` 端点；现有上传端点增加 `overwrite` 参数 |
| `backend/app/crud_parts.py` | 新增 `get_bom_descendants()`, `match_cad_files()` |
| `backend/app/schemas.py` | 新增 `CadImportPreviewRequest`, `MatchedFileItem`, `CadImportPreviewResponse` |

## 5. 前端设计

### 5.1 入口按钮

位置：`PartDetailModal.tsx` BOM结构标签页，现有「导入装配STEP」按钮左侧。

```
[导入CAD文件夹] [导入装配STEP] [新建子项] ...
```

- 仅当前用户已签出当前部件时可点击
- 未签出时 disabled + tooltip "请先签出零部件后再导入CAD附件"

### 5.2 文件夹选择

使用 `<input type="file" webkitdirectory>` 选择文件夹，仅收集文件名列表（`File.webkitRelativePath` 取文件名部分），不读取文件内容。

### 5.3 预览弹窗

Modal 组件，展示后端返回的匹配结果：

```
┌─────────────────────────────────────────────────┐
│  导入CAD附件 - 匹配预览                           │
│                                                  │
│  文件夹: BRACKET-ASSY                            │
│  文件夹文件总数: 150  匹配: 12  未匹配: 138        │
│  将覆盖已有附件: 3  不可上传: 2                   │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ 文件名       │ 零部件  │ 件号    │ 状态      │ │
│  ├─────────────────────────────────────────────┤ │
│  │ BRACKET.stp  │ 支架    │ BRACKET │ ✓匹配     │ │
│  │ BASE.prt     │ 底座    │ BASE    │ ⚠覆盖     │ │
│  │ SHAFT.igs    │ 轴      │ SHAFT   │ ⊗未签出   │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  已过滤 1 个不可上传项，将上传 2 个文件             │
│                                                  │
│  [取消]                              [确认导入]   │
└─────────────────────────────────────────────────┘
```

状态图例：
- ✓ 绿色「匹配」：正常上传
- ⚠ 黄色「覆盖」：已有同名附件将被覆盖
- ⊗ 红色「未签出」：零部件未签出，不可上传
- - 灰色「未匹配」：无对应零部件

### 5.4 上传进度

确认后关闭预览弹窗，在CAD附件区域上方显示进度条：

```
[████████░░░░░░░░░░░░] 5/10  上传中: BRACKET.stp → 支架
```

上传策略：
- 仅上传 `can_upload=true` 的项
- 使用 `Promise.all` + 并发限制（最大5个并发）
- 每个文件调用现有上传API + `overwrite=true` 参数
- 完成后刷新CAD附件列表，Toast提示结果

### 5.5 修改文件清单

| 文件 | 修改 |
|------|------|
| `frontend/src/components/PartDetailModal.tsx` | 新增「导入CAD文件夹」按钮；新增预览弹窗状态；新增上传进度状态 |
| `frontend/src/components/CadImportPreviewModal.tsx` | **新建** - 预览弹窗组件 |
| `frontend/src/services/api.ts` | 新增 `cadImportPreview()` API 方法 |
| `frontend/src/types/index.ts` | 新增相关 TypeScript 类型 |

## 6. 边界情况处理

| 场景 | 处理 |
|------|------|
| 当前部件未签出 | 入口按钮置灰，tooltip提示 |
| BOM树为空（无子项） | 仅匹配当前部件自身 |
| BOM树中同一子件出现多次 | 去重，按(code, revision_id)唯一 |
| 文件夹为空 | 预览弹窗显示"未找到匹配文件" |
| 全部未匹配 | 预览弹窗显示未匹配列表，确认按钮不可用 |
| 全部因签出被过滤 | 预览弹窗显示过滤提示，确认按钮不可用 |
| 上传中某文件失败 | 跳过该文件继续上传后续，最终Toast汇总成功/失败数 |
| 网络中断 | 上传中止，Toast提示错误，已上传的保留 |

## 7. 自检

- [x] 无 TBD/TODO 占位符
- [x] 前后端接口定义一致
- [x] 签出校验覆盖所有层级（根部件 + 子孙件）
- [x] 去重策略明确（按 code + revision_id）
- [x] 错误处理完备
- [x] 范围聚焦，无额外子系统
