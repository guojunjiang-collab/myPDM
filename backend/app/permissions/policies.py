from fastapi import HTTPException

from ..models import User

_POLICY_FUNCS: dict = {}


def register_policy(name: str):
    def deco(fn):
        _POLICY_FUNCS[name] = fn
        return fn
    return deco


def check_object_policy(name: str, user: User, obj, **ctx) -> bool:
    fn = _POLICY_FUNCS.get(name)
    if fn is None:
        raise KeyError(f"Unregistered object policy: {name}")
    return bool(fn(user, obj, **ctx))


def enforce_object_policy(name: str, user: User, obj, **ctx) -> None:
    if not check_object_policy(name, user, obj, **ctx):
        raise HTTPException(status_code=403, detail="无权操作该对象")


def _is_admin(user) -> bool:
    return user.role == "admin"


@register_policy("ecr_owner_or_admin")
def _ecr_owner_or_admin(user, ecr, **_) -> bool:
    return _is_admin(user) or ecr.creator_id == user.id


@register_policy("eco_owner_or_admin")
def _eco_owner_or_admin(user, eco, **_) -> bool:
    return _is_admin(user) or eco.creator_id == user.id


@register_policy("ecr_approver_or_admin")
def _ecr_approver_or_admin(user, ecr, *, reviewer_ids=None, **_) -> bool:
    return _is_admin(user) or (reviewer_ids is not None and user.id in reviewer_ids)


@register_policy("inventory_keeper_or_admin")
def _inventory_keeper_or_admin(user, doc, **_) -> bool:
    return _is_admin(user) or getattr(doc, "keeper_id", None) == user.id


@register_policy("inventory_doc_participant_or_admin")
def _inventory_doc_participant_or_admin(user, doc, *, reviewer_ids=None, **_) -> bool:
    """单据参与者 = admin / 创建者 / 保管人 / 指定审批人。
    与 list_documents 的行级可见性口径一致，避免"知道 id 就能改他人单据"。
    """
    if _is_admin(user):
        return True
    if getattr(doc, "creator_id", None) == user.id:
        return True
    if getattr(doc, "keeper_id", None) == user.id:
        return True
    if reviewer_ids is None:
        reviewer_ids = {r.get("user_id") for r in (getattr(doc, "reviewers", None) or [])}
    return str(user.id) in {str(r) for r in reviewer_ids}


@register_policy("profile_approver_or_admin")
def _profile_approver_or_admin(user, profile, *, reviewer_ids=None, **_) -> bool:
    """配置方案审批人门禁：admin 或被指定的审批人。"""
    if _is_admin(user):
        return True
    if reviewer_ids is None:
        reviewer_ids = {r.get("user_id") for r in (getattr(profile, "reviewers", None) or [])}
    return str(user.id) in {str(r) for r in reviewer_ids}


@register_policy("dashboard_folder_editor")
def _dashboard_folder_editor(user, folder, *, owner_user_id=None, editor_user_ids=frozenset(), **_) -> bool:
    """看板文件夹编辑权：admin / 看板所有者 / 在本文件夹或其任一祖先上被授予 edit 的用户。

    owner_user_id 与 editor_user_ids 由调用方（dashboard 路由的
    _check_folder_edit_permission）计算后传入 —— DashboardFolder 模型本身
    既无 owner 列，也无法表达"祖先继承共享"，故不从对象属性推断。
    """
    if _is_admin(user):
        return True
    if owner_user_id is not None and owner_user_id == user.id:
        return True
    return user.id in set(editor_user_ids)


@register_policy("project_manager_or_admin")
def _project_manager_or_admin(user, project, *, manager_ids=None, **_) -> bool:
    # 项目管理者 = admin / owner / 角色为"经理"的成员。
    # manager_ids 由 router 传入（owner + 经理成员），未传时退回仅 owner 判定（向后兼容）。
    if _is_admin(user):
        return True
    if manager_ids is not None:
        return user.id in manager_ids
    return getattr(project, "owner_id", None) == user.id


@register_policy("document_content_access")
def _document_content_access(user, document, *, user_group_ids=frozenset(), doc_group_ids=frozenset(),
                             creator_id=None, **_) -> bool:
    """图文档内容访问：admin / 创建者 / 未关联用户组 / 组交集非空。

    creator_id 必须由调用方显式传入 —— v3.1.3 起 creator_id 落在
    DocumentIteration 上，DocumentMaster 已无该列，不能从对象属性取。
    """
    if _is_admin(user):
        return True
    if creator_id is not None and creator_id == user.id:
        return True
    if not doc_group_ids:
        return True
    return bool(set(user_group_ids) & set(doc_group_ids))
