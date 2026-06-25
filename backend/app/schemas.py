from pydantic import BaseModel, Field, ConfigDict, BeforeValidator, field_validator
from typing import Optional, List, Any, Dict, Union, Annotated
from datetime import datetime
import uuid
import re

from .permissions._generated import ROLES


def _normalize_applies_to(v):
    """兼容字符串或列表输入，统一转为列表"""
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return v
    return ['part']

AppliesToList = Annotated[List[str], BeforeValidator(_normalize_applies_to)]

class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

class UserBase(BaseSchema):
    username: str = Field(..., min_length=3, max_length=64)
    real_name: str = Field(..., min_length=1, max_length=64)
    role: str = Field(...)
    department: Optional[str] = None
    phone: Optional[str] = None
    status: str = "active"

    @field_validator("role")
    @classmethod
    def _check_role(cls, v):
        if v not in ROLES:
            raise ValueError(f"非法角色: {v}")
        return v

class UserCreate(UserBase):
    id: Optional[uuid.UUID] = None
    password: str = Field(..., min_length=6)

class UserUpdate(BaseSchema):
    real_name: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    password: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _check_role_opt(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError(f"非法角色: {v}")
        return v

class UserResponse(UserBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

class PartBase(BaseSchema):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    spec: Optional[str] = None
    version: str = "A"
    status: str = "draft"
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class PartCreate(PartBase):
    id: Optional[uuid.UUID] = None

class PartUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class PartResponse(PartBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

class AssemblyBase(BaseSchema):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    spec: Optional[str] = None
    version: str = "A"
    status: str = "draft"
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class AssemblyCreate(AssemblyBase):
    id: Optional[uuid.UUID] = None

class AssemblyUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    spec: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    revisions: Optional[List[Any]] = None

class AssemblyResponse(AssemblyBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

class BOMItemBase(BaseSchema):
    parent_type: str = "assembly"   # 后端接口会覆盖此字段
    parent_id: Optional[uuid.UUID] = None  # 后端接口会覆盖此字段
    child_type: str
    child_id: uuid.UUID
    quantity: int = 1

class BOMItemCreate(BOMItemBase):
    id: Optional[uuid.UUID] = None

class BOMItemUpdate(BaseSchema):
    quantity: Optional[int] = None

class BOMItemResponse(BOMItemBase):
    id: uuid.UUID
    created_at: datetime
    child_detail: Optional[dict] = None

class Token(BaseSchema):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str

class TokenData(BaseSchema):
    username: Optional[str] = None
    role: Optional[str] = None

class LoginRequest(BaseSchema):
    username: str
    password: str

class RefreshRequest(BaseSchema):
    refresh_token: str

class ChangePasswordRequest(BaseSchema):
    old_password: str
    new_password: str

    @field_validator('new_password')
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError('密码长度不能少于8位')
        if not re.search(r'[A-Z]', v):
            raise ValueError('密码需包含大写字母')
        if not re.search(r'[a-z]', v):
            raise ValueError('密码需包含小写字母')
        if not re.search(r'\d', v):
            raise ValueError('密码需包含数字')
        return v

class LogResponse(BaseSchema):
    id: uuid.UUID
    user_id: uuid.UUID
    username: str
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    detail: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime

class BOMCompareOptions(BaseSchema):
    """BOM对比选项"""
    ignore_quantity: bool = False
    max_depth: int = 10
    include_internal_change: bool = True

class BOMCompareRequest(BaseSchema):
    """BOM对比请求体"""
    left_assembly_id: uuid.UUID
    right_assembly_id: uuid.UUID
    options: BOMCompareOptions = BOMCompareOptions()

class BOMCompareNode(BaseSchema):
    """对比节点"""
    key: str
    level: int
    sort: str
    change_type: str  # none, add, delete, modify, internal
    left: Optional[Dict[str, Any]] = None
    right: Optional[Dict[str, Any]] = None

class BOMCompareResponse(BaseSchema):
    """BOM对比响应"""
    left_assembly: Dict[str, Any]
    right_assembly: Dict[str, Any]
    comparison: List[BOMCompareNode]
    summary: Dict[str, int]


class BOMTraceItem(BaseSchema):
    """BOM反查结果项"""
    level: int
    bom_item_id: str
    parent_assembly: Optional[Dict[str, Any]] = None
    parent_part: Optional[Dict[str, Any]] = None
    child_entity: Optional[Dict[str, Any]] = None
    quantity: int


# ===== 自定义字段 Schema =====

class CustomFieldDefinitionBase(BaseSchema):
    name: str = Field(..., min_length=1, max_length=128)
    field_key: str = Field(..., min_length=1, max_length=64, pattern=r'^[a-zA-Z][a-zA-Z0-9_]*$')
    field_type: str = Field(..., pattern=r'^(text|number|select|multiselect)$')
    options: Optional[List[str]] = None
    is_required: bool = False
    applies_to: AppliesToList = Field(default=['part'])
    sort_order: int = 0

class CustomFieldDefinitionCreate(CustomFieldDefinitionBase):
    id: Optional[uuid.UUID] = None

class CustomFieldDefinitionUpdate(BaseSchema):
    name: Optional[str] = None
    field_type: Optional[str] = None
    options: Optional[List[str]] = None
    is_required: Optional[bool] = None
    applies_to: Optional[AppliesToList] = None
    sort_order: Optional[int] = None

class CustomFieldDefinitionResponse(CustomFieldDefinitionBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class CustomFieldValueItem(BaseSchema):
    """单个字段的值"""
    id: Optional[uuid.UUID] = None
    field_id: uuid.UUID
    value: Optional[Any] = None  # 可以是 str / number / list[str]

class CustomFieldValuesBatch(BaseSchema):
    """批量设置字段值的请求"""
    values: List[CustomFieldValueItem]

class CustomFieldValueResponse(BaseSchema):
    """字段值响应"""
    field_id: uuid.UUID
    field_key: Optional[str] = None
    field_name: Optional[str] = None
    field_type: Optional[str] = None
    value: Optional[Any] = None


# ===== 图文档 Schema =====

class DocumentBase(BaseSchema):
    code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    version: str = "A"
    status: str = "draft"
    remark: Optional[str] = None


class DocumentCreate(DocumentBase):
    id: Optional[uuid.UUID] = None
    group_ids: Optional[List[uuid.UUID]] = None

class DocumentUpdate(BaseSchema):
    code: Optional[str] = None
    name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None
    group_ids: Optional[List[uuid.UUID]] = None

class DocumentResponse(DocumentBase):
    id: uuid.UUID
    file_name: Optional[str] = None
    file_id: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

class DocumentAttachmentCreate(BaseSchema):
    id: Optional[uuid.UUID] = None
    file_name: str
    file_data: str

class DocumentAttachmentResponse(BaseSchema):
    id: uuid.UUID
    document_id: uuid.UUID
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    created_at: datetime

class DocumentAttachmentFull(DocumentAttachmentResponse):
    file_data: Optional[str] = None

class EntityDocumentCreate(BaseSchema):
    """关联图文档到零件/部件的请求体"""
    id: Optional[uuid.UUID] = None
    document_id: uuid.UUID
    category: Optional[str] = None
    sort_order: int = 0

class EntityDocumentUpdate(BaseSchema):
    """更新图文档关联信息的请求体"""
    category: Optional[str] = None
    sort_order: Optional[int] = None

class ReorderItem(BaseSchema):
    id: uuid.UUID
    sort_order: int

class ReorderRequest(BaseSchema):
    items: List[ReorderItem]


# ===== 用户看板 Schema =====

class DashboardFolderCreate(BaseSchema):
    """创建文件夹"""
    id: Optional[uuid.UUID] = None
    parent_id: Optional[uuid.UUID] = None
    name: str = Field(..., min_length=1, max_length=128)

class DashboardFolderUpdate(BaseSchema):
    """更新文件夹"""
    name: Optional[str] = Field(None, min_length=1, max_length=128)
    parent_id: Optional[uuid.UUID] = None

class DashboardFolderResponse(BaseSchema):
    """文件夹响应"""
    id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    name: str
    sort_order: int = 0
    item_count: int = 0
    created_at: datetime

class DashboardFolderTreeResponse(BaseSchema):
    """文件夹树节点（含子节点和关联项）"""
    id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    name: str
    sort_order: int = 0
    created_at: datetime
    items: Optional[List[dict]] = None
    children: Optional[List["DashboardFolderTreeResponse"]] = None

class DashboardItemCreate(BaseSchema):
    """创建文件夹关联项"""
    folder_id: uuid.UUID
    entity_type: str = Field(..., pattern=r'^(part|assembly|document|configuration)$')
    entity_id: uuid.UUID

class DashboardItemBatchCreate(BaseSchema):
    """批量创建关联项"""
    items: List[DashboardItemCreate]

class DashboardShareCreate(BaseSchema):
    """创建文件夹共享"""
    shared_with_user_id: uuid.UUID
    permission: str = Field(default="view", pattern=r'^(view|edit)$')

class DashboardShareResponse(BaseSchema):
    """共享响应"""
    id: uuid.UUID
    folder_id: uuid.UUID
    shared_with_user_id: uuid.UUID
    shared_with_user: Optional[dict] = None  # {id, username, real_name}
    permission: str
    created_at: datetime

class DashboardResponse(BaseSchema):
    """看板响应"""
    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime


# ===== 升版 Schema =====

class UpgradeRequest(BaseSchema):
    note: Optional[str] = None

class VersionItem(BaseSchema):
    id: uuid.UUID
    version: str
    status: str
    created_at: Optional[datetime] = None
    revision_parent_id: Optional[uuid.UUID] = None

# ── 用户组 ──
class UserGroupCreate(BaseSchema):
    name: str = Field(..., min_length=1, max_length=64)
    description: Optional[str] = None


class UserGroupUpdate(BaseSchema):
    name: Optional[str] = None
    description: Optional[str] = None


class GroupMembersUpdate(BaseSchema):
    user_ids: List[uuid.UUID] = []


class UserGroupsUpdate(BaseSchema):
    group_ids: List[uuid.UUID] = []