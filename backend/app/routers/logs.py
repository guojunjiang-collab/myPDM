from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models import User
from .. import crud
from ..permissions import require_permission

router = APIRouter(prefix="/logs", tags=["操作日志"])

@router.get("/")
async def list_logs(skip: int = 0, limit: int = 100,
                    target_type: Optional[str] = Query(None),
                    target_id: Optional[str] = Query(None),
                    sort_field: str = Query('created_at'),
                    sort_order: str = Query('desc'),
                    db: Session = Depends(get_db),
                    current_user: User = Depends(require_permission("logs:read"))):
    from fastapi import HTTPException
    try:
        items, total = crud.get_logs(db, skip=skip, limit=limit, target_type=target_type, target_id=target_id,
                                     sort_field=sort_field, sort_order=sort_order)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"items": items, "total": total}
