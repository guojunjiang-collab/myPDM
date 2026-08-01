"""pytest 公共 fixtures：内存数据库、测试用户、假 LLM 客户端。"""
import os
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-tests-only-xx")

import uuid
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

from app.database import Base
# 导入全部模型模块，确保 Base.metadata 注册所有表（BOMItem 外键依赖 part_revisions 等跨模块表）
from app import models, models_parts, models_ecr, models_eco, models_configuration, models_notification  # noqa: F401
try:
    from app import models_inventory, models_project  # noqa: F401
except ImportError:
    pass


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


@pytest.fixture
def make_document(db):
    """三层图文档工厂：Master → Revision(A) → Iteration(1)。

    ⚠️ v3.1.3 起 creator_id 从 Master/Revision 下移到 Iteration 层。造图文档测试数据
    一律走本工厂，**不要**直接给 Master/Revision 传 creator_id —— 那样只会静默失配，
    掩盖 document_content_access 之类依赖创建者的策略回归（历史上就这么漏过一次）。
    """
    def _make(creator=None, code=None, name="图纸", group_ids=(), status="draft"):
        m = models.DocumentMaster(id=uuid.uuid4(), code=code or f"D{uuid.uuid4().hex[:6]}", name=name)
        db.add(m); db.flush()
        r = models.DocumentRevision(id=uuid.uuid4(), master_id=m.id, version="A",
                                    status=status, latest_iteration=1)
        db.add(r); db.flush()
        it = models.DocumentIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1,
                                      creator_id=creator.id if creator else None)
        db.add(it); db.flush()
        for gid in group_ids:
            db.add(models.DocumentGroupLink(document_id=m.id, group_id=gid))
        db.commit()
        db.refresh(m); db.refresh(r); db.refresh(it)
        return m, r, it
    return _make


@pytest.fixture
def make_doc_attachment(db):
    """图文档附件工厂（挂在 revision + iteration 上）。"""
    def _make(revision, iteration=None, file_name="a.pdf", file_path="x/a.pdf"):
        a = models.DocumentAttachment(
            id=uuid.uuid4(), revision_id=revision.id,
            iteration_id=iteration.id if iteration is not None else None,
            file_name=file_name, file_path=file_path,
        )
        db.add(a); db.commit(); db.refresh(a)
        return a
    return _make


@pytest.fixture
def make_user_group(db):
    def _make(name):
        g = models.UserGroup(name=name)
        db.add(g); db.commit(); db.refresh(g)
        return g
    return _make


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
