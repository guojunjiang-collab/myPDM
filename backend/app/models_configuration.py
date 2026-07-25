"""
构型配置 - SQLAlchemy Models
==============================
  - configuration_item_masters / configuration_item_revisions / configuration_item_iterations : 三层构型项模型
  - configuration_item_parts: 构型项关联零部件
  - configuration_item_children: 子构型项
  - configuration_profiles: 构型方案
"""

import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class ConfigurationItemMaster(Base):
    """构型项主数据（仅 code/name，其他通过自定义字段补充）"""
    __tablename__ = "configuration_item_masters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ConfigurationItemRevision(Base):
    """构型项版本（含签出锁 + 状态）"""
    __tablename__ = "configuration_item_revisions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_masters.id"), nullable=False)
    version = Column(String(8), nullable=False)
    status = Column(String(32), nullable=False, default="draft")
    check_out_user_id = Column(UUID(as_uuid=True), nullable=True)
    check_out_date = Column(DateTime(timezone=True), nullable=True)
    latest_iteration = Column(Integer, nullable=False, default=1)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ConfigurationItemIteration(Base):
    """构型项迭代（可编辑版本数据 + 签入备注）"""
    __tablename__ = "configuration_item_iterations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=False)
    iteration = Column(Integer, nullable=False)
    check_in_note = Column(Text)
    version_name = Column(String(255))
    document_links = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationItemPart(Base):
    """构型库关联零部件（FK 指向 iteration）"""
    __tablename__ = "configuration_item_parts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id", ondelete="CASCADE"), nullable=False)
    part_type = Column(String(16), nullable=False)
    part_id = Column(UUID(as_uuid=True), nullable=False)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id"), nullable=True)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationItemChild(Base):
    """构型库子构型项（parent→iteration, child→revision）"""
    __tablename__ = "configuration_item_children"
    __table_args__ = (UniqueConstraint('parent_iteration_id', 'child_revision_id', name='uix_config_child'),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id", ondelete="CASCADE"), nullable=False)
    child_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id", ondelete="CASCADE"), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationProfile(Base):
    """构型配置主表（FK 改为指向 revision）"""
    __tablename__ = "configuration_profiles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    configuration_item_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=True)
    status = Column(String(16), nullable=False, default="draft")
    effectivity_start = Column(String(32))
    effectivity_end = Column(String(32))
    remark = Column(Text)
    creator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")
    cc_users = Column(JSONB, nullable=False, default=[])
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)


class ConfigurationProfileItem(Base):
    """构型配置清单明细（正式配置清单，FK 改为 revision + iteration）"""
    __tablename__ = "configuration_profile_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    source_config_item_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=True)
    source_config_item_iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id"), nullable=True)
    item_type = Column(String(16), nullable=False)
    item_id = Column(UUID(as_uuid=True), nullable=False)
    item_code = Column(String(64))
    item_name = Column(String(255))
    part_revision_id = Column(UUID(as_uuid=True), nullable=True)
    is_required = Column(Boolean, nullable=False, default=True)
    is_selected = Column(Boolean, nullable=False, default=False)
    quantity = Column(Integer, nullable=False, default=1)
    source_type = Column(String(16), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationWorkingItem(Base):
    """配置清单工作表（用户实时编辑状态，FK 改为 revision + iteration）"""
    __tablename__ = "configuration_working_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    source_config_item_revision_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_revisions.id"), nullable=True)
    source_config_item_iteration_id = Column(UUID(as_uuid=True), ForeignKey("configuration_item_iterations.id"), nullable=True)
    item_type = Column(String(16), nullable=False)
    item_id = Column(UUID(as_uuid=True), nullable=False)
    item_code = Column(String(64))
    item_name = Column(String(255))
    part_revision_id = Column(UUID(as_uuid=True), nullable=True)
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
    decision = Column(String(16), nullable=False)
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

# 向后兼容别名：旧代码引用 ConfigurationItem 自动映射到 ConfigurationItemMaster。
# 后续 Tasks 2-3 将所有调用方重写为三层模型后移除此别名。
ConfigurationItem = ConfigurationItemMaster
