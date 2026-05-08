-- 004: 移除不需要的字段
-- 零件: material, unit, price, supplier
-- 部件: material, unit, price
-- 图文档附件: file_data（文件已存储在文件系统）

-- 零件表
ALTER TABLE parts DROP COLUMN IF EXISTS material;
ALTER TABLE parts DROP COLUMN IF EXISTS unit;
ALTER TABLE parts DROP COLUMN IF EXISTS price;
ALTER TABLE parts DROP COLUMN IF EXISTS supplier;

-- 部件表
ALTER TABLE assemblies DROP COLUMN IF EXISTS material;
ALTER TABLE assemblies DROP COLUMN IF EXISTS unit;
ALTER TABLE assemblies DROP COLUMN IF EXISTS price;

-- 图文档附件表
ALTER TABLE document_attachments DROP COLUMN IF EXISTS file_data;
