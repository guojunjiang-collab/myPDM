"""
同步状态端点 - 供前端自动轮询
GET /api/sync/status → 返回各表最后更新时间戳
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from ..database import get_db
from ..models import User
from ..permissions import require_permission

router = APIRouter(prefix="/sync", tags=["数据同步"])


def _max_ts(db: Session, table: str) -> float:
    """查询表的 MAX(GREATEST(updated_at, COALESCE(deleted_at, '1970-01-01')))"""
    result = db.execute(text(f"""
        SELECT EXTRACT(EPOCH FROM GREATEST(
            MAX(updated_at),
            COALESCE(MAX(deleted_at), '1970-01-01'::timestamptz)
        ))::bigint
        FROM {table}
    """))
    val = result.scalar()
    return float(val) if val else 0.0


@router.get("/status")
async def sync_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sync:read"))
):
    """返回所有需要同步的表的最新时间戳。
    前端每 10s 轮询此端点，对比本地 lastSyncTime 决定是否拉取增量。
    """
    return {
        "parts": _max_ts(db, "part_masters"),
        "documents": _max_ts(db, "document_revisions"),
        "bom_items": _max_ts(db, "bom_items"),
        "ecrs": _max_ts(db, "ecrs"),
        "ecos": _max_ts(db, "ecos"),
        "config_items": _max_ts(db, "configuration_item_masters"),
    }
