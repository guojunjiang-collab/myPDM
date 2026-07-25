"""构型项零部件版本级绑定迁移：加 revision_id 列并回填最新版。幂等，PostgreSQL。"""
from sqlalchemy import text


def migrate_config_part_revision(db, engine):
    db.execute(text(
        "ALTER TABLE configuration_item_parts ADD COLUMN IF NOT EXISTS revision_id UUID"
    ))
    db.execute(text("""
        UPDATE configuration_item_parts cip
        SET revision_id = (
            SELECT pr.id FROM part_revisions pr
            WHERE pr.master_id = cip.part_id AND pr.deleted_at IS NULL
            ORDER BY pr.created_at DESC
            LIMIT 1
        )
        WHERE cip.revision_id IS NULL
    """))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_cip_revision_id "
        "ON configuration_item_parts(revision_id)"
    ))
    db.commit()
