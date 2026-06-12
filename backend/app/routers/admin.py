"""
数据管理 API（仅管理员）
- 查看软删除数据统计
- 清除软删除数据
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
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

    # 按依赖顺序删除：被引用的父表放在引用它的子表之后，
    # 否则同批清理（如同时选 ecrs + ecos）会因外键顺序失败。
    # 目前唯一的可清理表内依赖：ecos.ecr_id -> ecrs。
    purge_order = ["bom_items", "ecos", "ecrs", "configuration_items", "documents", "parts", "assemblies"]
    ordered = [t for t in purge_order if t in tables]

    deleted_counts = {}
    skipped = {}
    for tbl in ordered:
        try:
            # 每个表单独 SAVEPOINT：某个表因外键约束失败时只回滚该表，
            # 不影响其它表已完成的清理，整体不再返回 500。
            with db.begin_nested():
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
        except IntegrityError as e:
            deleted_counts[tbl] = 0
            # 从底层 psycopg2 错误中取出仍在引用该表的子表名，给出可读原因
            ref_table = getattr(getattr(e.orig, "diag", None), "table_name", None)
            skipped[tbl] = (
                f"仍被「{ref_table}」表中的现有记录引用，无法清理" if ref_table
                else "仍被其他现有记录引用，无法清理"
            )

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    detail = f"清理了 {sum(deleted_counts.values())} 条记录: {deleted_counts}"
    if skipped:
        detail += f"；跳过: {skipped}"
    crud.create_log(
        db, current_user.id, current_user.username,
        "清除软删除数据", "admin", "purge",
        detail,
        ip
    )

    return {
        "deleted_counts": deleted_counts,
        "skipped": skipped,
        "total": sum(deleted_counts.values())
    }
