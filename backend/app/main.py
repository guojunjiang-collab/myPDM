from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
import os

from .routers import auth_router, users_router, bom_router, logs_router, custom_fields_router, documents_router, user_groups_router, dashboard_router, ecr_router, eco_router, config_router, inventory_router, components_router
from .routers.attachments_v2 import router as attachments_v2_router
from .routers.sync import router as sync_router
from .routers.admin import router as admin_router
from .routers.assistant import router as assistant_router
from .routers.projects import router as projects_router
from .database import SessionLocal, engine
from .migrations_components import migrate_components

app = FastAPI(
    title="BOM管理系统API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "https://localhost:8080").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(user_groups_router, prefix="/api")
app.include_router(components_router, prefix="/api")
app.include_router(bom_router, prefix="/api")
app.include_router(logs_router, prefix="/api")
app.include_router(attachments_v2_router, prefix="/api/v2")  # 新版附件API（支持分块上传）
app.include_router(custom_fields_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(ecr_router, prefix="/api")
app.include_router(eco_router, prefix="/api")
app.include_router(config_router, prefix="/api")
app.include_router(inventory_router, prefix="/api")
app.include_router(sync_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(projects_router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    """应用启动时执行数据库表结构检查和自动迁移（带 PostgreSQL 连接重试）"""
    import time as _time

    # 第一步：等待 PostgreSQL 就绪（容器启动时序问题）
    max_retries = 10
    db = None
    for attempt in range(1, max_retries + 1):
        try:
            db = SessionLocal()
            db.execute(text("SELECT 1"))
            break  # 连接成功
        except Exception as e:
            if db: db.close()
            if attempt == max_retries:
                print(f"✗ PostgreSQL not ready after {max_retries} attempts: {e}")
                return
            print(f"⏳ Waiting for PostgreSQL (attempt {attempt}/{max_retries})...")
            _time.sleep(2 ** attempt)

    # 第二步：执行数据库迁移
    try:
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'document_attachments' AND column_name = 'file_path'
        """))
        if not result.fetchone():
            # 添加 file_path 列
            db.execute(text("ALTER TABLE document_attachments ADD COLUMN file_path VARCHAR(512)"))
            db.commit()
            print("✓ Added column file_path to document_attachments table")
        
        # 检查 document_attachments 表是否有 file_hash 列
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'document_attachments' AND column_name = 'file_hash'
        """))
        if not result.fetchone():
            # 添加 file_hash 列
            db.execute(text("ALTER TABLE document_attachments ADD COLUMN file_hash VARCHAR(64)"))
            db.commit()
            print("✓ Added column file_hash to document_attachments table")

        # 检查并添加 revision_parent_id 列（版本控制）
        for table_name in ['parts', 'assemblies', 'documents', 'components']:
            result = db.execute(text(f"""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = '{table_name}' AND column_name = 'revision_parent_id'
            """))
            if not result.fetchone():
                db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN revision_parent_id UUID"))
                db.commit()
                print(f"✓ Added column revision_parent_id to {table_name} table")

        # 检查 documents 表是否有 revisions 列
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'documents' AND column_name = 'revisions'
        """))
        if not result.fetchone():
            db.execute(text("ALTER TABLE documents ADD COLUMN revisions JSONB DEFAULT '[]'"))
            db.commit()
            print("✓ Added column revisions to documents table")

        # 检查 configuration_items 表是否有 document_links 列
        result = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'configuration_items' AND column_name = 'document_links'
        """))
        if not result.fetchone():
            db.execute(text("ALTER TABLE configuration_items ADD COLUMN document_links JSONB NOT NULL DEFAULT '[]'"))
            db.commit()
            print("✓ Added column document_links to configuration_items table")

        # 检查 configuration_profiles 表是否存在
        result = db.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'configuration_profiles'
        """))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE configuration_profiles (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    code VARCHAR(64) UNIQUE NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    configuration_item_id UUID REFERENCES configuration_items(id),
                    status VARCHAR(16) NOT NULL DEFAULT 'draft',
                    effectivity_start VARCHAR(32),
                    effectivity_end VARCHAR(32),
                    remark TEXT,
                    creator_id UUID NOT NULL REFERENCES users(id),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("CREATE INDEX idx_cp_config_item_id ON configuration_profiles(configuration_item_id)"))
            db.execute(text("CREATE INDEX idx_cp_status ON configuration_profiles(status)"))
            db.commit()
            print("✓ Created table configuration_profiles")

        # 检查 configuration_profile_items 表是否存在
        result = db.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'configuration_profile_items'
        """))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE configuration_profile_items (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
                    source_config_item_id UUID REFERENCES configuration_items(id),
                    item_type VARCHAR(16) NOT NULL,
                    item_id UUID NOT NULL,
                    item_code VARCHAR(64),
                    item_name VARCHAR(255),
                    is_required BOOLEAN NOT NULL DEFAULT TRUE,
                    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
                    source_type VARCHAR(16) NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("CREATE INDEX idx_cpi_profile_id ON configuration_profile_items(profile_id)"))
            db.commit()
            print("✓ Created table configuration_profile_items")

        # 检查 configuration_working_items 表是否存在
        result = db.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'configuration_working_items'
        """))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE configuration_working_items (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
                    source_config_item_id UUID REFERENCES configuration_items(id),
                    item_type VARCHAR(16) NOT NULL,
                    item_id UUID NOT NULL,
                    item_code VARCHAR(64),
                    item_name VARCHAR(255),
                    is_required BOOLEAN NOT NULL DEFAULT TRUE,
                    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
                    source_type VARCHAR(16) NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("CREATE INDEX idx_cwi_profile_id ON configuration_working_items(profile_id)"))
            db.commit()
            print("✓ Created table configuration_working_items")

        # 检查 component_attachments 表是否存在
        result = db.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_name = 'component_attachments'
        """))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE component_attachments (
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
            db.commit()
            print("✓ Created table component_attachments")

        # 审批流新增列 + 表
        for col_def in [
            ("reviewers", "JSONB NOT NULL DEFAULT '[]'"),
            ("review_mode", "VARCHAR(8) NOT NULL DEFAULT 'all'"),
            ("cc_users", "JSONB NOT NULL DEFAULT '[]'"),
            ("submitted_at", "TIMESTAMPTZ"),
            ("reviewed_at", "TIMESTAMPTZ"),
            ("archived_at", "TIMESTAMPTZ"),
        ]:
            result = db.execute(text(
                f"SELECT column_name FROM information_schema.columns WHERE table_name='configuration_profiles' AND column_name='{col_def[0]}'"
            ))
            if not result.fetchone():
                db.execute(text(f"ALTER TABLE configuration_profiles ADD COLUMN {col_def[0]} {col_def[1]}"))
                db.commit()
                print(f"✓ Added column {col_def[0]} to configuration_profiles table")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'configuration_review_records'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE configuration_review_records (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
                    reviewer_id UUID NOT NULL REFERENCES users(id),
                    reviewer_name VARCHAR(64),
                    decision VARCHAR(16) NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table configuration_review_records")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'configuration_status_logs'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE configuration_status_logs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    profile_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
                    from_status VARCHAR(16),
                    to_status VARCHAR(16) NOT NULL,
                    operator_id UUID NOT NULL REFERENCES users(id),
                    operator_name VARCHAR(64),
                    comment TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table configuration_status_logs")

        # ── ECO/ECR 表结构（变更管理）──
        # ECR 表
        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'ecrs'"))
        if not result.fetchone():
            db.execute(text("""
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
                    cc_users JSONB NOT NULL DEFAULT '[]',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    reviewed_at TIMESTAMP WITH TIME ZONE,
                    closed_at TIMESTAMP WITH TIME ZONE,
                    eco_id UUID
                )
            """))
            db.commit()
            print("✓ Created table ecrs")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'ecr_affected_items'"))
        if not result.fetchone():
            db.execute(text("""
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
                )
            """))
            db.commit()
            print("✓ Created table ecr_affected_items")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'ecr_review_records'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE ecr_review_records (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    ecr_id UUID NOT NULL REFERENCES ecrs(id) ON DELETE CASCADE,
                    reviewer_id UUID NOT NULL REFERENCES users(id),
                    reviewer_name VARCHAR(64),
                    decision VARCHAR(16) NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table ecr_review_records")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'ecr_status_logs'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE ecr_status_logs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    ecr_id UUID NOT NULL REFERENCES ecrs(id) ON DELETE CASCADE,
                    from_status VARCHAR(16),
                    to_status VARCHAR(16) NOT NULL,
                    operator_id UUID NOT NULL REFERENCES users(id),
                    operator_name VARCHAR(64),
                    comment TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table ecr_status_logs")

        # ECO 表
        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'ecos'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE ecos (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    eco_number VARCHAR(32) UNIQUE NOT NULL,
                    ecr_id UUID REFERENCES ecrs(id),
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
                    cc_users JSONB NOT NULL DEFAULT '[]',
                    release_items JSONB NOT NULL DEFAULT '[]',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    reviewed_at TIMESTAMP WITH TIME ZONE,
                    executed_at TIMESTAMP WITH TIME ZONE,
                    closed_at TIMESTAMP WITH TIME ZONE
                )
            """))
            db.commit()
            print("✓ Created table ecos")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'eco_execution_items'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE eco_execution_items (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
                    source VARCHAR(8) NOT NULL DEFAULT 'ecr',
                    affected_item_id UUID REFERENCES ecr_affected_items(id),
                    entity_type VARCHAR(16) NOT NULL,
                    entity_id UUID,
                    entity_code VARCHAR(64),
                    entity_name VARCHAR(255) NOT NULL,
                    action VARCHAR(16) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    detail JSONB NOT NULL DEFAULT '{}',
                    new_entity_id UUID,
                    new_version VARCHAR(32),
                    parent_entity_id UUID,
                    parent_new_entity_id UUID,
                    error_message TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    executed_at TIMESTAMP WITH TIME ZONE
                )
            """))
            db.commit()
            print("✓ Created table eco_execution_items")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'eco_review_records'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE eco_review_records (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
                    reviewer_id UUID NOT NULL REFERENCES users(id),
                    reviewer_name VARCHAR(64),
                    decision VARCHAR(16) NOT NULL,
                    comment TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table eco_review_records")

        result = db.execute(text("SELECT table_name FROM information_schema.tables WHERE table_name = 'eco_status_logs'"))
        if not result.fetchone():
            db.execute(text("""
                CREATE TABLE eco_status_logs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    eco_id UUID NOT NULL REFERENCES ecos(id) ON DELETE CASCADE,
                    from_status VARCHAR(16),
                    to_status VARCHAR(16) NOT NULL,
                    operator_id UUID NOT NULL REFERENCES users(id),
                    operator_name VARCHAR(64),
                    comment TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.commit()
            print("✓ Created table eco_status_logs")

        # ── ECO/ECR 列迁移（增量更新）──
        for tbl, col, coltype in [
            ("ecrs", "cc_users", "JSONB NOT NULL DEFAULT '[]'"),
            ("ecos", "cc_users", "JSONB NOT NULL DEFAULT '[]'"),
            ("ecos", "release_items", "JSONB NOT NULL DEFAULT '[]'"),
            ("configuration_item_children", "quantity", "INTEGER NOT NULL DEFAULT 1"),
        ]:
            result = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{tbl}' AND column_name = '{col}'"))
            if not result.fetchone():
                db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col} {coltype}"))
            db.commit()
            print(f"✓ Added column {col} to {tbl} table")

        # ── 软删除列迁移 ──
        for tbl in ["parts", "assemblies", "documents", "components", "bom_items", "ecrs", "ecos", "configuration_items"]:
            result = db.execute(text(f"""
                SELECT column_name FROM information_schema.columns
                WHERE table_name = '{tbl}' AND column_name = 'deleted_at'
            """))
            if not result.fetchone():
                db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL"))
                db.commit()
                print(f"✓ Added column deleted_at to {tbl} table")

        # BOM items 的 updated_at 列
        result = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'bom_items' AND column_name = 'updated_at'
        """))
        if not result.fetchone():
            db.execute(text("ALTER TABLE bom_items ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now()"))
            db.commit()
            print("✓ Added column updated_at to bom_items table")

        # ── 软删除 → 唯一约束改为 partial index ──
        for tbl in ["parts", "assemblies", "documents", "components"]:
            idx_name = {"parts": "uix_part_code_version", "assemblies": "uix_assembly_code_version", "documents": "uix_doc_code_version", "components": "uix_component_code_version"}[tbl]
            try:
                # 检查是否已经是 partial index
                result = db.execute(text(f"""
                    SELECT 1 FROM pg_indexes
                    WHERE indexname = '{idx_name}' AND indexdef ILIKE '%WHERE deleted_at IS NULL%'
                """))
                if not result.fetchone():
                    # 删除旧唯一约束（若有）
                    db.execute(text(f"ALTER TABLE {tbl} DROP CONSTRAINT IF EXISTS {idx_name}"))
                    db.execute(text(f"""
                        CREATE UNIQUE INDEX {idx_name} ON {tbl} (code, version) WHERE deleted_at IS NULL
                    """))
                    db.commit()
                    print(f"✓ Converted {idx_name} to partial unique index on {tbl}")
            except Exception as e:
                db.rollback()
                # 约束/索引可能已不存在，忽略错误
                pass

        # ── 通用列对账：模型已声明但表中缺失的列，自动 ADD COLUMN（幂等）──
        # 防止"模型加了列但忘了写迁移"导致旧库 SELECT 时 UndefinedColumn 500。
        try:
            from sqlalchemy import inspect as _sqla_inspect
            from app.database import Base, engine
            # 导入所有模型模块以填充 Base.metadata
            import app.models  # noqa: F401
            import app.models_ecr  # noqa: F401
            import app.models_eco  # noqa: F401
            import app.models_configuration  # noqa: F401
            import app.models_inventory  # noqa: F401
            import app.models_project  # noqa: F401
            import app.models_parts  # noqa: F401

            # 幂等建表：仅创建尚不存在的表（如库存模块新表）
            Base.metadata.create_all(bind=engine)

            # 项目任务日期列 varchar -> date(Postgres 旧库迁移,幂等)
            try:
                from app.migrations_project import migrate_task_dates_to_date
                migrate_task_dates_to_date(db, engine)
            except Exception as _de:
                db.rollback()
                print(f"⚠ Task date migration skipped: {_de}")

            def _col_default_sql(col):
                sd = getattr(col, "server_default", None)
                if sd is not None and getattr(sd, "arg", None) is not None:
                    txt = getattr(sd.arg, "text", None)
                    if txt is not None:
                        return f" DEFAULT {txt}"
                d = getattr(col, "default", None)
                if d is not None and getattr(d, "is_scalar", False):
                    v = d.arg
                    if isinstance(v, bool):
                        return f" DEFAULT {'true' if v else 'false'}"
                    if isinstance(v, (int, float)):
                        return f" DEFAULT {v}"
                    if isinstance(v, str):
                        return " DEFAULT '" + v.replace("'", "''") + "'"
                return ""

            _insp = _sqla_inspect(engine)
            for _table in Base.metadata.tables.values():
                if not _insp.has_table(_table.name):
                    continue  # 不存在的表交由上面的 CREATE 流程处理
                _existing = {c["name"] for c in _insp.get_columns(_table.name)}
                for _col in _table.columns:
                    if _col.name in _existing:
                        continue
                    try:
                        _ctype = _col.type.compile(engine.dialect)
                        _default_sql = _col_default_sql(_col)
                        # 仅在有默认值时加 NOT NULL，避免已有数据表加非空列失败；否则加为可空
                        _nn = " NOT NULL" if (not _col.nullable and _default_sql) else ""
                        db.execute(text(
                            f'ALTER TABLE {_table.name} ADD COLUMN IF NOT EXISTS "{_col.name}" {_ctype}{_default_sql}{_nn}'
                        ))
                        db.commit()
                        print(f"✓ Auto-added missing column {_table.name}.{_col.name}")
                    except Exception as _ce:
                        db.rollback()
                        print(f"⚠ Skip auto-add {_table.name}.{_col.name}: {_ce}")
        except Exception as _e:
            db.rollback()
            print(f"⚠ Auto column reconcile skipped: {_e}")

        # 回填存量数据:父任务计划日期 = 子孙叶包络
        try:
            from app import crud_project
            crud_project.persist_rollup_all(db)
        except Exception as _re:
            db.rollback()
            print(f"⚠ Parent date rollup skipped: {_re}")

        # 零部件统一化迁移：parts + assemblies → components
        try:
            migrate_components(db, engine)
            print("✓ Components unification migration completed")
        except Exception as _cm:
            db.rollback()
            print(f"⚠ Components unification migration skipped: {_cm}")

        print("✓ Database migration completed successfully")
    except Exception as e:
        print(f"✗ Database migration error: {e}")
        db.rollback()
    finally:
        db.close()

@app.get("/")
async def root():
    return {"message": "BOM管理系统API服务运行中"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
