import uuid
from sqlalchemy import Column, String, Integer, DateTime, Numeric, Text, JSON, UniqueConstraint, ForeignKey, LargeBinary
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    real_name = Column(String(64), nullable=False)
    role = Column(String(32), nullable=False)
    department = Column(String(128))
    phone = Column(String(32))
    status = Column(String(32), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Component(Base):
    __tablename__ = "components"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    version = Column(String(32), default="A")
    status = Column(String(32), nullable=False, default="draft")
    remark = Column(Text)
    revisions = Column(JSONB, default=[])
    revision_parent_id = Column(UUID(as_uuid=True), nullable=True)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    document_links = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

class BOMItem(Base):
    __tablename__ = "bom_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("part_iterations.id", ondelete="CASCADE"), nullable=False)
    parent_revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    child_revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

class OperationLog(Base):
    __tablename__ = "operation_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True))
    username = Column(String(64))
    action = Column(String(64), nullable=False)
    target_type = Column(String(32))
    target_id = Column(String(64))
    detail = Column(Text)
    ip_address = Column(String(64))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Document(Base):
    """图文档主表"""
    __tablename__ = "documents"
    # Unique constraint managed by DB partial index: uix_doc_code_version WHERE deleted_at IS NULL
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(String(32), default="A")
    status = Column(String(32), nullable=False, default="draft")
    remark = Column(Text)
    file_name = Column(String(255))
    file_id = Column(UUID(as_uuid=True), ForeignKey('document_attachments.id', ondelete='SET NULL'))
    revisions = Column(JSONB, default=[])
    revision_parent_id = Column(UUID(as_uuid=True), nullable=True)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

class DocumentAttachment(Base):
    """图文档独立附件表（文件存储在文件系统）"""
    __tablename__ = "document_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey('documents.id', ondelete='CASCADE'), nullable=False)
    file_name = Column(String(255))
    file_size = Column(Integer)
    file_path = Column(String(512))  # 文件系统路径
    file_hash = Column(String(64))   # 文件哈希值
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ComponentAttachment(Base):
    """零部件独立附件表（照抄 document_attachments，文件存储在文件系统）"""
    __tablename__ = "component_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    component_id = Column(UUID(as_uuid=True), ForeignKey('components.id', ondelete='CASCADE'), nullable=False)
    category = Column(String(32), nullable=False)  # 'cad' / 'production'
    file_name = Column(String(255))
    file_size = Column(Integer)
    file_path = Column(String(512))  # 文件系统路径
    file_hash = Column(String(64))   # 文件哈希值
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CustomFieldDefinition(Base):
    """自定义字段定义表"""
    __tablename__ = "custom_field_definitions"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(128), nullable=False)           # 字段显示名称
    field_key = Column(String(64), unique=True, nullable=False)  # 字段标识键
    field_type = Column(String(32), nullable=False)      # text / number / select / multiselect
    options = Column(JSONB, default=[])                   # 单选/多选选项列表
    is_required = Column(Integer, default=0)              # 是否必填（数据库是 BOOLEAN，用 Integer 兼容）
    applies_to = Column(JSONB, nullable=False, default=[])  # ['part'] / ['component'] / ['part', 'component'] / ['part', 'component', 'document'] 等数组
    sort_order = Column(Integer, default=0)               # 排序序号
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class CustomFieldValue(Base):
    """自定义字段值表"""
    __tablename__ = "custom_field_values"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(UUID(as_uuid=True), ForeignKey('custom_field_definitions.id', ondelete='CASCADE'), nullable=False)
    entity_type = Column(String(32), nullable=False)  # 'part' 或 'component'
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    value_text = Column(Text, nullable=True)           # 文本/单选值
    value_number = Column(Numeric(12, 4), nullable=True)  # 数字值
    value_json = Column(JSONB, nullable=True)           # 多选值数组
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ===== 用户看板 =====

class UserDashboard(Base):
    """用户看板主表（每用户一个）"""
    __tablename__ = "user_dashboards"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False)
    name = Column(String(128), default="我的看板")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    folders = relationship("DashboardFolder", back_populates="dashboard", cascade="all, delete-orphan")


class DashboardFolder(Base):
    """看板文件夹（树形结构）"""
    __tablename__ = "dashboard_folders"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey('user_dashboards.id', ondelete='CASCADE'), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('dashboard_folders.id', ondelete='CASCADE'), nullable=True)
    name = Column(String(128), nullable=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    dashboard = relationship("UserDashboard", back_populates="folders")
    children = relationship("DashboardFolder", backref="parent", remote_side="DashboardFolder.id", cascade="save-update, merge")
    items = relationship("DashboardItem", back_populates="folder", cascade="all, delete-orphan")
    shares = relationship("DashboardFolderShare", back_populates="folder", cascade="all, delete-orphan")


class DashboardItem(Base):
    """文件夹内容关联表"""
    __tablename__ = "dashboard_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    folder_id = Column(UUID(as_uuid=True), ForeignKey('dashboard_folders.id', ondelete='CASCADE'), nullable=False)
    entity_type = Column(String(16), nullable=False)  # part / assembly / document
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    folder = relationship("DashboardFolder", back_populates="items")

class UserGroup(Base):
    """用户组"""
    __tablename__ = "user_groups"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(64), unique=True, nullable=False)
    description = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserGroupMember(Base):
    """用户 ↔ 组（多对多）"""
    __tablename__ = "user_group_members"
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey('user_groups.id', ondelete='CASCADE'), primary_key=True)


class DocumentGroupLink(Base):
    """文档 ↔ 组（多对多）"""
    __tablename__ = "document_group_links"
    document_id = Column(UUID(as_uuid=True), ForeignKey('documents.id', ondelete='CASCADE'), primary_key=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey('user_groups.id', ondelete='CASCADE'), primary_key=True)


class DashboardFolderShare(Base):
    """文件夹共享表"""
    __tablename__ = "dashboard_folder_shares"
    __table_args__ = (UniqueConstraint('folder_id', 'shared_with_user_id', name='uix_folder_share_user'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    folder_id = Column(UUID(as_uuid=True), ForeignKey('dashboard_folders.id', ondelete='CASCADE'), nullable=False)
    shared_with_user_id = Column(UUID(as_uuid=True), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    permission = Column(String(16), nullable=False, default="view")  # view / edit
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    folder = relationship("DashboardFolder", back_populates="shares")
