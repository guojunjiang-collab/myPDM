-- ============================================================
-- 011: 图文档三层模型重构（Master → Revision → Iteration）
-- ============================================================
-- 将扁平 documents 表拆分为 document_masters + document_revisions，
-- 同时更新 document_iterations、document_attachments、
-- document_group_links 的外键指向。
-- 此脚本幂等——对已迁移的数据库再次运行不会出错。
-- ============================================================

BEGIN;

-- ── 1. 创建新表 ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_masters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    revisions JSONB DEFAULT '[]'::jsonb,
    creator_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id UUID NOT NULL REFERENCES document_masters(id) ON DELETE CASCADE,
    version VARCHAR(32) NOT NULL DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark TEXT,
    revision_parent_id UUID,
    check_out_user_id UUID,
    check_out_date TIMESTAMPTZ,
    latest_iteration INTEGER NOT NULL DEFAULT 0,
    creator_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_dr_master_id ON document_revisions(master_id);
CREATE INDEX IF NOT EXISTS idx_dr_status ON document_revisions(status);

-- ── 2. 迁移旧数据 → 新表 ──────────────────────────────────

-- 仅当旧表 documents 存在时执行数据迁移
DO $$
DECLARE
    doc_record RECORD;
    master_id_val UUID;
    revision_id_val UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'documents') THEN

        -- 检查新表是否已有数据（幂等保护）
        IF NOT EXISTS (SELECT 1 FROM document_masters LIMIT 1) THEN

            -- 2a. 主数据：按 code 去重，取第一条记录的 name/creator_id 等作为 master 属性
            FOR doc_record IN
                SELECT DISTINCT ON (code)
                    code, id AS old_id, name, COALESCE(revisions, '[]'::jsonb) AS revisions,
                    creator_id, created_at, updated_at, deleted_at
                FROM documents
                ORDER BY code, created_at ASC
            LOOP
                master_id_val := gen_random_uuid();
                INSERT INTO document_masters (id, code, name, revisions, creator_id, created_at, updated_at, deleted_at)
                VALUES (master_id_val, doc_record.code, doc_record.name, doc_record.revisions,
                        doc_record.creator_id, doc_record.created_at, doc_record.updated_at, doc_record.deleted_at);
            END LOOP;

            -- 2b. 为每个旧文档记录创建对应 revision，关联到去重后的 master
            FOR doc_record IN
                SELECT d.id AS old_doc_id, d.code, COALESCE(d.version, 'A') AS version,
                       COALESCE(d.status, 'draft') AS status, d.remark,
                       d.revision_parent_id, d.check_out_user_id, d.check_out_date,
                       COALESCE(d.latest_iteration, 0) AS latest_iteration,
                       d.creator_id, d.created_at, d.deleted_at,
                       m.id AS master_id
                FROM documents d
                JOIN document_masters m ON m.code = d.code
            LOOP
                revision_id_val := gen_random_uuid();
                INSERT INTO document_revisions (id, master_id, version, status, remark,
                    revision_parent_id, check_out_user_id, check_out_date,
                    latest_iteration, creator_id, created_at, deleted_at)
                VALUES (revision_id_val, doc_record.master_id, doc_record.version, doc_record.status,
                    doc_record.remark, doc_record.revision_parent_id,
                    doc_record.check_out_user_id, doc_record.check_out_date,
                    doc_record.latest_iteration, doc_record.creator_id, doc_record.created_at,
                    doc_record.deleted_at);
            END LOOP;

            -- 2c. 为 latest_iteration=0 的存量文档补建迭代 1
            FOR doc_record IN
                SELECT d.id AS old_doc_id, r.id AS revision_id, d.created_at
                FROM documents d
                JOIN document_masters m ON m.code = d.code
                JOIN document_revisions r ON r.master_id = m.id AND r.version = COALESCE(d.version, 'A')
                WHERE COALESCE(d.latest_iteration, 0) = 0 AND d.deleted_at IS NULL
            LOOP
                INSERT INTO document_iterations (id, revision_id, iteration, check_in_date, check_in_note, created_at)
                VALUES (gen_random_uuid(), doc_record.revision_id, 1, NULL, NULL, doc_record.created_at);

                UPDATE document_revisions SET latest_iteration = 1 WHERE id = doc_record.revision_id;
            END LOOP;

        END IF;

    END IF;
END $$;

-- ── 3. 迁移 document_iterations FK ───────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'document_iterations' AND column_name = 'document_id') THEN

        ALTER TABLE document_iterations ADD COLUMN IF NOT EXISTS revision_id UUID;

        -- 通过旧 documents → 新 master(code) + version → revision 关联
        UPDATE document_iterations i SET revision_id = (
            SELECT r.id FROM document_revisions r
            JOIN document_masters m ON r.master_id = m.id
            JOIN documents d ON d.code = m.code
            WHERE d.id = i.document_id
              AND r.version = COALESCE(d.version, 'A')
        );

        ALTER TABLE document_iterations DROP CONSTRAINT IF EXISTS document_iterations_document_id_fkey;
        ALTER TABLE document_iterations DROP COLUMN IF EXISTS document_id CASCADE;

        ALTER TABLE document_iterations ALTER COLUMN revision_id SET NOT NULL;

        ALTER TABLE document_iterations
            ADD CONSTRAINT fk_di_revision FOREIGN KEY (revision_id)
            REFERENCES document_revisions(id) ON DELETE CASCADE;

    END IF;
END $$;

-- ── 4. 迁移 document_attachments FK ──────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'document_attachments' AND column_name = 'document_id') THEN

        ALTER TABLE document_attachments ADD COLUMN IF NOT EXISTS revision_id UUID;

        -- 优先通过迭代关联找到 revision_id
        UPDATE document_attachments a SET revision_id = (
            SELECT i.revision_id FROM document_iterations i
            WHERE i.id = a.iteration_id
        );

        -- 没有迭代关联的附件，通过旧 document_id → code + version → revision
        UPDATE document_attachments a SET revision_id = (
            SELECT r.id FROM document_revisions r
            JOIN document_masters m ON r.master_id = m.id
            JOIN documents d ON d.code = m.code AND r.version = COALESCE(d.version, 'A')
            WHERE d.id = a.document_id
        )
        WHERE a.revision_id IS NULL;

        ALTER TABLE document_attachments DROP CONSTRAINT IF EXISTS document_attachments_document_id_fkey;
        ALTER TABLE document_attachments DROP COLUMN IF EXISTS document_id CASCADE;

        ALTER TABLE document_attachments ALTER COLUMN revision_id SET NOT NULL;

        ALTER TABLE document_attachments
            ADD CONSTRAINT fk_da_revision FOREIGN KEY (revision_id)
            REFERENCES document_revisions(id) ON DELETE CASCADE;

    END IF;
END $$;

-- ── 5. 迁移 document_group_links FK ──────────────────────

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'document_group_links' AND column_name = 'document_id') THEN

        -- document_group_links 的 document_id → 通过 code 找到新 master
        ALTER TABLE document_group_links ADD COLUMN IF NOT EXISTS new_document_id UUID;

        UPDATE document_group_links gl SET new_document_id = (
            SELECT m.id FROM document_masters m
            JOIN documents d ON d.code = m.code
            WHERE d.id = gl.document_id
        );

        ALTER TABLE document_group_links DROP CONSTRAINT IF EXISTS document_group_links_document_id_fkey;
        ALTER TABLE document_group_links DROP COLUMN IF EXISTS document_id CASCADE;

        ALTER TABLE document_group_links RENAME COLUMN new_document_id TO document_id;

        ALTER TABLE document_group_links ALTER COLUMN document_id SET NOT NULL;

        ALTER TABLE document_group_links
            ADD CONSTRAINT fk_dgl_document FOREIGN KEY (document_id)
            REFERENCES document_masters(id) ON DELETE CASCADE;

    END IF;
END $$;

-- ── 6. 删除旧主表 ────────────────────────────────────────

DROP TABLE IF EXISTS documents CASCADE;

COMMIT;
