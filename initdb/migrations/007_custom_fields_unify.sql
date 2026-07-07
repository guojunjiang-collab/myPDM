-- 007_custom_fields_unify.sql
-- 自定义字段统一：新增 iteration_id 列

ALTER TABLE custom_field_values ADD COLUMN IF NOT EXISTS iteration_id UUID;
CREATE INDEX IF NOT EXISTS idx_cf_val_iter ON custom_field_values(iteration_id);
