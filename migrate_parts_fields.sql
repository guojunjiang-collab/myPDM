-- 迁移脚本：为 parts 和 assemblies 表添加新字段
-- 运行方式: docker exec -i bom_postgres psql -U bomadmin -d bom_system < migrate_parts_fields.sql

-- 为 parts 表添加新字段
ALTER TABLE parts ADD COLUMN IF NOT EXISTS material VARCHAR(128);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS unit VARCHAR(32);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS supplier VARCHAR(255);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS remark TEXT;

-- 为 assemblies 表添加新字段（如果有旧数据的话）
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS material VARCHAR(128);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS unit VARCHAR(32);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS remark TEXT;

-- 删除旧的 assemblies code 唯一约束（如果存在），替换为 code+version 唯一约束
-- 注意：这条语句在 assemblies 表为空时可以安全执行
DO $$
BEGIN
    -- 检查是否需要修改约束
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'assemblies_code_key'
    ) THEN
        ALTER TABLE assemblies DROP CONSTRAINT assemblies_code_key;
    END IF;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 为 assemblies 添加 code+version 唯一约束
ALTER TABLE assemblies ADD CONSTRAINT uix_assembly_code_version UNIQUE (code, version);