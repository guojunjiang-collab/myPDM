-- 006: 部件 code+version 联合唯一（替代 code 全局唯一）
-- 删除旧的单字段唯一约束
ALTER TABLE assemblies DROP CONSTRAINT IF EXISTS assemblies_code_key;
ALTER TABLE assemblies DROP CONSTRAINT IF EXISTS assemblies_code_unique;
-- 添加联合唯一约束（如不存在）
ALTER TABLE assemblies ADD CONSTRAINT IF NOT EXISTS uix_assembly_code_version UNIQUE (code, version);
