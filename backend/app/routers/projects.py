"""项目管理 - API Router"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app import crud_project
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskStatusUpdate, TaskMove, TaskReorder, TaskLinkAdd, CommentAdd,
)
from ..permissions import require_permission, enforce_object_policy

router = APIRouter(prefix="/projects", tags=["项目管理"])


def _require_member(db, project_id, user):
    if user.role != "admin" and not crud_project.is_member(db, project_id, user.id):
        raise HTTPException(status_code=403, detail="非项目成员")


# ──────────── 项目 ────────────
@router.get("")
async def list_projects(db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project:read"))):
    items = crud_project.list_projects(db, current_user)
    return {"items": [_project_brief(db, p) for p in items]}


@router.post("")
async def create_project(data: ProjectCreate, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:create"))):
    p = crud_project.create_project(db, data, current_user.id)
    return _project_detail(db, p)


@router.get("/{project_id}")
async def get_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project:read"))):
    p = crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return _project_detail(db, p)


@router.put("/{project_id}")
async def update_project(project_id: uuid.UUID, data: ProjectEdit, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return _project_detail(db, crud_project.update_project(db, p, data))


@router.delete("/{project_id}")
async def delete_project(project_id: uuid.UUID, db: Session = Depends(get_db),
                         current_user: User = Depends(require_permission("project:delete"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
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
                     current_user: User = Depends(require_permission("project.member:manage"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return _member_dict(db, crud_project.add_member(db, project_id, data))


@router.delete("/{project_id}/members/{user_id}")
async def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.member:manage"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    if user_id == p.owner_id:
        raise HTTPException(status_code=400, detail="不能移除项目负责人")
    crud_project.remove_member(db, project_id, user_id)
    return {"detail": "已移除"}


# ──────────── 任务 ────────────
@router.get("/{project_id}/tasks")
async def list_tasks(project_id: uuid.UUID, db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("project:read"))):
    crud_project.get_project(db, project_id)
    _require_member(db, project_id, current_user)
    return {"items": crud_project.get_task_tree(db, project_id)}


@router.post("/{project_id}/tasks")
async def create_task(project_id: uuid.UUID, data: TaskCreate, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:create"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return _task_dict(db, crud_project.create_task(db, p, data))


@router.put("/{project_id}/tasks/{task_id}")
async def update_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskEdit, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    t = crud_project.get_active_task(db, task_id, project_id)
    return _task_dict(db, crud_project.update_task(db, t, data))


@router.patch("/{project_id}/tasks/{task_id}/status")
async def update_task_status(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskStatusUpdate,
                             db: Session = Depends(get_db),
                             current_user: User = Depends(require_permission("project.task:update_status"))):
    p = crud_project.get_project(db, project_id)
    t = crud_project.get_active_task(db, task_id, project_id)
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and t.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅项目经理或任务负责人可更新状态")
    if not is_mgr:
        _require_member(db, project_id, current_user)
    return _task_dict(db, crud_project.update_task_status(db, t, data.status))


@router.post("/{project_id}/tasks/{task_id}/move")
async def move_task(project_id: uuid.UUID, task_id: uuid.UUID, data: TaskMove, db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    t = crud_project.get_active_task(db, task_id, project_id)
    return _task_dict(db, crud_project.move_task(db, t, data))


@router.post("/{project_id}/tasks/reorder")
async def reorder_tasks(project_id: uuid.UUID, data: TaskReorder, db: Session = Depends(get_db),
                        current_user: User = Depends(require_permission("project.task:update"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    return crud_project.reorder_task(db, project_id, data)


@router.delete("/{project_id}/tasks/{task_id}")
async def delete_task(project_id: uuid.UUID, task_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("project.task:delete"))):
    p = crud_project.get_project(db, project_id)
    enforce_object_policy("project_manager_or_admin", current_user, p)
    crud_project.delete_task(db, crud_project.get_active_task(db, task_id, project_id))
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
    is_mgr = current_user.role == "admin" or p.owner_id == current_user.id
    if not is_mgr and c.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能删除本人评论")
    crud_project.delete_comment(db, c)
    return {"detail": "已删除"}


# ──────────── 序列化辅助 ────────────
def _project_brief(db, p):
    owner = db.query(User).filter(User.id == p.owner_id).first()
    member_count = len(crud_project.list_members(db, p.id))
    return {"id": str(p.id), "code": p.code, "name": p.name, "status": p.status,
            "owner_id": str(p.owner_id), "owner_name": owner.real_name if owner else "",
            "planned_start": p.planned_start, "planned_end": p.planned_end,
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
            "planned_start": t.planned_start, "planned_end": t.planned_end,
            "actual_start": t.actual_start, "actual_end": t.actual_end,
            "sort_order": t.sort_order, "description": t.description}


_ENTITY_TABLE = {"part": "parts", "assembly": "assemblies", "document": "documents"}


def _link_dict(db, l):
    from sqlalchemy import text
    code = name = None
    table = _ENTITY_TABLE.get(l.entity_type)
    if table:
        row = db.execute(
            text(f"SELECT code, name FROM {table} WHERE id = :id"), {"id": str(l.entity_id)}
        ).fetchone()
        if row:
            code, name = row[0], row[1]
    return {"id": str(l.id), "task_id": str(l.task_id), "entity_type": l.entity_type,
            "entity_id": str(l.entity_id), "entity_code": code, "entity_name": name}


def _comment_dict(db, c):
    u = db.query(User).filter(User.id == c.user_id).first()
    return {"id": str(c.id), "task_id": str(c.task_id), "user_id": str(c.user_id),
            "user_name": u.real_name if u else "", "content": c.content,
            "created_at": c.created_at}
