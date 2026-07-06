"""
零部件签入检出模型（三层：PartMaster → PartRevision → PartIteration）
参考 DocDoku PLM 数据结构
"""
import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base


class PartMaster(Base):
    __tablename__ = "part_masters"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    spec = Column(String(255))
    type = Column(String(16), nullable=False, default="part")  # 'part' / 'assembly'
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

    revisions = relationship("PartRevision", back_populates="master", lazy="dynamic")


class PartRevision(Base):
    __tablename__ = "part_revisions"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    master_id = Column(UUID(as_uuid=True), ForeignKey("part_masters.id", ondelete="CASCADE"), nullable=False)
    version = Column(String(32), nullable=False, default="A")
    status = Column(String(32), nullable=False, default="draft")  # draft/frozen/released/obsolete
    revision_note = Column(Text)
    check_out_user_id = Column(UUID(as_uuid=True), nullable=True)
    check_out_date = Column(DateTime(timezone=True), nullable=True)
    latest_iteration = Column(Integer, nullable=False, default=0)
    revision_parent_id = Column(UUID(as_uuid=True), nullable=True)
    creator_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True, default=None)

    master = relationship("PartMaster", back_populates="revisions")
    iterations = relationship("PartIteration", back_populates="revision", lazy="dynamic",
                              order_by="PartIteration.iteration")


class PartIteration(Base):
    __tablename__ = "part_iterations"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    revision_id = Column(UUID(as_uuid=True), ForeignKey("part_revisions.id", ondelete="CASCADE"), nullable=False)
    iteration = Column(Integer, nullable=False, default=1)
    check_in_date = Column(DateTime(timezone=True), nullable=True)
    check_in_note = Column(Text)
    custom_fields = Column(JSONB, default={})
    document_links = Column(JSONB, default=[])
    remark = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    revision = relationship("PartRevision", back_populates="iterations")
    attachments = relationship("PartAttachment", back_populates="iteration", lazy="dynamic")


class PartAttachment(Base):
    __tablename__ = "part_attachments"
    __table_args__ = ()
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iteration_id = Column(UUID(as_uuid=True), ForeignKey("part_iterations.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(32), nullable=False)  # 'cad' / 'production'
    file_name = Column(String(255))
    file_size = Column(Integer)
    file_path = Column(String(512))
    file_hash = Column(String(64))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    iteration = relationship("PartIteration", back_populates="attachments")
