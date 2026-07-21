-- ============================================================
-- 010: 构型项三层模型重构（Master → Revision → Iteration）
-- ============================================================
-- 将扁平 configuration_items 表拆分为三张新表，同时更新
-- 所有关联表的外键指向。
-- 此脚本幂等——对已迁移的数据库再次运行不会出错。
-- ============================================================

BEGIN;

-- ── 1. 创建新表 ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS configuration_item_masters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    remark TEXT,
    creator_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS configuration_item_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID NOT NULL REFERENCES configuration_item_masters(id),
    version VARCHAR(8) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    check_out_user_id UUID,
    check_out_date TIMESTAMPTZ,
    latest_iteration INTEGER NOT NULL DEFAULT 1,
    creator_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS configuration_item_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id UUID NOT NULL REFERENCES configuration_item_revisions(id),
    iteration INTEGER NOT NULL,
    check_in_note TEXT,
    version_spec VARCHAR(255),
    version_remark TEXT,
    version_name VARCHAR(255),
    document_links JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cir_master_id ON configuration_item_revisions(master_id);
CREATE INDEX IF NOT EXISTS idx_cir_status ON configuration_item_revisions(status);
CREATE INDEX IF NOT EXISTS idx_cii_revision_id ON configuration_item_iterations(revision_id);

-- ── 2. 迁移旧数据 → 新表 ──────────────────────────────────

-- 仅当旧表 configuration_items 存在时执行数据迁移
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'configuration_items') THEN

        -- 检查新表是否已有数据（幂等保护）
        IF NOT EXISTS (SELECT 1 FROM configuration_item_masters LIMIT 1) THEN

            -- 2a. 主数据（保留原始 id，保证 code 唯一约束延续）
            INSERT INTO configuration_item_masters (id, code, name, spec, remark, creator_id, created_at, updated_at, deleted_at)
            SELECT id, code, name, spec, remark, creator_id, created_at, updated_at, deleted_at
            FROM configuration_items;

            -- 2b. 为每个未删除的主数据创建版本 A + 迭代 1
            INSERT INTO configuration_item_revisions (id, master_id, version, status, creator_id, created_at)
            SELECT gen_random_uuid(), id, 'A', 'draft', creator_id, created_at
            FROM configuration_item_masters
            WHERE deleted_at IS NULL;

            -- 2c. 为每个版本创建迭代 1，复制旧字段数据
            INSERT INTO configuration_item_iterations (id, revision_id, iteration, version_spec, version_remark, version_name, document_links, created_at)
            SELECT gen_random_uuid(), r.id, 1, m.spec, m.remark, m.name, ci.document_links, ci.created_at
            FROM configuration_items ci
            JOIN configuration_item_masters m ON ci.id = m.id
            JOIN configuration_item_revisions r ON r.master_id = m.id;

        END IF;

    END IF;
END $$;

-- ── 3. 迁移 configuration_item_parts ─────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'configuration_item_parts' AND column_name = 'configuration_item_id') THEN

        ALTER TABLE configuration_item_parts ADD COLUMN IF NOT EXISTS iteration_id UUID;

        UPDATE configuration_item_parts p SET iteration_id = (
            SELECT i.id FROM configuration_item_revisions r
            JOIN configuration_item_iterations i ON i.revision_id = r.id
            WHERE r.master_id = p.configuration_item_id
        );

        ALTER TABLE configuration_item_parts DROP COLUMN IF EXISTS configuration_item_id CASCADE;

        ALTER TABLE configuration_item_parts ALTER COLUMN iteration_id SET NOT NULL;

        ALTER TABLE configuration_item_parts
            ADD CONSTRAINT fk_cip_iteration FOREIGN KEY (iteration_id)
            REFERENCES configuration_item_iterations(id) ON DELETE CASCADE;

    END IF;
END $$;

-- ── 4. 迁移 configuration_item_children ──────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'configuration_item_children' AND column_name = 'parent_id') THEN

        -- 先解除旧的唯一约束（自动随列删除，此处显式清理以防残留）
        ALTER TABLE configuration_item_children DROP CONSTRAINT IF EXISTS uix_config_child;

        ALTER TABLE configuration_item_children ADD COLUMN IF NOT EXISTS parent_iteration_id UUID;
        ALTER TABLE configuration_item_children ADD COLUMN IF NOT EXISTS child_revision_id UUID;

        UPDATE configuration_item_children c SET parent_iteration_id = (
            SELECT i.id FROM configuration_item_revisions r
            JOIN configuration_item_iterations i ON i.revision_id = r.id
            WHERE r.master_id = c.parent_id
        );

        UPDATE configuration_item_children c SET child_revision_id = (
            SELECT r.id FROM configuration_item_revisions r
            WHERE r.master_id = c.child_id
        );

        ALTER TABLE configuration_item_children DROP COLUMN IF EXISTS parent_id CASCADE;
        ALTER TABLE configuration_item_children DROP COLUMN IF EXISTS child_id CASCADE;

        ALTER TABLE configuration_item_children ALTER COLUMN parent_iteration_id SET NOT NULL;
        ALTER TABLE configuration_item_children ALTER COLUMN child_revision_id SET NOT NULL;

        ALTER TABLE configuration_item_children
            ADD CONSTRAINT fk_cic_parent FOREIGN KEY (parent_iteration_id)
            REFERENCES configuration_item_iterations(id) ON DELETE CASCADE;

        ALTER TABLE configuration_item_children
            ADD CONSTRAINT fk_cic_child FOREIGN KEY (child_revision_id)
            REFERENCES configuration_item_revisions(id) ON DELETE CASCADE;

        ALTER TABLE configuration_item_children
            ADD CONSTRAINT uix_config_child UNIQUE (parent_iteration_id, child_revision_id);

    END IF;
END $$;

-- ── 5. 迁移 configuration_profiles ───────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'configuration_profiles' AND column_name = 'configuration_item_id') THEN

        ALTER TABLE configuration_profiles ADD COLUMN IF NOT EXISTS configuration_item_revision_id UUID;

        UPDATE configuration_profiles p SET configuration_item_revision_id = (
            SELECT r.id FROM configuration_item_revisions r
            WHERE r.master_id = p.configuration_item_id
        );

        ALTER TABLE configuration_profiles DROP COLUMN IF EXISTS configuration_item_id CASCADE;

    END IF;
END $$;

-- ── 6. 迁移 configuration_profile_items ──────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'configuration_profile_items' AND column_name = 'source_config_item_id') THEN

        ALTER TABLE configuration_profile_items ADD COLUMN IF NOT EXISTS source_config_item_revision_id UUID;
        ALTER TABLE configuration_profile_items ADD COLUMN IF NOT EXISTS source_config_item_iteration_id UUID;

        UPDATE configuration_profile_items p SET source_config_item_revision_id = (
            SELECT r.id FROM configuration_item_revisions r
            WHERE r.master_id = p.source_config_item_id
        );

        UPDATE configuration_profile_items p SET source_config_item_iteration_id = (
            SELECT i.id FROM configuration_item_revisions r
            JOIN configuration_item_iterations i ON i.revision_id = r.id
            WHERE r.master_id = p.source_config_item_id
        );

        ALTER TABLE configuration_profile_items DROP COLUMN IF EXISTS source_config_item_id CASCADE;

    END IF;
END $$;

-- ── 7. 迁移 configuration_working_items ──────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'configuration_working_items' AND column_name = 'source_config_item_id') THEN

        ALTER TABLE configuration_working_items ADD COLUMN IF NOT EXISTS source_config_item_revision_id UUID;
        ALTER TABLE configuration_working_items ADD COLUMN IF NOT EXISTS source_config_item_iteration_id UUID;

        UPDATE configuration_working_items w SET source_config_item_revision_id = (
            SELECT r.id FROM configuration_item_revisions r
            WHERE r.master_id = w.source_config_item_id
        );

        UPDATE configuration_working_items w SET source_config_item_iteration_id = (
            SELECT i.id FROM configuration_item_revisions r
            JOIN configuration_item_iterations i ON i.revision_id = r.id
            WHERE r.master_id = w.source_config_item_id
        );

        ALTER TABLE configuration_working_items DROP COLUMN IF EXISTS source_config_item_id CASCADE;

    END IF;
END $$;

-- ── 8. 删除旧主表 ────────────────────────────────────────

DROP TABLE IF EXISTS configuration_items CASCADE;

COMMIT;
