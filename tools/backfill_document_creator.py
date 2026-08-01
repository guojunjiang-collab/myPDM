#!/usr/bin/env python3
"""从 operation_logs 回填图文档创建者（幂等）。

v3.1.3 起 creator_id 从 Master/Revision 下移到 DocumentIteration，本脚本相应改为
回填 document_iterations.creator_id：

- 只处理 creator_id 为空的迭代；
- "创建图文档"日志的 target_id 记的是 revision_id（见 routers/documents.py 的 create_log），
  故按 revision 匹配日志，回填该 revision 下的迭代；
- 找不到日志的迭代保持空置。

Run（容器内或配好 DATABASE_URL 后）: python tools/backfill_document_creator.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.models import DocumentIteration, OperationLog  # noqa: E402


def backfill(db) -> int:
    iterations = (db.query(DocumentIteration)
                  .filter(DocumentIteration.creator_id.is_(None),
                          DocumentIteration.deleted_at.is_(None))
                  .all())
    filled = 0
    for it in iterations:
        log = (db.query(OperationLog)
               .filter(OperationLog.target_type == "document",
                       OperationLog.target_id == str(it.revision_id),
                       OperationLog.action == "创建图文档")
               .order_by(OperationLog.created_at.asc())
               .first())
        if log and log.user_id:
            it.creator_id = log.user_id
            filled += 1
    db.commit()
    return filled


def main():
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        n = backfill(db)
        print(f"✓ backfilled creator_id for {n} document iteration(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
