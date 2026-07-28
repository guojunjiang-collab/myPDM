"""license 上传审计表。校验永远以文件+验签为准，本表仅供展示与追溯。"""
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from .database import Base


class LicenseRecord(Base):
    __tablename__ = "licenses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    license_id = Column(String(64), nullable=False)
    customer = Column(String(255), nullable=False)
    machine_code = Column(String(64), nullable=False)
    issued_at = Column(String(16), nullable=False)
    expires_at = Column(String(16), nullable=False)
    max_users = Column(Integer, nullable=False, default=0)
    modules = Column(JSONB, default=list)
    edition = Column(String(32), nullable=False, default="basic")
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
