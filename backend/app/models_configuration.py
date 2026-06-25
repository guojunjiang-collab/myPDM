"""
构型配置 - SQLAlchemy Models
==============================
  - configuration_items: 构型库（构型项定义 + 关联零部件 + 子构型项）
  - configuration_schemes: 构型方案（哪个构型项适用哪些架次）
"""

import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class ConfigurationItem(Base):
    """构型库表"""
    __tablename__ = "configuration_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    remark = Column(Text)
    document_links = Column(JSONB, default=[])  # [{id, document_id, category, sort_order}]
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ConfigurationItemPart(Base):
    """构型库关联零部件"""
    __tablename__ = "configuration_item_parts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    configuration_item_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id", ondelete="CASCADE"), nullable=False)
    part_type = Column(String(16), nullable=False)  # 'part' | 'assembly'
    part_id = Column(UUID(as_uuid=True), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationItemChild(Base):
    """构型库子构型项（自引用）"""
    __tablename__ = "configuration_item_children"
    __table_args__ = (UniqueConstraint('parent_id', 'child_id', name='uix_config_child'),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id", ondelete="CASCADE"), nullable=False)
    child_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id", ondelete="CASCADE"), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationProfile(Base):
    """构型配置主表"""
    __tablename__ = "configuration_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    configuration_item_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id"), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    effectivity_start = Column(String(32))
    effectivity_end = Column(String(32))
    remark = Column(Text)
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")  # all=会签 / any=或签
    cc_users = Column(JSONB, nullable=False, default=[])
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)


class ConfigurationProfileItem(Base):
    """构型配置清单明细（正式配置清单）"""
    __tablename__ = "configuration_profile_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    source_config_item_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id"), nullable=True)
    item_type = Column(String(16), nullable=False)
    item_id = Column(UUID(as_uuid=True), nullable=False)
    item_code = Column(String(64))
    item_name = Column(String(255))
    is_required = Column(Boolean, nullable=False, default=True)
    is_selected = Column(Boolean, nullable=False, default=False)
    quantity = Column(Integer, nullable=False, default=1)
    source_type = Column(String(16), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationWorkingItem(Base):
    """配置清单工作表（用户实时编辑状态）"""
    __tablename__ = "configuration_working_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    source_config_item_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id"), nullable=True)
    item_type = Column(String(16), nullable=False)
    item_id = Column(UUID(as_uuid=True), nullable=False)
    item_code = Column(String(64))
    item_name = Column(String(255))
    is_required = Column(Boolean, nullable=False, default=True)
    is_selected = Column(Boolean, nullable=False, default=False)
    quantity = Column(Integer, nullable=False, default=1)
    source_type = Column(String(16), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationReviewRecord(Base):
    """构型配置审批记录表"""
    __tablename__ = "configuration_review_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)  # approved / rejected / returned
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationStatusLog(Base):
    """构型配置状态变更日志表"""
    __tablename__ = "configuration_status_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
