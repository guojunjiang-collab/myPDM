from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from .. import crud, schemas
from ..permissions import require_permission

router = APIRouter(prefix="/logs", tags=["操作日志"])

@router.get("/", response_model=list[schemas.LogResponse])
async def list_logs(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(require_permission("logs:read"))):
    return crud.get_logs(db, skip=skip, limit=limit)
