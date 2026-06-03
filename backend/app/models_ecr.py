"""
ECR (Engineering Change Request) - SQLAlchemy Models
====================================================
变更管理 - ECR 模块数据模型
"""

import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class ECR(Base):
    """ECR 主表 - 工程变更请求"""
    __tablename__ = "ecrs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ecr_number = Column(String(32), unique=True, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    reason = Column(String(64), nullable=False)
    priority = Column(String(16), nullable=False, default="normal")
    category = Column(String(32), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    document_links = Column(JSONB, nullable=False, default=[])
    cc_users = Column(JSONB, nullable=False, default=[])  # 知会用户列表 [{"user_id": "xxx", "user_name": "xxx"}]
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
    eco_id = Column(UUID(as_uuid=True), nullable=True)


class ECRAffectedItem(Base):
    """受影响对象及 BOM 影响表"""
    __tablename__ = "ecr_affected_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ecr_id = Column(UUID(as_uuid=True), ForeignKey("ecrs.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String(16), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    entity_code = Column(String(64), nullable=True)
    entity_name = Column(String(255), nullable=True)
    entity_version = Column(String(32), nullable=True)
    change_description = Column(Text, nullable=True)
    change_type = Column(String(32), nullable=True)
    bom_impact = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ECRReviewRecord(Base):
    """审批记录表"""
    __tablename__ = "ecr_review_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ecr_id = Column(UUID(as_uuid=True), ForeignKey("ecrs.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ECRStatusLog(Base):
    """状态变更日志表"""
    __tablename__ = "ecr_status_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ecr_id = Column(UUID(as_uuid=True), ForeignKey("ecrs.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
