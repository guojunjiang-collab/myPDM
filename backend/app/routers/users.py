from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import User
from .. import crud, schemas
from .auth import require_role

router = APIRouter(prefix="/users", tags=["用户管理"])

@router.get("/", response_model=list[schemas.UserResponse])
async def list_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))):
    return crud.get_users(db, skip=skip, limit=limit)

@router.post("/", response_model=schemas.UserResponse)
async def create_user(user: schemas.UserCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    if crud.get_user_by_username(db, user.username):
        raise HTTPException(status_code=400, detail="用户名已存在")
    return crud.create_user(db, user)

@router.get("/{user_id}", response_model=schemas.UserResponse)
async def get_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    db_user = crud.get_user(db, user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return db_user

@router.put("/{user_id}", response_model=schemas.UserResponse)
async def update_user(user_id: uuid.UUID, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    db_user = crud.update_user(db, user_id, user_update)
    if not db_user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return db_user

@router.delete("/{user_id}")
async def delete_user(user_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_role(["admin"]))):
    if not crud.delete_user(db, user_id):
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"message": "用户已删除"}
