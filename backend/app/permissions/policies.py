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


@register_policy("dashboard_folder_editor")
def _dashboard_folder_editor(user, folder, **_) -> bool:
    if _is_admin(user) or getattr(folder, "owner_user_id", None) == user.id:
        return True
    for share in getattr(folder, "shares", []) or []:
        if share.shared_with_user_id == user.id and share.permission == "edit":
            return True
    return False


@register_policy("project_manager_or_admin")
def _project_manager_or_admin(user, project, **_) -> bool:
    return _is_admin(user) or getattr(project, "owner_id", None) == user.id


@register_policy("document_content_access")
def _document_content_access(user, document, *, user_group_ids=frozenset(), doc_group_ids=frozenset(), **_) -> bool:
    if _is_admin(user):
        return True
    if getattr(document, "creator_id", None) == user.id:
        return True
    if not doc_group_ids:
        return True
    return bool(set(user_group_ids) & set(doc_group_ids))
