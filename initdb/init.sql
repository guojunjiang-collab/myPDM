-- 启用UUID扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 删除旧的迁移脚本已不需要，所有表定义已合并到此文件

-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    real_name VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL,
    department VARCHAR(128),
    phone VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 零件表
CREATE TABLE parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    version VARCHAR(32) DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark TEXT,
    revisions JSONB DEFAULT '[]',
    revision_parent_id UUID,
    document_links JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uix_part_code_version UNIQUE (code, version)
);

-- 部件表
CREATE TABLE assemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    version VARCHAR(32) DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark TEXT,
    revisions JSONB DEFAULT '[]',
    revision_parent_id UUID,
    document_links JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uix_assembly_code_version UNIQUE (code, version)
);

-- BOM表
CREATE TABLE bom_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_type VARCHAR(16) NOT NULL,
    parent_id UUID NOT NULL,
    child_type VARCHAR(16) NOT NULL,
    child_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 操作日志表
CREATE TABLE operation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    username VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32),
    target_id VARCHAR(64),
    detail TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 图文档主表
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(32) DEFAULT 'A',
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark TEXT,
    file_name VARCHAR(255),
    file_id UUID,
    revisions JSONB DEFAULT '[]',
    revision_parent_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uix_doc_code_version UNIQUE (code, version)
);

-- 图文档独立附件表
CREATE TABLE document_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    file_name VARCHAR(255),
    file_size INTEGER,
    file_path VARCHAR(512),
    file_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 图文档主附件外键
ALTER TABLE documents ADD CONSTRAINT fk_doc_file
    FOREIGN KEY (file_id) REFERENCES document_attachments(id) ON DELETE SET NULL;

-- 自定义字段定义表
CREATE TABLE custom_field_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    field_key VARCHAR(64) UNIQUE NOT NULL,
    field_type VARCHAR(32) NOT NULL,
    options JSONB DEFAULT '[]',
    is_required INTEGER DEFAULT 0,
    applies_to JSONB DEFAULT '["part"]' NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 自定义字段值表
CREATE TABLE custom_field_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    field_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    entity_type VARCHAR(32) NOT NULL,
    entity_id UUID NOT NULL,
    value_text TEXT,
    value_number DECIMAL(12, 4),
    value_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_parts_code ON parts(code);
CREATE INDEX idx_parts_name ON parts(name);
CREATE INDEX idx_parts_status ON parts(status);
CREATE INDEX idx_assemblies_code ON assemblies(code);
CREATE INDEX idx_assemblies_status ON assemblies(status);
CREATE INDEX idx_bom_parent ON bom_items(parent_type, parent_id);
CREATE INDEX idx_bom_item_child ON bom_items(child_type, child_id);
CREATE INDEX idx_cf_def_key ON custom_field_definitions(field_key);
CREATE INDEX idx_cf_val_entity ON custom_field_values(entity_type, entity_id);
CREATE INDEX idx_doc_code ON documents(code);
CREATE INDEX idx_doc_status ON documents(status);
CREATE INDEX idx_doc_att_doc ON document_attachments(document_id);

-- 插入默认用户（密码均为 admin123）
INSERT INTO users (username, password_hash, real_name, role, department, status) VALUES
('admin', '$2b$12$MwgiArsPySEydYloZq.FYu7lixhRufdvZfqC17I2bW4Eo5kRt0Kp2', '系统管理员', 'admin', '信息部', 'active'),
('engineer', '$2b$12$MwgiArsPySEydYloZq.FYu7lixhRufdvZfqC17I2bW4Eo5kRt0Kp2', '张工程师', 'engineer', '研发部', 'active'),
('production', '$2b$12$MwgiArsPySEydYloZq.FYu7lixhRufdvZfqC17I2bW4Eo5kRt0Kp2', '李生产', 'production', '生产部', 'active'),
('guest', '$2b$12$MwgiArsPySEydYloZq.FYu7lixhRufdvZfqC17I2bW4Eo5kRt0Kp2', '访客账户', 'guest', '采购部', 'active');

-- ===== 用户看板 =====

-- 看板主表（每用户一个）
CREATE TABLE user_dashboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    name VARCHAR(128) DEFAULT '我的看板',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_user_dashboards_user_id ON user_dashboards(user_id);

-- 看板文件夹表（树形结构）
CREATE TABLE dashboard_folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dashboard_id UUID NOT NULL REFERENCES user_dashboards(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES dashboard_folders(id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dashboard_folders_dashboard_id ON dashboard_folders(dashboard_id);
CREATE INDEX idx_dashboard_folders_parent_id ON dashboard_folders(parent_id);

-- 文件夹内容关联表
CREATE TABLE dashboard_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES dashboard_folders(id) ON DELETE CASCADE,
    entity_type VARCHAR(16) NOT NULL,
    entity_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dashboard_items_folder_id ON dashboard_items(folder_id);
CREATE INDEX idx_dashboard_items_entity ON dashboard_items(entity_type, entity_id);
CREATE UNIQUE INDEX uix_dashboard_item_folder_entity ON dashboard_items(folder_id, entity_type, entity_id);

-- 文件夹共享表
CREATE TABLE dashboard_folder_shares (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL REFERENCES dashboard_folders(id) ON DELETE CASCADE,
    shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(16) NOT NULL DEFAULT 'view',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_dashboard_shares_folder_id ON dashboard_folder_shares(folder_id);
CREATE INDEX idx_dashboard_shares_user_id ON dashboard_folder_shares(shared_with_user_id);
CREATE UNIQUE INDEX uix_folder_share_user ON dashboard_folder_shares(folder_id, shared_with_user_id);

-- ===== 变更管理 - ECR =====

CREATE TABLE ecrs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecr_number VARCHAR(32) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    reason VARCHAR(64) NOT NULL,
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    category VARCHAR(32),
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    reviewers JSONB NOT NULL DEFAULT '[]',
    review_mode VARCHAR(8) NOT NULL DEFAULT 'all',
    creator_id UUID NOT NULL REFERENCES users(id),
    document_links JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    eco_id UUID
);

CREATE TABLE ecr_affected_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecr_id UUID NOT NULL REFERENCES ecrs(id) ON DELETE CASCADE,
    entity_type VARCHAR(16) NOT NULL,
    entity_id UUID NOT NULL,
    entity_code VARCHAR(64),
    entity_name VARCHAR(255),
    entity_version VARCHAR(32),
    change_description TEXT,
    change_type VARCHAR(32),
    bom_impact JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ecr_review_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecr_id UUID NOT NULL REFERENCES ecrs(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    reviewer_name VARCHAR(64),
    decision VARCHAR(16) NOT NULL,
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ecr_status_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ecr_id UUID NOT NULL REFERENCES ecrs(id) ON DELETE CASCADE,
    from_status VARCHAR(16),
    to_status VARCHAR(16) NOT NULL,
    operator_id UUID NOT NULL REFERENCES users(id),
    operator_name VARCHAR(64),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ecrs_status ON ecrs(status);
CREATE INDEX idx_ecrs_creator ON ecrs(creator_id);
CREATE INDEX idx_ecrs_priority ON ecrs(priority);
CREATE INDEX idx_ecrs_number ON ecrs(ecr_number);
CREATE INDEX idx_ecr_affected_items_ecr ON ecr_affected_items(ecr_id);
CREATE INDEX idx_ecr_affected_items_entity ON ecr_affected_items(entity_type, entity_id);
CREATE INDEX idx_ecr_review_records_ecr ON ecr_review_records(ecr_id);
CREATE INDEX idx_ecr_review_records_reviewer ON ecr_review_records(reviewer_id);
CREATE INDEX idx_ecr_status_logs_ecr ON ecr_status_logs(ecr_id);

-- ============================================================
-- 构型配置模块
-- ============================================================

-- 构型库表
CREATE TABLE configuration_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    spec VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    remark TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 构型库关联零部件
CREATE TABLE configuration_item_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    configuration_item_id UUID NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
    part_type VARCHAR(16) NOT NULL,
    part_id UUID NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cip_config_id ON configuration_item_parts(configuration_item_id);

-- 构型库子构型项（自引用）
CREATE TABLE configuration_item_children (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_id UUID NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
    child_id UUID NOT NULL REFERENCES configuration_items(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uix_config_child UNIQUE (parent_id, child_id),
    CONSTRAINT ck_no_self_ref CHECK (parent_id != child_id)
);

CREATE INDEX idx_cic_parent_id ON configuration_item_children(parent_id);
