"""库存管理 - Pydantic Schemas"""
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal, List
from datetime import datetime


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 仓库 ----
class WarehouseCreate(BaseSchema):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    type: Optional[str] = None
    default_keeper_id: Optional[str] = None
    remark: Optional[str] = None


class WarehouseEdit(BaseSchema):
    name: Optional[str] = None
    type: Optional[str] = None
    default_keeper_id: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None


# ---- 物料 ----
class MaterialCreate(BaseSchema):
    code: str = Field(..., max_length=64)
    name: str = Field(..., max_length=255)
    spec: Optional[str] = None
    unit: Optional[str] = None
    track_mode: Literal["quantity", "batch"] = "quantity"
    safety_stock: Optional[float] = None
    remark: Optional[str] = None


class MaterialEdit(BaseSchema):
    name: Optional[str] = None
    spec: Optional[str] = None
    unit: Optional[str] = None
    track_mode: Optional[Literal["quantity", "batch"]] = None
    safety_stock: Optional[float] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class MaterialEnableFromPDM(BaseSchema):
    entity_type: Literal["part", "assembly"]
    entity_id: str
    track_mode: Literal["quantity", "batch"] = "quantity"
    unit: Optional[str] = None
    safety_stock: Optional[float] = None


# ---- 单据 ----
class ReviewerItem(BaseModel):
    user_id: str
    seq: int = 0


class DocumentLineItem(BaseSchema):
    material_id: str
    batch_no: str = ""
    quantity: float = 0
    direction: Optional[Literal["in", "out"]] = None   # 仅调整单
    counted_quantity: Optional[float] = None            # 仅盘点单（过账时填）
    remark: Optional[str] = None


class DocumentCreate(BaseSchema):
    doc_type: Literal["inbound", "outbound", "transfer", "stocktake", "adjustment"]
    biz_type: Optional[str] = None
    warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    reviewers: List[ReviewerItem] = []
    review_mode: Literal["all", "any"] = "all"
    keeper_id: Optional[str] = None
    remark: Optional[str] = None
    lines: List[DocumentLineItem] = []


class DocumentEdit(BaseSchema):
    biz_type: Optional[str] = None
    warehouse_id: Optional[str] = None
    to_warehouse_id: Optional[str] = None
    reviewers: Optional[List[ReviewerItem]] = None
    review_mode: Optional[Literal["all", "any"]] = None
    keeper_id: Optional[str] = None
    remark: Optional[str] = None
    lines: Optional[List[DocumentLineItem]] = None


class ReviewAction(BaseSchema):
    decision: Literal["approved", "rejected", "returned"]
    comment: Optional[str] = None


class AssignKeeperAction(BaseSchema):
    keeper_id: str


class PostLineCount(BaseModel):
    line_id: str
    counted_quantity: float


class PostAction(BaseSchema):
    # 盘点单过账时提交各行实盘数；其它单据可省略
    counts: Optional[List[PostLineCount]] = None


class DocumentListParams(BaseModel):
    page: int = 1
    page_size: int = 20
    doc_type: Optional[str] = None
    status: Optional[str] = None
    search: Optional[str] = None
