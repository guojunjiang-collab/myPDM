"""
ECO (Engineering Change Order) - SQLAlchemy Models
====================================================
变更管理 - ECO 模块数据模型
"""

import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class ECO(Base):
    """ECO 主表 - 工程变更指令"""
    __tablename__ = "ecos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    eco_number = Column(String(32), unique=True, nullable=False)
    ecr_id = Column(UUID(as_uuid=True), ForeignKey("ecrs.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    reason = Column(String(64), nullable=False)
    priority = Column(String(16), nullable=False, default="normal")
    category = Column(String(32), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    executor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    document_links = Column(JSONB, nullable=False, default=[])
    cc_users = Column(JSONB, nullable=False, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    executed_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)


class ECOExecutionItem(Base):
    """执行明细表"""
    __tablename__ = "eco_execution_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    eco_id = Column(UUID(as_uuid=True), ForeignKey("ecos.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(8), nullable=False, default="ecr")
    affected_item_id = Column(UUID(as_uuid=True), ForeignKey("ecr_affected_items.id"), nullable=True)
    entity_type = Column(String(16), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    entity_code = Column(String(64), nullable=True)
    entity_name = Column(String(255), nullable=False)
    action = Column(String(16), nullable=False)
    status = Column(String(16), nullable=False, default="pending")
    detail = Column(JSONB, nullable=False, default={})
    new_entity_id = Column(UUID(as_uuid=True), nullable=True)
    new_version = Column(String(32), nullable=True)
    parent_entity_id = Column(UUID(as_uuid=True), nullable=True)
    parent_new_entity_id = Column(UUID(as_uuid=True), nullable=True)
    error_message = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    executed_at = Column(DateTime(timezone=True), nullable=True)


class ECOReviewRecord(Base):
    """审批记录表"""
    __tablename__ = "eco_review_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    eco_id = Column(UUID(as_uuid=True), ForeignKey("ecos.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ECOStatusLog(Base):
    """状态变更日志表"""
    __tablename__ = "eco_status_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    eco_id = Column(UUID(as_uuid=True), ForeignKey("ecos.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
