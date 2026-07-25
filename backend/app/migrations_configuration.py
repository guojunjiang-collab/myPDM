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


def migrate_config_list_part_revision(db, engine):
    """配置清单 working/formal 表加 part_revision_id 列（幂等）"""
    db.execute(text(
        "ALTER TABLE configuration_working_items ADD COLUMN IF NOT EXISTS part_revision_id UUID"
    ))
    db.execute(text(
        "ALTER TABLE configuration_profile_items ADD COLUMN IF NOT EXISTS part_revision_id UUID"
    ))
    db.commit()


def migrate_cip_dedup_revision(db, engine):
    """清理 configuration_item_parts 中 (iteration_id, revision_id) 重复行 + 加唯一索引（幂等）"""
    db.execute(text("""
        DELETE FROM configuration_item_parts
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY iteration_id, revision_id ORDER BY created_at
                       ) AS rn
                FROM configuration_item_parts
                WHERE revision_id IS NOT NULL
            ) sub
            WHERE sub.rn > 1
        )
    """))
    db.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uix_cip_iteration_revision "
        "ON configuration_item_parts(iteration_id, revision_id) "
        "WHERE revision_id IS NOT NULL"
    ))
    db.commit()
