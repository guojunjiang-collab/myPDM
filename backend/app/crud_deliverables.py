"""项目交付物汇总 - 只读聚合查询
============================
汇总口径：项目下所有未删除任务的 project_task_links，按 entity_id 去重、合并来源任务。
不新增表，不做结构性下钻。查询一律用 ORM（测试跑在内存 SQLite 上）。
"""
import uuid
from typing import Callable

from sqlalchemy.orm import Session

from app.models import User
from app.models_parts import PartMaster, PartRevision
from app.models_project import ProjectTask, ProjectTaskLink

# task_links 中代表零部件的 entity_type 取值（component 为历史遗留值）
PART_LINK_TYPES = ("part", "assembly", "component")
PART_TYPE_LABEL = {"part": "零件", "assembly": "部件"}


def _user_names(db: Session) -> dict:
    """一次性取全部用户的显示名，避免逐行查询。"""
    return {u.id: u.real_name for u in db.query(User).all()}


def _collect(bucket: dict, key: str, task: ProjectTask, factory: Callable[[], dict]) -> None:
    """把一行查询结果并入 bucket：首次出现时用 factory 建 item，之后只累加来源任务。"""
    item = bucket.get(key)
    if item is None:
        item = factory()
        item["tasks"] = []
        bucket[key] = item
    if not any(t["id"] == str(task.id) for t in item["tasks"]):
        item["tasks"].append({"id": str(task.id), "code": task.code, "name": task.name})


def _finalize(bucket: dict) -> list:
    """任务按编号排序、条目按 code 排序，保证导出结果稳定。"""
    items = list(bucket.values())
    for it in items:
        it["tasks"].sort(key=lambda t: t["code"] or "")
    items.sort(key=lambda i: i["code"] or "")
    return items


def list_parts(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """零部件：entity_id 指向 part_revisions.id。"""
    rows = (
        db.query(ProjectTask, PartRevision, PartMaster)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(PartRevision, PartRevision.id == ProjectTaskLink.entity_id)
        .join(PartMaster, PartMaster.id == PartRevision.master_id)
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type.in_(PART_LINK_TYPES),
                PartRevision.deleted_at.is_(None),
                PartMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master in rows:
        def factory(rev=rev, master=master):
            return {
                "entity_type": master.type,
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": PART_TYPE_LABEL.get(master.type, master.type),
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)
