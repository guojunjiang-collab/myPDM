"""
构型配置 - Pydantic Schemas
==============================
三层模型：Master → Revision → Iteration
"""

from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime
import uuid


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ============================================================
# 构型项（库）— 三层模型 Schemas
# ============================================================

class ConfigItemCreate(BaseSchema):
    code: str
    name: str
    spec: str = ""
    remark: str = ""


class ConfigItemUpdate(BaseSchema):
    spec: Optional[str] = None
    remark: Optional[str] = None
    name: Optional[str] = None


class ConfigItemCheckin(BaseSchema):
    check_in_note: str = ""


class ConfigItemRevisionOut(BaseSchema):
    id: str
    master_id: str
    version: str
    status: str
    check_out_user_id: Optional[str] = None
    check_out_user_name: Optional[str] = None
    check_out_date: Optional[str] = None
    latest_iteration: int = 1
    creator_id: Optional[str] = None
    created_at: Optional[str] = None


# ============================================================
# 关联零部件（迭代级）
# ============================================================

class ConfigPartCreate(BaseSchema):
    part_type: str  # 'part' | 'assembly'
    part_id: uuid.UUID
    is_required: bool = True
    quantity: int = 1
    sort_order: int = 0


class ConfigPartUpdate(BaseSchema):
    is_required: Optional[bool] = None
    quantity: Optional[int] = None
    sort_order: Optional[int] = None


class ConfigPartResponse(BaseSchema):
    id: uuid.UUID
    iteration_id: uuid.UUID
    part_type: str
    part_id: uuid.UUID
    is_required: bool
    quantity: int
    sort_order: int
    created_at: datetime
    part_detail: Optional[dict] = None


class ConfigPartBulkCreate(BaseSchema):
    items: List[ConfigPartCreate]


# ============================================================
# 子构型项（parent→iteration, child→revision）
# ============================================================

class ConfigChildCreate(BaseSchema):
    child_revision_id: uuid.UUID
    is_required: bool = True
    quantity: int = 1
    sort_order: int = 0


class ConfigChildUpdate(BaseSchema):
    is_required: Optional[bool] = None
    quantity: Optional[int] = None
    sort_order: Optional[int] = None


class ConfigChildResponse(BaseSchema):
    id: uuid.UUID
    parent_iteration_id: uuid.UUID
    child_revision_id: uuid.UUID
    is_required: bool
    quantity: int
    sort_order: int
    created_at: datetime
    child_detail: Optional[dict] = None


class ConfigChildBulkCreate(BaseSchema):
    items: List[ConfigChildCreate]


# ============================================================
# 构型配置 (Configuration Profile)
# ============================================================

class ReviewerItem(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""
    role: Optional[str] = ""
    seq: int = 0


class CcUserItem(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""


class ConfigurationProfileCreate(BaseSchema):
    code: str
    name: str
    configuration_item_revision_id: Optional[uuid.UUID] = None
    effectivity_start: Optional[str] = None
    effectivity_end: Optional[str] = None
    remark: Optional[str] = None
    reviewers: List[ReviewerItem] = []
    review_mode: str = "all"
    cc_users: List[CcUserItem] = []


class ConfigurationProfileUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    configuration_item_revision_id: Optional[uuid.UUID] = None
    effectivity_start: Optional[str] = None
    effectivity_end: Optional[str] = None
    remark: Optional[str] = None
    reviewers: Optional[List[ReviewerItem]] = None
    review_mode: Optional[str] = None
    cc_users: Optional[List[CcUserItem]] = None


class ConfigurationProfileResponse(BaseSchema):
    id: uuid.UUID
    code: str
    name: str
    configuration_item_revision_id: Optional[uuid.UUID] = None
    status: str
    effectivity_start: Optional[str] = None
    effectivity_end: Optional[str] = None
    remark: Optional[str] = None
    creator_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    configuration_item: Optional[dict] = None


class ConfigurationProfileItemUpdate(BaseSchema):
    is_selected: Optional[bool] = None


class ConfigurationProfileItemResponse(BaseSchema):
    id: uuid.UUID
    profile_id: uuid.UUID
    source_config_item_revision_id: Optional[uuid.UUID] = None
    source_config_item_iteration_id: Optional[uuid.UUID] = None
    item_type: str
    item_id: uuid.UUID
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    is_required: bool
    is_selected: bool
    quantity: int = 1
    source_type: str
    sort_order: int
    created_at: datetime
    source_config_item: Optional[dict] = None


class ProfileReviewRequest(BaseSchema):
    decision: str  # approved / rejected / returned
    comment: Optional[str] = ""


class ProfileWithdrawRequest(BaseSchema):
    comment: Optional[str] = ""


class ProfileCcAddRequest(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""
