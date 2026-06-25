"""项目管理 - 启动迁移辅助"""
import datetime
from sqlalchemy import text


def parse_iso_date(v):
    """把 'YYYY-MM-DD' 解析为 date;无法解析或空返回 None。"""
    if not v:
        return None
    if isinstance(v, datetime.date):
        return v
    try:
        return datetime.datetime.strptime(str(v).strip(), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


_DATE_COLS = ("planned_start", "planned_end", "actual_start", "actual_end")


def migrate_task_dates_to_date(db, engine):
    """把 project_tasks 四个日期列从 varchar 迁为 date(仅 Postgres,幂等)。

    SQLite 无需迁移(测试库每次按模型新建)。Postgres 旧库若列仍是字符型,
    逐行解析后 ALTER TYPE;无法解析的值置 NULL。
    """
    if engine.dialect.name != "postgresql":
        return
    insp_sql = text(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = 'project_tasks' AND column_name = :col"
    )
    for col in _DATE_COLS:
        row = db.execute(insp_sql, {"col": col}).fetchone()
        if not row:
            continue  # 列不存在(全新库交由 create_all)
        data_type = row[0]
        if data_type == "date":
            continue  # 已迁移,幂等跳过
        # 先把非法/空字符串规整为可转换或 NULL
        db.execute(text(
            f"UPDATE project_tasks SET {col} = NULL "
            f"WHERE {col} IS NOT NULL AND {col} !~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}$'"
        ))
        db.commit()
        db.execute(text(
            f"ALTER TABLE project_tasks ALTER COLUMN {col} TYPE date "
            f"USING NULLIF({col}, '')::date"
        ))
        db.commit()
        print(f"✓ Migrated project_tasks.{col} varchar -> date")
