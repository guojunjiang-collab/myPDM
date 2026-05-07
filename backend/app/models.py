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

class Part(Base):
    __tablename__ = "parts"
    __table_args__ = (UniqueConstraint('code', 'version', name='uix_part_code_version'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    material = Column(String(128))
    unit = Column(String(32))
    price = Column(Numeric(12, 2))
    supplier = Column(String(255))
    version = Column(String(32), default="A")
    status = Column(String(32), nullable=False, default="draft")
    remark = Column(Text)
    revisions = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Assembly(Base):
    __tablename__ = "assemblies"
    __table_args__ = (UniqueConstraint('code', 'version', name='uix_assembly_code_version'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    material = Column(String(128))
    unit = Column(String(32))
    price = Column(Numeric(12, 2))
    version = Column(String(32), default="V1.0")
    status = Column(String(32), nullable=False, default="draft")
    remark = Column(Text)
    revisions = Column(JSONB, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class BOMItem(Base):
    __tablename__ = "bom_items"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_type = Column(String(16), nullable=False)
    parent_id = Column(UUID(as_uuid=True), nullable=False)
    child_type = Column(String(16), nullable=False)
    child_id = Column(UUID(as_uuid=True), nullable=False)
    quantity = Column(Numeric(10, 3), nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

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

class Attachment(Base):
    """附件表：简化后仅存储文件内容（通过 Part/Assembly 外键关联）"""
    __tablename__ = "attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_name = Column(String(255))
    file_data = Column(LargeBinary)  # 使用 BYTEA 存储二进制文件内容
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Document(Base):
    """图文档主表"""
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint('code', 'version', name='uix_doc_code_version'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(String(32), default="A")
    status = Column(String(32), nullable=False, default="draft")
    description = Column(Text)
    file_name = Column(String(255))
    file_id = Column(UUID(as_uuid=True), ForeignKey('document_attachments.id', ondelete='SET NULL'))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class DocumentAttachment(Base):
    """图文档独立附件表"""
    __tablename__ = "document_attachments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey('documents.id', ondelete='CASCADE'), nullable=False)
    file_name = Column(String(255))
    file_data = Column(LargeBinary)  # 保留用于向后兼容
    file_size = Column(Integer)
    file_path = Column(String(512))  # 新增：文件系统路径
    file_hash = Column(String(64))   # 新增：文件哈希值
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class EntityDocument(Base):
    """实体-图文档关联表（零部件↔图文档）"""
    __tablename__ = "entity_documents"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey('documents.id', ondelete='RESTRICT'), nullable=False)
    category = Column(String(64))
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Dictionary(Base):
    __tablename__ = "dictionaries"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dict_type = Column(String(32), nullable=False)  # material, unit, supplier, product
    value = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

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
