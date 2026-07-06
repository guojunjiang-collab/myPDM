"""项目管理 - API Router"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app import crud_project, crud
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd, MemberRoleUpdate,
    TaskCreate, TaskEdit, TaskStatusUpdate, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd, DepCreate,
)
from ..permissions import require_permission, enforce_object_policy

router = APIRouter(prefix="/projects", tags=["项目管理"])

PROJECT_FIELD_LABELS = {
    "name": "项目名", "status": "状态", "planned_start": "计划开始",
    "planned_end": "计划结束", "description": "描述", "owner_id": "负责人",
}
TASK_FIELD_LABELS = {
    "name": "任务名", "status": "状态", "assignee_id": "负责人",
    "planned_start": "计划开始", "planned_end": "计划完成",
    "actual_start": "实际开始", "actual_end": "实际完成",
    "priority": "优先级", "description": "描述", "task_type": "类型",
}
ACTION_COLOR_MAP = {
    "创建项目": "green", "删除项目": "red", "更新项目": "gray",
    "添加成员": "purple", "移除成员": "orange",
    "创建任务": "green", "删除任务": "red", "更新任务": "gray",
    "任务状态变更": "blue",
}


def _require_member(db, project_id, user):
    if user.role != "admin" and not crud_project.is_member(db, project_id, user.id):
        raise HTTPException(status_code=403, detail="非项目成员")


def _project_manager_ids(db, project) -> set:
    """项目管理者集合 = owner + 角色为"经理"的成员。"""
    ids = {project.owner_id}
    for m in crud_project.list_members(db, project.id):
        if m.role_in_project == "经理":
            ids.add(m.user_id)
    return ids


def _enforce_manager(db, user, project):
    """项目级管理者门禁:admin / owner / 经理成员。"""
    enforce_object_policy("project_manager_or_admin", user, project,
                          manager_ids=_project_manager_ids(db, project))


def _is_manager(db, user, project) -> bool:
    return user.role == "admin" or user.id in _project_manager_ids(db, project)


# ──────────── 项目 ────────────
@router.get("")
async def list_projects(db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project:read"))):
    items = crud_project.list_projects(db, current_user)
    return {"items": [_project_brief(db, p) for p in items]}


@router.post("")
async def create_project(data: ProjectCreate, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:create")),
                         request: Request = None):
    p = crud_project.create_project(db, data, current_user.id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建项目", "project", str(p.id), f"名称:{p.name}", ip)
    return _project_detail(db, p)


@router.get("/my-tasks")
async def my_tasks(db: Session = Depends(get_db),
                   current_user: User = Depends(require_permission("project:read"))):
    """我的任务：指派给我且未完成的项目任务。只读。必须注册在 /{project_id} 之前。"""
    from app.crud_dashboard import get_my_tasks
    return {"items": get_my_tasks(db, current_user.id)}


@router.get("/{project_id}")
async def get_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project:read"))):
    p = crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return _project_detail(db, p)


@router.put("/{project_id}")
async def update_project(project_id: uuid.UUID, data: ProjectEdit, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:update")),
                         request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    changed = data.model_dump(exclude_unset=True, exclude_none=True)
    def _norm(v):
        if v == '' or v is None:
            return None
        return str(v)
    old_vals = {k: getattr(p, k, None) for k in changed}
    result = _project_detail(db, crud_project.update_project(db, p, data))
    ip = request.client.host if request and request.client else None
    parts = []
    for k, new_val in changed.items():
        old_val = old_vals[k]
        if _norm(old_val) != _norm(new_val):
            label = PROJECT_FIELD_LABELS.get(k, k)
            parts.append(f"{label}：{old_val or '-'}->{new_val or '-'}")
    detail = '; '.join(parts) if parts else None
    # 无实际字段变更（如甘特图同步项目日期时的空操作）不记日志，避免空详情记录
    if detail:
        crud.create_log(db, current_user.id, current_user.username, "更新项目", "project", str(project_id), detail, ip)
    return result


@router.delete("/{project_id}")
async def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:delete")),
                         request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除项目", "project", str(project_id), f"名称:{p.name}", ip)
    crud_project.delete_project(db, p)
    return {"detail": "已删除"}


# ──────────── 成员 ────────────
@router.get("/{project_id}/members")
async def list_members(project_id: uuid.UUID, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": [_member_dict(db, m) for m in crud_project.list_members(db, project_id)]}


@router.post("/{project_id}/members")
async def add_member(project_id: uuid.UUID, data: MemberAdd, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project.member:manage")),
                     request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    result = _member_dict(db, crud_project.add_member(db, project_id, data))
    ip = request.client.host if request and request.client else None
    added_user = crud.get_user(db, data.user_id)
    added_name = added_user.real_name or added_user.username if added_user else str(data.user_id)
    crud.create_log(db, current_user.id, current_user.username, "添加成员", "project", str(project_id), f"成员:{added_name}", ip)
    return result


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.member:manage")),
                        request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    if user_id == p.owner_id:
        raise HTTPException(status_code=400, detail="不能移除项目负责人")
    removed_user = crud.get_user(db, user_id)
    removed_name = removed_user.real_name or removed_user.username if removed_user else str(user_id)
    crud_project.remove_member(db, project_id, user_id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "移除成员", "project", str(project_id), f"成员:{removed_name}", ip)
    return {"detail": "已移除"}


@router.patch("/{project_id}/members/{user_id}")
async def update_member_role(project_id: uuid.UUID, user_id: uuid.UUID, data: MemberRoleUpdate,
                             db: Session = Depends(get_db),
                             current_user: User = Depends(require_permission("project.member:manage")),
                             request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    # owner 恒为管理者（经理），其成员角色不允许下调，避免出现"项目负责人却非经理"的歧义
    if user_id == p.owner_id and data.role_in_project != "经理":
        raise HTTPException(status_code=400, detail="项目负责人角色不可修改")
    m = crud_project.set_member_role(db, project_id, user_id, data.role_in_project)
    ip = request.client.host if request and request.client else None
    changed_user = crud.get_user(db, user_id)
    changed_name = changed_user.real_name or changed_user.username if changed_user else str(user_id)
    crud.create_log(db, current_user.id, current_user.username, "调整成员角色", "project", str(project_id),
                    f"成员:{changed_name} → {data.role_in_project}", ip)
    return _member_dict(db, m)


# ──────────── 任务 ────────────
@router.get("/{project_id}/tasks")
async def list_tasks(project_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": crud_project.get_task_tree(db, project_id)}


@router.post("/{project_id}/tasks")
async def create_task(project_id: uuid.UUID, data: TaskCreate, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:create")),
                      request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    t = crud_project.create_task(db, p, data)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建任务", "project_task", str(t.id), f"名称:{t.name}", ip)
    crud.create_log(db, current_user.id, current_user.username, "新增任务", "project", str(project_id), f"{t.code} {t.name}", ip)
    return _task_dict(db, t)


@router.put("/{project_id}/tasks/{task_id}")
async def update_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskEdit, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:update")),
                      request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    t = crud_project.get_active_task(db, task_id, project_id)
    changed = data.model_dump(exclude_unset=True, exclude_none=True)
    def _norm(v):
        if v == '' or v is None:
            return None
        return str(v)
    # 必须在 update_task 之前读旧值，update 后 SQLAlchemy 对象已被修改
    old_vals = {k: getattr(t, k, None) for k in changed}
    ip = request.client.host if request and request.client else None
    # 传入 actor：级联改期的后置任务由 auto_schedule 单独写操作记录
    actor = {"user_id": current_user.id, "username": current_user.username, "ip": ip}
    result = _task_dict(db, crud_project.update_task(db, t, data, actor=actor))
    parts = []
    for k, new_val in changed.items():
        old_val = old_vals[k]
        if _norm(old_val) != _norm(new_val):
            label = TASK_FIELD_LABELS.get(k, k)
            parts.append(f"{label}：{old_val or '-'}->{new_val or '-'}")
    detail = '; '.join(parts) if parts else None
    # 无实际字段变更不记日志，避免空详情记录
    if detail:
        crud.create_log(db, current_user.id, current_user.username, "更新任务", "project_task", str(task_id), detail, ip)
    return result


@router.patch("/{project_id}/tasks/{task_id}/status")
async def update_task_status(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskStatusUpdate,
                             db: Session = Depends(get_db),
                             current_user: User = Depends(require_permission("project.task:update_status")),
                             request: Request = None):
    p = crud_project.get_project(db, project_id)
    t = crud_project.get_active_task(db, task_id, project_id)
    is_mgr = _is_manager(db, current_user, p)
    if not is_mgr and t.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅项目经理或任务负责人可更新状态")
    if not is_mgr:
        _require_member(db, project_id, current_user)
    result = _task_dict(db, crud_project.update_task_status(db, t, data.status))
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "任务状态变更", "project_task", str(task_id), f"状态→{data.status}", ip)
    return result


@router.get("/{project_id}/tasks/{task_id}/logs")
async def list_task_logs(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:read"))):
    # 任务操作记录:走项目成员门禁,项目成员即可查看(通用 /logs 是 admin-only,非管理员看不到)
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)  # 校验任务属于本项目,防跨项目越权
    items, total = crud.get_logs(db, limit=200, target_type="project_task", target_id=str(task_id))
    return {"items": items, "total": total}


@router.post("/{project_id}/tasks/{task_id}/move")
async def move_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskMove, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    t = crud_project.get_active_task(db, task_id, project_id)
    return _task_dict(db, crud_project.move_task(db, t, data))


@router.post("/{project_id}/tasks/reorder")
async def reorder_tasks(project_id: uuid.UUID, data: TaskReorder, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    return crud_project.reorder_task(db, project_id, data)


@router.delete("/{project_id}/tasks/{task_id}")
async def delete_task(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:delete")),
                      request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    t = crud_project.get_active_task(db, task_id, project_id)
    ip = request.client.host if request and request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除任务", "project_task", str(t.id), f"任务:{t.code} {t.name}", ip)
    crud.create_log(db, current_user.id, current_user.username, "删除任务", "project", str(project_id), f"{t.code} {t.name}", ip)
    crud_project.delete_task(db, t)
    return {"detail": "已删除"}


# ──────────── 任务关联对象 ────────────
@router.get("/{project_id}/tasks/{task_id}/links")
async def list_links(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)
    return {"items": [_link_dict(db, l) for l in crud_project.list_links(db, task_id)]}


@router.post("/{project_id}/tasks/{task_id}/links")
async def add_link(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskLinkAdd, db: Session = Depends(get_db),
                   current_user: User = Depends(require_permission("project.task:link"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)
    return _link_dict(db, crud_project.add_link(db, task_id, data))


@router.delete("/{project_id}/tasks/{task_id}/links/{link_id}")
async def remove_link(project_id: uuid.UUID, task_id: uuid.UUID, link_id: uuid.UUID,
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:link"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)
    link = crud_project.get_link(db, link_id)
    if link.task_id != task_id:
        raise HTTPException(status_code=404, detail="关联不存在")
    crud_project.remove_link(db, link_id)
    return {"detail": "已解除"}


# ──────────── 任务评论 ────────────
@router.get("/{project_id}/tasks/{task_id}/comments")
async def list_comments(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)
    return {"items": [_comment_dict(db, c) for c in crud_project.list_comments(db, task_id)]}


@router.post("/{project_id}/tasks/{task_id}/comments")
async def add_comment(project_id: uuid.UUID, task_id: uuid.UUID, data: CommentAdd, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:comment"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    crud_project.get_active_task(db, task_id, project_id)
    return _comment_dict(db, crud_project.add_comment(db, task_id, current_user.id, data))


@router.delete("/{project_id}/tasks/{task_id}/comments/{comment_id}")
async def delete_comment(project_id: uuid.UUID, task_id: uuid.UUID, comment_id: uuid.UUID,
                         db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project.task:comment"))):
    p = crud_project.get_project(db, project_id)
    crud_project.get_active_task(db, task_id, project_id)
    c = crud_project.get_comment(db, comment_id)
    if c.task_id != task_id:
        raise HTTPException(status_code=404, detail="评论不存在")
    is_mgr = _is_manager(db, current_user, p)
    if not is_mgr and c.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除本人评论")
    crud_project.delete_comment(db, c)
    return {"detail": "已删除"}


# ──────────── 甘特 ────────────
@router.get("/{project_id}/gantt")
async def get_gantt(project_id: uuid.UUID, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return crud_project.get_gantt_data(db, project_id)


@router.post("/{project_id}/auto-schedule")
async def run_auto_schedule(project_id: uuid.UUID, db: Session = Depends(get_db),
                            current_user: User = Depends(require_permission("project.task:depend")),
                            request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    ip = request.client.host if request and request.client else None
    actor = {"user_id": current_user.id, "username": current_user.username, "ip": ip}
    crud_project.auto_schedule(db, project_id, actor=actor)
    crud_project.persist_rollup(db, project_id)
    return crud_project.get_gantt_data(db, project_id)


# ──────────── 任务依赖 ────────────
@router.get("/{project_id}/deps")
async def list_deps(project_id: uuid.UUID, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    from app.models_project import ProjectTask
    tasks_by_id = {t.id: t for t in db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)).all()}
    return {"items": [{
        "id": str(d.id), "predecessor_id": str(d.predecessor_id),
        "successor_id": str(d.successor_id), "dep_type": d.dep_type, "lag_days": d.lag_days,
        "is_violation": crud_project._violation(d, tasks_by_id),
    } for d in crud_project.list_deps(db, project_id)]}


@router.post("/{project_id}/deps")
async def add_dep(project_id: uuid.UUID, data: DepCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(require_permission("project.task:depend")),
                  request: Request = None):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    ip = request.client.host if request and request.client else None
    actor = {"user_id": current_user.id, "username": current_user.username, "ip": ip}
    d = crud_project.add_dep(db, project_id, data, actor=actor)
    return {"id": str(d.id), "predecessor_id": str(d.predecessor_id),
            "successor_id": str(d.successor_id), "dep_type": d.dep_type, "lag_days": d.lag_days}


@router.delete("/{project_id}/deps/{dep_id}")
async def remove_dep(project_id: uuid.UUID, dep_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project.task:depend"))):
    p = crud_project.get_project(db, project_id)
    _enforce_manager(db, current_user, p)
    crud_project.remove_dep(db, project_id, dep_id)
    return {"detail": "已删除"}


# ──────────── 序列化辅助 ────────────
def _project_brief(db, p):
    owner = db.query(User).filter(User.id == p.owner_id).first()
    member_count = len(crud_project.list_members(db, p.id))
    return {"id": str(p.id), "code": p.code, "name": p.name, "status": p.status,
            "owner_id": str(p.owner_id), "owner_name": owner.real_name if owner else "",
            "planned_start": p.planned_start, "planned_end": p.planned_end,
            "description": p.description,
            "member_count": member_count, "created_at": p.created_at}


def _project_detail(db, p):
    base = _project_brief(db, p)
    base["description"] = p.description
    base["members"] = [_member_dict(db, m) for m in crud_project.list_members(db, p.id)]
    return base


def _member_dict(db, m):
    u = db.query(User).filter(User.id == m.user_id).first()
    return {"id": str(m.id), "user_id": str(m.user_id),
            "user_name": u.real_name if u else "", "username": u.username if u else "",
            "role_in_project": m.role_in_project}


def _task_dict(db, t):
    return {"id": str(t.id), "project_id": str(t.project_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "status": t.status, "priority": t.priority,
            "planned_start": crud_project._iso(t.planned_start),
            "planned_end": crud_project._iso(t.planned_end),
            "actual_start": crud_project._iso(t.actual_start),
            "actual_end": crud_project._iso(t.actual_end),
            "sort_order": t.sort_order, "description": t.description}


_ENTITY_TABLE = {"part": "part_masters", "assembly": "part_masters", "component": "part_masters", "document": "documents", "config_item": "configuration_items"}


def _link_dict(db, l):
    from sqlalchemy import text
    code = name = spec = remark = master_id = None
    table = _ENTITY_TABLE.get(l.entity_type)
    if table:
        if table == "part_masters":
            row = db.execute(
                text("SELECT pm.code, pm.name, pm.spec, pi.remark, pm.id as master_id FROM part_masters pm JOIN part_revisions pr ON pr.master_id = pm.id LEFT JOIN part_iterations pi ON pi.revision_id = pr.id AND pi.iteration = pr.latest_iteration WHERE pr.id = :id"),
                {"id": str(l.entity_id)}
            ).fetchone()
            if row:
                code, name, spec, remark, master_id = row[0], row[1], row[2] if len(row) > 2 else None, row[3] if len(row) > 3 else None, row[4] if len(row) > 4 else None
        elif table == "documents":
            row = db.execute(
                text(f"SELECT code, name, NULL AS spec, remark FROM {table} WHERE id = :id"), {"id": str(l.entity_id)}
            ).fetchone()
        else:
            row = db.execute(
                text(f"SELECT code, name, spec, remark FROM {table} WHERE id = :id"), {"id": str(l.entity_id)}
            ).fetchone()
        if row:
            code, name, spec, remark = row[0], row[1], row[2] if len(row) > 2 else None, row[3] if len(row) > 3 else None
    elif l.entity_type == "ec":
        row = db.execute(
            text("SELECT ecr_number, title, description FROM ecrs WHERE id = :id UNION ALL SELECT eco_number, title, description FROM ecos WHERE id = :id LIMIT 1"),
            {"id": str(l.entity_id)}
        ).fetchone()
        if row:
            code, name, remark = row[0], row[1], row[2] if len(row) > 2 else None
    return {"id": str(l.id), "task_id": str(l.task_id), "entity_type": l.entity_type,
            "entity_id": str(l.entity_id), "entity_code": code, "entity_name": name,
            "entity_spec": spec, "entity_remark": remark, "entity_master_id": str(master_id) if master_id else None}


def _comment_dict(db, c):
    u = db.query(User).filter(User.id == c.user_id).first()
    return {"id": str(c.id), "task_id": str(c.task_id), "user_id": str(c.user_id),
            "user_name": u.real_name if u else "", "content": c.content,
            "created_at": c.created_at}
