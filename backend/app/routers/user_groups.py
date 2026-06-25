from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User, UserGroup, UserGroupMember, DocumentGroupLink
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/user-groups", tags=["用户组管理"])


def _group_dict(db, g):
    count = db.query(UserGroupMember).filter(UserGroupMember.group_id == g.id).count()
    return {"id": g.id, "name": g.name, "description": g.description,
            "member_count": count, "created_at": g.created_at, "updated_at": g.updated_at}


@router.get("/")
async def list_groups(db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:read"))):
    groups = db.query(UserGroup).order_by(UserGroup.name).all()
    return [_group_dict(db, g) for g in groups]


@router.post("/")
async def create_group(body: schemas.UserGroupCreate, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    if db.query(UserGroup).filter(UserGroup.name == body.name).first():
        raise HTTPException(status_code=400, detail="该用户组名称已存在")
    g = UserGroup(name=body.name, description=body.description)
    db.add(g); db.commit(); db.refresh(g)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "创建用户组", "user_group", str(g.id), f"名称:{g.name}", ip)
    return _group_dict(db, g)


@router.put("/{group_id}")
async def update_group(group_id: uuid.UUID, body: schemas.UserGroupUpdate, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    if body.name and body.name != g.name:
        if db.query(UserGroup).filter(UserGroup.name == body.name, UserGroup.id != group_id).first():
            raise HTTPException(status_code=400, detail="该用户组名称已存在")
        g.name = body.name
    if body.description is not None:
        g.description = body.description
    db.commit(); db.refresh(g)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "更新用户组", "user_group", str(group_id), None, ip)
    return _group_dict(db, g)


@router.delete("/{group_id}")
async def delete_group(group_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                       current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    name = g.name
    db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).delete()
    db.query(DocumentGroupLink).filter(DocumentGroupLink.group_id == group_id).delete()
    db.delete(g); db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除用户组", "user_group", str(group_id), f"名称:{name}", ip)
    return {"message": "用户组已删除"}


@router.get("/{group_id}/members")
async def get_members(group_id: uuid.UUID, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:read"))):
    rows = db.query(UserGroupMember.user_id).filter(UserGroupMember.group_id == group_id).all()
    return {"user_ids": [r[0] for r in rows]}


@router.put("/{group_id}/members")
async def set_members(group_id: uuid.UUID, body: schemas.GroupMembersUpdate, request: Request, db: Session = Depends(get_db),
                      current_user: User = Depends(require_permission("user_groups:manage"))):
    g = db.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="用户组不存在")
    db.query(UserGroupMember).filter(UserGroupMember.group_id == group_id).delete()
    uids = set(body.user_ids)
    for uid in uids:
        db.add(UserGroupMember(user_id=uid, group_id=group_id))
    db.commit()
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "设置用户组成员", "user_group", str(group_id), f"成员数:{len(uids)}", ip)
    return {"user_ids": list(uids)}
