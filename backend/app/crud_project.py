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
