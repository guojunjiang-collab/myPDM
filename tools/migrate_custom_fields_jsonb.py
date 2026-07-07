"""
将 PartIteration.custom_fields JSONB 数据迁移到 custom_field_values 关系表
用法: python tools/migrate_custom_fields_jsonb.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from app.database import SessionLocal
from app import models_parts, models
from app.models import CustomFieldValue, CustomFieldDefinition
from sqlalchemy import text


def migrate():
    db = SessionLocal()
    try:
        # 1. 加载所有字段定义（按 name 索引——JSONB 中存储的键是字段中文名）
        defs = db.query(CustomFieldDefinition).all()
        name_to_def = {d.name: d for d in defs}

        # 2. 用原生 SQL 查找有自定义字段的迭代（模型已移除 JSONB 列，但数据库列还在）
        rows = db.execute(
            text("SELECT id, revision_id, custom_fields FROM part_iterations "
                 "WHERE custom_fields IS NOT NULL AND custom_fields != '{}'::jsonb")
        ).fetchall()

        migrated = 0
        skipped = []

        for row in rows:
            it_id, revision_id, cf_raw = row
            cf = dict(cf_raw or {})
            if not cf:
                continue
            revision = db.query(models_parts.PartRevision).filter(
                models_parts.PartRevision.id == revision_id
            ).first()
            if not revision:
                continue

            for field_key, value in cf.items():
                field_def = name_to_def.get(field_key)
                if not field_def:
                    skipped.append(f"iteration={it_id} key={field_key}")
                    continue

                existing = db.query(CustomFieldValue).filter(
                    CustomFieldValue.field_id == field_def.id,
                    CustomFieldValue.entity_type == 'component',
                    CustomFieldValue.entity_id == revision.id,
                    CustomFieldValue.iteration_id == it_id,
                ).first()
                if existing:
                    continue

                new_val = CustomFieldValue(
                    field_id=field_def.id,
                    entity_type='component',
                    entity_id=revision.id,
                    iteration_id=it_id,
                )
                if field_def.field_type in ('text', 'select'):
                    new_val.value_text = str(value) if value is not None else None
                elif field_def.field_type == 'number':
                    try:
                        new_val.value_number = float(value)
                    except (ValueError, TypeError):
                        skipped.append(f"iteration={it_id} key={field_key} bad_number={value}")
                        continue
                elif field_def.field_type == 'multiselect':
                    new_val.value_json = value if isinstance(value, list) else None

                db.add(new_val)
                migrated += 1

        db.commit()
        print(f"迁移完成: {migrated} 条记录")
        if skipped:
            print(f"跳过 {len(skipped)} 条:")
            for s in skipped:
                print(f"  {s}")

        print("\n迁移成功。确认无误后执行:")
        print("ALTER TABLE part_iterations DROP COLUMN IF EXISTS custom_fields;")

    finally:
        db.close()


if __name__ == '__main__':
    migrate()
