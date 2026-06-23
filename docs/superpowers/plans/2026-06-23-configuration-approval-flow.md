# 构型配置审批流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为构型配置（`configuration_profiles`）增加参照 ECO 的多人会签/或签审批流，通过即自动生效，含知会(CC)、审批记录与状态日志。

**Architecture:** 镜像现有 ECO 实现（`models_eco.py` / `crud_eco.py` / `routers/ecos.py`）。后端新增 2 张表（审批记录、状态日志）+ `configuration_profiles` 6 个新列，状态机扩展为 `draft→reviewing→active/rejected→archived`。前端在 `ProfileEditModal` 加审批人/审批模式/知会，新增审批面板与状态徽章，列表操作按状态渲染。

**Tech Stack:** 后端 FastAPI + SQLAlchemy + Pydantic v2，pytest（SQLite 内存库，fixtures：`db` / `engineer_user` / `admin_user` / `guest_user`）。前端 React + TypeScript + Vite + Tailwind。

**参考 spec:** `项目说明/构型配置审批流设计方案.md`

---

## 文件结构

| 文件 | 责任 |
|------|------|
| `backend/app/models_configuration.py` | 加 `ConfigurationReviewRecord` / `ConfigurationStatusLog` 模型 + Profile 6 新列 |
| `backend/app/schemas_configuration.py` | 评审/知会请求 schema + Create/Update/Response 扩展 |
| `backend/app/crud_configuration.py` | 状态机逻辑（submit/withdraw/review/reopen/archive）、会签或签判定、日志写入、列表权限过滤 |
| `backend/app/routers/configuration.py` | 评审/知会/状态日志端点；废弃 activate；详情响应扩展；列表权限过滤接线 |
| `backend/app/main.py` | 自动迁移建表 + ADD COLUMN |
| `initdb/init.sql` | 同步 DDL |
| `backend/tests/test_configuration_approval.py` | 状态机 + 会签或签 + 权限过滤的单元测试 |
| `frontend/src/types/index.ts` | Profile 类型扩展 |
| `frontend/src/services/api.ts` | configurationProfileApi 评审/知会函数 |
| `frontend/src/components/Configuration/ProfileStatusBadge.tsx` | 状态徽章（新增） |
| `frontend/src/components/Configuration/ProfileReviewPanel.tsx` | 审批面板（新增） |
| `frontend/src/components/Configuration/ProfileEditModal.tsx` | 审批人/模式/知会区块 |
| `frontend/src/components/Configuration/ProfileList.tsx` | 状态化操作按钮 + 筛选 |

---

## 约定（先读）

- **fixtures**：`backend/tests/conftest.py` 提供 `db`（SQLite 内存 Session）、`engineer_user`、`admin_user`、`guest_user`、`production_user`。用户有 `.id`、`.role`、`.real_name`。
- **运行测试**：在 `backend/` 目录下 `python -m pytest tests/test_configuration_approval.py -v`。
- **现有 crud 别名**：`from app import crud` 指向 `crud_configuration`（见现有 router `import ... as crud`）。本计划新函数直接加在 `crud_configuration.py`。
- **decision 取值**：`approved` / `rejected` / `returned`（与 ECO 一致）。
- **reviewers JSON 结构**：`[{"user_id": str, "user_name": str, "role": str, "seq": int}]`。
- **cc_users JSON 结构**：`[{"user_id": str, "user_name": str}]`。

---

## Task 1: 数据模型 — 新增 2 表 + Profile 新列

**Files:**
- Modify: `backend/app/models_configuration.py`

- [ ] **Step 1: 在 `ConfigurationProfile` 类追加 6 个新列**

在 `models_configuration.py` 的 `ConfigurationProfile` 类中，`updated_at` 行之后追加：

```python
    reviewers = Column(JSONB, nullable=False, default=[])
    review_mode = Column(String(8), nullable=False, default="all")  # all=会签 / any=或签
    cc_users = Column(JSONB, nullable=False, default=[])
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 2: 在文件末尾追加两张新表模型**

```python
class ConfigurationReviewRecord(Base):
    """构型配置审批记录表"""
    __tablename__ = "configuration_review_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    reviewer_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewer_name = Column(String(64), nullable=True)
    decision = Column(String(16), nullable=False)  # approved / rejected / returned
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ConfigurationStatusLog(Base):
    """构型配置状态变更日志表"""
    __tablename__ = "configuration_status_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id = Column(UUID(as_uuid=True), ForeignKey("configuration_profiles.id", ondelete="CASCADE"), nullable=False)
    from_status = Column(String(16), nullable=True)
    to_status = Column(String(16), nullable=False)
    operator_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    operator_name = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 3: 确认导入充分**

文件顶部已 `from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey, UniqueConstraint` 且 `from sqlalchemy.dialects.postgresql import UUID, JSONB`，无需新增 import。确认 `Text` 已在导入列表中（已在）。

- [ ] **Step 4: 快速冒烟 — 导入不报错**

Run: `cd backend && python -c "from app import models_configuration as m; print(m.ConfigurationReviewRecord.__tablename__, m.ConfigurationStatusLog.__tablename__)"`
Expected: 输出 `configuration_review_records configuration_status_logs`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models_configuration.py
git commit -m "feat(configuration): 审批流数据模型 - 审批记录/状态日志表 + Profile 评审字段"
```

---

## Task 2: Schemas — 评审/知会请求 + Create/Update/Response 扩展

**Files:**
- Modify: `backend/app/schemas_configuration.py`

- [ ] **Step 1: `ConfigurationProfileCreate` 增加评审字段**

把现有 `ConfigurationProfileCreate` 替换为：

```python
class ReviewerItem(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""
    role: Optional[str] = ""
    seq: int = 0


class CcUserItem(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""


class ConfigurationProfileCreate(BaseSchema):
    code: str
    name: str
    configuration_item_id: Optional[uuid.UUID] = None
    effectivity_start: Optional[str] = None
    effectivity_end: Optional[str] = None
    remark: Optional[str] = None
    reviewers: List[ReviewerItem] = []
    review_mode: str = "all"
    cc_users: List[CcUserItem] = []
```

- [ ] **Step 2: `ConfigurationProfileUpdate` 增加评审字段**

把现有 `ConfigurationProfileUpdate` 替换为：

```python
class ConfigurationProfileUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    configuration_item_id: Optional[uuid.UUID] = None
    effectivity_start: Optional[str] = None
    effectivity_end: Optional[str] = None
    remark: Optional[str] = None
    reviewers: Optional[List[ReviewerItem]] = None
    review_mode: Optional[str] = None
    cc_users: Optional[List[CcUserItem]] = None
```

- [ ] **Step 3: 追加评审操作 schema（文件末尾）**

```python
class ProfileReviewRequest(BaseSchema):
    decision: str  # approved / rejected / returned
    comment: Optional[str] = ""


class ProfileWithdrawRequest(BaseSchema):
    comment: Optional[str] = ""


class ProfileCcAddRequest(BaseSchema):
    user_id: str
    user_name: Optional[str] = ""
```

- [ ] **Step 4: 冒烟 — schema 导入与默认值**

Run: `cd backend && python -c "from app import schemas_configuration as s; print(s.ConfigurationProfileCreate(code='c',name='n').review_mode, s.ProfileReviewRequest(decision='approved').comment=='')"`
Expected: 输出 `all True`

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas_configuration.py
git commit -m "feat(configuration): 审批流 schema - 评审/知会请求 + Create/Update 评审字段"
```

---

## Task 3: CRUD — 状态机逻辑 + 会签或签 + 日志 + 权限过滤

**Files:**
- Modify: `backend/app/crud_configuration.py`
- Test: `backend/tests/test_configuration_approval.py`

> 本任务先写测试再实现。测试覆盖：提交（有/无审批人）、会签全通过、或签任一通过、驳回、退回清记录、撤回、列表权限过滤。

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/test_configuration_approval.py`：

```python
"""构型配置审批流：状态机 / 会签或签 / 列表权限过滤。"""
import uuid
import pytest
from fastapi import HTTPException

from app import models, crud_configuration as crud
from app.models_configuration import ConfigurationProfile, ConfigurationReviewRecord


def _profile(db, creator, status="draft", reviewers=None, review_mode="all", cc_users=None):
    p = ConfigurationProfile(
        id=uuid.uuid4(), code=f"CFG-{uuid.uuid4().hex[:6]}", name="cfg",
        status=status, creator_id=creator.id,
        reviewers=reviewers or [], review_mode=review_mode, cc_users=cc_users or [],
    )
    db.add(p); db.commit(); db.refresh(p)
    return p


def _rv(user, seq=0):
    return {"user_id": str(user.id), "user_name": user.real_name, "role": user.role, "seq": seq}


def test_submit_with_reviewers_goes_reviewing(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    db.refresh(p)
    assert p.status == "reviewing"
    assert p.submitted_at is not None


def test_submit_without_reviewers_auto_active(db, engineer_user):
    p = _profile(db, engineer_user, reviewers=[])
    crud.submit_profile(db, p, engineer_user)
    db.refresh(p)
    assert p.status == "active"


def test_review_all_mode_needs_everyone(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest_user)], review_mode="all")
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "approved", "ok")
    db.refresh(p); assert p.status == "reviewing"      # 还差一人
    crud.review_profile(db, p, guest_user, "approved", "ok")
    db.refresh(p); assert p.status == "active"          # 全通过 → 生效


def test_review_any_mode_one_approve(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest_user)], review_mode="any")
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "approved", "ok")
    db.refresh(p); assert p.status == "active"          # 或签任一通过 → 生效


def test_review_rejected(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "rejected", "不行")
    db.refresh(p); assert p.status == "rejected"


def test_returned_clears_records_and_back_to_draft(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "returned", "改一下")
    db.refresh(p); assert p.status == "draft"
    recs = db.query(ConfigurationReviewRecord).filter(
        ConfigurationReviewRecord.profile_id == p.id).count()
    assert recs == 0


def test_withdraw_clears_records(db, engineer_user, admin_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    crud.review_profile(db, p, admin_user, "approved", "ok")  # all 模式单人，仍 reviewing? admin是唯一审批人→active
    # 为测撤回，重建一个两审批人的
    p2 = _profile(db, engineer_user, reviewers=[_rv(admin_user), _rv(guest := engineer_user)])
    crud.submit_profile(db, p2, engineer_user)
    crud.withdraw_profile(db, p2, engineer_user)
    db.refresh(p2); assert p2.status == "draft"


def test_non_reviewer_cannot_review(db, engineer_user, admin_user, guest_user):
    p = _profile(db, engineer_user, reviewers=[_rv(admin_user)])
    crud.submit_profile(db, p, engineer_user)
    with pytest.raises(HTTPException) as ei:
        crud.review_profile(db, p, guest_user, "approved", "")
    assert ei.value.status_code == 403


def test_list_filter_hides_others_draft(db, engineer_user, guest_user):
    # engineer 的草稿，guest（非管理员、非相关人）看不到
    _profile(db, engineer_user, status="draft")
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 0


def test_list_filter_shows_active_to_everyone(db, engineer_user, guest_user):
    _profile(db, engineer_user, status="active")
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 1


def test_list_filter_shows_own_and_reviewer_and_cc(db, engineer_user, guest_user, admin_user):
    _profile(db, engineer_user, status="draft")                              # guest 不可见
    _profile(db, guest_user, status="draft")                                 # guest 自己创建，可见
    _profile(db, engineer_user, status="reviewing", reviewers=[_rv(guest_user)])  # guest 是审批人，可见
    _profile(db, engineer_user, status="draft", cc_users=[{"user_id": str(guest_user.id), "user_name": guest_user.real_name}])  # guest 被知会，可见
    items, total = crud.get_profiles_for_user(db, guest_user)
    assert total == 3


def test_admin_sees_all(db, engineer_user, admin_user):
    _profile(db, engineer_user, status="draft")
    _profile(db, engineer_user, status="reviewing")
    items, total = crud.get_profiles_for_user(db, admin_user)
    assert total == 2
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_configuration_approval.py -v`
Expected: FAIL — `AttributeError: module 'app.crud_configuration' has no attribute 'submit_profile'`

- [ ] **Step 3: 在 `crud_configuration.py` 顶部确认导入**

确认文件顶部含（缺则补）：

```python
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import or_, and_
```

并在导入 models 处确保可访问新模型：`from app import models_configuration as models`（沿用现有引用方式；本文件已用 `models.ConfigurationProfile`，新模型同 namespace 可用 `models.ConfigurationReviewRecord` / `models.ConfigurationStatusLog`）。

- [ ] **Step 4: 追加状态机辅助 + 审批函数（文件末尾）**

```python
# ════════════════════════════════════════════════════════
# 审批流（参照 ECO）
# ════════════════════════════════════════════════════════

_ALLOWED_PROFILE_TRANSITIONS = {
    "draft": {"reviewing", "active", "archived"},
    "reviewing": {"active", "rejected", "draft"},
    "active": {"archived"},
    "rejected": {"draft", "archived"},
    "archived": set(),
}


def _validate_profile_transition(current: str, target: str):
    if target not in _ALLOWED_PROFILE_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=400, detail=f"不允许从 {current} 转为 {target}")


def _add_profile_status_log(db, profile_id, from_status, to_status,
                            operator_id, operator_name, comment=""):
    db.add(models.ConfigurationStatusLog(
        profile_id=profile_id, from_status=from_status, to_status=to_status,
        operator_id=operator_id, operator_name=operator_name, comment=comment,
    ))


def _clear_profile_review_records(db, profile_id):
    db.query(models.ConfigurationReviewRecord).filter(
        models.ConfigurationReviewRecord.profile_id == profile_id
    ).delete()


def submit_profile(db, profile, user):
    """提交评审：有审批人→reviewing；无审批人→自动生效 active。"""
    reviewers = profile.reviewers or []
    _clear_profile_review_records(db, profile.id)
    if not reviewers:
        _validate_profile_transition(profile.status, "active")
        _add_profile_status_log(db, profile.id, profile.status, "active",
                                user.id, user.real_name, "无审批人自动生效")
        profile.status = "active"
        profile.submitted_at = datetime.now(timezone.utc)
        profile.reviewed_at = datetime.now(timezone.utc)
    else:
        _validate_profile_transition(profile.status, "reviewing")
        _add_profile_status_log(db, profile.id, profile.status, "reviewing",
                                user.id, user.real_name, "提交评审")
        profile.status = "reviewing"
        profile.submitted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)
    return profile


def withdraw_profile(db, profile, user, comment=""):
    """撤回评审：reviewing→draft，清空审批记录。"""
    _validate_profile_transition(profile.status, "draft")
    _clear_profile_review_records(db, profile.id)
    _add_profile_status_log(db, profile.id, profile.status, "draft",
                            user.id, user.real_name, comment or "撤回评审")
    profile.status = "draft"
    db.commit()
    db.refresh(profile)
    return profile


def reopen_profile(db, profile, user):
    """重新编辑：rejected→draft。"""
    _validate_profile_transition(profile.status, "draft")
    _clear_profile_review_records(db, profile.id)
    _add_profile_status_log(db, profile.id, profile.status, "draft",
                            user.id, user.real_name, "重新编辑")
    profile.status = "draft"
    db.commit()
    db.refresh(profile)
    return profile


def archive_profile(db, profile, user, comment=""):
    """归档：active/rejected→archived。"""
    _validate_profile_transition(profile.status, "archived")
    _add_profile_status_log(db, profile.id, profile.status, "archived",
                            user.id, user.real_name, comment or "归档")
    profile.status = "archived"
    profile.archived_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(profile)
    return profile


def review_profile(db, profile, reviewer, decision, comment=""):
    """审批操作：通过/驳回/退回。会签全通过或或签任一通过 → active。"""
    if profile.status != "reviewing":
        raise HTTPException(status_code=400, detail="配置不在评审中状态")

    is_admin = reviewer.role == "admin"
    is_reviewer = any(r.get("user_id") == str(reviewer.id) for r in (profile.reviewers or []))
    if not is_admin and not is_reviewer:
        raise HTTPException(status_code=403, detail="您不是该配置的指定审批人")

    db.add(models.ConfigurationReviewRecord(
        profile_id=profile.id, reviewer_id=reviewer.id,
        reviewer_name=reviewer.real_name, decision=decision, comment=comment,
    ))
    db.commit()

    if decision == "approved":
        if profile.review_mode == "all":
            all_ids = {r.get("user_id") for r in (profile.reviewers or [])}
            approved_ids = {
                str(r.reviewer_id) for r in db.query(models.ConfigurationReviewRecord).filter(
                    models.ConfigurationReviewRecord.profile_id == profile.id,
                    models.ConfigurationReviewRecord.decision == "approved",
                ).all()
            }
            if all_ids and all_ids.issubset(approved_ids):
                _add_profile_status_log(db, profile.id, profile.status, "active",
                                        reviewer.id, reviewer.real_name, "全部审批通过")
                profile.status = "active"
                profile.reviewed_at = datetime.now(timezone.utc)
        else:
            _add_profile_status_log(db, profile.id, profile.status, "active",
                                    reviewer.id, reviewer.real_name, "或签通过")
            profile.status = "active"
            profile.reviewed_at = datetime.now(timezone.utc)
    elif decision == "rejected":
        _add_profile_status_log(db, profile.id, profile.status, "rejected",
                                reviewer.id, reviewer.real_name, comment or "驳回")
        profile.status = "rejected"
        profile.reviewed_at = datetime.now(timezone.utc)
    elif decision == "returned":
        _add_profile_status_log(db, profile.id, profile.status, "draft",
                                reviewer.id, reviewer.real_name, comment or "退回修改")
        profile.status = "draft"
        _clear_profile_review_records(db, profile.id)
    else:
        raise HTTPException(status_code=400, detail="无效审批决定")

    db.commit()
    db.refresh(profile)
    return profile


def get_review_records(db, profile_id):
    return db.query(models.ConfigurationReviewRecord).filter(
        models.ConfigurationReviewRecord.profile_id == profile_id
    ).order_by(models.ConfigurationReviewRecord.created_at).all()


def get_status_logs(db, profile_id):
    return db.query(models.ConfigurationStatusLog).filter(
        models.ConfigurationStatusLog.profile_id == profile_id
    ).order_by(models.ConfigurationStatusLog.created_at).all()


def add_profile_cc(db, profile, user_id, user_name):
    cc = list(profile.cc_users or [])
    if not any(c.get("user_id") == user_id for c in cc):
        cc.append({"user_id": user_id, "user_name": user_name})
        profile.cc_users = cc
        db.commit()
        db.refresh(profile)
    return profile


def remove_profile_cc(db, profile, user_id):
    profile.cc_users = [c for c in (profile.cc_users or []) if c.get("user_id") != user_id]
    db.commit()
    db.refresh(profile)
    return profile
```

- [ ] **Step 5: 追加权限过滤列表函数（文件末尾）**

```python
def get_profiles_for_user(db, user, search=None, status=None, skip=0, limit=20):
    """列表 + 权限过滤：
    - 管理员：全部
    - 非管理员：active/archived 全可见 + draft/reviewing/rejected 中 自己创建/审批人/知会 的
    """
    q = db.query(models.ConfigurationProfile)
    if status:
        q = q.filter(models.ConfigurationProfile.status == status)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            models.ConfigurationProfile.code.ilike(like),
            models.ConfigurationProfile.name.ilike(like),
        ))
    if user.role != "admin":
        uid = str(user.id)
        # SQLite/PG 通用：JSONB 包含判断用 Python 侧过滤更稳妥（数据量有限）
        all_rows = q.order_by(models.ConfigurationProfile.code).all()
        def visible(p):
            if p.status in ("active", "archived"):
                return True
            if str(p.creator_id) == uid:
                return True
            if any(r.get("user_id") == uid for r in (p.reviewers or [])):
                return True
            if any(c.get("user_id") == uid for c in (p.cc_users or [])):
                return True
            return False
        rows = [p for p in all_rows if visible(p)]
        total = len(rows)
        return rows[skip:skip + limit], total
    total = q.count()
    items = q.order_by(models.ConfigurationProfile.code).offset(skip).limit(limit).all()
    return items, total
```

> 说明：JSONB 数组在 SQLite 与 PG 上的包含查询写法不同，为保证测试（SQLite）与生产（PG）一致，非管理员分支采用 Python 侧过滤。构型配置数据量有限，性能可接受。

- [ ] **Step 6: 让 create/update 持久化评审字段**

修改 `create_profile`（在 `db.add(profile)` 前的构造里追加），把构造改为：

```python
def create_profile(
    db: Session, data: schemas.ConfigurationProfileCreate, creator_id: str,
) -> models.ConfigurationProfile:
    profile = models.ConfigurationProfile(
        code=data.code, name=data.name,
        configuration_item_id=data.configuration_item_id,
        effectivity_start=data.effectivity_start,
        effectivity_end=data.effectivity_end,
        remark=data.remark,
        creator_id=creator_id,
        reviewers=[r.model_dump() for r in (data.reviewers or [])],
        review_mode=data.review_mode or "all",
        cc_users=[c.model_dump() for c in (data.cc_users or [])],
    )
    db.add(profile)
    db.flush()

    if data.configuration_item_id:
        _generate_checklist(db, str(profile.id), str(data.configuration_item_id))
        db.flush()
        sync_working_to_formal(db, str(profile.id))

    db.commit()
    db.refresh(profile)
    return profile
```

在 `update_profile` 的“更新其他字段”段落前，加入评审字段处理。把现有：

```python
    # 更新其他字段
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("configuration_item_id", None)
    for k, v in update_data.items():
        setattr(profile, k, v)
```

替换为：

```python
    # 更新其他字段
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("configuration_item_id", None)
    # 评审字段为对象列表，需转 dict 后存 JSONB
    if "reviewers" in update_data and update_data["reviewers"] is not None:
        update_data["reviewers"] = [r if isinstance(r, dict) else r for r in update_data["reviewers"]]
    if "cc_users" in update_data and update_data["cc_users"] is not None:
        update_data["cc_users"] = [c if isinstance(c, dict) else c for c in update_data["cc_users"]]
    for k, v in update_data.items():
        if v is None and k in ("reviewers", "cc_users", "review_mode"):
            continue
        setattr(profile, k, v)
```

> `model_dump(exclude_unset=True)` 会把 `ReviewerItem` 列表转成 dict 列表，故直接 setattr 即可写 JSONB。

- [ ] **Step 7: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_configuration_approval.py -v`
Expected: PASS（全部用例绿）

- [ ] **Step 8: 回归 — 不破坏既有构型测试**

Run: `cd backend && python -m pytest tests/ -q -k "configuration or profile"`
Expected: 无新增失败（若无既有构型测试则仅本文件通过）

- [ ] **Step 9: Commit**

```bash
git add backend/app/crud_configuration.py backend/tests/test_configuration_approval.py
git commit -m "feat(configuration): 审批流 CRUD - 提交/撤回/审批/退回/归档 + 会签或签 + 权限过滤"
```

---

## Task 4: Router — 评审/知会/状态日志端点 + 废弃 activate + 列表/详情接线

**Files:**
- Modify: `backend/app/routers/configuration.py`

- [ ] **Step 1: 列表端点改用权限过滤**

把 `list_profiles` 内的：

```python
    profiles, total = crud.get_profiles(db, search=search, status=status, skip=skip, limit=page_size)
```

替换为：

```python
    profiles, total = crud.get_profiles_for_user(db, current_user, search=search, status=status, skip=skip, limit=page_size)
```

并在返回 item dict 中追加 `"review_mode"` 与状态时间（可选展示）：在 `"updated_at": ...` 行后加：

```python
            "review_mode": p.review_mode,
            "reviewer_count": len(p.reviewers or []),
```

- [ ] **Step 2: 详情端点返回评审信息**

在 `get_profile` 的返回 dict 中，`"formal_items": ...` 行后追加：

```python
        "reviewers": profile.reviewers or [],
        "review_mode": profile.review_mode,
        "cc_users": profile.cc_users or [],
        "review_records": [{
            "id": str(r.id), "reviewer_id": str(r.reviewer_id),
            "reviewer_name": r.reviewer_name, "decision": r.decision,
            "comment": r.comment or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in crud.get_review_records(db, profile_id)],
        "status_logs": [{
            "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
            "operator_name": l.operator_name, "comment": l.comment or "",
            "created_at": l.created_at.isoformat() if l.created_at else None,
        } for l in crud.get_status_logs(db, profile_id)],
        "submitted_at": profile.submitted_at.isoformat() if profile.submitted_at else None,
        "reviewed_at": profile.reviewed_at.isoformat() if profile.reviewed_at else None,
        "archived_at": profile.archived_at.isoformat() if profile.archived_at else None,
```

- [ ] **Step 3: 删除/废弃 `activate` 端点，替换为评审流端点**

把现有 `activate_profile` 整个函数（`@router.post("/profiles/{profile_id}/activate")` 块）替换为以下端点集合：

```python
@router.post("/profiles/{profile_id}/submit")
async def submit_profile_review(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """提交评审（draft→reviewing；无审批人→active）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可提交评审")
    profile = crud.submit_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/withdraw")
async def withdraw_profile_review(
    profile_id: str,
    data: schemas.ProfileWithdrawRequest = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """撤回评审（reviewing→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅评审中状态可撤回")
    profile = crud.withdraw_profile(db, profile, current_user, (data.comment if data else "") or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/review")
async def review_profile_endpoint(
    profile_id: str,
    data: schemas.ProfileReviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """审批操作（通过/驳回/退回）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.decision not in ("approved", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="无效审批决定")
    profile = crud.review_profile(db, profile, current_user, data.decision, data.comment or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/reopen")
async def reopen_profile_endpoint(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:update")),
):
    """重新编辑（rejected→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "rejected":
        raise HTTPException(status_code=400, detail="仅已驳回状态可重新编辑")
    profile = crud.reopen_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}
```

> 审批端点用 `profile:read` 权限把关到“登录用户”，真正的“是否指定审批人”由 `crud.review_profile` 内部 403 校验。

- [ ] **Step 4: 收口 `PUT /status` 为 admin 兜底并写日志**

把 `update_profile_status` 内：

```python
    if data.status not in ("draft", "active", "archived"):
        raise HTTPException(status_code=400, detail="无效状态")
    crud.change_profile_status(db, profile_id, data.status)
    return {"detail": "ok", "status": data.status}
```

替换为：

```python
    if data.status not in ("draft", "reviewing", "active", "rejected", "archived"):
        raise HTTPException(status_code=400, detail="无效状态")
    old = profile.status
    crud._add_profile_status_log(db, profile.id, old, data.status,
                                 current_user.id, current_user.real_name, "管理员强制变更")
    crud.change_profile_status(db, profile_id, data.status)
    return {"detail": "ok", "status": data.status}
```

> `change_profile_status` 内部已 `db.commit()`，状态日志在其 commit 中一并持久化（同一 session）。

- [ ] **Step 5: 改造 `archive` 端点用新 crud（允许 active/rejected）**

把 `archive_profile` 内：

```python
    if profile.status != "active":
        raise HTTPException(status_code=400, detail="仅生效状态可归档")
    crud.change_profile_status(db, profile_id, "archived")
    return {"detail": "ok", "status": "archived"}
```

替换为：

```python
    if profile.status not in ("active", "rejected"):
        raise HTTPException(status_code=400, detail="仅生效或已驳回状态可归档")
    profile = crud.archive_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}
```

- [ ] **Step 6: 新增状态日志与知会端点（在 archive 端点之后插入）**

```python
@router.get("/profiles/{profile_id}/status-logs", response_model=dict)
async def get_profile_status_logs(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    return {"items": [{
        "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
        "operator_name": l.operator_name, "comment": l.comment or "",
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in crud.get_status_logs(db, profile_id)]}


@router.post("/profiles/{profile_id}/cc")
async def add_profile_cc_endpoint(
    profile_id: str,
    data: schemas.ProfileCcAddRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.add_profile_cc(db, profile, data.user_id, data.user_name or "")
    return {"detail": "ok", "cc_users": profile.cc_users}


@router.delete("/profiles/{profile_id}/cc/{user_id}")
async def remove_profile_cc_endpoint(
    profile_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.remove_profile_cc(db, profile, user_id)
    return {"detail": "ok", "cc_users": profile.cc_users}
```

- [ ] **Step 7: 冒烟 — 路由可加载**

Run: `cd backend && python -c "from app.routers import configuration; print([r.path for r in configuration.router.routes if 'profiles/{profile_id}' in r.path])"`
Expected: 输出含 `/profiles/{profile_id}/submit`、`/review`、`/withdraw`、`/reopen`、`/status-logs`、`/cc` 等路径，且 **不含** `/activate`

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/configuration.py
git commit -m "feat(configuration): 审批流路由 - submit/withdraw/review/reopen/cc/status-logs + 废弃 activate + 列表权限过滤"
```

---

## Task 5: 自动迁移 + init.sql

**Files:**
- Modify: `backend/app/main.py`
- Modify: `initdb/init.sql`

- [ ] **Step 1: 定位现有构型自动迁移代码**

Run: `cd backend && grep -n "configuration_working_items\|configuration_profiles" app/main.py`
Expected: 找到现有 `CREATE TABLE IF NOT EXISTS configuration_working_items` 或 `ADD COLUMN` 的自动迁移块位置。

- [ ] **Step 2: 在该迁移块旁追加新表 + 新列（PostgreSQL 语法）**

在现有构型迁移 SQL 执行处追加以下语句（沿用现有 `db.execute(text(...))` 风格）：

```sql
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS reviewers JSONB NOT NULL DEFAULT '[]';
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS review_mode VARCHAR(8) NOT NULL DEFAULT 'all';
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS cc_users JSONB NOT NULL DEFAULT '[]';
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS configuration_review_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    reviewer_name VARCHAR(64),
    decision VARCHAR(16) NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS configuration_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    from_status VARCHAR(16),
    to_status VARCHAR(16) NOT NULL,
    operator_id UUID NOT NULL REFERENCES users(id),
    operator_name VARCHAR(64),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

> 若现有迁移用逐条 `text()` 执行，则每条 SQL 单独 `db.execute(text("..."))`。沿用现有写法即可。

- [ ] **Step 3: 在 `initdb/init.sql` 同步补 DDL**

在 `initdb/init.sql` 中 `configuration_profiles` 表定义处补上 6 个新列（若为全量 CREATE TABLE 定义），并在文件末尾追加上面两张表的 `CREATE TABLE`。保持与 main.py 一致。

- [ ] **Step 4: 冒烟 — main 可导入**

Run: `cd backend && python -c "import app.main"`
Expected: 无异常（迁移 SQL 仅在启动连接 DB 时执行，导入不报错）

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py initdb/init.sql
git commit -m "chore(configuration): 审批流自动迁移 - 新增审批记录/状态日志表 + Profile 评审列"
```

---

## Task 6: 前端类型定义

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: 找到现有 Profile 相关类型**

Run: `cd frontend && grep -n "ConfigurationProfile\|ProfileItem\|formal_items" src/types/index.ts`
Expected: 定位现有 Profile 详情/列表类型。

- [ ] **Step 2: 追加/扩展类型**

在 types/index.ts 追加（若已有 `ConfigurationProfile` 接口则在其中补字段）：

```typescript
export interface ProfileReviewer {
  user_id: string;
  user_name?: string;
  role?: string;
  seq?: number;
}

export interface ProfileCcUser {
  user_id: string;
  user_name?: string;
}

export interface ProfileReviewRecord {
  id: string;
  reviewer_id: string;
  reviewer_name?: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  created_at?: string;
}

export interface ProfileStatusLog {
  id: string;
  from_status?: string;
  to_status: string;
  operator_name?: string;
  comment?: string;
  created_at?: string;
}

export type ProfileStatus = 'draft' | 'reviewing' | 'active' | 'rejected' | 'archived';
```

在现有 `ConfigurationProfile`（详情）接口中追加可选字段：

```typescript
  reviewers?: ProfileReviewer[];
  review_mode?: 'all' | 'any';
  cc_users?: ProfileCcUser[];
  review_records?: ProfileReviewRecord[];
  status_logs?: ProfileStatusLog[];
  submitted_at?: string | null;
  reviewed_at?: string | null;
  archived_at?: string | null;
```

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(configuration): 前端审批流类型定义"
```

---

## Task 7: 前端 API 服务

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: 找到 configurationProfileApi**

Run: `cd frontend && grep -n "configurationProfileApi\|profiles/" src/services/api.ts`
Expected: 定位现有 profile API 对象（含 activate/archive/status 等）。

- [ ] **Step 2: 移除 activate 调用、新增评审/知会函数**

删除 `activate` 方法（若存在），在 `configurationProfileApi` 对象内追加：

```typescript
  submit: (id: string) =>
    api.post(`/configurations/profiles/${id}/submit`).then(r => r.data),
  withdraw: (id: string, comment = '') =>
    api.post(`/configurations/profiles/${id}/withdraw`, { comment }).then(r => r.data),
  review: (id: string, decision: 'approved' | 'rejected' | 'returned', comment = '') =>
    api.post(`/configurations/profiles/${id}/review`, { decision, comment }).then(r => r.data),
  reopen: (id: string) =>
    api.post(`/configurations/profiles/${id}/reopen`).then(r => r.data),
  archive: (id: string) =>
    api.post(`/configurations/profiles/${id}/archive`).then(r => r.data),
  statusLogs: (id: string) =>
    api.get(`/configurations/profiles/${id}/status-logs`).then(r => r.data),
  addCc: (id: string, user_id: string, user_name = '') =>
    api.post(`/configurations/profiles/${id}/cc`, { user_id, user_name }).then(r => r.data),
  removeCc: (id: string, userId: string) =>
    api.delete(`/configurations/profiles/${id}/cc/${userId}`).then(r => r.data),
```

> 若现有 `archive` 已存在则保留（指向同端点），不要重复定义同名键。

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(configuration): 前端审批流 API - submit/withdraw/review/reopen/cc/statusLogs"
```

---

## Task 8: 状态徽章组件

**Files:**
- Create: `frontend/src/components/Configuration/ProfileStatusBadge.tsx`

- [ ] **Step 1: 参照 ECOStatusBadge 配色写组件**

Run: `cd frontend && sed -n '1,40p' src/components/ECO/ECOStatusBadge.tsx`（了解配色与 className 写法）

- [ ] **Step 2: 创建组件**

```tsx
import React from 'react';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft:     { label: '草稿',   cls: 'bg-gray-100 text-gray-600' },
  reviewing: { label: '评审中', cls: 'bg-orange-100 text-orange-700' },
  active:    { label: '生效中', cls: 'bg-green-100 text-green-700' },
  rejected:  { label: '已驳回', cls: 'bg-red-100 text-red-700' },
  archived:  { label: '已归档', cls: 'bg-slate-200 text-slate-600' },
};

export default function ProfileStatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
```

> 配色 class 请与项目实际 Tailwind 主题对齐（参照 ECOStatusBadge 用的是 primary-* 还是原生色；若项目统一用 primary-*，把 green/orange 等替换为对应语义色）。

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Configuration/ProfileStatusBadge.tsx
git commit -m "feat(configuration): 构型配置状态徽章组件"
```

---

## Task 9: ProfileEditModal — 审批人 / 审批模式 / 知会区块

**Files:**
- Modify: `frontend/src/components/Configuration/ProfileEditModal.tsx`

- [ ] **Step 1: 阅读现有 Modal 结构与 ECO 审批人选择写法**

Run: `cd frontend && sed -n '1,60p' src/components/Configuration/ProfileEditModal.tsx`
Run: `cd frontend && grep -n "reviewers\|review_mode\|ReviewerPicker\|usersApi\|CcPicker" src/components/ECO/ECOCreateModal.tsx`
Expected: 了解 ECO 如何选审批人（多选用户）、审批模式单选、知会选择器（`ECOCcPicker`）。

- [ ] **Step 2: 在 ProfileEditModal 表单 state 增加字段**

在组件 state 初始化处增加（与现有 form state 风格一致）：

```tsx
const [reviewers, setReviewers] = useState<ProfileReviewer[]>(profile?.reviewers || []);
const [reviewMode, setReviewMode] = useState<'all' | 'any'>(profile?.review_mode || 'all');
const [ccUsers, setCcUsers] = useState<ProfileCcUser[]>(profile?.cc_users || []);
```

- [ ] **Step 3: 在基本信息表单下方（仅 draft / 新建态）渲染区块**

```tsx
{(!profile || profile.status === 'draft') && (
  <div className="space-y-3 border-t pt-3 mt-3">
    <div>
      <label className="block text-sm font-medium mb-1">审批模式</label>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={reviewMode === 'all'} onChange={() => setReviewMode('all')} />
          会签（全部通过）
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={reviewMode === 'any'} onChange={() => setReviewMode('any')} />
          或签（任一通过）
        </label>
      </div>
    </div>
    {/* 审批人选择：复用 ECO 的用户选择器模式。这里用一个用户多选弹窗组件 */}
    <ReviewerSelector value={reviewers} onChange={setReviewers} />
    {/* 知会人：复用 ECOCcPicker 或抽公共组件 */}
    <CcSelector value={ccUsers} onChange={setCcUsers} />
  </div>
)}
```

> `ReviewerSelector` / `CcSelector`：直接复用 `ECOCcPicker` 的实现，或将其抽为 `components/common/UserMultiPicker.tsx`。**最简做法**：import 现有 `ECOCcPicker`（它本质是用户多选），用两个实例分别绑定 reviewers / ccUsers，reviewers 实例额外维护 seq（按选择顺序赋值 index）。

- [ ] **Step 4: 提交时把字段并入 create/update payload**

在 handleSubmit 构造 payload 处追加：

```tsx
  reviewers: reviewers.map((r, i) => ({ ...r, seq: i })),
  review_mode: reviewMode,
  cc_users: ccUsers,
```

- [ ] **Step 5: 把原“管理员单选框直接切状态”常规入口移除**

Run: `cd frontend && grep -n "status\|active\|archived\|单选" src/components/Configuration/ProfileEditModal.tsx`
找到状态单选切换 UI（设计文档 §6.1 所述「状态管理（单选框，仅管理员+编辑模式）」），将其删除（状态改由列表的评审操作按钮驱动）。

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Configuration/ProfileEditModal.tsx
git commit -m "feat(configuration): 编辑弹窗增加审批人/审批模式/知会，移除直接切状态"
```

---

## Task 10: 审批面板 + 详情区（审批记录 / 状态日志 / 知会）

**Files:**
- Create: `frontend/src/components/Configuration/ProfileReviewPanel.tsx`
- Modify: `frontend/src/components/Configuration/ProfileEditModal.tsx`（或详情视图所在文件）

- [ ] **Step 1: 参照 ECOReviewPanel 写审批面板**

Run: `cd frontend && sed -n '1,80p' src/components/ECO/ECOReviewPanel.tsx`
了解：当前用户是否在 reviewers、通过/驳回/退回按钮、comment 输入、调用回调。

- [ ] **Step 2: 创建 ProfileReviewPanel**

```tsx
import React, { useState } from 'react';
import { ProfileReviewer, ProfileReviewRecord } from '../../types';

interface Props {
  reviewers: ProfileReviewer[];
  records: ProfileReviewRecord[];
  reviewMode?: 'all' | 'any';
  canReview: boolean;            // 当前用户是审批人或 admin，且状态 reviewing
  onReview: (decision: 'approved' | 'rejected' | 'returned', comment: string) => void;
}

export default function ProfileReviewPanel({ reviewers, records, reviewMode, canReview, onReview }: Props) {
  const [comment, setComment] = useState('');
  const decided = (uid: string) => records.find(r => r.reviewer_id === uid);
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-500">
        审批模式：{reviewMode === 'any' ? '或签（任一通过）' : '会签（全部通过）'}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500">
          <th className="py-1">审批人</th><th>结果</th><th>意见</th><th>时间</th>
        </tr></thead>
        <tbody>
          {reviewers.map(rv => {
            const d = decided(rv.user_id);
            return (
              <tr key={rv.user_id} className="border-t">
                <td className="py-1">{rv.user_name}</td>
                <td>{d ? ({ approved: '通过', rejected: '驳回', returned: '退回' } as any)[d.decision] : '待审'}</td>
                <td>{d?.comment || '-'}</td>
                <td>{d?.created_at ? new Date(d.created_at).toLocaleString() : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canReview && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <textarea className="border rounded px-2 py-1 text-sm" rows={2}
            placeholder="审批意见（可选）" value={comment}
            onChange={e => setComment(e.target.value)} />
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded bg-green-600 text-white text-sm"
              onClick={() => onReview('approved', comment)}>通过</button>
            <button className="px-3 py-1 rounded bg-red-600 text-white text-sm"
              onClick={() => onReview('rejected', comment)}>驳回</button>
            <button className="px-3 py-1 rounded bg-gray-500 text-white text-sm"
              onClick={() => onReview('returned', comment)}>退回</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

> 按钮配色对齐项目主题（若用 primary-*，替换 green/red/gray）。

- [ ] **Step 3: 在配置详情视图中接入审批面板与状态日志**

在 ProfileEditModal（查看态）或详情区域追加：

```tsx
{profile && profile.status !== 'draft' && (
  <div className="border-t pt-3 mt-3 space-y-4">
    <ProfileReviewPanel
      reviewers={profile.reviewers || []}
      records={profile.review_records || []}
      reviewMode={profile.review_mode}
      canReview={profile.status === 'reviewing' &&
        ((profile.reviewers || []).some(r => r.user_id === currentUserId) || isAdmin)}
      onReview={async (decision, comment) => {
        await configurationProfileApi.review(profile.id, decision, comment);
        await reload();   // 复用现有详情刷新函数
      }}
    />
    <div>
      <div className="text-sm font-medium mb-1">状态日志</div>
      <ul className="text-xs text-gray-500 space-y-1">
        {(profile.status_logs || []).map(l => (
          <li key={l.id}>
            {l.created_at ? new Date(l.created_at).toLocaleString() : ''} ·
            {l.from_status || '—'} → {l.to_status} · {l.operator_name} · {l.comment}
          </li>
        ))}
      </ul>
    </div>
  </div>
)}
```

> `currentUserId` / `isAdmin` / `reload` 取自现有上下文（项目通常有 auth store 或 props）。若无现成，用现有获取当前用户的方式（参照 ECODetailModal 如何取当前用户与 admin 判断）。

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 构建成功

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Configuration/ProfileReviewPanel.tsx frontend/src/components/Configuration/ProfileEditModal.tsx
git commit -m "feat(configuration): 审批面板 + 详情区审批记录/状态日志"
```

---

## Task 11: ProfileList — 状态化操作按钮 + 状态徽章 + 筛选

**Files:**
- Modify: `frontend/src/components/Configuration/ProfileList.tsx`

- [ ] **Step 1: 阅读现有列表操作列与状态展示**

Run: `cd frontend && grep -n "status\|activate\|archive\|操作\|StatusBadge\|筛选\|filter" src/components/Configuration/ProfileList.tsx`
Expected: 定位操作列渲染、状态筛选下拉、当前对 activate/archive 的调用。

- [ ] **Step 2: 状态展示替换为 ProfileStatusBadge**

把列表里直接渲染 `p.status` 文本处替换为 `<ProfileStatusBadge status={p.status} />`（顶部 import）。

- [ ] **Step 3: 操作列按状态渲染按钮**

把操作列替换为：

```tsx
{p.status === 'draft' && (
  <>
    <button onClick={() => onEdit(p)}>编辑</button>
    <button onClick={() => handleSubmit(p)}>提交评审</button>
  </>
)}
{p.status === 'reviewing' && (
  <>
    <button onClick={() => onView(p)}>审批</button>
    <button onClick={() => handleWithdraw(p)}>撤回</button>
  </>
)}
{p.status === 'active' && isAdmin && (
  <button onClick={() => handleArchive(p)}>归档</button>
)}
{p.status === 'rejected' && (
  <>
    <button onClick={() => handleReopen(p)}>重新编辑</button>
    {isAdmin && <button onClick={() => handleArchive(p)}>归档</button>}
  </>
)}
{isAdmin && <button onClick={() => handleDelete(p)}>删除</button>}
```

> `onEdit` / `onView` 复用现有打开弹窗回调；按钮 className 沿用列表现有按钮风格。

- [ ] **Step 4: 实现操作 handler**

```tsx
const handleSubmit = async (p) => { await configurationProfileApi.submit(p.id); await reload(); };
const handleWithdraw = async (p) => { await configurationProfileApi.withdraw(p.id); await reload(); };
const handleReopen = async (p) => { await configurationProfileApi.reopen(p.id); await reload(); };
const handleArchive = async (p) => {
  if (!confirm('确认归档该配置？')) return;
  await configurationProfileApi.archive(p.id); await reload();
};
```

> `reload` 复用现有列表刷新函数。

- [ ] **Step 5: 状态筛选下拉补 reviewing / rejected 选项**

把筛选下拉的 options 改为：`全部 / 草稿(draft) / 评审中(reviewing) / 生效中(active) / 已驳回(rejected) / 已归档(archived)`。

- [ ] **Step 6: 构建验证**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 构建成功

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Configuration/ProfileList.tsx
git commit -m "feat(configuration): 列表状态化操作按钮 + 状态徽章 + 评审筛选"
```

---

## Task 12: 全栈验证

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && python -m pytest tests/ -q`
Expected: 全绿（含新增 `test_configuration_approval.py`，无回归）

- [ ] **Step 2: 前端类型 + 构建**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 3: 手动联调清单（Docker 起栈后）**

参照 `项目说明/构型配置审批流设计方案.md` §5.3 矩阵逐项验证：
- draft 配置选审批人(会签) → 提交 → reviewing
- 审批人逐一通过 → 全通过 → active
- 或签：任一通过 → active
- 驳回 → rejected → 重新编辑 → draft
- 撤回 reviewing → draft（审批记录清空）
- 无审批人提交 → 直接 active
- 非相关人登录看不到他人 draft，但能看到 active
- 知会某用户后该用户可见

- [ ] **Step 4: 最终 commit（如有联调修正）**

```bash
git add -A
git commit -m "test(configuration): 审批流全栈验证修正"
```

---

## Self-Review 记录

- **Spec 覆盖**：状态机(Task1,3,4) / 会签或签(Task3) / 审批记录表(Task1) / 状态日志表(Task1) / 知会(Task3,4,7,9,10) / 列表权限过滤(Task3,4) / 废弃 activate(Task4,7) / 生效后锁定(沿用现有 `update_profile` 的 `status != "draft"` 拦截，Task4 未放开) / admin 兜底强切(Task4 Step4) — 全部有对应任务。
- **类型一致**：crud 函数名 `submit_profile/withdraw_profile/review_profile/reopen_profile/archive_profile/get_profiles_for_user/get_review_records/get_status_logs/add_profile_cc/remove_profile_cc` 在 Task3 定义、Task4 调用一致；前端 `configurationProfileApi.submit/withdraw/review/reopen/archive/statusLogs/addCc/removeCc` Task7 定义、Task9-11 调用一致。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码。
- **已知需现场对齐项**（非占位，依赖现有代码风格）：前端按钮/徽章 Tailwind 配色是否用 `primary-*`、`currentUserId`/`isAdmin`/`reload` 的现有获取方式、`ECOCcPicker` 能否直接复用为用户多选——均在对应 Step 用「参照 ECO 同名实现」给出做法。

---

*计划生成: 2026-06-23*
