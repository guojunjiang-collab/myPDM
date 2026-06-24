"""
项目管理 - SQLAlchemy Models
============================
项目容器 / 项目成员 / 任务(自引用树) / 任务关联对象 / 任务评论
"""
import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.database import Base


class Project(Base):
    __tablename__ = "projects"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(16), nullable=False, default="进行中")  # 进行中/已完成/已暂停/已归档
    planned_start = Column(String(32), nullable=True)
    planned_end = Column(String(32), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ProjectMember(Base):
    __tablename__ = "project_members"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role_in_project = Column(String(8), nullable=False, default="成员")  # 经理/成员
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectTask(Base):
    __tablename__ = "project_tasks"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id"), nullable=True)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    task_type = Column(String(8), nullable=False, default="任务")      # 任务/里程碑/评审
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status = Column(String(8), nullable=False, default="未开始")        # 未开始/进行中/已完成/挂起
    priority = Column(String(4), nullable=False, default="中")         # 高/中/低
    planned_start = Column(String(32), nullable=True)
    planned_end = Column(String(32), nullable=True)
    actual_start = Column(String(32), nullable=True)
    actual_end = Column(String(32), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)


class ProjectTaskLink(Base):
    __tablename__ = "project_task_links"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String(16), nullable=False)  # part/assembly/config_item/ec/document
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ProjectTaskComment(Base):
    __tablename__ = "project_task_comments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(UUID(as_uuid=True), ForeignKey("project_tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)
