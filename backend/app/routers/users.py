from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User, UserGroupMember
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/users", tags=["用户管理"])

@router.get("/", response_model=list[schemas.UserResponse])
async def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:read"))):
    return crud.get_users(db, skip=skip, limit=limit)

@router.post("/", response_model=schemas.UserResponse)
async def create_user(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:create"))):
    if crud.get_user_by_username(db, user.username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    return crud.create_user(db, user)

@router.get("/{user_id}", response_model=schemas.UserResponse)
async def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:read_detail"))):
    db_user = crud.get_user(db, user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return db_user

@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:update"))):
    db_user = crud.update_user(db, user_id, user_update)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 管理员替他人重置密码 → 该用户下次登录必须重设；改自己的密码不算
    if user_update.password is not None and db_user.id != current_user.id:
        db_user.must_change_password = True
        db.commit()
        db.refresh(db_user)
    return db_user

@router.delete("/{user_id}")
async def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("users:delete"))):
    if not crud.delete_user(db, user_id):
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"message": "用户已删除"}


@router.get("/{user_id}/groups")
async def get_user_groups(user_id: uuid.UUID, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("user_groups:read"))):
    rows = db.query(UserGroupMember.group_id).filter(UserGroupMember.user_id == user_id).all()
    return {"group_ids": [r[0] for r in rows]}


@router.put("/{user_id}/groups")
async def set_user_groups(user_id: uuid.UUID, body: schemas.UserGroupsUpdate, db: Session = Depends(get_db),
                          current_user: User = Depends(require_permission("user_groups:manage"))):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="用户不存在")
    db.query(UserGroupMember).filter(UserGroupMember.user_id == user_id).delete()
    gids = set(body.group_ids)
    for gid in gids:
        db.add(UserGroupMember(user_id=user_id, group_id=gid))
    db.commit()
    return {"group_ids": list(gids)}
