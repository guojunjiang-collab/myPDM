"""零部件统一化迁移：parts + assemblies → components

幂等设计：可重复执行，已迁移的行不会重复插入。
仅在 PostgreSQL 环境执行（测试库 SQLite 跳过）。
"""
from sqlalchemy import text


def migrate_components(db, engine):
    if engine.dialect.name != "postgresql":
        return

    # 1. 创建 components 表（若已存在则跳过）
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS components (
            id UUID PRIMARY KEY,
            code VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            spec VARCHAR(255),
            version VARCHAR(32) DEFAULT 'A',
            status VARCHAR(32) NOT NULL DEFAULT 'draft',
            remark TEXT,
            revisions JSONB DEFAULT '[]',
            revision_parent_id UUID,
            creator_id UUID,
            document_links JSONB DEFAULT '[]',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            deleted_at TIMESTAMPTZ
        )
    """))

    db.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uix_component_code_version
        ON components (code, version)
        WHERE deleted_at IS NULL
    """))

    # 1b. 创建 component_attachments 表（照抄 document_attachments，若已存在跳过）
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS component_attachments (
            id UUID PRIMARY KEY,
            component_id UUID NOT NULL REFERENCES components(id) ON DELETE CASCADE,
            category VARCHAR(32) NOT NULL,
            file_name VARCHAR(255),
            file_size INTEGER,
            file_path VARCHAR(512),
            file_hash VARCHAR(64),
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_component_attachments_comp_cat
        ON component_attachments (component_id, category)
    """))

    # 2. 迁移 parts（跳过 id 已存在的行）
    db.execute(text("""
        INSERT INTO components
            (id, code, name, spec, version, status, remark,
             revisions, revision_parent_id, creator_id, document_links,
             created_at, updated_at, deleted_at)
        SELECT
            id, code, name, spec, version, status, remark,
            revisions, revision_parent_id, creator_id, document_links,
            created_at, updated_at, deleted_at
        FROM parts
        WHERE id NOT IN (SELECT id FROM components)
    """))

    # 3. 迁移 assemblies（跳过 id 已存在的行）
    db.execute(text("""
        INSERT INTO components
            (id, code, name, spec, version, status, remark,
             revisions, revision_parent_id, creator_id, document_links,
             created_at, updated_at, deleted_at)
        SELECT
            id, code, name, spec, version, status, remark,
            revisions, revision_parent_id, creator_id, document_links,
            created_at, updated_at, deleted_at
        FROM assemblies
        WHERE id NOT IN (SELECT id FROM components)
    """))

    # 4. bom_items: parent_type / child_type → 'component'
    db.execute(text("""
        UPDATE bom_items
        SET parent_type = 'component'
        WHERE parent_type IN ('part', 'assembly')
    """))
    db.execute(text("""
        UPDATE bom_items
        SET child_type = 'component'
        WHERE child_type IN ('part', 'assembly', 'component')
    """))

    # 5. custom_field_values: entity_type → 'component'
    db.execute(text("""
        UPDATE custom_field_values
        SET entity_type = 'component'
        WHERE entity_type IN ('part', 'assembly')
    """))

    # 6. custom_field_definitions: applies_to 数组内替换（JSONB）
    db.execute(text("""
        UPDATE custom_field_definitions
        SET applies_to = (
            SELECT jsonb_agg(
                CASE
                    WHEN elem IN ('"part"'::jsonb, '"assembly"'::jsonb, '"component"'::jsonb)
                    THEN '"component"'::jsonb
                    ELSE elem
                END
            )
            FROM jsonb_array_elements(applies_to) AS elem
        )
        WHERE applies_to ?| array['part', 'assembly', 'component']
    """))

    # 7. dashboard_items: entity_type → 'component'
    db.execute(text("""
        UPDATE dashboard_items
        SET entity_type = 'component'
        WHERE entity_type IN ('part', 'assembly')
    """))

    # 8. inventory_documents: ref_entity_type → 'component'（若列存在）
    try:
        db.execute(text("""
            UPDATE inventory_documents
            SET ref_entity_type = 'component'
            WHERE ref_entity_type IN ('part', 'assembly')
        """))
    except Exception:
        db.rollback()
        pass

    # 9. project_tasks: entity_type → 'component'（若表/列存在）
    try:
        db.execute(text("""
            UPDATE project_tasks
            SET entity_type = 'component'
            WHERE entity_type IN ('part', 'assembly')
        """))
    except Exception:
        db.rollback()
        pass

    # operation_logs 的 target_type 保留历史值，前端展示时做映射

    # 10. 安全删除旧表（确认 components 表数据完整后）
    parts_count = db.execute(text("SELECT COUNT(*) FROM parts")).scalar()
    asms_count = db.execute(text("SELECT COUNT(*) FROM assemblies")).scalar()
    comps_count = db.execute(text("SELECT COUNT(*) FROM components")).scalar()
    if comps_count >= parts_count + asms_count and parts_count + asms_count > 0:
        db.execute(text("DROP TABLE IF EXISTS parts"))
        db.execute(text("DROP TABLE IF EXISTS assemblies"))
        print("✓ Dropped old parts and assemblies tables")

    db.commit()
