"""项目管理 - Pydantic Schemas"""
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, Literal, List
from datetime import datetime, date


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- 项目 ----
class ProjectCreate(BaseSchema):
    name: str = Field(..., max_length=255)
    status: Literal["待启动", "进行中", "已完成", "已暂停", "已归档"] = "进行中"
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: Optional[str] = None
    member_user_ids: List[str] = []


class ProjectEdit(BaseSchema):
    name: Optional[str] = None
    owner_id: Optional[str] = None
    status: Optional[Literal["待启动", "进行中", "已完成", "已暂停", "已归档"]] = None
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    description: Optional[str] = None


# ---- 成员 ----
class MemberAdd(BaseSchema):
    user_id: str
    role_in_project: Literal["经理", "成员"] = "成员"


# ---- 任务 ----
class TaskCreate(BaseSchema):
    name: str = Field(..., max_length=255)
    parent_id: Optional[str] = None
    task_type: Literal["任务", "里程碑", "评审"] = "任务"
    assignee_id: Optional[str] = None
    status: Literal["未开始", "进行中", "已完成", "挂起"] = "未开始"
    priority: Literal["高", "中", "低"] = "中"
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    description: Optional[str] = None

    @field_validator("planned_start", "planned_end", "actual_start", "actual_end", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        return None if v == "" else v


class TaskEdit(BaseSchema):
    name: Optional[str] = None
    task_type: Optional[Literal["任务", "里程碑", "评审"]] = None
    assignee_id: Optional[str] = None
    status: Optional[Literal["未开始", "进行中", "已完成", "挂起"]] = None
    priority: Optional[Literal["高", "中", "低"]] = None
    planned_start: Optional[date] = None
    planned_end: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    description: Optional[str] = None

    @field_validator("planned_start", "planned_end", "actual_start", "actual_end", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        return None if v == "" else v


class TaskStatusUpdate(BaseSchema):
    status: Literal["未开始", "进行中", "已完成", "挂起"]


class TaskMove(BaseSchema):
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class TaskReorder(BaseSchema):
    task_id: str
    new_parent_id: Optional[str] = None
    new_sort_order: int


# ---- 关联对象 ----
class TaskLinkAdd(BaseSchema):
    entity_type: Literal["part", "assembly", "component", "config_item", "ec", "document"]
    entity_id: str


# ---- 评论 ----
class CommentAdd(BaseSchema):
    content: str = Field(..., min_length=1)


# ---- 任务依赖 ----
class DepCreate(BaseSchema):
    predecessor_id: str
    successor_id: str
    dep_type: Literal["FS", "SS", "FF", "SF"] = "FS"
    lag_days: int = 0
