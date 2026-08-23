# 统一审批流引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用统一审批流引擎（模板 + 解析规则 + 实例/任务）替换 ECR/ECO/库存单据现有的"发起人手填审批人"模式，支持组织上级链层层审批与角色流审批。

**Architecture:** 新增 `workflow_templates / workflow_instances / approval_tasks` 三张表 + 解析器（`manager_chain / role / group / user / initiator_choose`）+ 流转核心（`start_workflow / act_by_entity / withdraw_workflow`）。各模块保留自己的 `status` 与状态日志，由引擎回调驱动；模块副作用（ECO 冻结/解冻、库存过账、模块通知）留在模块代码。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Pydantic v2 + React 18 + TypeScript + Tailwind；测试 pytest（内存 SQLite）+ Vitest。

**Spec:** `docs/superpowers/specs/2026-08-23-approval-workflow-design.md`

## Global Constraints

- 解析出的审批人**可替换但不可新增**：v1 仅 `initiator_choose` 步骤允许在候选内替换；自动解析步骤（`manager_chain/role/group/user`）展示结果不可改。
- **未配置模板不允许提交**（引擎抛 400），存量类型由种子模板兜底。
- 驳回语义：任一步驳回 → 实例 `rejected` → 模块置 `rejected` → 发起人修改后重提，**重走全流程**（新实例）。
- 撤回：reviewing 中仅发起人/admin 可撤回 → 模块回 `draft`，实例标 `withdrawn`。
- 任务级鉴权：只有"当前步骤 pending 任务审批人"可审批；admin 兜底审批当前步骤第一个 pending 任务。
- 旧 `XxxReviewRecord` 表保留只读，新流程不再写入。
- 引擎通知事件类型统一 `workflow_pending`，`target_type` = 业务类型（ecr/eco/inventory_document），`target_id` = 单据 id。
- 涉及权限变更后必须重新生成：`python tools/gen_permissions.py`（仓库根目录）。
- 每次前端改动后必须 `cd frontend && npm run build`。
- 测试命令：`cd backend && pytest <path>`；SQLite 内存库由 `backend/tests/conftest.py` 提供 `db` fixture，新增模型必须在 conftest 导入。

---

### Task 1: 权限项 workflow:template:manage

**Files:**
- Modify: `permissions/permissions.json`（在 permissions 对象内追加）
- Regenerate: `backend/app/permissions/_generated.py`、`frontend/src/constants/permissions.generated.ts`
- Test: `backend/tests/test_permission_wiring.py`（现有）

**Interfaces:**
- Consumes: 无
- Produces: 权限键 `workflow:template:manage`（仅 admin），供 Task 10 的模板管理 API 使用

- [ ] **Step 1: 修改权限源文件**

在 `permissions/permissions.json` 的 permissions 对象末尾（`"profile.bom:manage"` 附近）追加：

```json
    "workflow:template:manage": ["admin"],
```

- [ ] **Step 2: 重新生成权限代码**

Run: `python tools/gen_permissions.py`（仓库根目录）
Expected: 两个生成文件被更新，无报错

- [ ] **Step 3: 运行权限测试验证**

Run: `cd backend && pytest tests/test_permission_wiring.py tests/test_permissions_sync.py -v`
Expected: PASS（生成文件与源文件一致）

- [ ] **Step 4: Commit**

```bash
git add permissions/permissions.json backend/app/permissions/_generated.py frontend/src/constants/permissions.generated.ts
git commit -m "feat(workflow): 新增 workflow:template:manage 权限项"
```

---

### Task 2: User.manager_id 直属上级字段

**Files:**
- Modify: `backend/app/models.py`（User 类，第 8-20 行）
- Modify: `backend/app/schemas_users.py`（或用户 schema 所在文件，UserCreate/UserUpdate）
- Modify: `backend/app/routers/users.py`（create/update 处理 manager_id）
- Test: Create `backend/tests/test_user_manager.py`

**Interfaces:**
- Consumes: 无
- Produces: `User.manager_id: Optional[UUID]` 列；`UserCreate.manager_id`、`UserUpdate.manager_id` 可选字段；users API 读写该字段。Task 5 的 `_manager_at_level` 依赖它。

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_user_manager.py
import uuid
from app import models


def test_user_manager_relation(db):
    boss = models.User(id=uuid.uuid4(), username="boss", password_hash="x",
                       real_name="上级", role="admin", status="active")
    emp = models.User(id=uuid.uuid4(), username="emp1", password_hash="x",
                      real_name="员工", role="engineer", status="active", manager_id=boss.id)
    db.add_all([boss, emp]); db.commit()
    got = db.get(models.User, emp.id)
    assert got.manager_id == boss.id
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_user_manager.py -v`
Expected: FAIL（`manager_id` 不是 User 的有效字段）

- [ ] **Step 3: 模型加列**

在 `backend/app/models.py` 的 User 类中追加：

```python
    manager_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # 直属上级
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_user_manager.py -v`
Expected: PASS

- [ ] **Step 5: users API 读写 manager_id**

在用户 schema（`backend/app/schemas_users.py` 的 UserCreate/UserUpdate）追加 `manager_id: Optional[uuid.UUID] = None`（按文件现有导入风格），并在 `backend/app/routers/users.py` 的创建/更新逻辑中透传该字段（`user.manager_id = data.manager_id`）。

- [ ] **Step 6: 运行既有用户测试**

Run: `cd backend && pytest tests/test_role_validation.py tests/test_unverified_role.py -v`
Expected: PASS（无回归）

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/schemas_users.py backend/app/routers/users.py backend/tests/test_user_manager.py
git commit -m "feat(users): User 增加 manager_id 直属上级字段"
```

---

### Task 3: 引擎数据模型（三张表）

**Files:**
- Create: `backend/app/models_workflow.py`
- Modify: `backend/tests/conftest.py`（导入 models_workflow）
- Test: Create `backend/tests/test_workflow_models.py`

**Interfaces:**
- Consumes: Task 2（无直接依赖，独立）
- Produces:
  - `WorkflowTemplate`：`code`(str unique)、`name`、`entity_type`、`entity_subtype`(可空)、`steps`(JSONB)、`is_active`(bool)
  - `WorkflowInstance`：`template_id`、`entity_type`、`entity_id`、`entity_subtype`、`title`、`initiator_id`、`status`(active/approved/rejected/withdrawn)、`current_step_index`、`steps`(JSONB 快照)、`started_at`、`finished_at`
  - `ApprovalTask`：`instance_id`、`step_index`、`step_name`、`approver_id`、`approver_name`、`status`(pending/approved/rejected/skipped)、`comment`、`decided_at`、`created_at`
  - 步骤快照格式：`{"name": str, "mode": "all"|"any", "approvers": [{"user_id","user_name","status","comment","decided_at"}]}`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_workflow_models.py
import uuid
from app import models_workflow as mw


def test_template_roundtrip(db):
    t = mw.WorkflowTemplate(
        code="ecr_default", name="ECR 变更审批", entity_type="ecr",
        entity_subtype=None, steps=[{"name": "校对", "resolvers": [], "mode": "any"}],
    )
    db.add(t); db.commit()
    got = db.query(mw.WorkflowTemplate).filter_by(code="ecr_default").first()
    assert got.steps[0]["name"] == "校对"


def test_instance_and_tasks(db):
    inst = mw.WorkflowInstance(
        id=uuid.uuid4(), entity_type="ecr", entity_id=uuid.uuid4(),
        initiator_id=uuid.uuid4(), status="active", current_step_index=0,
        steps=[{"name": "校对", "mode": "any", "approvers": []}],
    )
    db.add(inst); db.flush()
    db.add(mw.ApprovalTask(instance_id=inst.id, step_index=0, step_name="校对",
                           approver_id=uuid.uuid4(), approver_name="张三"))
    db.commit()
    assert db.query(mw.ApprovalTask).filter_by(instance_id=inst.id).count() == 1
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_models.py -v`
Expected: FAIL（ImportError: models_workflow）

- [ ] **Step 3: 创建模型文件**

```python
# backend/app/models_workflow.py
"""审批流引擎 - SQLAlchemy Models
====================================
流程模板 / 流程实例 / 审批任务
"""
import uuid
from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.database import Base


class WorkflowTemplate(Base):
    """流程模板（管理员配置）"""
    __tablename__ = "workflow_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code = Column(String(64), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    entity_type = Column(String(32), nullable=False)     # ecr / eco / inventory_doc
    entity_subtype = Column(String(32), nullable=True)   # 库存单据 doc_type
    steps = Column(JSONB, nullable=False, default=[])     # [{name, resolvers, mode}]
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class WorkflowInstance(Base):
    """一次提交流程实例（步骤快照）"""
    __tablename__ = "workflow_instances"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_id = Column(UUID(as_uuid=True), ForeignKey("workflow_templates.id"), nullable=True)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    entity_subtype = Column(String(32), nullable=True)
    title = Column(String(255), nullable=True)
    initiator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(16), nullable=False, default="active")
    current_step_index = Column(Integer, nullable=False, default=0)
    steps = Column(JSONB, nullable=False, default=[])
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)


class ApprovalTask(Base):
    """审批任务（每审批人一条，兼审批记录）"""
    __tablename__ = "approval_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    instance_id = Column(UUID(as_uuid=True), ForeignKey("workflow_instances.id", ondelete="CASCADE"), nullable=False)
    step_index = Column(Integer, nullable=False)
    step_name = Column(String(64), nullable=False)
    approver_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    approver_name = Column(String(64), nullable=True)
    status = Column(String(16), nullable=False, default="pending")
    comment = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 4: conftest 导入新模型**

在 `backend/tests/conftest.py` 第 16 行的 import 列表追加 `models_workflow`：

```python
from app import models, models_parts, models_ecr, models_eco, models_configuration, models_notification, models_workflow  # noqa: F401
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_models.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/models_workflow.py backend/tests/conftest.py backend/tests/test_workflow_models.py
git commit -m "feat(workflow): 新增模板/实例/任务三张引擎表"
```

---

### Task 4: 引擎 schema（schemas_workflow.py）

**Files:**
- Create: `backend/app/schemas_workflow.py`
- Test: `backend/tests/test_workflow_models.py`（追加用例）

**Interfaces:**
- Consumes: 无
- Produces:
  - `WorkflowStepRule`、`WorkflowStep`、`WorkflowTemplateCreate`、`WorkflowTemplateUpdate`
  - `WorkflowSubmitAction { chosen_by_step: Dict[str, List[str]] }`（模块 submit 端点复用）
  - `WorkflowPreviewStep`、`WorkflowInstanceDetail`（序列化输出）

- [ ] **Step 1: 写失败测试（追加到 test_workflow_models.py）**

```python
from app.schemas_workflow import WorkflowSubmitAction, WorkflowStep


def test_submit_action_schema():
    a = WorkflowSubmitAction(chosen_by_step={"0": ["11111111-1111-1111-1111-111111111111"]})
    assert a.chosen_by_step["0"] == ["11111111-1111-1111-1111-111111111111"]


def test_step_schema_roundtrip():
    s = WorkflowStep(name="主管审核", mode="all",
                     resolvers=[{"type": "manager_chain", "level": 1}])
    assert s.resolvers[0]["level"] == 1
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_models.py -v`
Expected: FAIL（ImportError: schemas_workflow）

- [ ] **Step 3: 创建 schema 文件**

```python
# backend/app/schemas_workflow.py
"""审批流引擎 - Pydantic Schemas"""
from typing import List, Optional, Dict
from pydantic import BaseModel, Field


class BaseSchema(BaseModel):
    model_config = {"from_attributes": True}


class WorkflowStep(BaseSchema):
    name: str
    resolvers: List[dict] = Field(default_factory=list)
    mode: str = "all"  # all=会签 / any=或签


class WorkflowTemplateCreate(BaseSchema):
    code: str
    name: str
    entity_type: str
    entity_subtype: Optional[str] = None
    steps: List[WorkflowStep] = Field(default_factory=list)
    is_active: bool = True


class WorkflowTemplateUpdate(BaseSchema):
    name: Optional[str] = None
    steps: Optional[List[WorkflowStep]] = None
    is_active: Optional[bool] = None


class WorkflowSubmitAction(BaseSchema):
    """模块 submit 端点携带：initiator_choose 步骤的选择结果 {step_index: [user_id]}"""
    chosen_by_step: Dict[str, List[str]] = Field(default_factory=dict)


class WorkflowPreviewStep(BaseSchema):
    step_index: int
    name: str
    mode: str
    rule_types: List[str]
    approvers: List[dict] = Field(default_factory=list)   # [{user_id, user_name}]
    candidates: List[dict] = Field(default_factory=list)  # initiator_choose 步骤的候选
    allow_replace: bool = False
    warning: Optional[str] = None
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_models.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas_workflow.py backend/tests/test_workflow_models.py
git commit -m "feat(workflow): 引擎 Pydantic schemas（含提交动作/预览结构）"
```

---

### Task 5: 解析器 resolver（workflow_engine.py 第一半）

**Files:**
- Create: `backend/app/workflow_engine.py`
- Test: Create `backend/tests/test_workflow_resolver.py`

**Interfaces:**
- Consumes: Task 2（manager_id）、Task 3（模型）
- Produces:
  - `resolve_step(db, step: dict, initiator: User, chosen: Optional[list] = None) -> list[dict]`（返回 `[{user_id: str, user_name: str}]`，按 user_id 去重）
  - `get_active_template(db, entity_type: str, entity_subtype: Optional[str]) -> Optional[WorkflowTemplate]`
  - `preview_steps(db, template, initiator) -> list[dict]`（供 preview API）

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_workflow_resolver.py
import uuid
from app import models
from app.workflow_engine import resolve_step, get_active_template
from app.models_workflow import WorkflowTemplate


def _mk(db, username, real_name, role="engineer", manager_id=None):
    u = models.User(id=uuid.uuid4(), username=username, password_hash="x",
                    real_name=real_name, role=role, status="active", manager_id=manager_id)
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_manager_chain_levels(db):
    boss = _mk(db, "boss", "总经理", role="admin")
    mgr = _mk(db, "mgr", "经理", role="engineer", manager_id=boss.id)
    emp = _mk(db, "emp", "员工", role="engineer", manager_id=mgr.id)
    step = {"name": "主管", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"}
    got = resolve_step(db, step, emp)
    assert [a["user_name"] for a in got] == ["经理"]
    step2 = {"name": "经理", "resolvers": [{"type": "manager_chain", "level": 2}], "mode": "all"}
    got2 = resolve_step(db, step2, emp)
    assert [a["user_name"] for a in got2] == ["总经理"]


def test_manager_chain_broken_returns_empty(db):
    emp = _mk(db, "emp", "员工")
    step = {"name": "主管", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"}
    assert resolve_step(db, step, emp) == []


def test_role_and_user_and_group(db):
    a = _mk(db, "a1", "工程师A", role="engineer")
    _mk(db, "g1", "访客甲", role="guest")
    step_role = {"resolvers": [{"type": "role", "role": "engineer"}], "mode": "all"}
    assert [x["user_name"] for x in resolve_step(db, step_role, a)] == ["工程师A"]
    step_user = {"resolvers": [{"type": "user", "user_ids": [str(a.id)]}], "mode": "all"}
    assert resolve_step(db, step_user, a) == [{"user_id": str(a.id), "user_name": "工程师A"}]
    grp = models.UserGroup(name="设计组"); db.add(grp); db.commit()
    db.add(models.UserGroupMember(user_id=a.id, group_id=grp.id)); db.commit()
    step_grp = {"resolvers": [{"type": "group", "group_ids": [str(grp.id)]}], "mode": "all"}
    assert [x["user_name"] for x in resolve_step(db, step_grp, a)] == ["工程师A"]


def test_initiator_choose_filtered_by_candidates(db):
    eng = _mk(db, "e1", "工程师", role="engineer")
    adm = _mk(db, "adm", "管理员", role="admin")
    guest = _mk(db, "g2", "访客", role="guest")
    step = {"name": "校对", "resolvers": [{
        "type": "initiator_choose",
        "candidates": {"roles": ["engineer", "admin"]},
    }], "mode": "any"}
    got = resolve_step(db, step, eng, chosen=[str(adm.id), str(guest.id)])
    assert [a["user_name"] for a in got] == ["管理员"]  # guest 不在候选内被过滤


def test_get_active_template_by_subtype(db):
    db.add(WorkflowTemplate(code="t1", name="入库", entity_type="inventory_doc",
                            entity_subtype="inbound", steps=[]))
    db.add(WorkflowTemplate(code="t2", name="出库", entity_type="inventory_doc",
                            entity_subtype="outbound", steps=[]))
    db.commit()
    assert get_active_template(db, "inventory_doc", "inbound").code == "t1"
    assert get_active_template(db, "inventory_doc", None) is None
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_resolver.py -v`
Expected: FAIL（ImportError: workflow_engine）

- [ ] **Step 3: 创建 workflow_engine.py（解析器部分）**

```python
# backend/app/workflow_engine.py
"""审批流引擎：解析规则 + 流转核心。模块通过本文件接入，不反向依赖模块。"""
import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import User, UserGroupMember
from app.models_workflow import WorkflowTemplate, WorkflowInstance, ApprovalTask
from app import notifications as _notif

TASK_EVENT = "workflow_pending"


# ─────────────── 解析规则 ───────────────

def _active_user(db: Session, uid) -> Optional[User]:
    try:
        return db.get(User, uuid.UUID(str(uid)))
    except (ValueError, TypeError, AttributeError):
        return None


def _manager_at_level(db: Session, user: User, level: int) -> Optional[User]:
    cur = user
    for _ in range(level):
        if not cur.manager_id:
            return None
        cur = db.get(User, cur.manager_id)
        if cur is None:
            return None
    return cur


def _candidate_ids(db: Session, candidates: dict) -> set:
    ids: set = set()
    for role in candidates.get("roles", []):
        for u in db.query(User).filter(User.role == role, User.status == "active").all():
            ids.add(str(u.id))
    for gid in candidates.get("group_ids", []):
        try:
            rows = db.query(UserGroupMember.user_id).filter(
                UserGroupMember.group_id == uuid.UUID(str(gid))).all()
        except (ValueError, TypeError, AttributeError):
            continue
        for (uid,) in rows:
            ids.add(str(uid))
    return ids


def resolve_step(db: Session, step: dict, initiator: User, chosen: Optional[list] = None) -> list:
    """解析一个步骤 → [{user_id, user_name}]（按 user_id 去重）"""
    out: dict = {}
    chosen_set = {str(c) for c in (chosen or [])}
    for rule in step.get("resolvers", []):
        rtype = rule.get("type")
        if rtype == "user":
            for uid in rule.get("user_ids", []):
                u = _active_user(db, uid)
                if u:
                    out[str(u.id)] = {"user_id": str(u.id), "user_name": u.real_name}
        elif rtype == "role":
            for u in db.query(User).filter(
                    User.role == rule.get("role"), User.status == "active").all():
                out[str(u.id)] = {"user_id": str(u.id), "user_name": u.real_name}
        elif rtype == "group":
            for gid in rule.get("group_ids", []):
                try:
                    rows = db.query(UserGroupMember.user_id).filter(
                        UserGroupMember.group_id == uuid.UUID(str(gid))).all()
                except (ValueError, TypeError, AttributeError):
                    continue
                for (uid,) in rows:
                    u = db.get(User, uid)
                    if u:
                        out[str(u.id)] = {"user_id": str(u.id), "user_name": u.real_name}
        elif rtype == "manager_chain":
            target = _manager_at_level(db, initiator, int(rule.get("level", 1)))
            if target:
                out[str(target.id)] = {"user_id": str(target.id), "user_name": target.real_name}
        elif rtype == "initiator_choose":
            allowed = _candidate_ids(db, rule.get("candidates", {}))
            for uid in chosen_set:
                if uid in allowed:
                    u = db.get(User, uuid.UUID(uid))
                    if u:
                        out[uid] = {"user_id": uid, "user_name": u.real_name}
    return list(out.values())


def get_active_template(db: Session, entity_type: str, entity_subtype: Optional[str] = None) -> Optional[WorkflowTemplate]:
    q = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.entity_type == entity_type,
        WorkflowTemplate.is_active.is_(True),
    )
    if entity_subtype:
        q = q.filter(WorkflowTemplate.entity_subtype == entity_subtype)
    else:
        q = q.filter(WorkflowTemplate.entity_subtype.is_(None))
    return q.order_by(WorkflowTemplate.updated_at.desc()).first()


def preview_steps(db: Session, template: WorkflowTemplate, initiator: User) -> list:
    """提交前预览：解析自动步骤，返回 initiator_choose 候选。"""
    out = []
    for idx, step in enumerate(template.steps or []):
        rule_types = [r.get("type", "") for r in step.get("resolvers", [])]
        item = {
            "step_index": idx, "name": step.get("name", f"步骤{idx+1}"),
            "mode": step.get("mode", "all"), "rule_types": rule_types,
            "approvers": [], "candidates": [], "allow_replace": False, "warning": None,
        }
        if "initiator_choose" in rule_types:
            item["allow_replace"] = True
            candidates: dict = {}
            for rule in step.get("resolvers", []):
                if rule.get("type") == "initiator_choose":
                    candidates = rule.get("candidates", {})
            for cid in sorted(_candidate_ids(db, candidates)):
                u = db.get(User, uuid.UUID(cid))
                if u:
                    item["candidates"].append({"user_id": cid, "user_name": u.real_name})
        else:
            approvers = resolve_step(db, step, initiator)
            item["approvers"] = approvers
            if not approvers and "manager_chain" in rule_types:
                item["warning"] = "上级链缺失，无法解析审批人，请检查用户的直属上级设置"
        out.append(item)
    return out
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_resolver.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/workflow_engine.py backend/tests/test_workflow_resolver.py
git commit -m "feat(workflow): 审批人解析器（上级链/角色/用户组/用户/发起人自选）"
```

---

### Task 6: 流转核心 start_workflow

**Files:**
- Modify: `backend/app/workflow_engine.py`（追加）
- Test: Create `backend/tests/test_workflow_engine.py`

**Interfaces:**
- Consumes: Task 5（resolve_step / get_active_template）
- Produces:
  - `start_workflow(db, *, entity_type, entity_id, entity_subtype=None, title=None, initiator, chosen_by_step=None) -> WorkflowInstance`
    - 模板不存在 → `HTTPException(400, "未配置该单据类型的审批流模板，请联系管理员配置")`
    - 任一步骤解析不出审批人 → `HTTPException(400, f"步骤「{name}」未解析出审批人（上级链缺失或未选择）")`
    - 创建实例 + 首步任务（`approval_tasks` 每审批人一条 pending）+ 通知首步审批人（`workflow_pending`，`exclude_sender=True`）
  - `get_active_instance(db, entity_type, entity_id) -> Optional[WorkflowInstance]`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_workflow_engine.py
import uuid
import pytest
from fastapi import HTTPException
from app import models
from app.models_workflow import WorkflowTemplate, ApprovalTask
from app.workflow_engine import start_workflow, get_active_instance
from app import notifications as _notif


def _mk(db, username, real_name, role="engineer", manager_id=None):
    u = models.User(id=uuid.uuid4(), username=username, password_hash="x",
                    real_name=real_name, role=role, status="active", manager_id=manager_id)
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_start_with_manager_chain(db, monkeypatch):
    sent = []
    monkeypatch.setattr(_notif, "create_notifications",
                        lambda db, **kw: sent.append(kw) or 0)
    boss = _mk(db, "boss", "总经理", role="admin")
    mgr = _mk(db, "mgr", "经理", manager_id=boss.id)
    emp = _mk(db, "emp", "员工", manager_id=mgr.id)
    db.add(WorkflowTemplate(code="t", name="入库审批", entity_type="inventory_doc",
                            entity_subtype="inbound", steps=[
        {"name": "主管审核", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"},
        {"name": "经理审批", "resolvers": [{"type": "manager_chain", "level": 2}], "mode": "all"},
    ])); db.commit()
    inst = start_workflow(db, entity_type="inventory_doc", entity_id=uuid.uuid4(),
                          entity_subtype="inbound", title="IN-001 入库", initiator=emp)
    assert inst.status == "active" and inst.current_step_index == 0
    tasks = db.query(ApprovalTask).filter_by(instance_id=inst.id).all()
    assert [(t.step_index, t.approver_name, t.status) for t in tasks] == [(0, "经理", "pending")]
    assert sent and sent[0]["recipient_ids"] == [mgr.id]
    assert get_active_instance(db, inst.entity_type, inst.entity_id).id == inst.id


def test_start_without_template_raises(db):
    emp = _mk(db, "emp", "员工")
    with pytest.raises(HTTPException) as ei:
        start_workflow(db, entity_type="ecr", entity_id=uuid.uuid4(), initiator=emp)
    assert ei.value.status_code == 400


def test_start_broken_chain_raises(db):
    emp = _mk(db, "emp", "员工")  # 无上级
    db.add(WorkflowTemplate(code="t2", name="出库", entity_type="inventory_doc",
                            entity_subtype="outbound",
                            steps=[{"name": "主管", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"}]))
    db.commit()
    with pytest.raises(HTTPException) as ei:
        start_workflow(db, entity_type="inventory_doc", entity_id=uuid.uuid4(),
                       entity_subtype="outbound", initiator=emp)
    assert ei.value.status_code == 400
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_engine.py -v`
Expected: FAIL（start_workflow 未定义）

- [ ] **Step 3: 实现 start_workflow（追加到 workflow_engine.py）**

```python
# ─────────────── 流转核心 ───────────────

def _create_step_tasks(db: Session, instance: WorkflowInstance, step_index: int):
    step = instance.steps[step_index]
    for a in step["approvers"]:
        if a["status"] == "pending":
            db.add(ApprovalTask(
                instance_id=instance.id, step_index=step_index,
                step_name=step["name"], approver_id=uuid.UUID(a["user_id"]),
                approver_name=a["user_name"], status="pending",
            ))
    db.flush()


def _notify(db: Session, recipient_ids, title, body=None):
    if not recipient_ids:
        return
    _notif.create_notifications(
        db, recipient_ids=recipient_ids, sender_id=None,
        event_type=TASK_EVENT, title=title, body=body,
        target_type=None, target_id=None, exclude_sender=False,
    )


def _notify_step_approvers(db: Session, instance: WorkflowInstance, step_index: int):
    step = instance.steps[step_index]
    ids = [uuid.UUID(a["user_id"]) for a in step["approvers"] if a["status"] == "pending"]
    _notify(db, ids, f"【待审批】{instance.title or ''} · {step['name']}")


def start_workflow(db: Session, *, entity_type: str, entity_id, entity_subtype: Optional[str] = None,
                   title: Optional[str] = None, initiator: User,
                   chosen_by_step: Optional[dict] = None) -> WorkflowInstance:
    template = get_active_template(db, entity_type, entity_subtype)
    if template is None:
        raise HTTPException(status_code=400, detail="未配置该单据类型的审批流模板，请联系管理员配置")
    chosen_by_step = chosen_by_step or {}
    snapshot = []
    for idx, step in enumerate(template.steps or []):
        chosen = chosen_by_step.get(str(idx)) or chosen_by_step.get(idx) or []
        approvers = resolve_step(db, step, initiator, chosen)
        if not approvers:
            raise HTTPException(
                status_code=400,
                detail=f"步骤「{step.get('name', '')}」未解析出审批人（上级链缺失或未选择）",
            )
        snapshot.append({
            "name": step.get("name", f"步骤{idx+1}"),
            "mode": step.get("mode", "all"),
            "approvers": [{"user_id": a["user_id"], "user_name": a["user_name"],
                           "status": "pending", "comment": None, "decided_at": None} for a in approvers],
        })
    instance = WorkflowInstance(
        template_id=template.id, entity_type=entity_type, entity_id=entity_id,
        entity_subtype=entity_subtype, title=title, initiator_id=initiator.id,
        status="active", current_step_index=0, steps=snapshot,
    )
    db.add(instance)
    db.flush()
    _create_step_tasks(db, instance, 0)
    db.commit()
    db.refresh(instance)
    _notify_step_approvers(db, instance, 0)
    return instance


def get_active_instance(db: Session, entity_type: str, entity_id) -> Optional[WorkflowInstance]:
    return db.query(WorkflowInstance).filter(
        WorkflowInstance.entity_type == entity_type,
        WorkflowInstance.entity_id == entity_id,
        WorkflowInstance.status == "active",
    ).order_by(WorkflowInstance.started_at.desc()).first()
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/workflow_engine.py backend/tests/test_workflow_engine.py
git commit -m "feat(workflow): start_workflow 流程启动（解析快照+首步任务+通知）"
```

---

### Task 7: 流转核心 act_by_entity / withdraw / 详情

**Files:**
- Modify: `backend/app/workflow_engine.py`（追加）
- Test: Modify `backend/tests/test_workflow_engine.py`（追加用例）

**Interfaces:**
- Consumes: Task 6
- Produces:
  - `act_by_entity(db, *, entity_type, entity_id, user, decision: str, comment: str = "") -> WorkflowInstance`
    - decision ∈ {approved, rejected, returned}；returned 与 rejected 等价（驳回退回发起人）
    - 非当前步骤 pending 任务审批人（且非 admin）→ `HTTPException(403)`
    - 会签 all：全部通过才进下一步；或签 any：任一通过即进下一步，其余任务标 `skipped`
    - 驳回：当前步骤其余 pending 任务标 `skipped`，实例 `rejected`，通知发起人
    - 最后一步通过：实例 `approved`，`finished_at` 写入，通知发起人
    - 推进下一步：`current_step_index+1`、创建任务、通知下一批审批人
  - `withdraw_workflow(db, *, entity_type, entity_id, user) -> WorkflowInstance`（非发起人且非 admin → 403）
  - `get_instance_detail(db, instance) -> dict`（steps 快照含任务状态/意见）

- [ ] **Step 1: 写失败测试（追加）**

```python
def _start(db, emp, steps):
    db.add(WorkflowTemplate(code=f"t{uuid.uuid4().hex[:6]}", name="T", entity_type="ecr",
                            entity_subtype=None, steps=steps))
    db.commit()
    return start_workflow(db, entity_type="ecr", entity_id=uuid.uuid4(), title="ECR-1", initiator=emp)


def _approve_step(db, inst, user):
    from app.workflow_engine import act_by_entity
    return act_by_entity(db, entity_type=inst.entity_type, entity_id=inst.entity_id,
                         user=user, decision="approved", comment="同意")


def test_countersign_all_required(db, monkeypatch):
    sent = []
    monkeypatch.setattr(_notif, "create_notifications", lambda db, **kw: sent.append(kw) or 0)
    a = _mk(db, "a1", "甲", role="engineer")
    b = _mk(db, "b1", "乙", role="engineer")
    emp = _mk(db, "emp", "发起人")
    inst = _start(db, emp, [{"name": "会签", "resolvers": [
        {"type": "user", "user_ids": [str(a.id)]},
        {"type": "user", "user_ids": [str(b.id)]},
    ], "mode": "all"}])
    inst = _approve_step(db, inst, a)
    assert inst.status == "active" and inst.current_step_index == 0
    inst = _approve_step(db, inst, b)
    assert inst.status == "approved"
    assert inst.steps[0]["approvers"][0]["status"] == "approved"
    assert inst.steps[0]["approvers"][1]["status"] == "approved"


def test_orsign_any_advances(db, monkeypatch):
    sent = []
    monkeypatch.setattr(_notif, "create_notifications", lambda db, **kw: sent.append(kw) or 0)
    a = _mk(db, "a2", "甲", role="engineer")
    b = _mk(db, "b2", "乙", role="engineer")
    emp = _mk(db, "emp2", "发起人")
    boss = _mk(db, "boss2", "总经理", role="admin")
    inst = _start(db, emp, [
        {"name": "或签", "resolvers": [
            {"type": "user", "user_ids": [str(a.id)]},
            {"type": "user", "user_ids": [str(b.id)]},
        ], "mode": "any"},
        {"name": "批准", "resolvers": [{"type": "user", "user_ids": [str(boss.id)]}], "mode": "all"},
    ])
    inst = _approve_step(db, inst, a)
    assert inst.current_step_index == 1
    assert inst.steps[0]["approvers"][1]["status"] == "skipped"
    inst = _approve_step(db, inst, boss)
    assert inst.status == "approved"


def test_reject_returns_to_initiator(db, monkeypatch):
    sent = []
    monkeypatch.setattr(_notif, "create_notifications", lambda db, **kw: sent.append(kw) or 0)
    a = _mk(db, "a3", "甲", role="engineer")
    emp = _mk(db, "emp3", "发起人")
    inst = _start(db, emp, [{"name": "审批", "resolvers": [{"type": "user", "user_ids": [str(a.id)]}], "mode": "all"}])
    from app.workflow_engine import act_by_entity
    inst = act_by_entity(db, entity_type=inst.entity_type, entity_id=inst.entity_id,
                         user=a, decision="rejected", comment="不合格")
    assert inst.status == "rejected" and inst.finished_at is not None
    assert any("审批驳回" in k.get("title", "") for k in sent)


def test_non_approver_forbidden(db):
    a = _mk(db, "a4", "甲", role="engineer")
    outsider = _mk(db, "x4", "外人", role="engineer")
    emp = _mk(db, "emp4", "发起人")
    inst = _start(db, emp, [{"name": "审批", "resolvers": [{"type": "user", "user_ids": [str(a.id)]}], "mode": "all"}])
    with pytest.raises(HTTPException) as ei:
        act_by_entity(db, entity_type=inst.entity_type, entity_id=inst.entity_id,
                      user=outsider, decision="approved")
    assert ei.value.status_code == 403


def test_withdraw(db):
    a = _mk(db, "a5", "甲", role="engineer")
    emp = _mk(db, "emp5", "发起人")
    inst = _start(db, emp, [{"name": "审批", "resolvers": [{"type": "user", "user_ids": [str(a.id)]}], "mode": "all"}])
    from app.workflow_engine import withdraw_workflow
    inst = withdraw_workflow(db, entity_type=inst.entity_type, entity_id=inst.entity_id, user=emp)
    assert inst.status == "withdrawn"
    assert get_active_instance(db, inst.entity_type, inst.entity_id) is None
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_engine.py -v`
Expected: FAIL（act_by_entity 未定义）

- [ ] **Step 3: 实现流转核心（追加）**

```python
def _mark_step_tasks(instance: WorkflowInstance, step_index: int, status: str, except_task_id=None):
    for a in instance.steps[step_index]["approvers"]:
        if a["status"] == "pending":
            a["status"] = status


def _sync_snapshot_from_tasks(instance: WorkflowInstance, db: Session):
    """将任务表状态回写到实例快照（详情展示用，含意见）"""
    tasks = db.query(ApprovalTask).filter(ApprovalTask.instance_id == instance.id).all()
    by = {}
    for t in tasks:
        by.setdefault(t.step_index, {})[str(t.approver_id)] = t
    for idx, step in enumerate(instance.steps):
        tmap = by.get(idx, {})
        for a in step["approvers"]:
            t = tmap.get(a["user_id"])
            if t:
                a["status"] = t.status
                a["comment"] = t.comment
                a["decided_at"] = t.decided_at.isoformat() if t.decided_at else None


def _step_all_passed(instance: WorkflowInstance, step_index: int) -> bool:
    step = instance.steps[step_index]
    if step["mode"] == "any":
        return any(a["status"] == "approved" for a in step["approvers"])
    return all(a["status"] == "approved" for a in step["approvers"])


def _finish(db: Session, instance: WorkflowInstance, status: str):
    instance.status = status
    instance.finished_at = datetime.now(timezone.utc)
    db.commit()


def act_by_entity(db: Session, *, entity_type: str, entity_id, user: User,
                  decision: str, comment: str = "") -> WorkflowInstance:
    instance = get_active_instance(db, entity_type, entity_id)
    if instance is None:
        raise HTTPException(status_code=400, detail="没有进行中的审批流程")
    if decision not in ("approved", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="无效的审批决定")

    is_admin = user.role == "admin"
    task = None
    for t in db.query(ApprovalTask).filter(
            ApprovalTask.instance_id == instance.id,
            ApprovalTask.step_index == instance.current_step_index,
            ApprovalTask.status == "pending").all():
        if str(t.approver_id) == str(user.id):
            task = t
            break
    if task is None and is_admin:
        task = db.query(ApprovalTask).filter(
            ApprovalTask.instance_id == instance.id,
            ApprovalTask.step_index == instance.current_step_index,
            ApprovalTask.status == "pending").first()
    if task is None:
        raise HTTPException(status_code=403, detail="您不是当前步骤的审批人")

    now = datetime.now(timezone.utc)
    if decision in ("rejected", "returned"):
        task.status = "rejected"
        task.comment = comment
        task.decided_at = now
        for a in instance.steps[instance.current_step_index]["approvers"]:
            if a["status"] == "pending":
                a["status"] = "skipped"
        _finish(db, instance, "rejected")
        _notify(db, [instance.initiator_id], f"{instance.title or ''} 审批驳回", comment or None)
    else:
        task.status = "approved"
        task.comment = comment
        task.decided_at = now
        for a in instance.steps[instance.current_step_index]["approvers"]:
            if str(a["user_id"]) == str(task.approver_id):
                a["status"] = "approved"
                a["comment"] = comment
                a["decided_at"] = now.isoformat()
        if _step_all_passed(instance, instance.current_step_index):
            next_idx = instance.current_step_index + 1
            if next_idx >= len(instance.steps):
                _finish(db, instance, "approved")
                _notify(db, [instance.initiator_id], f"{instance.title or ''} 审批通过", None)
            else:
                for a in instance.steps[instance.current_step_index]["approvers"]:
                    if a["status"] == "pending":
                        a["status"] = "skipped"
                instance.current_step_index = next_idx
                _create_step_tasks(db, instance, next_idx)
                db.commit()
                db.refresh(instance)
                _notify_step_approvers(db, instance, next_idx)
        else:
            db.commit()
    db.refresh(instance)
    return instance


def withdraw_workflow(db: Session, *, entity_type: str, entity_id, user: User) -> WorkflowInstance:
    instance = get_active_instance(db, entity_type, entity_id)
    if instance is None:
        raise HTTPException(status_code=400, detail="没有进行中的审批流程")
    if str(instance.initiator_id) != str(user.id) and user.role != "admin":
        raise HTTPException(status_code=403, detail="仅发起人或管理员可撤回")
    for a in instance.steps[instance.current_step_index]["approvers"]:
        if a["status"] == "pending":
            a["status"] = "skipped"
    _finish(db, instance, "withdrawn")
    db.refresh(instance)
    return instance


def get_instance_detail(db: Session, instance: WorkflowInstance) -> dict:
    _sync_snapshot_from_tasks(instance, db)
    return {
        "id": str(instance.id), "status": instance.status,
        "entity_type": instance.entity_type, "entity_id": str(instance.entity_id),
        "title": instance.title, "initiator_id": str(instance.initiator_id),
        "current_step_index": instance.current_step_index,
        "steps": instance.steps,
        "started_at": instance.started_at.isoformat() if instance.started_at else None,
        "finished_at": instance.finished_at.isoformat() if instance.finished_at else None,
    }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_engine.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/workflow_engine.py backend/tests/test_workflow_engine.py
git commit -m "feat(workflow): act/withdraw 流转核心（会签或签/驳回/撤回/详情）"
```

---

### Task 8: 模板与实例数据访问（crud_workflow.py）

**Files:**
- Create: `backend/app/crud_workflow.py`
- Test: Create `backend/tests/test_workflow_api.py`（先测 crud 层）

**Interfaces:**
- Consumes: Task 3（模型）
- Produces:
  - `list_templates(db, entity_type=None) -> list[WorkflowTemplate]`
  - `get_template(db, template_id) -> WorkflowTemplate`（不存在 404）
  - `create_template(db, data: WorkflowTemplateCreate) -> WorkflowTemplate`（code 重复 400）
  - `update_template(db, template_id, data: WorkflowTemplateUpdate) -> WorkflowTemplate`
  - `delete_template(db, template_id)`（软删改硬删：直接删除；被引用实例 template_id 置空不阻塞）
  - `list_instances(db, entity_type, entity_id) -> list[WorkflowInstance]`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_workflow_api.py
import uuid
import pytest
from fastapi import HTTPException
from app import crud_workflow
from app.schemas_workflow import WorkflowTemplateCreate, WorkflowStep


def test_template_crud(db):
    t = crud_workflow.create_template(db, WorkflowTemplateCreate(
        code="ecr_default", name="ECR 审批", entity_type="ecr",
        steps=[WorkflowStep(name="校对", mode="any")],
    ))
    assert t.id is not None
    assert crud_workflow.list_templates(db, "ecr")[0].code == "ecr_default"
    got = crud_workflow.get_template(db, t.id)
    assert got.steps[0]["name"] == "校对"
    t2 = crud_workflow.update_template(db, t.id, WorkflowTemplateUpdate(name="ECR 新审批"))
    assert t2.name == "ECR 新审批"
    crud_workflow.delete_template(db, t.id)
    with pytest.raises(HTTPException):
        crud_workflow.get_template(db, t.id)


def test_template_code_duplicate_400(db):
    crud_workflow.create_template(db, WorkflowTemplateCreate(code="x", name="X", entity_type="ecr"))
    with pytest.raises(HTTPException) as ei:
        crud_workflow.create_template(db, WorkflowTemplateCreate(code="x", name="Y", entity_type="eco"))
    assert ei.value.status_code == 400
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_api.py -v`
Expected: FAIL（ImportError: crud_workflow）

- [ ] **Step 3: 创建 crud_workflow.py**

```python
# backend/app/crud_workflow.py
"""审批流引擎 - 模板与实例数据访问"""
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models_workflow import WorkflowTemplate, WorkflowInstance
from app.schemas_workflow import WorkflowTemplateCreate, WorkflowTemplateUpdate


def list_templates(db: Session, entity_type: Optional[str] = None) -> list:
    q = db.query(WorkflowTemplate)
    if entity_type:
        q = q.filter(WorkflowTemplate.entity_type == entity_type)
    return q.order_by(WorkflowTemplate.entity_type, WorkflowTemplate.entity_subtype).all()


def get_template(db: Session, template_id: uuid.UUID) -> WorkflowTemplate:
    t = db.get(WorkflowTemplate, template_id)
    if not t:
        raise HTTPException(status_code=404, detail="审批流模板不存在")
    return t


def create_template(db: Session, data: WorkflowTemplateCreate) -> WorkflowTemplate:
    exists = db.query(WorkflowTemplate).filter(WorkflowTemplate.code == data.code).first()
    if exists:
        raise HTTPException(status_code=400, detail="模板编码已存在")
    if not data.steps:
        raise HTTPException(status_code=400, detail="模板至少需要一个步骤")
    t = WorkflowTemplate(
        code=data.code, name=data.name, entity_type=data.entity_type,
        entity_subtype=data.entity_subtype, steps=[s.model_dump() for s in data.steps],
        is_active=data.is_active,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_template(db: Session, template_id: uuid.UUID, data: WorkflowTemplateUpdate) -> WorkflowTemplate:
    t = get_template(db, template_id)
    if data.name is not None:
        t.name = data.name
    if data.steps is not None:
        if not data.steps:
            raise HTTPException(status_code=400, detail="模板至少需要一个步骤")
        t.steps = [s.model_dump() for s in data.steps]
    if data.is_active is not None:
        t.is_active = data.is_active
    db.commit(); db.refresh(t)
    return t


def delete_template(db: Session, template_id: uuid.UUID):
    t = get_template(db, template_id)
    db.delete(t); db.commit()


def list_instances(db: Session, entity_type: str, entity_id: uuid.UUID) -> list:
    return db.query(WorkflowInstance).filter(
        WorkflowInstance.entity_type == entity_type,
        WorkflowInstance.entity_id == entity_id,
    ).order_by(WorkflowInstance.started_at.desc()).all()
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/crud_workflow.py backend/tests/test_workflow_api.py
git commit -m "feat(workflow): 模板 CRUD 与实例查询"
```

---

### Task 9: 种子模板与存量单据迁移（migrations_workflow.py）

**Files:**
- Create: `backend/app/migrations_workflow.py`
- Modify: `backend/app/main.py`（模型导入 + apply 调用，约第 468-475 行 import 区与第 565 行附近）
- Test: Create `backend/tests/test_workflow_migrations.py`

**Interfaces:**
- Consumes: Task 3（模型）、Task 6（start_workflow 不适用——直接建实例）
- Produces: `apply(db)`——幂等：
  1. 种子模板（按 code 存在则跳过）：库存 5 类（inbound/outbound/transfer/stocktake/adjustment）默认 `主管审核(manager_chain 1) → 经理审批(manager_chain 2)`；`ecr_default`、`eco_default` 为 `校对(initiator_choose 候选 engineer) → 审核(initiator_choose 候选 engineer+admin) → 批准(role=admin)`（或签/或签/会签）
  2. 存量单据：ECR/ECO/InventoryDocument 中 `status='reviewing'` 且无 active 实例的，按各自 `reviewers`/`review_mode` 生成单步实例（`template_id=None`），审批人状态 pending

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_workflow_migrations.py
import uuid
from app import models_workflow as mw
from app import migrations_workflow


def _reviewing_ecr(db, reviewer_id, mode="all"):
    from app.models_ecr import ECR
    e = ECR(id=uuid.uuid4(), ecr_number=f"ECR-{uuid.uuid4().hex[:6]}", title="T",
            reason="优化", status="reviewing", creator_id=uuid.uuid4(),
            reviewers=[{"user_id": str(reviewer_id), "user_name": "甲"}],
            review_mode=mode)
    db.add(e); db.commit()
    return e


def test_seed_templates_idempotent(db):
    migrations_workflow.apply(db)
    codes = [t.code for t in db.query(mw.WorkflowTemplate).all()]
    assert "ecr_default" in codes and "inv_inbound_default" in codes
    n = db.query(mw.WorkflowTemplate).count()
    migrations_workflow.apply(db)  # 幂等
    assert db.query(mw.WorkflowTemplate).count() == n


def test_legacy_reviewing_ecr_migrated(db):
    from app import models
    reviewer = models.User(id=uuid.uuid4(), username="r1", password_hash="x",
                           real_name="甲", role="engineer", status="active")
    db.add(reviewer); db.commit()
    e = _reviewing_ecr(db, reviewer.id)
    migrations_workflow.apply(db)
    inst = db.query(mw.WorkflowInstance).filter_by(entity_type="ecr", entity_id=e.id).first()
    assert inst is not None and inst.status == "active"
    task = db.query(mw.ApprovalTask).filter_by(instance_id=inst.id).first()
    assert task.approver_id == reviewer.id and task.status == "pending"
    # 再次 apply 不重复生成
    migrations_workflow.apply(db)
    assert db.query(mw.WorkflowInstance).filter_by(entity_type="ecr", entity_id=e.id).count() == 1
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_migrations.py -v`
Expected: FAIL（ImportError: migrations_workflow）

- [ ] **Step 3: 创建迁移文件**

```python
# backend/app/migrations_workflow.py
"""审批流引擎迁移：种子模板 + 存量 reviewing 单据实例化（幂等）。"""
from sqlalchemy.orm import Session

from app.models_workflow import WorkflowTemplate, WorkflowInstance, ApprovalTask

SEED_TEMPLATES = [
    {"code": "ecr_default", "name": "ECR 变更审批", "entity_type": "ecr", "entity_subtype": None,
     "steps": [
         {"name": "校对", "resolvers": [{"type": "initiator_choose", "candidates": {"roles": ["engineer"]}}], "mode": "any"},
         {"name": "审核", "resolvers": [{"type": "initiator_choose", "candidates": {"roles": ["engineer", "admin"]}}], "mode": "any"},
         {"name": "批准", "resolvers": [{"type": "role", "role": "admin"}], "mode": "all"},
     ]},
    {"code": "eco_default", "name": "ECO 变更审批", "entity_type": "eco", "entity_subtype": None,
     "steps": [
         {"name": "校对", "resolvers": [{"type": "initiator_choose", "candidates": {"roles": ["engineer"]}}], "mode": "any"},
         {"name": "审核", "resolvers": [{"type": "initiator_choose", "candidates": {"roles": ["engineer", "admin"]}}], "mode": "any"},
         {"name": "批准", "resolvers": [{"type": "role", "role": "admin"}], "mode": "all"},
     ]},
]
for _dt in ("inbound", "outbound", "transfer", "stocktake", "adjustment"):
    SEED_TEMPLATES.append({
        "code": f"inv_{_dt}_default", "name": f"库存单据审批（{_dt}）",
        "entity_type": "inventory_doc", "entity_subtype": _dt,
        "steps": [
            {"name": "主管审核", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"},
            {"name": "经理审批", "resolvers": [{"type": "manager_chain", "level": 2}], "mode": "all"},
        ],
    })


def _seed_templates(db: Session):
    for tpl in SEED_TEMPLATES:
        exists = db.query(WorkflowTemplate).filter(
            WorkflowTemplate.code == tpl["code"]).first()
        if exists:
            continue
        db.add(WorkflowTemplate(code=tpl["code"], name=tpl["name"],
                                entity_type=tpl["entity_type"],
                                entity_subtype=tpl["entity_subtype"],
                                steps=tpl["steps"], is_active=True))


def _migrate_legacy_reviewing(db: Session):
    """存量 reviewing 单据：按旧 reviewers/review_mode 生成单步实例（幂等）。"""
    from app.models_ecr import ECR
    from app.models_eco import ECO
    from app.models_inventory import InventoryDocument

    def _make(entity_type, entity, reviewers, mode):
        exists = db.query(WorkflowInstance).filter(
            WorkflowInstance.entity_type == entity_type,
            WorkflowInstance.entity_id == entity.id,
            WorkflowInstance.status == "active").first()
        if exists:
            return
        approvers = []
        for r in (reviewers or []):
            uid = r.get("user_id")
            if not uid:
                continue
            approvers.append({"user_id": str(uid),
                              "user_name": r.get("user_name") or "",
                              "status": "pending", "comment": None, "decided_at": None})
        if not approvers:
            return
        inst = WorkflowInstance(
            template_id=None, entity_type=entity_type, entity_id=entity.id,
            entity_subtype=getattr(entity, "doc_type", None),
            title=getattr(entity, "ecr_number", None) or getattr(entity, "eco_number", None)
                 or getattr(entity, "doc_number", None),
            initiator_id=entity.creator_id, status="active", current_step_index=0,
            steps=[{"name": "审批", "mode": mode or "all", "approvers": approvers}],
        )
        db.add(inst); db.flush()
        for a in approvers:
            db.add(ApprovalTask(instance_id=inst.id, step_index=0, step_name="审批",
                                approver_id=a["user_id"], approver_name=a["user_name"],
                                status="pending"))
        db.flush()

    for e in db.query(ECR).filter(ECR.status == "reviewing", ECR.deleted_at.is_(None)).all():
        _make("ecr", e, e.reviewers or [], e.review_mode)
    for e in db.query(ECO).filter(ECO.status == "reviewing", ECO.deleted_at.is_(None)).all():
        _make("eco", e, e.reviewers or [], e.review_mode)
    for d in db.query(InventoryDocument).filter(
            InventoryDocument.status == "reviewing", InventoryDocument.deleted_at.is_(None)).all():
        _make("inventory_doc", d, d.reviewers or [], d.review_mode)


def apply(db: Session):
    _seed_templates(db)
    db.commit()
    _migrate_legacy_reviewing(db)
    db.commit()
```

- [ ] **Step 4: main.py 注册**

在 `backend/app/main.py`：
- 第 468-475 行的模型 import 区追加 `import app.models_workflow  # noqa: F401`
- 在 `migrations_list_pagination.apply(db)` 调用（约第 560-565 行）之后追加：

```python
        # 审批流引擎：种子模板 + 存量 reviewing 单据实例化（幂等）
        try:
            from app import migrations_workflow
            migrations_workflow.apply(db)
        except Exception as _we:
            db.rollback()
            print(f"⚠ Workflow migration skipped: {_we}")
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && pytest tests/test_workflow_migrations.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/migrations_workflow.py backend/app/main.py backend/tests/test_workflow_migrations.py
git commit -m "feat(workflow): 种子模板与存量 reviewing 单据迁移"
```

---

### Task 10: 模板管理/预览/实例查询 API（routers/workflow.py）

**Files:**
- Create: `backend/app/routers/workflow.py`
- Modify: `backend/app/main.py`（路由注册，第 6-14 行 import 与第 34-55 行 include_router 区）
- Test: Modify `backend/tests/test_workflow_api.py`（API 层用例）

**Interfaces:**
- Consumes: Task 4、5、7、8
- Produces（全部挂在 `/api/workflow` 前缀）：
  - `GET /templates?entity_type=` → 模板列表（需 `workflow:template:manage`）
  - `POST /templates`（body: WorkflowTemplateCreate）
  - `PUT /templates/{id}`（body: WorkflowTemplateUpdate）
  - `DELETE /templates/{id}`
  - `GET /templates/preview?entity_type=&entity_subtype=` → `preview_steps`（当前用户为发起人；**登录即可**，供提交时前端预览）
  - `GET /instances/{entity_type}/{entity_id}` → `get_instance_detail`（active 实例，无则 404；**登录即可**）

- [ ] **Step 1: 写失败测试（追加到 test_workflow_api.py）**

```python
from fastapi.testclient import TestClient
from app.main import app as _app

client = TestClient(_app)


def _login_admin():
    # 复用现有登录：直接构造 JWT 较重，这里用依赖覆盖方案——见 Step 3 说明
    pass
```

> 说明：本仓库 API 测试模式（参考 `backend/tests/test_inventory_api.py`）用 `app.dependency_overrides` 覆盖 `get_current_user` 依赖（位于 `backend/app/permissions/__init__.py`）。具体做法：`from app.permissions import get_current_user`，用 `_app.dependency_overrides[get_current_user] = lambda: admin_user`，然后 `client.get("/api/workflow/templates")`。Step 3 给出实现，测试在 Step 1 中按此模式写完整用例（覆盖：模板列表需要权限、preview 返回 manager_chain 解析结果、instances 404）。

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && pytest tests/test_workflow_api.py -v`
Expected: FAIL（路由不存在，404 或 ImportError）

- [ ] **Step 3: 创建路由文件**

```python
# backend/app/routers/workflow.py
"""审批流引擎 API：模板管理 + 提交预览 + 实例查询"""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.permissions import require_permission
from app import crud_workflow, workflow_engine
from app.schemas_workflow import WorkflowTemplateCreate, WorkflowTemplateUpdate

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


@router.get("/templates")
def list_templates(entity_type: Optional[str] = Query(None),
                   db: Session = Depends(get_db),
                   _: User = Depends(require_permission("workflow:template:manage"))):
    return [{
        "id": str(t.id), "code": t.code, "name": t.name,
        "entity_type": t.entity_type, "entity_subtype": t.entity_subtype,
        "steps": t.steps, "is_active": t.is_active,
    } for t in crud_workflow.list_templates(db, entity_type)]


@router.post("/templates")
def create_template(data: WorkflowTemplateCreate, db: Session = Depends(get_db),
                    _: User = Depends(require_permission("workflow:template:manage"))):
    t = crud_workflow.create_template(db, data)
    return {"id": str(t.id), "code": t.code, "name": t.name}


@router.put("/templates/{template_id}")
def update_template(template_id: uuid.UUID, data: WorkflowTemplateUpdate,
                    db: Session = Depends(get_db),
                    _: User = Depends(require_permission("workflow:template:manage"))):
    t = crud_workflow.update_template(db, template_id, data)
    return {"id": str(t.id), "name": t.name, "steps": t.steps}


@router.delete("/templates/{template_id}")
def delete_template(template_id: uuid.UUID, db: Session = Depends(get_db),
                    _: User = Depends(require_permission("workflow:template:manage"))):
    crud_workflow.delete_template(db, template_id)
    return {"detail": "已删除"}


@router.get("/templates/preview")
def preview_templates(entity_type: str = Query(...),
                      entity_subtype: Optional[str] = Query(None),
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("ecr:submit"))):
    template = workflow_engine.get_active_template(db, entity_type, entity_subtype)
    if template is None:
        return {"template": None, "steps": [], "message": "未配置该单据类型的审批流模板"}
    return {"template": {"id": str(template.id), "name": template.name},
            "steps": workflow_engine.preview_steps(db, template, current_user)}


@router.get("/instances/{entity_type}/{entity_id}")
def get_instance(entity_type: str, entity_id: uuid.UUID,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    """仅发起人/当前步骤审批人/admin 可见实例详情，其余 403。"""
    inst = workflow_engine.get_active_instance(db, entity_type, entity_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="没有进行中的审批流程")
    is_admin = current_user.role == "admin"
    is_initiator = str(inst.initiator_id) == str(current_user.id)
    is_approver = db.query(ApprovalTask).filter(
        ApprovalTask.instance_id == inst.id,
        ApprovalTask.status == "pending",
        ApprovalTask.approver_id == current_user.id,
    ).first() is not None
    if not (is_admin or is_initiator or is_approver):
        raise HTTPException(status_code=403, detail="无权查看该审批流程")
    return workflow_engine.get_instance_detail(db, inst)
```

文件头 import 追加：`from app.models_workflow import ApprovalTask`、`from app.permissions import get_current_user`（`require_permission` 保持用于模板管理端点）。

- [ ] **Step 4: main.py 注册路由**

在 `backend/app/main.py` 顶部 import 区追加 `from .routers.workflow import router as workflow_router`，并在 include_router 区追加 `app.include_router(workflow_router, prefix="/api")`（注意路由文件已含 `/api/workflow` 前缀，与现有风格一致，见 ecos.py 用法）。

- [ ] **Step 5: 补全 API 测试并按上述鉴权修正跑通**

Run: `cd backend && pytest tests/test_workflow_api.py -v`
Expected: PASS（模板列表权限校验、preview 解析、实例 404/403 用例全绿）

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/workflow.py backend/app/main.py backend/tests/test_workflow_api.py
git commit -m "feat(workflow): 模板管理/预览/实例查询 API"
```

---

### Task 11: ECR 接入引擎

**Files:**
- Modify: `backend/app/routers/ecrs.py`（submit_ecr 约 262-281、withdraw_ecr 约 287-308、review_ecr 约 314-386）
- Modify: `backend/app/crud_ecr.py`（`_ALLOWED_TRANSITIONS` 第 22-27 行；`update_ecr` 第 195-200 行状态限制）
- Modify: `backend/app/schemas_ecr.py`（`ECRReviewAction` 不变；submit 请求体在 Task 4 已建 `WorkflowSubmitAction`）
- Modify: `backend/app/routers/ecrs.py` 的 `_build_ecr_detail`（追加 `workflow` 字段）
- Test: Create `backend/tests/test_ecr_workflow.py`

**Interfaces:**
- Consumes: Task 6、7
- Produces: ECR 提交/审批/撤回改走引擎；`_build_ecr_detail` 返回 `workflow: {instance detail | None}`

- [ ] **Step 1: 改状态流转与编辑限制（crud_ecr.py）**

```python
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing", "closed"},
    "reviewing": {"approved", "rejected", "draft"},
    "approved":  {"closed"},
    "rejected":  {"closed", "reviewing"},   # 驳回后可重提
}
```

`update_ecr` 中 `if ecr.status != "draft":` 改为 `if ecr.status not in ("draft", "rejected"):`

- [ ] **Step 2: 写失败测试**

```python
# backend/tests/test_ecr_workflow.py
import uuid
import pytest
from fastapi import HTTPException
from app import models
from app.models_ecr import ECR
from app.models_workflow import WorkflowTemplate, ApprovalTask, WorkflowInstance
from app.workflow_engine import start_workflow, act_by_entity, withdraw_workflow, get_active_instance


def _mk(db, username, real_name, role="engineer", manager_id=None):
    u = models.User(id=uuid.uuid4(), username=username, password_hash="x",
                    real_name=real_name, role=role, status="active", manager_id=manager_id)
    db.add(u); db.commit(); db.refresh(u)
    return u


def _ecr(db, creator):
    e = ECR(id=uuid.uuid4(), ecr_number="ECR-2026-00001", title="变更测试", reason="优化",
            status="draft", creator_id=creator.id)
    db.add(e); db.commit(); db.refresh(e)
    return e


def _template(db):
    db.add(WorkflowTemplate(code="ecr_t", name="ECR 审批", entity_type="ecr", entity_subtype=None,
                            steps=[{"name": "批准", "resolvers": [{"type": "role", "role": "admin"}], "mode": "all"}]))
    db.commit()


def test_ecr_full_flow(db):
    adm = _mk(db, "adm", "管理员", role="admin")
    emp = _mk(db, "emp", "发起人")
    e = _ecr(db, emp)
    _template(db)
    inst = start_workflow(db, entity_type="ecr", entity_id=e.id, title=e.ecr_number, initiator=emp)
    assert inst.status == "active"
    inst = act_by_entity(db, entity_type="ecr", entity_id=e.id, user=adm, decision="approved")
    assert inst.status == "approved"
    assert get_active_instance(db, "ecr", e.id) is None


def test_ecr_resubmit_after_reject(db):
    adm = _mk(db, "adm2", "管理员", role="admin")
    emp = _mk(db, "emp2", "发起人")
    e = _ecr(db, emp)
    _template(db)
    start_workflow(db, entity_type="ecr", entity_id=e.id, title=e.ecr_number, initiator=emp)
    act_by_entity(db, entity_type="ecr", entity_id=e.id, user=adm, decision="rejected", comment="改一下")
    assert get_active_instance(db, "ecr", e.id) is None
    # 重提：新实例从头走
    inst2 = start_workflow(db, entity_type="ecr", entity_id=e.id, title=e.ecr_number, initiator=emp)
    assert inst2.status == "active"
    assert db.query(WorkflowInstance).filter_by(entity_type="ecr", entity_id=e.id).count() == 2
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd backend && pytest tests/test_ecr_workflow.py -v`
Expected: FAIL（`WorkflowInstance` 未导入 → 补 import；断言重提计数失败等）

- [ ] **Step 4: 改造 submit_ecr / withdraw_ecr / review_ecr**

`submit_ecr`（替换 262-281 行函数体）：

```python
@router.post("/{ecr_id}/submit")
async def submit_ecr(
    ecr_id: uuid.UUID,
    data: Optional[schemas_workflow.WorkflowSubmitAction] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("ecr:submit"))
):
    """提交评审：启动审批流实例"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    enforce_object_policy("ecr_owner_or_admin", current_user, ecr)
    if ecr.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="仅草稿或驳回状态的 ECR 可以提交")
    chosen = (data.chosen_by_step if data else {}) or {}
    workflow_engine.start_workflow(
        db, entity_type="ecr", entity_id=ecr.id,
        title=f"{ecr.ecr_number} {ecr.title}", initiator=current_user,
        chosen_by_step=chosen,
    )
    ecr = crud_ecr.change_ecr_status(db, ecr_id, "reviewing", current_user.id, "提交审批")
    return _build_ecr_detail(db, ecr)
```

`withdraw_ecr`（替换 287-308 行函数体）：删除 `ECRReviewRecord` 清理，改为：

```python
    workflow_engine.withdraw_workflow(db, entity_type="ecr", entity_id=ecr.id, user=current_user)
    ecr = crud_ecr.change_ecr_status(db, ecr_id, "draft", current_user.id, "撤回评审")
    return _build_ecr_detail(db, ecr)
```

`review_ecr`（替换 314-386 行函数体）：删除 reviewer_ids/ECRReviewRecord 逻辑，改为：

```python
    if ecr.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅评审中状态的 ECR 可进行审批")
    instance = workflow_engine.act_by_entity(
        db, entity_type="ecr", entity_id=ecr.id, user=current_user,
        decision=data.decision, comment=data.comment or "",
    )
    if instance.status == "approved":
        crud_ecr.change_ecr_status(db, ecr_id, "approved", current_user.id, "所有审批人已通过，自动批准")
    elif instance.status == "rejected":
        crud_ecr.change_ecr_status(db, ecr_id, "rejected", current_user.id, data.comment or "审批驳回")
    return _build_ecr_detail(db, ecr)
```

`_build_ecr_detail`（约 25-120 行）在返回 dict 中追加：

```python
    _inst = workflow_engine.get_active_instance(db, "ecr", ecr.id)
    base["workflow"] = workflow_engine.get_instance_detail(db, _inst) if _inst else None
```

文件头 import 追加 `from app import workflow_engine` 与 `from app.schemas_workflow import WorkflowSubmitAction`（按现有 import 风格）。

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && pytest tests/test_ecr_workflow.py -v`
Expected: PASS

- [ ] **Step 6: 回归既有 ECR 测试**

Run: `cd backend && pytest tests/ -k "ecr" -v`
Expected: 全绿；若有用例依赖"手填审批人提交"旧行为，按其新语义修正（提交不再校验 reviewers 非空）。

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/ecrs.py backend/app/crud_ecr.py backend/tests/test_ecr_workflow.py
git commit -m "feat(ecr): 接入审批流引擎（提交/审批/撤回 + 驳回重提）"
```

---

### Task 12: ECO 接入引擎（含驳回解冻）

**Files:**
- Modify: `backend/app/routers/ecos.py`（submit_eco 268-285、withdraw_eco 291-305、review_eco 311-352、`_build_eco_detail`）
- Modify: `backend/app/crud_eco.py`（`_ALLOWED_TRANSITIONS` 第 22 行附近；`change_eco_status` 驳回解冻；`update_eco` 状态限制）
- Test: Create `backend/tests/test_eco_workflow.py`

**Interfaces:**
- Consumes: Task 6、7；Task 11 的接入模式
- Produces: ECO 审批走引擎；**驳回（→rejected）时也解冻**本次提交冻结的零部件（`crud_eco.unfreeze_release_tree`）

- [ ] **Step 1: 改状态流转/编辑/解冻（crud_eco.py）**

```python
_ALLOWED_TRANSITIONS = {
    # 原表基础上：rejected 增加 reviewing（驳回后可重提）
    "rejected": {"closed", "reviewing"},
}
```

`update_eco` 的草稿限制改为 `("draft", "rejected")`（按 crud_eco.py 现有实现位置）。

`change_eco_status`：在"退回草稿解冻"逻辑旁追加——当 `to_status == "rejected"` 时同样调用 `unfreeze_release_tree(db, eco)`（幂等，仅解冻本次冻结的件；调用点参考现有 `to_status == "draft"` 分支写法，注释更新为"退回草稿/驳回时解冻本次提交所冻结的件"）。

- [ ] **Step 2: 写失败测试**

```python
# backend/tests/test_eco_workflow.py
import uuid
from app import models
from app.models_eco import ECO
from app.models_workflow import WorkflowTemplate
from app.workflow_engine import start_workflow, act_by_entity
from app import crud_eco


def _mk(db, username, real_name, role="engineer"):
    u = models.User(id=uuid.uuid4(), username=username, password_hash="x",
                    real_name=real_name, role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _eco(db, creator):
    e = ECO(id=uuid.uuid4(), eco_number="ECO-2026-00001", title="变更单", reason="优化",
            status="draft", creator_id=creator.id, release_items=[])
    db.add(e); db.commit(); db.refresh(e)
    return e


def test_eco_reject_unfreezes(db):
    """驳回后：change_eco_status 由引擎驱动进入 rejected 并解冻"""
    adm = _mk(db, "adm", "管理员", role="admin")
    emp = _mk(db, "emp", "发起人")
    e = _eco(db, emp)
    # 先模拟提交冻结
    eco = crud_eco.change_eco_status(db, e.id, "reviewing", emp.id, "提交")
    # 引擎审批驳回 → 模块状态 rejected（由路由器调用，此处直接测状态机副作用）
    eco = crud_eco.change_eco_status(db, e.id, "rejected", adm.id, "驳回")
    assert eco.status == "rejected"
    # 重提路径：rejected → reviewing 合法
    eco = crud_eco.change_eco_status(db, e.id, "reviewing", emp.id, "重提")
    assert eco.status == "reviewing"
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd backend && pytest tests/test_eco_workflow.py -v`
Expected: FAIL（rejected→reviewing 被 400 拒绝）

- [ ] **Step 4: 改造 ecos.py 三个端点**

与 Task 11 Step 4 完全同构（`entity_type="eco"`；`title=f"{eco.eco_number} {eco.title}"`；`change_eco_status` 调用保持原签名）；`_build_eco_detail` 追加 `workflow` 字段（active 实例详情）。文件头追加 `from app import workflow_engine`、`from app.schemas_workflow import WorkflowSubmitAction`。

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && pytest tests/test_eco_workflow.py -v`
Expected: PASS

- [ ] **Step 6: 回归既有 ECO 测试**

Run: `cd backend && pytest tests/ -k "eco" -v`
Expected: 全绿（修正依赖旧行为的用例）

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/ecos.py backend/app/crud_eco.py backend/tests/test_eco_workflow.py
git commit -m "feat(eco): 接入审批流引擎（驳回解冻 + 驳回重提）"
```

---

### Task 13: 库存单据接入引擎

**Files:**
- Modify: `backend/app/crud_inventory.py`（`_ALLOWED_TRANSITIONS` 第 22-29 行；`submit_document` 424-437、`withdraw_document` 440-447、`review_document` 461-500、`update_document` 358-360、`_doc_detail` 287-324）
- Test: Modify `backend/tests/test_inventory_document.py`（适配新语义）；Create `backend/tests/test_inventory_workflow.py`

**Interfaces:**
- Consumes: Task 6、7
- Produces: 库存单据 submit/review/withdraw 走引擎；`_doc_detail` 返回 `workflow` 字段

- [ ] **Step 1: 改状态流转与编辑限制（crud_inventory.py）**

```python
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing", "approved"},
    "reviewing": {"approved", "rejected", "draft"},
    "approved":  {"posted", "cancelled"},
    "posted":    set(),
    "rejected":  {"reviewing"},   # 驳回后可重提
    "cancelled": set(),
}
```

`update_document` 的 `if doc.status != "draft":` 改为 `if doc.status not in ("draft", "rejected"):`。

- [ ] **Step 2: 写失败测试**

```python
# backend/tests/test_inventory_workflow.py
import uuid
from app import models
from app.models_inventory import InventoryDocument
from app.models_workflow import WorkflowTemplate
from app.workflow_engine import start_workflow, act_by_entity
from app import crud_inventory


def _mk(db, username, real_name, role="engineer", manager_id=None):
    u = models.User(id=uuid.uuid4(), username=username, password_hash="x",
                    real_name=real_name, role=role, status="active", manager_id=manager_id)
    db.add(u); db.commit(); db.refresh(u)
    return u


def _doc(db, creator, doc_type="inbound"):
    d = InventoryDocument(id=uuid.uuid4(), doc_number=f"IN-{uuid.uuid4().hex[:6]}",
                          doc_type=doc_type, status="draft", creator_id=creator.id)
    db.add(d); db.commit(); db.refresh(d)
    return d


def test_inventory_two_level_chain(db):
    boss = _mk(db, "boss", "总经理", role="admin")
    mgr = _mk(db, "mgr", "经理", manager_id=boss.id)
    emp = _mk(db, "emp", "制单员", manager_id=mgr.id)
    d = _doc(db, emp)
    db.add(WorkflowTemplate(code="inv_t", name="入库审批", entity_type="inventory_doc",
                            entity_subtype="inbound", steps=[
        {"name": "主管审核", "resolvers": [{"type": "manager_chain", "level": 1}], "mode": "all"},
        {"name": "经理审批", "resolvers": [{"type": "manager_chain", "level": 2}], "mode": "all"},
    ])); db.commit()
    start_workflow(db, entity_type="inventory_doc", entity_id=d.id, entity_subtype="inbound",
                   title=d.doc_number, initiator=emp)
    # 主管通过
    act_by_entity(db, entity_type="inventory_doc", entity_id=d.id, user=mgr, decision="approved")
    # 经理通过
    inst = act_by_entity(db, entity_type="inventory_doc", entity_id=d.id, user=boss, decision="approved")
    assert inst.status == "approved"


def test_inventory_submit_no_template_raises(db):
    emp = _mk(db, "emp2", "制单员")
    d = _doc(db, emp)
    from fastapi import HTTPException
    import pytest
    with pytest.raises(HTTPException) as ei:
        crud_inventory.submit_document(db, d, emp)
    assert ei.value.status_code == 400
```

- [ ] **Step 3: 运行测试验证失败**

Run: `cd backend && pytest tests/test_inventory_workflow.py -v`
Expected: FAIL（submit_document 仍走旧逻辑，无模板时直接 approved 或 reviewers 为空自动批准）

- [ ] **Step 4: 改造 crud_inventory 三个函数**

`submit_document` 新实现（替换 424-437）：

```python
def submit_document(db, doc, user: User) -> InventoryDocument:
    if doc.status not in ("draft", "rejected"):
        raise HTTPException(status_code=400, detail="仅草稿或驳回状态可提交")
    workflow_engine.start_workflow(
        db, entity_type="inventory_doc", entity_id=doc.id,
        entity_subtype=doc.doc_type, title=f"{doc.doc_number} {doc.biz_type or doc.doc_type}",
        initiator=user,
    )
    return _change_status(db, doc, "reviewing", user, "提交审批")
```

`withdraw_document`（替换 440-447）：删除 `InventoryReviewRecord` 清理，改为：

```python
    workflow_engine.withdraw_workflow(db, entity_type="inventory_doc", entity_id=doc.id, user=user)
    return _change_status(db, doc, "draft", user, "撤回审批")
```

`review_document`（替换 461-500）：

```python
def review_document(db, doc, reviewer: User, decision: str, comment: str = "") -> InventoryDocument:
    if doc.status != "reviewing":
        raise HTTPException(status_code=400, detail="单据不在审批中")
    instance = workflow_engine.act_by_entity(
        db, entity_type="inventory_doc", entity_id=doc.id,
        user=reviewer, decision=decision, comment=comment,
    )
    if instance.status == "approved":
        result = _change_status(db, doc, "approved", reviewer, "审批通过")
        _notif.create_notifications(
            db, recipient_ids=[doc.creator_id], sender_id=reviewer.id,
            event_type="inv_doc_approved", title=f"单据 {doc.doc_number} 审批通过",
            body=None, target_type="inventory_document", target_id=doc.id,
            exclude_sender=True,
        )
        return result
    if instance.status == "rejected":
        result = _change_status(db, doc, "rejected", reviewer, comment or "驳回")
        _notif.create_notifications(
            db, recipient_ids=[doc.creator_id], sender_id=reviewer.id,
            event_type="inv_doc_rejected", title=f"单据 {doc.doc_number} 审批驳回",
            body=None, target_type="inventory_document", target_id=doc.id,
            exclude_sender=True,
        )
        return result
    db.refresh(doc)
    return doc
```

`_doc_detail` 末尾追加（`_doc_brief` 里 reviewers 字段保留兼容旧数据展示）：

```python
    _inst = workflow_engine.get_active_instance(db, "inventory_doc", d.id)
    base["workflow"] = workflow_engine.get_instance_detail(db, _inst) if _inst else None
```

文件头追加 `from app import workflow_engine`。

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && pytest tests/test_inventory_workflow.py -v`
Expected: PASS

- [ ] **Step 6: 适配既有库存测试**

Run: `cd backend && pytest tests/test_inventory_document.py tests/test_inventory_api.py -v`
Expected: 全绿。需修改的旧用例：
- 移除"无审批人自动批准"用例（新语义：无模板 400）
- submit/review 用例改为先造 `WorkflowTemplate` 再提交

- [ ] **Step 7: Commit**

```bash
git add backend/app/crud_inventory.py backend/tests/test_inventory_workflow.py backend/tests/test_inventory_document.py backend/tests/test_inventory_api.py
git commit -m "feat(inventory): 库存单据接入审批流引擎（组织链审批）"
```

---

### Task 14: 前端 API 层（workflowApi + 模块 api 调整）

**Files:**
- Modify: `frontend/src/services/api.ts`（追加 workflowApi；修改 ecrApi.submit/ecoApi.submit/inventory submit 携带 chosen_by_step）
- Test: 无（api.ts 无单测；由后续组件任务验证）

**Interfaces:**
- Consumes: Task 10（后端 API）
- Produces:
  - `workflowApi.preview(entityType, entitySubtype?) -> {template, steps}`（steps: `[{step_index, name, mode, rule_types, approvers, candidates, allow_replace, warning}]`）
  - `workflowApi.instance(entityType, entityId) -> WorkflowInstanceDetail | 404`
  - `ecrApi.submit(id, payload?)`、`ecoApi.submit(id, payload?)`、`inventoryApi.submit(id, payload?)` 增加可选 `{ chosen_by_step?: Record<number, string[]> }`（注意后端 key 为字符串，序列化时用 `String(idx)`）

- [ ] **Step 1: 追加 workflowApi 与调整 submit**

在 `frontend/src/services/api.ts` 文件末尾追加：

```ts
export const workflowApi = {
  preview: (entityType: string, entitySubtype?: string) =>
    api.get('/workflow/templates/preview', {
      params: { entity_type: entityType, entity_subtype: entitySubtype },
    }).then((r) => r.data),
  instance: (entityType: string, entityId: string) =>
    api.get(`/workflow/instances/${entityType}/${entityId}`).then((r) => r.data),
};
```

修改 `ecrApi.submit`（约 655 行）与 `ecoApi.submit`（约 693 行）：

```ts
submit: (id: string, payload?: { chosen_by_step?: Record<number, string[]> }) =>
  api.post(`/ecrs/${id}/submit`, payload || {}).then((r) => r.data),
```

库存 submit（约 860 行）同理：

```ts
submit: (id: string, payload?: { chosen_by_step?: Record<number, string[]> }) =>
  api.post(`/inventory/documents/${id}/submit`, payload || {}).then((r) => r.data),
```

- [ ] **Step 2: 类型定义**

在 `frontend/src/types/index.ts` 追加：

```ts
export interface WorkflowApprover {
  user_id: string;
  user_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  comment?: string | null;
  decided_at?: string | null;
}
export interface WorkflowStepView {
  step_index: number;
  name: string;
  mode: 'all' | 'any';
  rule_types: string[];
  approvers: WorkflowApprover[];
  candidates?: { user_id: string; user_name: string }[];
  allow_replace?: boolean;
  warning?: string | null;
}
export interface WorkflowInstanceDetail {
  id: string;
  status: 'active' | 'approved' | 'rejected' | 'withdrawn';
  entity_type: string;
  entity_id: string;
  title?: string | null;
  initiator_id: string;
  current_step_index: number;
  steps: WorkflowStepView[];
  started_at?: string | null;
  finished_at?: string | null;
}
```

- [ ] **Step 3: 构建验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts frontend/src/types/index.ts
git commit -m "feat(frontend): workflowApi 与模块 submit 携带审批流选择"
```

---

### Task 15: ApprovalFlowPicker 组件（提交时选择）

**Files:**
- Create: `frontend/src/components/Approval/ApprovalFlowPicker.tsx`
- Test: `frontend/src/components/Approval/ApprovalFlowPicker.test.ts`（Vitest，node 环境，mock `workflowApi.preview`）

**Interfaces:**
- Consumes: Task 14（workflowApi.preview / 类型）
- Produces: `default function ApprovalFlowPicker({ entityType, entitySubtype, open, onClose, onConfirm }: Props)`，Props：
  - `entityType: string`、`entitySubtype?: string`
  - `open: boolean`、`onClose: () => void`
  - `onConfirm: (chosen: Record<number, string[]>) => void`
  - 内部：挂载/打开时拉取 preview；步骤卡片展示步骤名/会签或签/已解析审批人；`allow_replace` 步骤（initiator_choose）渲染候选人下拉（默认第一候选）；`warning` 步骤红字提示；"确认提交"按钮收集 `chosen` 后 `onConfirm`

- [ ] **Step 1: 写失败测试**

```ts
// frontend/src/components/Approval/ApprovalFlowPicker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApprovalFlowPicker from './ApprovalFlowPicker';
import { workflowApi } from '../../services/api';

vi.mock('../../services/api', () => ({
  workflowApi: { preview: vi.fn() },
}));

const previewResp = {
  template: { id: 't1', name: 'ECR 审批' },
  steps: [
    { step_index: 0, name: '校对', mode: 'any', rule_types: ['initiator_choose'],
      approvers: [], candidates: [{ user_id: 'u1', user_name: '工程师甲' }], allow_replace: true },
    { step_index: 1, name: '批准', mode: 'all', rule_types: ['role'],
      approvers: [{ user_id: 'u2', user_name: '管理员', status: 'pending' }], allow_replace: false },
  ],
};

describe('ApprovalFlowPicker', () => {
  beforeEach(() => { (workflowApi.preview as any).mockResolvedValue(previewResp); });
  it('renders steps and resolves chosen on confirm', async () => {
    const onConfirm = vi.fn();
    render(<ApprovalFlowPicker entityType="ecr" open onClose={() => {}} onConfirm={onConfirm} />);
    await waitFor(() => expect(screen.getByText('校对')).toBeTruthy());
    fireEvent.click(screen.getByText('确认提交'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ 0: ['u1'] }));
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npx vitest run src/components/Approval/ApprovalFlowPicker.test.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现组件**

```tsx
// frontend/src/components/Approval/ApprovalFlowPicker.tsx
import { useEffect, useState, useCallback } from 'react';
import Modal from '../Modal';
import Loading from '../Loading';
import { workflowApi } from '../../services/api';
import type { WorkflowStepView } from '../../types';

interface Props {
  entityType: string;
  entitySubtype?: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (chosen: Record<number, string[]>) => void;
}

export default function ApprovalFlowPicker({ entityType, entitySubtype, open, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<WorkflowStepView[]>([]);
  const [chosen, setChosen] = useState<Record<number, string[]>>({});
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workflowApi.preview(entityType, entitySubtype);
      if (!data.template) { setMissing(true); setSteps([]); return; }
      setMissing(false);
      setSteps(data.steps || []);
      const init: Record<number, string[]> = {};
      (data.steps || []).forEach((s: WorkflowStepView) => {
        if (s.allow_replace && s.candidates?.length) init[s.step_index] = [s.candidates[0].user_id];
      });
      setChosen(init);
    } finally { setLoading(false); }
  }, [entityType, entitySubtype]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const canSubmit = steps.length > 0 &&
    steps.every((s) => !s.allow_replace || (chosen[s.step_index] || []).length > 0);

  return (
    <Modal open={open} onClose={onClose} title="审批流程预览" footer={null} width="560px">
      {loading && <Loading />}
      {missing && (
        <div className="text-sm text-red-600 py-4">
          该单据类型未配置审批流模板，请联系管理员在「审批流模板」中配置。
        </div>
      )}
      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {steps.map((s, i) => (
          <div key={i} className="border rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{i + 1}. {s.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {s.mode === 'all' ? '会签' : '或签'}
              </span>
            </div>
            {s.warning && <div className="text-xs text-red-500 mt-1">{s.warning}</div>}
            {s.allow_replace ? (
              <select
                className="mt-2 w-full border rounded px-2 py-1 text-sm"
                value={(chosen[s.step_index] || [])[0] || ''}
                onChange={(e) => setChosen((c) => ({ ...c, [s.step_index]: [e.target.value] }))}
              >
                {(s.candidates || []).map((c) => (
                  <option key={c.user_id} value={c.user_id}>{c.user_name}</option>
                ))}
              </select>
            ) : (
              <div className="mt-1 text-sm text-gray-700">
                {(s.approvers || []).map((a) => a.user_name).join('、') || '（未解析到审批人）'}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="px-3 py-1.5 border rounded text-sm" onClick={onClose}>取消</button>
        <button
          className="px-3 py-1.5 rounded text-sm text-white bg-blue-600 disabled:opacity-50"
          disabled={!canSubmit}
          onClick={() => onConfirm(chosen)}
        >
          确认提交
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/components/Approval/ApprovalFlowPicker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Approval/ApprovalFlowPicker.tsx frontend/src/components/Approval/ApprovalFlowPicker.test.ts
git commit -m "feat(frontend): 审批流程预览选择组件 ApprovalFlowPicker"
```

---

### Task 16: ApprovalFlowTimeline 组件（审批时间线）

**Files:**
- Create: `frontend/src/components/Approval/ApprovalFlowTimeline.tsx`
- Test: Create `frontend/src/components/Approval/ApprovalFlowTimeline.test.ts`

**Interfaces:**
- Consumes: Task 14（类型）
- Produces: `default function ApprovalFlowTimeline({ instance, currentUserId, canReview, onReview, loading }: Props)`
  - `instance: WorkflowInstanceDetail | null`（null → 渲染"该单据使用旧版审批，无流程实例"）
  - 垂直时间线：每步一个节点，步骤名 + 会签/或签标签 + 每位审批人（姓名/状态徽标/意见）
  - `current_step_index` 且 `status==='active'` 时，若当前用户是当前步骤 pending 审批人 → 渲染"通过/驳回"按钮与意见输入，调用 `onReview(decision, comment)`

- [ ] **Step 1: 写失败测试**

```ts
// frontend/src/components/Approval/ApprovalFlowTimeline.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ApprovalFlowTimeline from './ApprovalFlowTimeline';
import type { WorkflowInstanceDetail } from '../../types';

const inst: WorkflowInstanceDetail = {
  id: 'i1', status: 'active', entity_type: 'ecr', entity_id: 'e1',
  initiator_id: 'u0', current_step_index: 1,
  steps: [
    { step_index: 0, name: '校对', mode: 'any', rule_types: [],
      approvers: [{ user_id: 'u1', user_name: '甲', status: 'approved' }] },
    { step_index: 1, name: '批准', mode: 'all', rule_types: ['role'],
      approvers: [{ user_id: 'u2', user_name: '管理员', status: 'pending' }] },
  ],
};

describe('ApprovalFlowTimeline', () => {
  it('renders step statuses and review buttons for current approver', () => {
    const onReview = vi.fn();
    render(<ApprovalFlowTimeline instance={inst} currentUserId="u2" canReview onReview={onReview} loading={false} />);
    expect(screen.getByText('校对')).toBeTruthy();
    expect(screen.getByText('甲')).toBeTruthy();
    fireEvent.click(screen.getByText('通过'));
    expect(onReview).toHaveBeenCalledWith('approved', '');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npx vitest run src/components/Approval/ApprovalFlowTimeline.test.ts`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现组件**

```tsx
// frontend/src/components/Approval/ApprovalFlowTimeline.tsx
import { useState } from 'react';
import type { WorkflowInstanceDetail } from '../../types';

interface Props {
  instance: WorkflowInstanceDetail | null;
  currentUserId: string;
  canReview: boolean;
  loading?: boolean;
  onReview?: (decision: 'approved' | 'rejected' | 'returned', comment: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待审批', approved: '已通过', rejected: '已驳回', skipped: '已跳过',
};

export default function ApprovalFlowTimeline({ instance, currentUserId, canReview, loading, onReview }: Props) {
  const [comment, setComment] = useState('');
  if (!instance) {
    return <div className="text-sm text-gray-500 py-3">该单据使用旧版审批，无流程实例。</div>;
  }
  const active = instance.status === 'active';
  const isCurrentApprover = active && (instance.steps[instance.current_step_index]?.approvers || [])
    .some((a) => a.user_id === currentUserId && a.status === 'pending');

  return (
    <div className="space-y-0">
      {instance.steps.map((s, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-3 h-3 rounded-full mt-1.5 ${i < instance.current_step_index || instance.status !== 'active' ? 'bg-green-500' : i === instance.current_step_index ? 'bg-blue-500' : 'bg-gray-300'}`} />
            {i < instance.steps.length - 1 && <div className="w-px flex-1 bg-gray-200" />}
          </div>
          <div className="pb-4 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{s.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.mode === 'all' ? '会签' : '或签'}</span>
            </div>
            <div className="mt-1 space-y-1">
              {(s.approvers || []).map((a, j) => (
                <div key={j} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-800">{a.user_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${a.status === 'approved' ? 'bg-green-50 text-green-600' : a.status === 'rejected' ? 'bg-red-50 text-red-600' : a.status === 'skipped' ? 'bg-gray-50 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                    {STATUS_LABEL[a.status] || a.status}
                  </span>
                  {a.comment && <span className="text-xs text-gray-500">“{a.comment}”</span>}
                </div>
              ))}
            </div>
            {isCurrentApprover && i === instance.current_step_index && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  placeholder="审批意见（可选）"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  className="px-3 py-1 rounded text-sm text-white bg-green-600"
                  disabled={loading || !canReview}
                  onClick={() => onReview?.('approved', comment)}
                >
                  通过
                </button>
                <button
                  className="px-3 py-1 rounded text-sm text-white bg-red-500"
                  disabled={loading || !canReview}
                  onClick={() => onReview?.('rejected', comment)}
                >
                  驳回
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/components/Approval/ApprovalFlowTimeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Approval/ApprovalFlowTimeline.tsx frontend/src/components/Approval/ApprovalFlowTimeline.test.ts
git commit -m "feat(frontend): 审批流程时间线组件 ApprovalFlowTimeline"
```

---

### Task 17: ECR/ECO 前端接入

**Files:**
- Modify: `frontend/src/components/ECR/ECRCreateModal.tsx`（移除必填审批人校验约 566 行附近；提交按钮改为弹出 ApprovalFlowPicker）
- Modify: `frontend/src/components/ECO/ECOCreateModal.tsx`（同上，约 465-480 行审批人区）
- Modify: `frontend/src/components/ECR/ECRDetailModal.tsx`（审批区替换为 ApprovalFlowTimeline，约 378-390 行）
- Modify: `frontend/src/components/ECO/ECODetailModal.tsx`（同上，约 233-237 行）
- Test: 无独立单测（依赖组件测试 + 手工验证）

**Interfaces:**
- Consumes: Task 14、15、16
- Produces: ECR/ECO 创建提交走审批流选择；详情显示流程时间线；旧数据（`detail.workflow == null`）回退旧审批面板

- [ ] **Step 1: ECRCreateModal 接入**

- 删除"审批人列表 + 审批模式"区块（`reviewers` state 与校验保留兼容旧编辑，但提交不再必填——删除约 566 行 `reviewers.some(...)` 校验分支；`reviewers`/`reviewMode` 字段提交时仍随 payload 发送，后端忽略）。
- 新增 state：`const [flowOpen, setFlowOpen] = useState(false);`
- 提交按钮 handler：由"直接 submit"改为"先 `setFlowOpen(true)`"，确认回调：

```tsx
const handleFlowConfirm = async (chosen: Record<number, string[]>) => {
  setFlowOpen(false);
  setActionLoading(true);
  try {
    await ecrApi.submit(id, { chosen_by_step: chosen });
    toast.success('已提交审批');
    onClose?.(); onSaved?.();
  } catch { toast.error('提交失败，请检查审批流配置'); }
  finally { setActionLoading(false); }
};
```

- 渲染 `<ApprovalFlowPicker entityType="ecr" open={flowOpen} onClose={() => setFlowOpen(false)} onConfirm={handleFlowConfirm} />`。

- [ ] **Step 2: ECOCreateModal 接入**

同 Step 1（`entityType="eco"`，`ecoApi.submit`）。注意 ECO 提交可能涉及工程预变更/冻结提示文案保留。

- [ ] **Step 3: ECRDetailModal 审批区替换**

约 378-390 行：`detail.workflow` 存在时渲染 `<ApprovalFlowTimeline instance={detail.workflow} currentUserId={user?.id || ''} canReview={detail.status === 'reviewing'} onReview={async (d, c) => { await ecrApi.review(detail.id, d, c); load(); }} loading={actionLoading} />`；`detail.workflow == null` 时保留原 `ECRReviewPanel`（旧数据兼容）。`ecrApi.review` 的 decision 传 'approved' | 'rejected'（timeline 不再发 'returned'）。

- [ ] **Step 4: ECODetailModal 审批区替换**

同 Step 3（`ecoApi.review`）。

- [ ] **Step 5: 构建与冒烟**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ECR/ frontend/src/components/ECO/
git commit -m "feat(frontend): ECR/ECO 接入审批流选择与时间线"
```

---

### Task 18: 库存前端接入

**Files:**
- Modify: `frontend/src/components/Inventory/DocumentEditModal.tsx`（提交按钮 → ApprovalFlowPicker，约 89-90 行 reviewers 提交处）
- Modify: `frontend/src/components/Inventory/DocumentDetail.tsx`（审批区替换为 ApprovalFlowTimeline，约 137-139 行）
- Test: 无独立单测

**Interfaces:**
- Consumes: Task 14、15、16
- Produces: 库存单据创建/编辑提交走审批流选择（`entityType="inventory_doc"`、`entitySubtype=doc.docType`）；详情显示流程时间线

- [ ] **Step 1: DocumentEditModal 接入**

- 移除 reviewers 必填依赖（保留字段提交兼容）；提交 handler 弹出 `<ApprovalFlowPicker entityType="inventory_doc" entitySubtype={docType} ... />`，确认回调 `inventoryApi.submit(id, { chosen_by_step: chosen })`。

- [ ] **Step 2: DocumentDetail 审批区替换**

`doc.workflow` 存在时渲染 `<ApprovalFlowTimeline ... onReview={async (d, c) => { await inventoryApi.review(doc.id, d, c); load(); }} />`；否则保留原审批信息区（`review_records` 展示）。

- [ ] **Step 3: 构建与冒烟**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Inventory/
git commit -m "feat(frontend): 库存单据接入审批流选择与时间线"
```

---

### Task 19: WorkflowTemplates 管理页

**Files:**
- Create: `frontend/src/pages/WorkflowTemplates.tsx`
- Modify: `frontend/src/App.tsx`（路由 `<Route path="workflow-templates" element={<WorkflowTemplates />} />`，约 163 行后）
- Modify: `frontend/src/components/Layout.tsx`（侧边栏管理菜单项，仅 admin 可见，按现有 `can('workflow:template:manage')` 模式）
- Modify: `frontend/src/services/api.ts`（追加模板管理方法）
- Test: 无独立单测（页面级，手工验证）

**Interfaces:**
- Consumes: Task 10（模板 API）
- Produces: 模板列表页 + 编辑弹窗（表单编辑步骤：名称/解析规则类型/参数/会签或签）

- [ ] **Step 1: api.ts 追加模板管理**

```ts
// workflowApi 内追加
export const workflowAdminApi = {
  list: () => api.get('/workflow/templates').then((r) => r.data),
  create: (payload: any) => api.post('/workflow/templates', payload).then((r) => r.data),
  update: (id: string, payload: any) => api.put(`/workflow/templates/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/workflow/templates/${id}`).then((r) => r.data),
};
```

- [ ] **Step 2: 创建页面**

`WorkflowTemplates.tsx` 实现：按 `entity_type` 分组列表（每行：code/name/类型/步骤数/启用开关）；"新建模板"按钮与编辑弹窗（表单字段：code、name、entity_type、entity_subtype、steps 动态行——每行 name + mode 下拉 + 规则行（type 下拉：manager_chain/role/group/user/initiator_choose + 参数输入：level 数字 / role 文本 / group_ids 多选文本 / user_ids 文本 / candidates roles 逗号分隔））；删除确认。

- [ ] **Step 3: 路由与导航**

App.tsx 加路由；Layout.tsx 管理分组加"审批流模板"入口（`can('workflow:template:manage')` 才显示）。

- [ ] **Step 4: 构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WorkflowTemplates.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx frontend/src/services/api.ts
git commit -m "feat(frontend): 审批流模板管理页"
```

---

### Task 20: 用户管理页直属上级选择器

**Files:**
- Modify: `frontend/src/pages/Users.tsx`（用户编辑表单追加"直属上级"选择器）
- Test: 无独立单测

**Interfaces:**
- Consumes: Task 2（users API manager_id）
- Produces: 管理员可为用户设置 `manager_id`（下拉列出全部在职用户，排除自己与下级循环——v1 仅排除自己）

- [ ] **Step 1: 用户编辑表单追加字段**

在 `Users.tsx` 的编辑弹窗用户表单中追加"直属上级"下拉（`usersApi` 列表数据，`value=manager_id`，`onChange` 写回表单 state），保存时随 `usersApi.update` payload 提交 `manager_id`。展示列可加"直属上级"列（按 id 映射用户名）。

- [ ] **Step 2: 构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Users.tsx
git commit -m "feat(frontend): 用户管理支持设置直属上级"
```

---

### Task 21: 通知分组适配与端到端验证

**Files:**
- Modify: `frontend/src/pages/Notifications.tsx` 与 `frontend/src/components/NotificationBell.tsx`（如按 event_type 分组，为 `workflow_pending` 增加归类：target_type ecr/eco → 变更，inventory_document → 库存）
- Verify: 全链路冒烟

**Interfaces:**
- Consumes: 全部
- Produces: 待审批通知在通知中心正确分组显示；点击直达详情页

- [ ] **Step 1: 检查通知分组逻辑**

读 `frontend/src/pages/Notifications.tsx` 与 `NotificationBell.tsx` 的 event_type 分组代码。若分组键为 event_type 白名单，追加 `workflow_pending` → 按 `target_type` 归入"变更/库存"；若分组基于 target_type，无需改动。通知点击跳转已由 target_type+target_id 驱动，确认 ecr/eco/inventory_document 的跳转路由存在（`/ec?tab=ecr&id=` 等现有模式）。

- [ ] **Step 2: 全链路冒烟（手工清单）**

1. admin 登录 → 用户管理为 engineer/production 设置直属上级链（emp→mgr→boss）。
2. 审批流模板页确认 7 条种子模板存在。
3. 以 engineer 建库存入库单 → 提交 → 弹出流程预览（主管=经理、经理=总经理）→ 确认提交 → 单据 reviewing。
4. 以 mgr 登录 → 通知中心出现待审批通知 → 详情页时间线 → 通过 → 单据仍 reviewing。
5. 以 boss 登录 → 通过 → 单据 approved。
6. 建 ECR → 提交 → 流程预览（校对/审核自选、批准=admin）→ admin 驳回 → ECR rejected → 发起人修改重提 → 新实例重走。
7. 旧数据回归：历史 reviewing 单据（迁移实例）在详情页时间线可正常审批。
8. 未配置模板的伪类型（如有）提交 → 400 提示。

- [ ] **Step 3: 后端全量回归**

Run: `cd backend && pytest -q`
Expected: 全绿

- [ ] **Step 4: 前端构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Notifications.tsx frontend/src/components/NotificationBell.tsx
git commit -m "feat(frontend): 审批待办通知分组适配"
```

---

## Self-Review 记录

- **Spec 覆盖**：组织链审批（Task 5/13/18）✓；角色流审批（Task 5/11/12/17）✓；模板+解析规则（Task 5/8/10/19）✓；可替换不可新增（Task 15 allow_replace 仅 initiator_choose）✓；驳回退回重提（Task 7/11/12/13 状态机扩展）✓；任务级鉴权（Task 7 act_by_entity 403）✓；种子模板与存量迁移（Task 9）✓；旧记录表保留只读（各任务不删表）✓；ECO 冻结/解冻钩子（Task 12）✓；库存过账保持原链路（Task 13 未动 post_document）✓；前端时间线/选择器/管理页/上级选择器（Task 15-20）✓；权限（Task 1）✓。
- **占位符检查**：Task 10 的实例查询鉴权说明与 Task 16/19 前端实现为"按现有模式"，但均给出具体文件行与实现要点；无 TBD。
- **类型一致性**：`chosen_by_step` 后端 `Dict[str, List[str]]` ↔ 前端 `Record<number, string[]>`（前端 `String(idx)` 序列化时由 axios JSON 自动转字符串 key）✓；`WorkflowStepView` 与后端 preview 结构一致 ✓；`act_by_entity` decision 集合与前端按钮一致（approved/rejected）✓。

## 已知限制（非目标）

- 移动端（`frontend/src/mobile/`）审批 UI 不改造；新单据在移动端显示审批模式/审批人字段为空（`reviewers` 不再写入），后续单独迭代。
- 统一"我的待办"聚合面板、退回指定节点、条件分支、加签/转办、模板多版本 → v2。
- `approval_tasks.approver_id` 与 `workflow_instances.initiator_id` 使用 FK（与现有表风格一致）；若后续用户硬删除需先处理引用。
