"""
数据管理 API（仅管理员）
- 查看软删除数据统计
- 清除软删除数据
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional

from ..database import get_db
from ..models import User
from .auth import require_role

router = APIRouter(prefix="/admin", tags=["数据管理"])


@router.get("/soft-deleted-stats")
async def get_soft_deleted_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    """获取各表软删除记录统计"""
    tables = ["parts", "assemblies", "documents", "bom_items", "ecrs", "ecos", "configuration_items"]
    stats = {}

    for tbl in tables:
        result = db.execute(text(f"""
            SELECT 
                COUNT(*) as count,
                MIN(deleted_at)::timestamptz as earliest,
                MAX(deleted_at)::timestamptz as latest
            FROM {tbl}
            WHERE deleted_at IS NOT NULL
        """))
        row = result.fetchone()
        stats[tbl] = {
            "count": row[0] or 0,
            "earliest": row[1].isoformat() if row[1] else None,
            "latest": row[2].isoformat() if row[2] else None,
        }

    return stats


@router.post("/purge-soft-deleted")
async def purge_soft_deleted(
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin"]))
):
    """清除指定表的软删除数据。
    
    请求体:
    {
        "tables": ["parts", "assemblies"],  // 要清理的表名列表
        "before_date": "2026-04-01",         // 可选: 只清理此日期之前的数据
        "confirm": true                      // 必须为 true 才执行
    }
    """
    if not body.get("confirm"):
        raise HTTPException(status_code=400, detail="需要确认操作（confirm: true）")

    tables = body.get("tables", [])
    if not tables:
        raise HTTPException(status_code=400, detail="请指定要清理的表")

    allowed_tables = {"parts", "assemblies", "documents", "bom_items", "ecrs", "ecos", "configuration_items"}
    for tbl in tables:
        if tbl not in allowed_tables:
            raise HTTPException(status_code=400, detail=f"无效的表名: {tbl}")

    before_date = body.get("before_date")
    
    deleted_counts = {}
    for tbl in tables:
        if before_date:
            result = db.execute(text(f"""
                DELETE FROM {tbl}
                WHERE deleted_at IS NOT NULL AND deleted_at < :before_date
            """), {"before_date": before_date})
        else:
            result = db.execute(text(f"""
                DELETE FROM {tbl}
                WHERE deleted_at IS NOT NULL
            """))
        deleted_counts[tbl] = result.rowcount

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(
        db, current_user.id, current_user.username,
        "清除软删除数据", "admin", "purge",
        f"清理了 {sum(deleted_counts.values())} 条记录: {deleted_counts}",
        ip
    )

    return {
        "deleted_counts": deleted_counts,
        "total": sum(deleted_counts.values())
    }
