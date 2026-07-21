"""
ECO (Engineering Change Order) - Pydantic Schemas
====================================================
变更管理 - ECO 模块请求/响应模型
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Literal, List, Any, Dict
from datetime import datetime
import uuid


# ============================================================
# 基础配置
# ============================================================

class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ============================================================
# 辅助 Schema
# ============================================================

class ECOReviewerItem(BaseModel):
    """审批人项"""
    user_id: str
    seq: int = 0


class ECOReviewerDetail(BaseModel):
    """审批人详情（含冗余信息）"""
    seq: int
    user_id: str
    user_name: str
    role: str


class ECOReviewRecordItem(BaseModel):
    """审批记录项"""
    id: str
    reviewer_id: str
    reviewer_name: str
    decision: str
    comment: Optional[str] = None
    created_at: datetime


class ECODocumentLinkItem(BaseModel):
    """关联图文档项"""
    document_id: str  # 现为 DocumentRevision.id（历史命名保留）
    document_code: str
    document_name: str
    document_version: str


class ECOStatusLogItem(BaseModel):
    """状态变更日志项"""
    id: str
    from_status: Optional[str] = None
    to_status: str
    operator_name: str
    comment: Optional[str] = None
    created_at: datetime


class ECOCcUserItem(BaseModel):
    """知会用户项"""
    user_id: str
    user_name: str


# ============================================================
# 执行项 Schema（需在 ECOCreate 之前定义）
# ============================================================

class ECOExecutionItemCreate(BaseSchema):
    """添加执行项请求"""
    source: Literal["ecr", "manual"] = "ecr"
    entity_type: Literal["part", "assembly", "component"]
    entity_name: str = Field(..., max_length=255)
    action: Literal["create", "upgrade", "qty_change", "delete", "no_change", "add_existing"]
    entity_id: Optional[str] = None
    entity_code: Optional[str] = None
    parent_entity_id: Optional[str] = None
    affected_item_id: Optional[str] = None
    detail: Optional[Dict[str, Any]] = None


class ECOExecutionItemEdit(BaseSchema):
    """编辑执行项请求"""
    entity_name: Optional[str] = Field(None, max_length=255)
    action: Optional[Literal["create", "upgrade", "qty_change", "delete", "no_change", "add_existing"]] = None
    entity_code: Optional[str] = None
    parent_entity_id: Optional[str] = None
    sort_order: Optional[int] = None


class ECOExecutionItemDetail(BaseSchema):
    """执行项详情"""
    id: str
    eco_id: str
    source: str
    affected_item_id: Optional[str] = None
    entity_type: str
    entity_id: Optional[str] = None
    entity_code: Optional[str] = None
    entity_name: str
    action: str
    status: str
    detail: Optional[Dict[str, Any]] = None
    new_entity_id: Optional[str] = None
    new_version: Optional[str] = None
    parent_entity_id: Optional[str] = None
    parent_new_entity_id: Optional[str] = None
    error_message: Optional[str] = None
    sort_order: int = 0
    executed_at: Optional[datetime] = None


# ============================================================
# ECO 创建/编辑 Schema
# ============================================================

class ECOCreate(BaseSchema):
    """ECO 创建请求"""
    title: str = Field(..., max_length=255)
    description: Optional[str] = None
    reason: str
    priority: Literal["urgent", "high", "normal", "low"] = "normal"
    category: Optional[str] = None
    reviewers: List[ECOReviewerItem] = []
    review_mode: Literal["all", "any"] = "all"
    document_links: List[ECODocumentLinkItem] = []
    ecr_id: Optional[str] = None
    release_items: Optional[List[Dict[str, Any]]] = None  # 工程预变更关联零部件
    execution_items: List[ECOExecutionItemCreate] = []


class ECOEdit(BaseSchema):
    """ECO 编辑请求（所有字段可选）"""
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    reason: Optional[str] = None
    priority: Optional[Literal["urgent", "high", "normal", "low"]] = None
    category: Optional[str] = None
    reviewers: Optional[List[ECOReviewerItem]] = None
    review_mode: Optional[Literal["all", "any"]] = None
    document_links: Optional[List[ECODocumentLinkItem]] = None
    ecr_id: Optional[str] = None
    release_items: Optional[List[Dict[str, Any]]] = None
    execution_items: Optional[List[ECOExecutionItemCreate]] = None


# ============================================================
# ECO 列表 Schema
# ============================================================

class ECOListParams(BaseSchema):
    """ECO 列表查询参数"""
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
    search: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class ECOListItem(BaseSchema):
    """ECO 列表项"""
    id: uuid.UUID
    eco_number: str
    title: str
    status: str
    priority: str
    category: Optional[str] = None
    creator_name: str
    reviewers_count: int = 0
    approved_count: int = 0
    execution_count: int = 0
    execution_completed_count: int = 0
    ecr_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ============================================================
# ECO 详情 Schema
# ============================================================

class ECODetail(ECOListItem):
    """ECO 详情（继承列表项 + 扩展）"""
    description: Optional[str] = None
    reason: str
    review_mode: str
    reviewers: List[ECOReviewerDetail] = []
    review_records: List[ECOReviewRecordItem] = []
    document_links: List[ECODocumentLinkItem] = []
    execution_items: List["ECOExecutionItemDetail"] = []
    status_logs: List[ECOStatusLogItem] = []
    cc_users: List[ECOCcUserItem] = []
    reviewed_at: Optional[datetime] = None
    executed_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None


# ============================================================
# 审批操作 Schema
# ============================================================

class ECOReviewAction(BaseSchema):
    """审批操作请求"""
    decision: Literal["approved", "rejected", "returned"]
    comment: Optional[str] = None


class ECOCloseAction(BaseSchema):
    """关闭 ECO 请求"""
    comment: Optional[str] = None


# ============================================================
# 知会操作 Schema
# ============================================================

class ECOCcAction(BaseSchema):
    """知会操作请求"""
    user_ids: List[str]


# ============================================================
# BOM 溯源 Schema（复用 ECR 的 BomImpactNode 结构）
# ============================================================

class BomImpactNode(BaseSchema):
    """BOM 影响节点（向上/向下通用）"""
    entity_type: str
    entity_id: str
    entity_code: str
    entity_name: str
    entity_version: str
    quantity: float
    action: str = "no_change"
    target_version: Optional[str] = None
    quantity_change: Optional[Dict[str, Any]] = None
    change_description: Optional[str] = None
    level: Optional[int] = None
    parent_entity_id: Optional[str] = None
    parent_entity_code: Optional[str] = None
    is_change_target: Optional[bool] = None
    tree_path: Optional[str] = None
    tree_connector: Optional[str] = None
    has_sibling: Optional[bool] = None


# ============================================================
# 执行项操作 Schema
# ============================================================

class ECOExecutionItemAction(BaseSchema):
    """执行项操作请求（可选携带 new_entity_id 用于自动检测场景）"""
    new_entity_id: Optional[str] = None
