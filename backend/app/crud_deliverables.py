"""项目交付物汇总 - 只读聚合查询
============================
汇总口径：项目下所有未删除任务的 project_task_links，按 entity_id 去重、合并来源任务。
不新增表，不做结构性下钻。查询一律用 ORM（测试跑在内存 SQLite 上）。
"""
import uuid
from typing import Callable

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import DocumentMaster, DocumentRevision, User
from app.models_configuration import (
    ConfigurationItemIteration, ConfigurationItemMaster, ConfigurationItemRevision,
)
from app.models_eco import ECO
from app.models_ecr import ECR
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


def list_documents(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """图文档：entity_id 指向 document_revisions.id，extra 取该版本备注。"""
    rows = (
        db.query(ProjectTask, DocumentRevision, DocumentMaster)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(DocumentRevision, DocumentRevision.id == ProjectTaskLink.entity_id)
        .join(DocumentMaster, DocumentMaster.id == DocumentRevision.master_id)
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type == "document",
                DocumentRevision.deleted_at.is_(None),
                DocumentMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master in rows:
        def factory(rev=rev, master=master):
            return {
                "entity_type": "document",
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": rev.remark or "",
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)


def list_config_items(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """构型项：entity_id 指向 configuration_item_revisions.id。

    extra 取 latest_iteration 对应迭代的 version_name；迭代缺失时为空串（outerjoin）。
    """
    rows = (
        db.query(ProjectTask, ConfigurationItemRevision, ConfigurationItemMaster,
                 ConfigurationItemIteration)
        .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
        .join(ConfigurationItemRevision,
              ConfigurationItemRevision.id == ProjectTaskLink.entity_id)
        .join(ConfigurationItemMaster,
              ConfigurationItemMaster.id == ConfigurationItemRevision.master_id)
        .outerjoin(ConfigurationItemIteration,
                   and_(ConfigurationItemIteration.revision_id == ConfigurationItemRevision.id,
                        ConfigurationItemIteration.iteration == ConfigurationItemRevision.latest_iteration))
        .filter(ProjectTask.project_id == project_id,
                ProjectTask.deleted_at.is_(None),
                ProjectTaskLink.entity_type == "config_item",
                ConfigurationItemRevision.deleted_at.is_(None),
                ConfigurationItemMaster.deleted_at.is_(None))
        .all()
    )
    bucket: dict = {}
    for task, rev, master, iteration in rows:
        def factory(rev=rev, master=master, iteration=iteration):
            return {
                "entity_type": "config_item",
                "entity_id": str(rev.id),
                "master_id": str(master.id),
                "code": master.code,
                "name": master.name,
                "version": rev.version,
                "status": rev.status,
                "creator_name": user_names.get(rev.creator_id, ""),
                "extra": (iteration.version_name if iteration else "") or "",
            }
        _collect(bucket, str(rev.id), task, factory)
    return _finalize(bucket)


def list_changes(db: Session, project_id: uuid.UUID, user_names: dict) -> list:
    """变更：entity_type 统一为 ec，entity_id 指向 ecrs.id 或 ecos.id。

    ECR/ECO 是单实例对象，无版本概念，version 与 master_id 恒为 None。
    """
    bucket: dict = {}
    for model, number_attr, kind in ((ECR, "ecr_number", "ECR"), (ECO, "eco_number", "ECO")):
        rows = (
            db.query(ProjectTask, model)
            .join(ProjectTaskLink, ProjectTaskLink.task_id == ProjectTask.id)
            .join(model, model.id == ProjectTaskLink.entity_id)
            .filter(ProjectTask.project_id == project_id,
                    ProjectTask.deleted_at.is_(None),
                    ProjectTaskLink.entity_type == "ec",
                    model.deleted_at.is_(None))
            .all()
        )
        for task, ec in rows:
            def factory(ec=ec, number_attr=number_attr, kind=kind):
                return {
                    "entity_type": "ec",
                    "entity_id": str(ec.id),
                    "master_id": None,
                    "code": getattr(ec, number_attr),
                    "name": ec.title,
                    "version": None,
                    "status": ec.status,
                    "creator_name": user_names.get(ec.creator_id, ""),
                    "extra": kind,
                }
            _collect(bucket, str(ec.id), task, factory)
    return _finalize(bucket)


def get_deliverables(db: Session, project_id: uuid.UUID) -> dict:
    """项目交付物汇总：四类对象各自去重后返回，counts 为各类总数（不受前端筛选影响）。"""
    user_names = _user_names(db)
    config_items = list_config_items(db, project_id, user_names)
    parts = list_parts(db, project_id, user_names)
    documents = list_documents(db, project_id, user_names)
    changes = list_changes(db, project_id, user_names)
    return {
        "counts": {
            "config_items": len(config_items),
            "parts": len(parts),
            "documents": len(documents),
            "changes": len(changes),
        },
        "config_items": config_items,
        "parts": parts,
        "documents": documents,
        "changes": changes,
    }
