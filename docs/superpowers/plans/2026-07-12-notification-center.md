# 通知/消息中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 myPDM 建立纯站内通知系统（顶栏铃铛 + 未读红点 + 下拉面板 + 通知中心页），让 ECR/ECO/配置/库存/项目的知会类事件主动触达相关用户。

**Architecture:** 新增 `notifications` 表 + `notifications.py` 服务（扇出写入）；在各模块状态变更的统一函数中集中埋点生成通知；新增 `/api/notifications` 只读 + 已读操作路由；前端复用现有 10 秒轮询拉未读数，顶栏铃铛下拉 + 独立通知中心页。

**Tech Stack:** 后端 FastAPI + SQLAlchemy 2.0 + PostgreSQL；前端 React 18 + TypeScript + Zustand + Tailwind；权限走 `permissions.json` 单一事实源自动生成。

**设计来源:** `docs/superpowers/specs/2026-07-12-notification-center-design.md`

---

## 文件结构

**后端新增/修改：**
- 新增 `backend/app/models_notification.py` — Notification 模型
- 新增 `backend/app/schemas_notification.py` — Pydantic Schema
- 新增 `backend/app/notifications.py` — 通知服务（create_notifications 扇出 + 查询/已读/清除）
- 新增 `backend/app/routers/notifications.py` — API 路由
- 修改 `backend/app/main.py` — 导入新模型、注册路由
- 修改 `permissions/permissions.json` — 新增 `notifications:read`
- 修改 `backend/app/crud_ecr.py` / `crud_eco.py` / `crud_configuration.py` / `crud_inventory.py` / `crud_project.py` — 埋点
- 修改 `backend/app/routers/ecrs.py` / `ecos.py` — cc 端点埋点

**前端新增/修改：**
- 新增 `frontend/src/stores/notification.ts` — Zustand store（未读数 + 最近列表）
- 新增 `frontend/src/services/notificationApi.ts` — API 客户端
- 新增 `frontend/src/components/NotificationBell.tsx` — 顶栏铃铛 + 下拉面板
- 新增 `frontend/src/pages/Notifications.tsx` — 通知中心页
- 修改 `frontend/src/components/Layout.tsx` — 插入铃铛、启停轮询
- 修改 `frontend/src/App.tsx` — 注册 `/notifications` 路由
- 修改 `frontend/src/types/index.ts` — Notification 类型

**测试：**
- `backend/tests/test_notifications.py` — 服务与路由测试
- `backend/tests/test_notification_hooks.py` — 埋点事件→通知生成测试

---

## Task 1: Notification 数据模型

**Files:**
- Create: `backend/app/models_notification.py`
- Modify: `backend/app/main.py`（导入新模型模块）
- Modify: `backend/tests/conftest.py`（导入新模型模块以建表）

- [ ] **Step 1: 创建 Notification 模型**

Create `backend/app/models_notification.py`:

```python
"""站内通知模型（每收件人一行，独立已读状态）。"""
import uuid
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .database import Base


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_recipient_read", "recipient_id", "is_read"),
        Index("ix_notifications_recipient_created", "recipient_id", "created_at"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sender_id = Column(UUID(as_uuid=True), nullable=True)
    event_type = Column(String(48), nullable=False)      # ecr_approved / cc_added / task_assigned ...
    title = Column(String(255), nullable=False)
    body = Column(String(512), nullable=True)
    target_type = Column(String(32), nullable=False)     # ecr / eco / configuration_profile / inventory_document / project_task
    target_id = Column(String(64), nullable=False)
    is_read = Column(Boolean, nullable=False, default=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 2: main.py 导入新模型（两处）**

在 `backend/app/main.py` 顶部模型导入区（约第 503-509 行附近，与其它 `import app.models_*` 并列）以及启动建表区（约第 502-509 行）都加入：

```python
import app.models_notification  # noqa: F401
```

两处 `import` 块都要加（顶部全局导入区 + 启动 `_run` 内的导入区）。若顶部无全局导入区，仅需保证启动区（约 509 行后）存在该行，`Base.metadata.create_all` 即会建表。

- [ ] **Step 3: conftest.py 导入新模型**

Modify `backend/tests/conftest.py` — 在现有 `from app import models, models_parts, ...` 那一行追加 `models_notification`：

```python
from app import models, models_parts, models_ecr, models_eco, models_configuration, models_notification  # noqa: F401
```

- [ ] **Step 4: 写建表冒烟测试**

Create `backend/tests/test_notifications.py`:

```python
import uuid
from app import models_notification


def test_notification_table_persists(db):
    n = models_notification.Notification(
        id=uuid.uuid4(),
        recipient_id=uuid.uuid4(),
        event_type="ecr_approved",
        title="ECR-2026-0007 审批通过",
        body="你发起的变更请求已通过全部审批",
        target_type="ecr",
        target_id="abc-123",
    )
    db.add(n); db.commit(); db.refresh(n)
    assert n.is_read is False
    assert n.created_at is not None
```

- [ ] **Step 5: 运行测试**

Run: `docker cp backend/tests bom_backend:/app/tests; docker cp backend/app/models_notification.py bom_backend:/app/app/models_notification.py; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py::test_notification_table_persists -q`
Expected: PASS

> 注：本项目后端在 Docker 容器运行，测试目录未挂载。每次跑测试前用 `docker cp` 同步改动文件到 `bom_backend:/app/`，再 `docker exec` 运行。后续任务同理。

- [ ] **Step 6: Commit**

```bash
git add backend/app/models_notification.py backend/app/main.py backend/tests/conftest.py backend/tests/test_notifications.py
git commit -m "feat(notification): 新增站内通知数据模型"
```

---

## Task 2: 通知 Schema

**Files:**
- Create: `backend/app/schemas_notification.py`

- [ ] **Step 1: 创建 Schema**

Create `backend/app/schemas_notification.py`:

```python
"""通知 Pydantic Schema。"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: UUID
    event_type: str
    title: str
    body: Optional[str] = None
    target_type: str
    target_id: str
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    sender_id: Optional[UUID] = None

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    unread: int
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas_notification.py
git commit -m "feat(notification): 新增通知 Schema"
```

---

## Task 3: 通知服务（扇出写入 + 查询/已读/清除）

**Files:**
- Create: `backend/app/notifications.py`
- Test: `backend/tests/test_notifications.py`（追加）

- [ ] **Step 1: 写失败测试（扇出与去重）**

在 `backend/tests/test_notifications.py` 追加：

```python
from app import notifications as notif_svc


def _mk_user(db, name):
    from app.models import User
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}", password_hash="x",
             real_name=name, role="engineer", status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_create_notifications_fan_out_and_dedup(db):
    u1 = _mk_user(db, "张三")
    u2 = _mk_user(db, "李四")
    sender = _mk_user(db, "王五")
    notif_svc.create_notifications(
        db,
        recipient_ids=[u1.id, u2.id, u1.id],  # 含重复
        sender_id=sender.id,
        event_type="ecr_approved",
        title="ECR-1 审批通过",
        body="已通过",
        target_type="ecr",
        target_id="ecr-1",
    )
    rows = db.query(models_notification.Notification).all()
    assert len(rows) == 2  # 去重后 2 人


def test_create_notifications_excludes_sender(db):
    sender = _mk_user(db, "操作者")
    other = _mk_user(db, "旁观者")
    notif_svc.create_notifications(
        db, recipient_ids=[sender.id, other.id], sender_id=sender.id,
        event_type="ecr_closed", title="t", body=None,
        target_type="ecr", target_id="x", exclude_sender=True,
    )
    rows = db.query(models_notification.Notification).all()
    assert len(rows) == 1
    assert rows[0].recipient_id == other.id


def test_list_and_unread_count(db):
    u = _mk_user(db, "甲")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t2", body=None, target_type="ecr", target_id="2")
    items, total, unread = notif_svc.list_notifications(db, u.id, page=1, page_size=10)
    assert total == 2 and unread == 2 and len(items) == 2
    assert notif_svc.unread_count(db, u.id) == 2


def test_mark_read_and_read_all_and_clear(db):
    u = _mk_user(db, "乙")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    n2 = None
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t2", body=None, target_type="ecr", target_id="2")
    first = db.query(models_notification.Notification).first()
    assert notif_svc.mark_read(db, u.id, first.id) is True
    assert notif_svc.unread_count(db, u.id) == 1
    notif_svc.mark_all_read(db, u.id)
    assert notif_svc.unread_count(db, u.id) == 0
    deleted = notif_svc.clear_read(db, u.id)
    assert deleted == 2
    assert db.query(models_notification.Notification).count() == 0


def test_mark_read_other_user_denied(db):
    owner = _mk_user(db, "主人")
    intruder = _mk_user(db, "闯入者")
    notif_svc.create_notifications(db, recipient_ids=[owner.id], sender_id=None,
        event_type="e", title="t", body=None, target_type="ecr", target_id="1")
    n = db.query(models_notification.Notification).first()
    assert notif_svc.mark_read(db, intruder.id, n.id) is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `docker cp backend/tests/test_notifications.py bom_backend:/app/tests/test_notifications.py; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py -q`
Expected: FAIL（`notifications` 模块不存在）

- [ ] **Step 3: 实现服务**

Create `backend/app/notifications.py`:

```python
"""站内通知服务：扇出写入 + 查询 + 已读 + 清除。

在各模块状态变更的统一函数中调用 create_notifications 生成知会类通知。
"""
from typing import Optional, Iterable, List, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from .models_notification import Notification


def create_notifications(
    db: Session,
    *,
    recipient_ids: Iterable,
    sender_id: Optional[UUID],
    event_type: str,
    title: str,
    body: Optional[str],
    target_type: str,
    target_id: str,
    exclude_sender: bool = False,
    commit: bool = True,
) -> int:
    """对一组收件人扇出写入通知。去重 recipient；可排除 sender 自己。返回写入条数。"""
    seen = set()
    count = 0
    for rid in recipient_ids:
        if rid is None:
            continue
        rid_str = str(rid)
        if rid_str in seen:
            continue
        if exclude_sender and sender_id is not None and rid_str == str(sender_id):
            continue
        seen.add(rid_str)
        db.add(Notification(
            recipient_id=rid, sender_id=sender_id, event_type=event_type,
            title=title, body=body, target_type=target_type, target_id=str(target_id),
        ))
        count += 1
    if commit:
        db.commit()
    return count


def list_notifications(
    db: Session, user_id: UUID, *, is_read: Optional[bool] = None,
    target_type: Optional[str] = None, page: int = 1, page_size: int = 20,
) -> Tuple[List[Notification], int, int]:
    """分页查询当前用户通知，返回 (items, total, unread_total)。"""
    base = db.query(Notification).filter(Notification.recipient_id == user_id)
    q = base
    if is_read is not None:
        q = q.filter(Notification.is_read == is_read)
    if target_type:
        q = q.filter(Notification.target_type == target_type)
    total = q.count()
    items = (
        q.order_by(Notification.created_at.desc())
        .offset((page - 1) * page_size).limit(page_size).all()
    )
    unread = base.filter(Notification.is_read == False).count()  # noqa: E712
    return items, total, unread


def unread_count(db: Session, user_id: UUID) -> int:
    return (
        db.query(Notification)
        .filter(Notification.recipient_id == user_id, Notification.is_read == False)  # noqa: E712
        .count()
    )


def mark_read(db: Session, user_id: UUID, notification_id: UUID) -> bool:
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.recipient_id == user_id,
    ).first()
    if not n:
        return False
    if not n.is_read:
        n.is_read = True
        n.read_at = sqlfunc.now()
        db.commit()
    return True


def mark_all_read(db: Session, user_id: UUID) -> int:
    rows = db.query(Notification).filter(
        Notification.recipient_id == user_id,
        Notification.is_read == False,  # noqa: E712
    ).all()
    for n in rows:
        n.is_read = True
        n.read_at = sqlfunc.now()
    db.commit()
    return len(rows)


def clear_read(db: Session, user_id: UUID) -> int:
    """删除当前用户所有已读通知，返回删除条数。"""
    rows = db.query(Notification).filter(
        Notification.recipient_id == user_id,
        Notification.is_read == True,  # noqa: E712
    ).all()
    n = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return n
```

- [ ] **Step 4: 运行测试确认通过**

Run: `docker cp backend/app/notifications.py bom_backend:/app/app/notifications.py; docker cp backend/tests/test_notifications.py bom_backend:/app/tests/test_notifications.py; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py -q`
Expected: PASS（6 项）

- [ ] **Step 5: Commit**

```bash
git add backend/app/notifications.py backend/tests/test_notifications.py
git commit -m "feat(notification): 通知服务(扇出写入/查询/已读/清除)"
```

---

## Task 4: 权限 notifications:read

**Files:**
- Modify: `permissions/permissions.json`
- Generated: `backend/app/permissions/_generated.py`, `frontend/src/constants/permissions.generated.ts`

- [ ] **Step 1: 新增权限项**

Modify `permissions/permissions.json` — 在 `"logs:read"` 附近（`"sync:read"` 之前）加入：

```json
    "notifications:read": ["admin", "engineer", "production", "guest"],
```

- [ ] **Step 2: 重新生成权限代码**

Run: `python tools/gen_permissions.py`
Expected: 输出 `Wrote .../_generated.py` 与 `.../permissions.generated.ts`

- [ ] **Step 3: 验证生成一致**

Run: `docker cp backend/app/permissions/_generated.py bom_backend:/app/app/permissions/_generated.py; docker exec -w /app bom_backend python -c "from app.permissions import PERMISSIONS; print(PERMISSIONS['notifications:read'])"`
Expected: `['admin', 'engineer', 'production', 'guest']`

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(notification): 新增 notifications:read 权限"
```

---

## Task 5: 通知 API 路由

**Files:**
- Create: `backend/app/routers/notifications.py`
- Modify: `backend/app/main.py`（注册路由）
- Test: `backend/tests/test_notifications.py`（追加路由测试）

- [ ] **Step 1: 写失败测试（路由 + 权限隔离）**

在 `backend/tests/test_notifications.py` 追加：

```python
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user


def _client(db, user):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def test_api_list_and_unread_count(db):
    u = _mk_user(db, "接收者")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    try:
        c = _client(db, u)
        r = c.get("/api/notifications/")
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1 and r.json()["unread"] == 1
        rc = c.get("/api/notifications/unread-count")
        assert rc.status_code == 200 and rc.json()["unread"] == 1
    finally:
        app.dependency_overrides.clear()


def test_api_mark_read_and_read_all_and_clear(db):
    u = _mk_user(db, "操作者")
    notif_svc.create_notifications(db, recipient_ids=[u.id], sender_id=None,
        event_type="e", title="t1", body=None, target_type="ecr", target_id="1")
    n = db.query(models_notification.Notification).first()
    try:
        c = _client(db, u)
        assert c.post(f"/api/notifications/{n.id}/read").status_code == 200
        assert c.get("/api/notifications/unread-count").json()["unread"] == 0
        assert c.post("/api/notifications/read-all").status_code == 200
        assert c.request("DELETE", "/api/notifications/read").status_code == 200
        assert c.get("/api/notifications/").json()["total"] == 0
    finally:
        app.dependency_overrides.clear()


def test_api_only_own_notifications(db):
    owner = _mk_user(db, "主人2")
    intruder = _mk_user(db, "闯入者2")
    notif_svc.create_notifications(db, recipient_ids=[owner.id], sender_id=None,
        event_type="e", title="t", body=None, target_type="ecr", target_id="1")
    try:
        c = _client(db, intruder)
        assert c.get("/api/notifications/").json()["total"] == 0
    finally:
        app.dependency_overrides.clear()
```

- [ ] **Step 2: 运行确认失败**

Run: `docker cp backend/tests/test_notifications.py bom_backend:/app/tests/test_notifications.py; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py -k api -q`
Expected: FAIL（404，路由未注册）

- [ ] **Step 3: 实现路由**

Create `backend/app/routers/notifications.py`:

```python
"""站内通知 API：查询 / 未读数 / 标记已读 / 清除。"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..permissions import require_permission
from .. import notifications as notif_svc
from ..schemas_notification import NotificationListResponse, NotificationResponse

router = APIRouter(prefix="/notifications", tags=["通知中心"])


@router.get("/", response_model=NotificationListResponse)
def list_notifications(
    is_read: Optional[bool] = Query(None),
    target_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    items, total, unread = notif_svc.list_notifications(
        db, current_user.id, is_read=is_read, target_type=target_type,
        page=page, page_size=page_size,
    )
    return {
        "items": [NotificationResponse.model_validate(i) for i in items],
        "total": total,
        "unread": unread,
    }


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    return {"unread": notif_svc.unread_count(db, current_user.id)}


@router.post("/{notification_id}/read")
def mark_read(
    notification_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    ok = notif_svc.mark_read(db, current_user.id, notification_id)
    if not ok:
        raise HTTPException(404, "通知不存在")
    return {"detail": "已读"}


@router.post("/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    n = notif_svc.mark_all_read(db, current_user.id)
    return {"detail": "全部已读", "count": n}


@router.delete("/read")
def clear_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("notifications:read")),
):
    n = notif_svc.clear_read(db, current_user.id)
    return {"detail": "已清除", "count": n}
```

- [ ] **Step 4: 注册路由**

Modify `backend/app/main.py`：仿照现有 `app.include_router(logs_router, prefix="/api")` 模式。在路由导入区加入 `from app.routers.notifications import router as notifications_router`（与其它 router 导入并列），并在注册区加入：

```python
app.include_router(notifications_router, prefix="/api")
```

- [ ] **Step 5: 运行测试确认通过**

Run: `docker cp backend/app/routers/notifications.py bom_backend:/app/app/routers/notifications.py; docker cp backend/app/main.py bom_backend:/app/app/main.py; docker cp backend/app/schemas_notification.py bom_backend:/app/app/schemas_notification.py; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py -q`
Expected: PASS（全部）

- [ ] **Step 6: 重启后端并冒烟验证**

Run: `docker restart bom_backend; Start-Sleep -Seconds 6; curl.exe -sk -o NUL -w "%{http_code}" https://localhost:8080/api/notifications/`
Expected: `401`（端点存在，需鉴权）

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/notifications.py backend/app/main.py backend/tests/test_notifications.py
git commit -m "feat(notification): 通知 API 路由"
```

---

## Task 6: ECR 事件埋点

**Files:**
- Modify: `backend/app/crud_ecr.py`（change_ecr_status 内埋点）
- Modify: `backend/app/routers/ecrs.py`（cc 端点埋点）
- Test: `backend/tests/test_notification_hooks.py`

**收件人规则（来自设计 §4.2）：**
- `ecr_approved` / `ecr_rejected` → 创建人 + cc_users
- `ecr_closed` → cc_users
- `cc_added`（被加知会人）→ 被加的人

- [ ] **Step 1: 写失败测试**

Create `backend/tests/test_notification_hooks.py`:

```python
import uuid
from app import crud_ecr, models_notification
from app.models_ecr import ECR
from app.models import User


def _user(db, name="U"):
    u = User(id=uuid.uuid4(), username=f"u_{uuid.uuid4().hex[:6]}", password_hash="x",
             real_name=name, role="engineer", status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _ecr(db, creator_id, reviewers=None, cc_users=None, status="reviewing"):
    e = ECR(id=uuid.uuid4(), ecr_number=f"ECR-{uuid.uuid4().hex[:6]}", title="t",
            reason="r", status=status, creator_id=creator_id,
            reviewers=reviewers or [], cc_users=cc_users or [])
    db.add(e); db.commit(); db.refresh(e)
    return e


def _notifs(db, target_id):
    return db.query(models_notification.Notification).filter(
        models_notification.Notification.target_id == str(target_id)).all()


def test_ecr_approved_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    ecr = _ecr(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_ecr.change_ecr_status(db, ecr.id, "approved", approver.id)
    rows = _notifs(db, ecr.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients
    assert str(cc.id) in recipients
    assert all(r.event_type == "ecr_approved" for r in rows)


def test_ecr_closed_notifies_cc_only(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    # closed 需从 approved 流转
    ecr = _ecr(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}], status="approved")
    crud_ecr.change_ecr_status(db, ecr.id, "closed", creator.id)
    rows = _notifs(db, ecr.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(cc.id) in recipients
    assert all(r.event_type == "ecr_closed" for r in rows)
```

> 注：若 `_ALLOWED_TRANSITIONS` 不允许 `reviewing→approved` 直接流转，测试里改用合法的起始状态（查 `crud_ecr._ALLOWED_TRANSITIONS`）。

- [ ] **Step 2: 运行确认失败**

Run: `docker cp backend/tests/test_notification_hooks.py bom_backend:/app/tests/test_notification_hooks.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -q`
Expected: FAIL（无通知生成）

- [ ] **Step 3: 在 change_ecr_status 埋点**

Modify `backend/app/crud_ecr.py` — 在 `change_ecr_status` 函数 `db.commit(); db.refresh(ecr)` 之后、`return ecr` 之前插入：

```python
    # 站内通知：知会类事件（approved/rejected 通知创建人+cc；closed 仅通知 cc）
    from . import notifications as _notif
    _cc_ids = [c.get("user_id") for c in (ecr.cc_users or []) if c.get("user_id")]
    if to_status in ("approved", "rejected"):
        _evt = "ecr_approved" if to_status == "approved" else "ecr_rejected"
        _label = "审批通过" if to_status == "approved" else "审批驳回"
        _notif.create_notifications(
            db, recipient_ids=[ecr.creator_id, *_cc_ids], sender_id=operator_id,
            event_type=_evt, title=f"{ecr.ecr_number} {_label}",
            body=(comment or None), target_type="ecr", target_id=ecr.id,
            exclude_sender=True,
        )
    elif to_status == "closed":
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="ecr_closed", title=f"{ecr.ecr_number} 已关闭",
            body=None, target_type="ecr", target_id=ecr.id, exclude_sender=True,
        )
```

- [ ] **Step 4: cc 端点埋点**

Modify `backend/app/routers/ecrs.py` — 找到 `POST /{ecr_id}/cc`（添加知会人）处理函数，在成功 `db.commit()` 后、返回前插入（对新增的被知会用户发通知）：

```python
    from .. import notifications as _notif
    _notif.create_notifications(
        db, recipient_ids=[body.user_id], sender_id=current_user.id,
        event_type="cc_added", title=f"你被加为 {ecr.ecr_number} 知会人",
        body=None, target_type="ecr", target_id=ecr.id, exclude_sender=True,
    )
```

> 具体参数名（`body.user_id` / `ecr` 变量名）以该端点实际实现为准；核心是对新增知会人 user_id 发一条 `cc_added` 通知。

- [ ] **Step 5: 运行测试确认通过**

Run: `docker cp backend/app/crud_ecr.py bom_backend:/app/app/crud_ecr.py; docker cp backend/app/routers/ecrs.py bom_backend:/app/app/routers/ecrs.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_ecr.py backend/app/routers/ecrs.py backend/tests/test_notification_hooks.py
git commit -m "feat(notification): ECR 事件埋点(审批通过/驳回/关闭/知会)"
```

---

## Task 7: ECO 事件埋点

**Files:**
- Modify: `backend/app/crud_eco.py`（change_eco_status 内埋点）
- Modify: `backend/app/routers/ecos.py`（cc 端点埋点）
- Test: `backend/tests/test_notification_hooks.py`（追加）

**收件人规则：**
- `eco_approved` / `eco_rejected` → 创建人 + cc_users
- `eco_executing`（开始执行）/ `eco_closed` → cc_users
- `cc_added` → 被加的人

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_notification_hooks.py` 追加：

```python
from app import crud_eco
from app.models_eco import ECO


def _eco(db, creator_id, cc_users=None, status="reviewing"):
    e = ECO(id=uuid.uuid4(), eco_number=f"ECO-{uuid.uuid4().hex[:6]}", title="t",
            reason="r", status=status, creator_id=creator_id, reviewers=[],
            cc_users=cc_users or [])
    db.add(e); db.commit(); db.refresh(e)
    return e


def test_eco_approved_notifies_creator_and_cc(db):
    creator = _user(db, "创建人")
    cc = _user(db, "知会人")
    approver = _user(db, "审批人")
    eco = _eco(db, creator.id, cc_users=[{"user_id": str(cc.id), "user_name": "知会人"}])
    crud_eco.change_eco_status(db, eco.id, "approved", approver.id)
    rows = _notifs(db, eco.id)
    recipients = {str(r.recipient_id) for r in rows}
    assert str(creator.id) in recipients and str(cc.id) in recipients
    assert all(r.event_type == "eco_approved" for r in rows)
```

> 起始状态与流转须符合 `crud_eco._ALLOWED_TRANSITIONS`；如需先经其它状态，测试里按合法路径构造。

- [ ] **Step 2: 运行确认失败**

Run: `docker cp backend/tests/test_notification_hooks.py bom_backend:/app/tests/test_notification_hooks.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -k eco -q`
Expected: FAIL

- [ ] **Step 3: 在 change_eco_status 埋点**

Modify `backend/app/crud_eco.py` — 在 `change_eco_status` 的最终 `db.commit()` / `db.refresh(eco)` 之后、`return eco` 之前插入：

```python
    from . import notifications as _notif
    _cc_ids = [c.get("user_id") for c in (eco.cc_users or []) if c.get("user_id")]
    if to_status in ("approved", "rejected"):
        _evt = "eco_approved" if to_status == "approved" else "eco_rejected"
        _label = "审批通过" if to_status == "approved" else "审批驳回"
        _notif.create_notifications(
            db, recipient_ids=[eco.creator_id, *_cc_ids], sender_id=operator_id,
            event_type=_evt, title=f"{eco.eco_number} {_label}",
            body=(comment or None), target_type="eco", target_id=eco.id,
            exclude_sender=True,
        )
    elif to_status == "executing":
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="eco_executing", title=f"{eco.eco_number} 开始执行",
            body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
        )
    elif to_status == "closed":
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="eco_closed", title=f"{eco.eco_number} 已关闭",
            body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
        )
```

> 确认 `change_eco_status` 的操作者参数名（可能是 `operator_id` 或 `user_id`），埋点用其实际名。

- [ ] **Step 4: cc 端点埋点**

Modify `backend/app/routers/ecos.py` — 找到 `POST /{eco_id}/cc`，在 commit 后插入：

```python
    from .. import notifications as _notif
    _notif.create_notifications(
        db, recipient_ids=[body.user_id], sender_id=current_user.id,
        event_type="cc_added", title=f"你被加为 {eco.eco_number} 知会人",
        body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
    )
```

- [ ] **Step 5: 运行测试确认通过**

Run: `docker cp backend/app/crud_eco.py bom_backend:/app/app/crud_eco.py; docker cp backend/app/routers/ecos.py bom_backend:/app/app/routers/ecos.py; docker cp backend/tests/test_notification_hooks.py bom_backend:/app/tests/test_notification_hooks.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/crud_eco.py backend/app/routers/ecos.py backend/tests/test_notification_hooks.py
git commit -m "feat(notification): ECO 事件埋点(审批/执行/关闭/知会)"
```

---

## Task 8: 配置概要 / 库存单据 / 项目任务 埋点

**Files:**
- Modify: `backend/app/crud_configuration.py`（review_profile / archive_profile）
- Modify: `backend/app/crud_inventory.py`（review_document / post_document）
- Modify: `backend/app/crud_project.py`（create_task / update_task 指派变化）
- Test: `backend/tests/test_notification_hooks.py`（追加项目任务用例）

**收件人规则：**
- 配置概要 `profile_approved`/`profile_rejected`/`profile_archived` → 创建人 + cc_users
- 库存单据 `inv_doc_approved`/`inv_doc_rejected`/`inv_doc_posted` → 创建人
- 项目任务 `task_assigned` → 被指派人

- [ ] **Step 1: 写失败测试（项目任务指派，最易在 SQLite 构造）**

在 `backend/tests/test_notification_hooks.py` 追加：

```python
from app import crud_project, models_notification
from app.models_project import Project


def test_task_assigned_notifies_assignee(db):
    manager = _user(db, "经理")
    assignee = _user(db, "被指派人")
    proj = Project(id=uuid.uuid4(), code=f"P-{uuid.uuid4().hex[:6]}", name="项目",
                   owner_id=manager.id, status="进行中")
    db.add(proj); db.commit(); db.refresh(proj)
    task = crud_project.create_task(db, proj.id, {
        "name": "任务A", "assignee_id": str(assignee.id),
    }, manager.id)
    rows = db.query(models_notification.Notification).filter(
        models_notification.Notification.target_type == "project_task").all()
    recipients = {str(r.recipient_id) for r in rows}
    assert str(assignee.id) in recipients
    assert any(r.event_type == "task_assigned" for r in rows)
```

> `create_task` 的实际签名（参数是 dict 还是 schema、操作者参数名）以 `crud_project.py` 为准，测试按实际调用。

- [ ] **Step 2: 运行确认失败**

Run: `docker cp backend/tests/test_notification_hooks.py bom_backend:/app/tests/test_notification_hooks.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -k task_assigned -q`
Expected: FAIL

- [ ] **Step 3: 项目任务埋点**

Modify `backend/app/crud_project.py` — 在 `create_task` 成功创建并 commit 后，若 `assignee_id` 非空且不等于操作者，插入：

```python
    from . import notifications as _notif
    if task.assignee_id and str(task.assignee_id) != str(operator_id):
        _notif.create_notifications(
            db, recipient_ids=[task.assignee_id], sender_id=operator_id,
            event_type="task_assigned", title=f"你被指派任务：{task.name}",
            body=None, target_type="project_task", target_id=task.id,
            exclude_sender=True,
        )
```

在 `update_task` 中，若 `assignee_id` 发生变化（从旧值变为新值且新值非空），同样对新被指派人发 `task_assigned`（对比更新前后的 assignee_id）。

- [ ] **Step 4: 配置概要埋点**

Modify `backend/app/crud_configuration.py` — 在 `review_profile`（状态变为 active/rejected）与 `archive_profile`（archived）成功 commit 后插入。收件人 = 创建人 + cc_users：

```python
    from . import notifications as _notif
    _cc_ids = [c.get("user_id") for c in (profile.cc_users or []) if c.get("user_id")]
    # review_profile 内：to_status 为 "active"/"rejected"
    if new_status == "active":
        _notif.create_notifications(db, recipient_ids=[profile.creator_id, *_cc_ids],
            sender_id=operator_id, event_type="profile_approved",
            title=f"配置概要 {profile.code} 审批通过", body=None,
            target_type="configuration_profile", target_id=profile.id, exclude_sender=True)
    elif new_status == "rejected":
        _notif.create_notifications(db, recipient_ids=[profile.creator_id, *_cc_ids],
            sender_id=operator_id, event_type="profile_rejected",
            title=f"配置概要 {profile.code} 审批驳回", body=None,
            target_type="configuration_profile", target_id=profile.id, exclude_sender=True)
    # archive_profile 内：
    #   event_type="profile_archived", title=f"配置概要 {profile.code} 已归档"
```

> 变量名（`new_status`/`profile`/`operator_id`）以实际函数为准；archive 分支在 `archive_profile` 内单独加。

- [ ] **Step 5: 库存单据埋点**

Modify `backend/app/crud_inventory.py` — 在 `review_document`（approved/rejected）与 `post_document`（posted）成功 commit 后插入。收件人 = 单据创建人：

```python
    from . import notifications as _notif
    # review_document 内
    if new_status == "approved":
        _notif.create_notifications(db, recipient_ids=[doc.creator_id],
            sender_id=operator_id, event_type="inv_doc_approved",
            title=f"单据 {doc.doc_number} 审批通过", body=None,
            target_type="inventory_document", target_id=doc.id, exclude_sender=True)
    elif new_status == "rejected":
        _notif.create_notifications(db, recipient_ids=[doc.creator_id],
            sender_id=operator_id, event_type="inv_doc_rejected",
            title=f"单据 {doc.doc_number} 审批驳回", body=None,
            target_type="inventory_document", target_id=doc.id, exclude_sender=True)
    # post_document 内：
    #   event_type="inv_doc_posted", title=f"单据 {doc.doc_number} 已过账"
```

> 字段名（`doc.doc_number`/`doc.creator_id`/操作者参数）以 `models_inventory.py` 与函数签名为准。

- [ ] **Step 6: 运行测试确认通过**

Run: `docker cp backend/app/crud_project.py bom_backend:/app/app/crud_project.py; docker cp backend/app/crud_configuration.py bom_backend:/app/app/crud_configuration.py; docker cp backend/app/crud_inventory.py bom_backend:/app/app/crud_inventory.py; docker cp backend/tests/test_notification_hooks.py bom_backend:/app/tests/test_notification_hooks.py; docker exec -w /app bom_backend python -m pytest tests/test_notification_hooks.py -q`
Expected: PASS

- [ ] **Step 7: 全后端回归**

Run: `docker cp backend/tests bom_backend:/app/tests_new; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py tests/test_notification_hooks.py tests/test_require_permission.py -q`
Expected: PASS（通知相关全绿）

- [ ] **Step 8: Commit**

```bash
git add backend/app/crud_configuration.py backend/app/crud_inventory.py backend/app/crud_project.py backend/tests/test_notification_hooks.py
git commit -m "feat(notification): 配置/库存/项目任务事件埋点"
```

---

## Task 9: 前端 API 客户端 + 类型

**Files:**
- Modify: `frontend/src/types/index.ts`（Notification 类型）
- Create: `frontend/src/services/notificationApi.ts`

- [ ] **Step 1: 新增类型**

Modify `frontend/src/types/index.ts` — 文件末尾追加：

```typescript
export interface Notification {
  id: string;
  event_type: string;
  title: string;
  body?: string | null;
  target_type: 'ecr' | 'eco' | 'configuration_profile' | 'inventory_document' | 'project_task';
  target_id: string;
  is_read: boolean;
  read_at?: string | null;
  created_at?: string | null;
  sender_id?: string | null;
}

export interface NotificationListResult {
  items: Notification[];
  total: number;
  unread: number;
}
```

- [ ] **Step 2: 新增 API 客户端**

Create `frontend/src/services/notificationApi.ts`:

```typescript
import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import type { NotificationListResult } from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const notificationApi = {
  list: (params?: { is_read?: boolean; target_type?: string; page?: number; page_size?: number }) =>
    api.get<NotificationListResult>('/notifications/', { params }).then((r) => r.data),
  unreadCount: () =>
    api.get<{ unread: number }>('/notifications/unread-count').then((r) => r.data.unread),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.post('/notifications/read-all').then((r) => r.data),
  clearRead: () => api.delete('/notifications/read').then((r) => r.data),
};
```

> 说明：项目主 `api.ts` 的实例封装了 401 刷新；此处复用相同的 token 注入模式即可（与 `assistantApi.ts` 一致的轻量实例风格）。

- [ ] **Step 3: 构建验证类型**

Run: `cd frontend; npm run build`
Expected: 构建成功（无类型错误）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/notificationApi.ts
git commit -m "feat(notification): 前端通知 API 客户端与类型"
```

---

## Task 10: 通知 Store + 轮询

**Files:**
- Create: `frontend/src/stores/notification.ts`

- [ ] **Step 1: 创建 store**

Create `frontend/src/stores/notification.ts`:

```typescript
import { create } from 'zustand';
import type { Notification } from '../types';
import { notificationApi } from '../services/notificationApi';

interface NotificationState {
  unread: number;
  recent: Notification[];
  loading: boolean;
  fetchUnread: () => Promise<void>;
  fetchRecent: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: 0,
  recent: [],
  loading: false,
  fetchUnread: async () => {
    try { set({ unread: await notificationApi.unreadCount() }); } catch { /* ignore */ }
  },
  fetchRecent: async () => {
    set({ loading: true });
    try {
      const res = await notificationApi.list({ page: 1, page_size: 10 });
      set({ recent: res.items, unread: res.unread });
    } catch { /* ignore */ } finally { set({ loading: false }); }
  },
  markRead: async (id) => {
    await notificationApi.markRead(id);
    set((s) => ({
      recent: s.recent.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      unread: Math.max(0, s.unread - 1),
    }));
  },
  markAllRead: async () => {
    await notificationApi.markAllRead();
    set((s) => ({ recent: s.recent.map((n) => ({ ...n, is_read: true })), unread: 0 }));
  },
}));
```

- [ ] **Step 2: 在 Layout 挂载轮询**

Modify `frontend/src/components/Layout.tsx` — 找到现有 `useEffect` 中 `syncService.start()` 的位置（约第 54 行），在同一或相邻 `useEffect` 内加入通知未读数的 10 秒轮询：

```typescript
import { useNotificationStore } from '../stores/notification';
// ...
const fetchUnread = useNotificationStore((s) => s.fetchUnread);
useEffect(() => {
  fetchUnread();
  const t = setInterval(fetchUnread, 10000);
  return () => clearInterval(t);
}, [fetchUnread]);
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/notification.ts frontend/src/components/Layout.tsx
git commit -m "feat(notification): 通知 store 与 10 秒未读轮询"
```

---

## Task 11: 顶栏铃铛 + 下拉面板

**Files:**
- Create: `frontend/src/components/NotificationBell.tsx`
- Modify: `frontend/src/components/Layout.tsx`（插入铃铛）

- [ ] **Step 1: 创建 NotificationBell 组件**

Create `frontend/src/components/NotificationBell.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notification';
import type { Notification } from '../types';

const EVENT_ICON: Record<string, { icon: string; bg: string }> = {
  ecr_approved: { icon: '✅', bg: '#dcfce7' },
  eco_approved: { icon: '✅', bg: '#dcfce7' },
  profile_approved: { icon: '✅', bg: '#dcfce7' },
  inv_doc_approved: { icon: '✅', bg: '#dcfce7' },
  ecr_rejected: { icon: '↩️', bg: '#fee2e2' },
  eco_rejected: { icon: '↩️', bg: '#fee2e2' },
  profile_rejected: { icon: '↩️', bg: '#fee2e2' },
  inv_doc_rejected: { icon: '↩️', bg: '#fee2e2' },
  cc_added: { icon: '👁', bg: '#dbeafe' },
  profile_archived: { icon: '📦', bg: '#f3f4f6' },
  eco_executing: { icon: '⚙️', bg: '#e0e7ff' },
  eco_closed: { icon: '📦', bg: '#f3f4f6' },
  ecr_closed: { icon: '📦', bg: '#f3f4f6' },
  inv_doc_posted: { icon: '📥', bg: '#fef9c3' },
  task_assigned: { icon: '📋', bg: '#dbeafe' },
};

const TARGET_ROUTE: Record<string, string> = {
  ecr: '/ec', eco: '/ec', configuration_profile: '/configuration',
  inventory_document: '/inventory', project_task: '/projects',
};

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { unread, recent, fetchRecent, markRead, markAllRead } = useNotificationStore();

  useEffect(() => {
    if (open) fetchRecent();
  }, [open, fetchRecent]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const onItemClick = async (n: Notification) => {
    if (!n.is_read) await markRead(n.id);
    setOpen(false);
    navigate(TARGET_ROUTE[n.target_type] || '/');
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="relative text-gray-500 hover:text-blue-500" title="通知">
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] rounded-full px-1 leading-4 min-w-[16px] text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
            <b className="text-sm">通知 {unread > 0 && <span className="text-red-500">{unread}</span>}</b>
            <button onClick={() => markAllRead()} className="text-xs text-blue-600 hover:text-blue-800">全部已读</button>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">暂无通知</div>
            ) : recent.map((n) => {
              const ic = EVENT_ICON[n.event_type] || { icon: '🔔', bg: '#f3f4f6' };
              return (
                <div key={n.id} onClick={() => onItemClick(n)}
                  className={`px-3 py-2.5 border-b border-gray-50 flex gap-2.5 cursor-pointer hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50' : ''}`}>
                  <span className="w-6.5 h-6.5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: ic.bg, width: 26, height: 26 }}>{ic.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">{relativeTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
          <div onClick={() => { setOpen(false); navigate('/notifications'); }}
            className="text-center py-2.5 text-[13px] text-blue-600 hover:bg-gray-50 cursor-pointer border-t border-gray-100">
            查看全部通知 →
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 Layout 顶栏插入铃铛**

Modify `frontend/src/components/Layout.tsx` — 在顶栏 `<div className="right flex items-center gap-3">`（约第 159 行）内，同步状态指示器之后、用户名之前插入：

```tsx
<NotificationBell />
```

并在文件顶部 import：`import NotificationBell from './NotificationBell';`

- [ ] **Step 3: 构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功

- [ ] **Step 4: 部署并人工验证**

Run: `cd frontend; npm run build; cd ..; docker-compose up -d --force-recreate nginx`
人工：登录后顶栏出现铃铛；触发一次 ECR 审批通过，10 秒内红点出现，点击下拉见通知，点击条目跳转 EC 页且红点减少。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NotificationBell.tsx frontend/src/components/Layout.tsx
git commit -m "feat(notification): 顶栏通知铃铛与下拉面板"
```

---

## Task 12: 通知中心页

**Files:**
- Create: `frontend/src/pages/Notifications.tsx`
- Modify: `frontend/src/App.tsx`（注册路由）

- [ ] **Step 1: 创建通知中心页**

Create `frontend/src/pages/Notifications.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationApi } from '../services/notificationApi';
import { useNotificationStore } from '../stores/notification';
import type { Notification } from '../types';

const EVENT_ICON: Record<string, { icon: string; bg: string }> = {
  ecr_approved: { icon: '✅', bg: '#dcfce7' }, eco_approved: { icon: '✅', bg: '#dcfce7' },
  profile_approved: { icon: '✅', bg: '#dcfce7' }, inv_doc_approved: { icon: '✅', bg: '#dcfce7' },
  ecr_rejected: { icon: '↩️', bg: '#fee2e2' }, eco_rejected: { icon: '↩️', bg: '#fee2e2' },
  profile_rejected: { icon: '↩️', bg: '#fee2e2' }, inv_doc_rejected: { icon: '↩️', bg: '#fee2e2' },
  cc_added: { icon: '👁', bg: '#dbeafe' }, profile_archived: { icon: '📦', bg: '#f3f4f6' },
  eco_executing: { icon: '⚙️', bg: '#e0e7ff' }, eco_closed: { icon: '📦', bg: '#f3f4f6' },
  ecr_closed: { icon: '📦', bg: '#f3f4f6' }, inv_doc_posted: { icon: '📥', bg: '#fef9c3' },
  task_assigned: { icon: '📋', bg: '#dbeafe' },
};
const TARGET_ROUTE: Record<string, string> = {
  ecr: '/ec', eco: '/ec', configuration_profile: '/configuration',
  inventory_document: '/inventory', project_task: '/projects',
};
const MODULE_FILTERS: { key: string; label: string; targets: string[] }[] = [
  { key: 'all', label: '全部', targets: [] },
  { key: 'unread', label: '未读', targets: [] },
  { key: 'change', label: '变更', targets: ['ecr', 'eco'] },
  { key: 'config', label: '配置', targets: ['configuration_profile'] },
  { key: 'inventory', label: '库存', targets: ['inventory_document'] },
  { key: 'project', label: '项目', targets: ['project_task'] },
];

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN');
}

function groupByDay(items: Notification[]): { label: string; rows: Notification[] }[] {
  const today = new Date().toISOString().slice(0, 10);
  const g1: Notification[] = [], g2: Notification[] = [];
  for (const n of items) {
    if ((n.created_at || '').slice(0, 10) === today) g1.push(n); else g2.push(n);
  }
  const out: { label: string; rows: Notification[] }[] = [];
  if (g1.length) out.push({ label: '今天', rows: g1 });
  if (g2.length) out.push({ label: '更早', rows: g2 });
  return out;
}

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { fetchUnread, markAllRead } = useNotificationStore();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = MODULE_FILTERS.find((x) => x.key === filter)!;
      const params: any = { page: 1, page_size: 100 };
      if (filter === 'unread') params.is_read = false;
      const res = await notificationApi.list(params);
      let list = res.items;
      if (f.targets.length) list = list.filter((n) => f.targets.includes(n.target_type));
      setItems(list);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const onRowClick = async (n: Notification) => {
    if (!n.is_read) { await notificationApi.markRead(n.id); fetchUnread(); }
    navigate(TARGET_ROUTE[n.target_type] || '/');
  };

  const groups = groupByDay(items);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">通知中心</h1>
        <div className="flex gap-2">
          <button onClick={async () => { await markAllRead(); load(); }}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">全部标为已读</button>
          <button onClick={async () => { await notificationApi.clearRead(); fetchUnread(); load(); }}
            className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50">清除已读</button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap mb-4">
        {MODULE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] border ${filter === f.key ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-400">加载中...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">暂无通知</div>
      ) : groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div className="text-xs text-gray-400 font-semibold mb-2">{g.label}</div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {g.rows.map((n) => {
              const ic = EVENT_ICON[n.event_type] || { icon: '🔔', bg: '#f3f4f6' };
              return (
                <div key={n.id} onClick={() => onRowClick(n)}
                  className={`px-3.5 py-3 border-b border-gray-50 last:border-b-0 flex gap-3 items-start cursor-pointer hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50' : ''}`}>
                  <span className="rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: ic.bg, width: 30, height: 30 }}>{ic.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{n.title}</div>
                    {n.body && <div className="text-[13px] text-gray-500 mt-0.5">{n.body}</div>}
                    <div className="text-xs text-gray-400 mt-1">{relativeTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-1.5 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 注册路由**

Modify `frontend/src/App.tsx` — 顶部 import：`import Notifications from './pages/Notifications';`，并在 `<Route path="logs" .../>` 附近（约第 76 行）加入：

```tsx
<Route path="notifications" element={<Notifications />} />
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend; npm run build`
Expected: 构建成功

- [ ] **Step 4: 部署并人工验证**

Run: `cd frontend; npm run build; cd ..; docker-compose up -d --force-recreate nginx`
人工：铃铛下拉点"查看全部通知"进入 `/notifications`；筛选标签（全部/未读/变更/配置/库存/项目）生效；时间分组显示；点击条目跳转且标记已读；"全部标为已读"和"清除已读"生效。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Notifications.tsx frontend/src/App.tsx
git commit -m "feat(notification): 通知中心页(筛选/时间分组/跳转)"
```

---

## Task 13: 收尾验证

- [ ] **Step 1: 后端通知相关测试全绿**

Run: `docker cp backend/tests bom_backend:/app/tests_v; docker exec -w /app bom_backend python -m pytest tests/test_notifications.py tests/test_notification_hooks.py tests/test_require_permission.py tests/test_parts_perms.py -q`
Expected: PASS

- [ ] **Step 2: 前端构建 + 权限生成一致**

Run: `cd frontend; npm run build`
Expected: 成功（prebuild 重新生成权限，类型校验通过）

- [ ] **Step 3: 端到端冒烟**

人工按事件清单逐项验证：ECR 审批通过/驳回/关闭/加知会人、ECO 审批/执行/关闭/加知会人、配置概要审批/归档、库存单据审批/过账、项目任务指派——各自的收件人能在铃铛看到对应通知；操作者本人不会收到自己触发的通知。

- [ ] **Step 4: 最终提交（如有零散改动）**

```bash
git add -A
git commit -m "chore(notification): 收尾验证与修正"
```

---

## 附：事件→通知 对照总表（实现核对用）

| 触发函数 | 条件 | event_type | 收件人 | target_type |
|---|---|---|---|---|
| `crud_ecr.change_ecr_status` | to=approved | ecr_approved | creator + cc | ecr |
| `crud_ecr.change_ecr_status` | to=rejected | ecr_rejected | creator + cc | ecr |
| `crud_ecr.change_ecr_status` | to=closed | ecr_closed | cc | ecr |
| `routers/ecrs.py` cc 端点 | 添加知会人 | cc_added | 新知会人 | ecr |
| `crud_eco.change_eco_status` | to=approved | eco_approved | creator + cc | eco |
| `crud_eco.change_eco_status` | to=rejected | eco_rejected | creator + cc | eco |
| `crud_eco.change_eco_status` | to=executing | eco_executing | cc | eco |
| `crud_eco.change_eco_status` | to=closed | eco_closed | cc | eco |
| `routers/ecos.py` cc 端点 | 添加知会人 | cc_added | 新知会人 | eco |
| `crud_configuration.review_profile` | active | profile_approved | creator + cc | configuration_profile |
| `crud_configuration.review_profile` | rejected | profile_rejected | creator + cc | configuration_profile |
| `crud_configuration.archive_profile` | archived | profile_archived | creator + cc | configuration_profile |
| `crud_inventory.review_document` | approved | inv_doc_approved | creator | inventory_document |
| `crud_inventory.review_document` | rejected | inv_doc_rejected | creator | inventory_document |
| `crud_inventory.post_document` | posted | inv_doc_posted | creator | inventory_document |
| `crud_project.create_task` / `update_task` | 指派/改派 | task_assigned | 被指派人 | project_task |

所有埋点 `exclude_sender=True`，收件人列表自动去重。
