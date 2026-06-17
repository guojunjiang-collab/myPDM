"""pytest 公共 fixtures：内存数据库、测试用户、假 LLM 客户端。"""
import os
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-tests-only")

import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

from app.database import Base
from app import models


# SQLite 下把 PG 的 JSONB 渲染成 JSON，使 create_all 可用（已实测必需）
@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):
    return "JSON"


@pytest.fixture
def db():
    """每个测试一个独立的内存 SQLite 会话。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def engineer_user(db):
    user = models.User(
        id=uuid.uuid4(), username="eng", password_hash="x", real_name="工程师",
        role="engineer", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def guest_user(db):
    user = models.User(
        id=uuid.uuid4(), username="guest1", password_hash="x", real_name="访客",
        role="guest", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def admin_user(db):
    user = models.User(
        id=uuid.uuid4(), username="admin1", password_hash="x", real_name="管理员",
        role="admin", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def production_user(db):
    user = models.User(
        id=uuid.uuid4(), username="prod1", password_hash="x", real_name="生产人员",
        role="production", status="active",
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


class FakeLLM:
    """脚本化的假 LLM：按预设序列产出 stream_chat 事件。

    scripts: List[List[dict]]，每次调用 stream_chat 弹出一组事件。
    """
    def __init__(self, scripts):
        self._scripts = list(scripts)
        self.calls = []

    def stream_chat(self, messages, tools):
        self.calls.append({"messages": list(messages), "tools": tools})
        events = self._scripts.pop(0)
        for ev in events:
            yield ev


@pytest.fixture
def make_fake_llm():
    return lambda scripts: FakeLLM(scripts)
