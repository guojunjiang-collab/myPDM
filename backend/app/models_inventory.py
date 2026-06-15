"""
库存管理 - SQLAlchemy Models
============================
仓库 / 物料主数据 / 库存余额 / 库存流水 / 单据 / 明细行 / 审批记录 / 状态日志
"""
import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Numeric, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(32), nullable=True)            # 原料库/成品库/不良品库/通用
    default_keeper_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(32), nullable=False, default="active")
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryMaterial(Base):
    __tablename__ = "inventory_materials"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255), nullable=True)
    unit = Column(String(32), nullable=True)
    source_type = Column(String(16), nullable=False, default="standalone")  # part/assembly/standalone
    ref_entity_type = Column(String(16), nullable=True)   # part/assembly
    ref_entity_id = Column(UUID(as_uuid=True), nullable=True)
    track_mode = Column(String(16), nullable=False, default="quantity")     # quantity/batch
    safety_stock = Column(Numeric(14, 4), nullable=True)
    status = Column(String(32), nullable=False, default="active")
    remark = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryStock(Base):
    __tablename__ = "inventory_stock"
    __table_args__ = (
        UniqueConstraint("material_id", "warehouse_id", "batch_no", name="uix_stock_mat_wh_batch"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id = Column(UUID(as_uuid=True), ForeignKey("inventory_materials.id"), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    quantity = Column(Numeric(14, 4), nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id = Column(UUID(as_uuid=True), nullable=False)
    warehouse_id = Column(UUID(as_uuid=True), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    direction = Column(String(4), nullable=False)       # in/out
    quantity = Column(Numeric(14, 4), nullable=False)   # 恒正
    balance_after = Column(Numeric(14, 4), nullable=False)
    doc_id = Column(UUID(as_uuid=True), nullable=True)
    doc_type = Column(String(16), nullable=True)
    doc_number = Column(String(32), nullable=True)
    doc_line_id = Column(UUID(as_uuid=True), nullable=True)
    operator_id = Column(UUID(as_uuid=True), nullable=True)
    operator_name = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InventoryDocument(Base):
    __tablename__ = "inventory_documents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_number = Column(String(32), unique=True, nullable=False)
    doc_type = Column(String(16), nullable=False)       # inbound/outbound/transfer/stocktake/adjustment
    biz_type = Column(String(32), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    to_warehouse_id = Column(UUID(as_uuid=True), ForeignKey("warehouses.id"), nullable=True)
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")
    keeper_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    keeper_name = Column(String(64), nullable=True)
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    document_links = Column(JSONB, nullable=False, default=[])
    remark = Column(Text, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class InventoryDocumentLine(Base):
    __tablename__ = "inventory_document_lines"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    material_id = Column(UUID(as_uuid=True), ForeignKey("inventory_materials.id"), nullable=False)
    batch_no = Column(String(64), nullable=False, default="")
    quantity = Column(Numeric(14, 4), nullable=False, default=0)
    direction = Column(String(4), nullable=True)         # 仅调整单：in/out
    book_quantity = Column(Numeric(14, 4), nullable=True)     # 仅盘点
    counted_quantity = Column(Numeric(14, 4), nullable=True)  # 仅盘点
    remark = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)


class InventoryReviewRecord(Base):
    __tablename__ = "inventory_review_records"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InventoryStatusLog(Base):
    __tablename__ = "inventory_status_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doc_id = Column(UUID(as_uuid=True), ForeignKey("inventory_documents.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
