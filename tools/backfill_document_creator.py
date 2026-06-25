#!/usr/bin/env python3
"""从 operation_logs 回填 documents.creator_id（幂等）。

仅处理 creator_id 为空的文档；按最早一条"创建图文档"日志取 user_id。
找不到日志的文档保持空置。

Run（容器内或配好 DATABASE_URL 后）: python tools/backfill_document_creator.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.models import Document, OperationLog  # noqa: E402


def backfill(db) -> int:
    docs = db.query(Document).filter(Document.creator_id.is_(None)).all()
    filled = 0
    for d in docs:
        log = (db.query(OperationLog)
               .filter(OperationLog.target_type == "document",
                       OperationLog.target_id == str(d.id),
                       OperationLog.action == "创建图文档")
               .order_by(OperationLog.created_at.asc())
               .first())
        if log and log.user_id:
            d.creator_id = log.user_id
            filled += 1
    db.commit()
    return filled


def main():
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        n = backfill(db)
        print(f"✓ backfilled creator_id for {n} document(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
