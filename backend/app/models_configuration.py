"""
构型配置 - SQLAlchemy Models
==============================
  - configuration_items: 构型库（构型项定义 + 关联零部件 + 子构型项）
  - configuration_schemes: 构型方案（哪个构型项适用哪些架次）
"""

import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ConfigurationItemPart(Base):
    """构型库关联零部件"""
    __tablename__ = "configuration_item_parts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    configuration_item_id = Column(UUID(as_uuid=True), ForeignKey("configuration_items.id", ondelete="CASCADE"), nullable=False)
    part_type = Column(String(16), nullable=False)  # 'part' | 'assembly'
    part_id = Column(UUID(as_uuid=True), nullable=False)
    is_required = Column(Boolean, nullable=False, default=True)
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
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
