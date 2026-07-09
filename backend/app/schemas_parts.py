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
    spec: Optional[str] = None


class PartMasterCreate(PartMasterBase):
    pass


class PartMasterUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None


class PartMasterResponse(PartMasterBase):
    id: UUID
    creator_id: Optional[UUID] = None
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

    class Config:
        from_attributes = True


class PartRevisionResponse(PartRevisionBrief):
    master_id: UUID
    revision_note: Optional[str] = None
    revision_parent_id: Optional[UUID] = None
    creator_id: Optional[UUID] = None
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
    remark: Optional[str] = None
    created_at: Optional[datetime] = None

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
    # 多实例展开时的实例序号；与实例 bom_path 末段 "{bom_item_id}:{idx}" 对应。
    # 缺此字段会被 response_model 剥离，导致前端 mesh uuid 挂不上树(上色/选中失效)。
    instance_index: Optional[int] = None
    part_code: str
    part_name: str
    quantity: int
    instance_count: int
    is_leaf: bool
    children: List["AssemblyTreeNodeDTO"] = []


AssemblyTreeNodeDTO.model_rebuild()
