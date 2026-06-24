"""项目管理 - CRUD"""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import User
from app.models_project import (
    Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment,
)
from app.schemas_project import (
    ProjectCreate, ProjectEdit, MemberAdd,
    TaskCreate, TaskEdit, TaskMove, TaskLinkAdd, CommentAdd,
)


def _uuid(v):
    if v is None or v == "":
        return None
    return uuid.UUID(v) if isinstance(v, str) else v


# ════════════════════════ 项目 ════════════════════════
def _next_project_code(db: Session) -> str:
    count = db.query(Project).count()
    return f"PRJ-{count + 1:03d}"


def create_project(db: Session, data: ProjectCreate, owner_id: uuid.UUID) -> Project:
    p = Project(
        code=_next_project_code(db), name=data.name, owner_id=owner_id,
        status=data.status, planned_start=data.planned_start,
        planned_end=data.planned_end, description=data.description,
    )
    db.add(p); db.commit(); db.refresh(p)
    db.add(ProjectMember(project_id=p.id, user_id=owner_id, role_in_project="经理"))
    for uid in (data.member_user_ids or []):
        if _uuid(uid) != owner_id:
            db.add(ProjectMember(project_id=p.id, user_id=_uuid(uid), role_in_project="成员"))
    db.commit()
    return p


def list_projects(db: Session, user: User) -> list:
    q = db.query(Project).filter(Project.deleted_at.is_(None))
    if user.role != "admin":
        member_pids = db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id)
        q = q.filter(Project.id.in_(member_pids))
    return q.order_by(Project.created_at.desc()).all()


def get_project(db: Session, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    if not p:
        raise HTTPException(status_code=404, detail="项目不存在")
    return p


def update_project(db: Session, p: Project, data: ProjectEdit) -> Project:
    for field in ("name", "status", "planned_start", "planned_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(p, field, val)
    db.commit(); db.refresh(p)
    return p


def delete_project(db: Session, p: Project):
    p.deleted_at = datetime.now(timezone.utc)
    db.commit()


# ════════════════════════ 成员 ════════════════════════
def list_members(db: Session, project_id: uuid.UUID) -> list:
    return db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()


def is_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).first() is not None


def add_member(db: Session, project_id: uuid.UUID, data: MemberAdd) -> ProjectMember:
    uid = _uuid(data.user_id)
    if is_member(db, project_id, uid):
        raise HTTPException(status_code=400, detail="该用户已是项目成员")
    m = ProjectMember(project_id=project_id, user_id=uid, role_in_project=data.role_in_project)
    db.add(m); db.commit(); db.refresh(m)
    return m


def remove_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID):
    db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id
    ).delete()
    db.commit()


# ════════════════════════ 任务 ════════════════════════
def _next_task_code(db: Session, project: Project) -> str:
    count = db.query(ProjectTask).filter(ProjectTask.project_id == project.id).count()
    return f"{project.code}-{count + 1:02d}"


def get_task(db: Session, task_id: uuid.UUID) -> ProjectTask:
    t = db.query(ProjectTask).filter(ProjectTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


def create_task(db: Session, project: Project, data: TaskCreate) -> ProjectTask:
    parent_id = _uuid(data.parent_id)
    if parent_id:
        get_task(db, parent_id)
    max_sort = db.query(ProjectTask).filter(
        ProjectTask.project_id == project.id,
        ProjectTask.parent_id == parent_id,
        ProjectTask.deleted_at.is_(None),
    ).count()
    t = ProjectTask(
        project_id=project.id, parent_id=parent_id, code=_next_task_code(db, project),
        name=data.name, task_type=data.task_type, assignee_id=_uuid(data.assignee_id),
        status=data.status, priority=data.priority,
        planned_start=data.planned_start, planned_end=data.planned_end,
        actual_start=data.actual_start, actual_end=data.actual_end,
        description=data.description, sort_order=max_sort,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_task(db: Session, t: ProjectTask, data: TaskEdit) -> ProjectTask:
    for field in ("name", "task_type", "status", "priority", "planned_start",
                  "planned_end", "actual_start", "actual_end", "description"):
        val = getattr(data, field)
        if val is not None:
            setattr(t, field, val)
    if data.assignee_id is not None:
        t.assignee_id = _uuid(data.assignee_id)
    db.commit(); db.refresh(t)
    return t


def update_task_status(db: Session, t: ProjectTask, status: str) -> ProjectTask:
    t.status = status
    db.commit(); db.refresh(t)
    return t


def move_task(db: Session, t: ProjectTask, data: TaskMove) -> ProjectTask:
    if data.parent_id is not None:
        t.parent_id = _uuid(data.parent_id)
    if data.sort_order is not None:
        t.sort_order = data.sort_order
    db.commit(); db.refresh(t)
    return t


def delete_task(db: Session, t: ProjectTask):
    """软删任务及其整棵子树。"""
    now = datetime.now(timezone.utc)
    to_delete = [t.id]
    while to_delete:
        current = to_delete.pop()
        task = db.query(ProjectTask).filter(ProjectTask.id == current).first()
        if task and task.deleted_at is None:
            task.deleted_at = now
            children = db.query(ProjectTask.id).filter(
                ProjectTask.parent_id == current, ProjectTask.deleted_at.is_(None)
            ).all()
            to_delete.extend([c[0] for c in children])
    db.commit()


def get_task_tree(db: Session, project_id: uuid.UUID) -> list:
    """组装该项目整棵任务树(嵌套 dict)。"""
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id, ProjectTask.deleted_at.is_(None)
    ).order_by(ProjectTask.sort_order, ProjectTask.created_at).all()
    link_counts = {}
    for tid, in db.query(ProjectTaskLink.task_id).all():
        link_counts[tid] = link_counts.get(tid, 0) + 1
    user_names = {u.id: u.real_name for u in db.query(User).all()}

    nodes = {}
    for t in tasks:
        nodes[t.id] = {
            "id": str(t.id), "project_id": str(t.project_id),
            "parent_id": str(t.parent_id) if t.parent_id else None,
            "code": t.code, "name": t.name, "task_type": t.task_type,
            "assignee_id": str(t.assignee_id) if t.assignee_id else None,
            "assignee_name": user_names.get(t.assignee_id) if t.assignee_id else None,
            "status": t.status, "priority": t.priority,
            "planned_start": t.planned_start, "planned_end": t.planned_end,
            "actual_start": t.actual_start, "actual_end": t.actual_end,
            "sort_order": t.sort_order, "description": t.description,
            "link_count": link_counts.get(t.id, 0),
            "children": [],
        }
    roots = []
    for t in tasks:
        node = nodes[t.id]
        if t.parent_id and t.parent_id in nodes:
            nodes[t.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


# ════════════════════════ 任务关联对象 ════════════════════════
def add_link(db: Session, task_id: uuid.UUID, data: TaskLinkAdd) -> ProjectTaskLink:
    link = ProjectTaskLink(task_id=task_id, entity_type=data.entity_type, entity_id=_uuid(data.entity_id))
    db.add(link); db.commit(); db.refresh(link)
    return link


def list_links(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskLink).filter(ProjectTaskLink.task_id == task_id).all()


def remove_link(db: Session, link_id: uuid.UUID):
    db.query(ProjectTaskLink).filter(ProjectTaskLink.id == link_id).delete()
    db.commit()


# ════════════════════════ 任务评论 ════════════════════════
def add_comment(db: Session, task_id: uuid.UUID, user_id: uuid.UUID, data: CommentAdd) -> ProjectTaskComment:
    c = ProjectTaskComment(task_id=task_id, user_id=user_id, content=data.content)
    db.add(c); db.commit(); db.refresh(c)
    return c


def list_comments(db: Session, task_id: uuid.UUID) -> list:
    return db.query(ProjectTaskComment).filter(
        ProjectTaskComment.task_id == task_id, ProjectTaskComment.deleted_at.is_(None)
    ).order_by(ProjectTaskComment.created_at).all()


def get_comment(db: Session, comment_id: uuid.UUID) -> ProjectTaskComment:
    c = db.query(ProjectTaskComment).filter(
        ProjectTaskComment.id == comment_id, ProjectTaskComment.deleted_at.is_(None)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="评论不存在")
    return c


def delete_comment(db: Session, c: ProjectTaskComment):
    c.deleted_at = datetime.now(timezone.utc)
    db.commit()
