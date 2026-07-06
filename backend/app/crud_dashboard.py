"""仪表盘个人工作区聚合（只读，不写日志）：
- get_my_tasks：指派给我且未完成的项目任务
- get_my_todos：ECR/ECO 待我审批 + 我发起被驳回
"""
from sqlalchemy.orm import Session
from app.models_project import Project, ProjectTask
from app.models_ecr import ECR, ECRReviewRecord
from app.models_eco import ECO, ECOReviewRecord

_TASK_DONE = {"已完成"}


# ──────────── 我的任务 ────────────
def get_my_tasks(db: Session, user_id):
    rows = (
        db.query(ProjectTask, Project.name, Project.code, Project.id)
        .join(Project, Project.id == ProjectTask.project_id)
        .filter(ProjectTask.assignee_id == user_id)
        .filter(ProjectTask.deleted_at.is_(None))
        .filter(~ProjectTask.status.in_(_TASK_DONE))
        .all()
    )
    out = []
    for task, project_name, project_code, project_id in rows:
        out.append({
            "project_id": str(project_id),
            "project_code": project_code,
            "project_name": project_name,
            "task_id": str(task.id),
            "code": task.code,
            "name": task.name,
            "task_type": task.task_type,
            "status": task.status,
            "priority": task.priority,
            "planned_start": task.planned_start.isoformat() if task.planned_start else None,
            "planned_end": task.planned_end.isoformat() if task.planned_end else None,
            "description": task.description,
        })
    return out


# ──────────── 待我处理 ────────────
def _is_reviewer(reviewers, user_id_str):
    for r in reviewers or []:
        if str(r.get("user_id")) == user_id_str:
            return True
    return False


def _todo_row(m, type_name, number_attr, kind):
    return {
        "type": type_name,
        "kind": kind,
        "id": str(m.id),
        "number": getattr(m, number_attr),
        "title": m.title,
        "priority": m.priority,
        "status": m.status,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def _collect_todos(db, user_id, Model, RecordModel, type_name, number_attr, fk_col):
    uid = str(user_id)
    out = []
    # 待我审批：reviewing 状态且我是评审人且尚未评审
    reviewing = db.query(Model).filter(Model.status == "reviewing", Model.deleted_at.is_(None)).all()
    for m in reviewing:
        if not _is_reviewer(m.reviewers, uid):
            continue
        done = db.query(RecordModel).filter(
            fk_col == m.id,
            RecordModel.reviewer_id == user_id,
        ).first()
        if done:
            continue
        out.append(_todo_row(m, type_name, number_attr, "review"))
    # 我发起被驳回
    rejected = db.query(Model).filter(
        Model.status == "rejected", Model.creator_id == user_id, Model.deleted_at.is_(None)
    ).all()
    for m in rejected:
        out.append(_todo_row(m, type_name, number_attr, "rejected"))
    return out


def get_my_todos(db: Session, user_id):
    todos = []
    todos += _collect_todos(db, user_id, ECR, ECRReviewRecord, "ecr", "ecr_number", ECRReviewRecord.ecr_id)
    todos += _collect_todos(db, user_id, ECO, ECOReviewRecord, "eco", "eco_number", ECOReviewRecord.eco_id)
    todos.sort(key=lambda x: x["updated_at"] or "", reverse=True)
    return todos
