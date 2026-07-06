-- 008: 创建零部件三层模型表 (PartMaster/PartRevision/PartIteration/PartAttachment)
-- 改造 BOMItem 表以适配新模型

-- 1. 创建 part_masters 表
CREATE TABLE IF NOT EXISTS part_masters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    type VARCHAR(16) NOT NULL DEFAULT 'part',
    creator_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_master_code ON part_masters (code) WHERE deleted_at IS NULL;

-- 2. 创建 part_revisions 表
CREATE TABLE IF NOT EXISTS part_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID NOT NULL REFERENCES part_masters(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    revision_note TEXT,
    check_out_user_id UUID REFERENCES users(id),
    check_out_date TIMESTAMPTZ,
    latest_iteration INTEGER NOT NULL DEFAULT 0,
    revision_parent_id UUID,
    creator_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_revision_master_version ON part_revisions (master_id, version) WHERE deleted_at IS NULL;

-- 3. 创建 part_iterations 表
CREATE TABLE IF NOT EXISTS part_iterations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id UUID NOT NULL REFERENCES part_revisions(id) ON DELETE CASCADE,
    iteration INTEGER NOT NULL DEFAULT 1,
    check_in_date TIMESTAMPTZ,
    check_in_note TEXT,
    custom_fields JSONB DEFAULT '{}',
    document_links JSONB DEFAULT '[]',
    remark TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uix_part_iteration_revision_iter ON part_iterations (revision_id, iteration);

-- 4. 创建 part_attachments 表
CREATE TABLE IF NOT EXISTS part_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    iteration_id UUID NOT NULL REFERENCES part_iterations(id) ON DELETE CASCADE,
    category VARCHAR(32) NOT NULL,
    file_name VARCHAR(255),
    file_size INTEGER,
    file_path VARCHAR(512),
    file_hash VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. BOMItem 表改造（仅当旧结构存在且新列不存在时执行）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bom_items' AND column_name='parent_type') THEN
        -- 添加新列
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS iteration_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS parent_revision_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS child_revision_id UUID;
        ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
        -- 旧列保留兼容但去除 NOT NULL，否则新模型（仅写 *_revision_id）插入会报 500
        ALTER TABLE bom_items ALTER COLUMN parent_type DROP NOT NULL;
        ALTER TABLE bom_items ALTER COLUMN parent_id DROP NOT NULL;
        ALTER TABLE bom_items ALTER COLUMN child_type DROP NOT NULL;
        ALTER TABLE bom_items ALTER COLUMN child_id DROP NOT NULL;
    END IF;
END $$;

-- 6. 从现有 components 表迁移数据到新表
INSERT INTO part_masters (id, code, name, spec, type, creator_id, created_at, updated_at, deleted_at)
SELECT
    c.id,
    c.code,
    c.name,
    c.spec,
    CASE WHEN EXISTS (SELECT 1 FROM bom_items b WHERE b.parent_type = 'component' AND b.parent_id = c.id AND b.deleted_at IS NULL)
         THEN 'assembly' ELSE 'part' END,
    c.creator_id,
    c.created_at,
    c.updated_at,
    c.deleted_at
FROM components c
WHERE c.revision_parent_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO part_revisions (id, master_id, version, status, revision_parent_id, creator_id, created_at, updated_at, deleted_at, latest_iteration)
SELECT
    gen_random_uuid(),
    c.id,
    c.version,
    c.status,
    c.revision_parent_id,
    c.creator_id,
    c.created_at,
    c.updated_at,
    c.deleted_at,
    1
FROM components c
ON CONFLICT DO NOTHING;

INSERT INTO part_iterations (id, revision_id, iteration, custom_fields, document_links, remark, created_at, check_in_date)
SELECT
    gen_random_uuid(),
    pr.id,
    1,
    '{}',
    COALESCE(c.document_links, '[]'),
    c.remark,
    c.created_at,
    c.created_at
FROM components c
JOIN part_revisions pr ON pr.master_id = c.id AND pr.version = c.version
ON CONFLICT DO NOTHING;
