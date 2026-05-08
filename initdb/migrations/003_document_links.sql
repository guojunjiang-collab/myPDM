-- 003: 移除 entity_documents 关联表，改用 document_links JSONB
-- 开发环境，不迁移旧数据

-- 添加 document_links 列（如不存在）
ALTER TABLE parts ADD COLUMN IF NOT EXISTS document_links JSONB DEFAULT '[]';
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS document_links JSONB DEFAULT '[]';

-- 确保其他模型中存在但数据库可能缺失的列
ALTER TABLE parts ADD COLUMN IF NOT EXISTS material VARCHAR(128);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS unit VARCHAR(32);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS supplier VARCHAR(255);
ALTER TABLE parts ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS material VARCHAR(128);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS unit VARCHAR(32);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2);
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS remark TEXT;

-- 删除旧关联表
DROP TABLE IF EXISTS entity_documents;
