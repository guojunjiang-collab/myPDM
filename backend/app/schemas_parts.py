"""零部件签入检出 Schema"""
from __future__ import annotations
from typing import Optional, List, Any, Dict
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


# ===== PartMaster =====

class PartMasterBase(BaseModel):
    code: str
    name: str


class PartMasterCreate(PartMasterBase):
    pass


class PartMasterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None


class PartMasterResponse(PartMasterBase):
    id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    latest_revision: Optional["PartRevisionBrief"] = None
    type: Optional[str] = None  # 动态计算，非数据库字段

    class Config:
        from_attributes = True


# ===== PartRevision =====

class PartRevisionBrief(BaseModel):
    id: UUID
    version: str
    status: str
    latest_iteration: int
    check_out_user_id: Optional[UUID] = None
    check_out_user_name: Optional[str] = None
    check_out_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    version_count: Optional[int] = None

    class Config:
        from_attributes = True


class PartRevisionResponse(PartRevisionBrief):
    master_id: UUID
    revision_note: Optional[str] = None
    revision_parent_id: Optional[UUID] = None
    updated_at: Optional[datetime] = None
    current_iteration: Optional["PartIterationResponse"] = None


# ===== PartIteration =====

class PartIterationResponse(BaseModel):
    id: UUID
    revision_id: UUID
    iteration: int
    check_in_date: Optional[datetime] = None
    check_in_note: Optional[str] = None
    document_links: Optional[List[Dict[str, Any]]] = []
    created_at: Optional[datetime] = None
    creator_id: Optional[UUID] = None
    creator_name: Optional[str] = None

    class Config:
        from_attributes = True


# ===== Checkout/Checkin =====

class CheckinRequest(BaseModel):
    check_in_note: Optional[str] = None


class CascadeResult(BaseModel):
    succeed_count: int
    failed_count: int
    failed_items: List[Dict[str, Any]] = []


# ===== PartAttachment =====

class PartAttachmentResponse(BaseModel):
    id: UUID
    iteration_id: UUID
    category: str
    file_name: str
    file_size: Optional[int] = None
    file_path: Optional[str] = None
    file_hash: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== BOM Item（新模型） =====

class BOMItemCreate(BaseModel):
    child_revision_id: UUID
    quantity: int = 1
    sort_order: int = 0


class BOMItemUpdate(BaseModel):
    quantity: Optional[int] = None
    sort_order: Optional[int] = None
    child_revision_id: Optional[str] = None


class BOMItemResponse(BaseModel):
    id: UUID
    iteration_id: UUID
    parent_revision_id: UUID
    child_revision_id: UUID
    quantity: int
    sort_order: int
    child_detail: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ===== 列表查询 =====

class PartListQuery(BaseModel):
    search: Optional[str] = None
    status: Optional[str] = None
    check_out_user_id: Optional[UUID] = None
    show_all_versions: bool = False
    page: int = 1
    page_size: int = 50


# ===== 装配 3D 预览 =====

class MatchReport(BaseModel):
    matched: List[str]
    unmatched: List[str]
    multi_instance: List[str]
    generated: List[str] = []              # 成功拆出 STEP 的件号(去重)
    skipped_not_editable: List[str] = []   # 非草稿/未检出跳过
    failed: List[str] = []                 # 子集提取/写盘失败


class AssemblyInstanceDTO(BaseModel):
    path: str
    bom_path: List[str]
    part_code: str
    revision_id: str
    glb_urls: dict
    matrix: List[float]
    bbox: Optional[dict] = None


class AssemblyTreeNodeDTO(BaseModel):
    bom_item_id: str
    instance_index: Optional[int] = None
    part_code: str
    part_name: str
    version: Optional[str] = None
    quantity: int
    instance_count: int
    is_leaf: bool
    children: List["AssemblyTreeNodeDTO"] = []


AssemblyTreeNodeDTO.model_rebuild()


# === CAD 工作台 件号+版本 批量匹配 ===

class CadBomMatchItem(BaseModel):
    code: str
    version: Optional[str] = None


class CadBomMatchRequest(BaseModel):
    items: List[CadBomMatchItem] = []


class CadBomMatchResult(BaseModel):
    code: str
    version: Optional[str] = None
    match_status: str  # matched / conflict / new
    master_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None
    matched_version: Optional[str] = None
    name: Optional[str] = None
    checkout_status: Optional[str] = None  # not_checked_out / checked_out / other_checked_out
    latest_version: Optional[str] = None


class CadBomMatchResponse(BaseModel):
    results: List[CadBomMatchResult] = []


# === CAD 工作台 装配直接子项 BOM 同步 ===

class CadBomSyncInstance(BaseModel):
    """CATIA 实例变换矩阵（相对于父装配，平移单位 mm）"""
    matrix: Optional[List[float]] = None  # 16 元素 4x4 行主序，null=不可用
    label: str = ""


class CadBomSyncChild(BaseModel):
    code: str
    name: Optional[str] = None
    spec: Optional[str] = None
    quantity: int = 1
    instances: List[CadBomSyncInstance] = []


class CadBomSyncRequest(BaseModel):
    children: List[CadBomSyncChild] = []


class CadBomSyncResponse(BaseModel):
    created_parts: List[str] = []   # 自动新建的零件件号列表
    created_items: int = 0          # 新增 BOM 项数
    updated_items: int = 0          # 更新 BOM 项数
    extra_in_pdm: List[str] = []    # PDM 中存在但 CATIA 中不存在的直接子项件号
