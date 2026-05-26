from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .routers import auth_router, users_router, parts_router, assemblies_router, bom_router, logs_router, custom_fields_router, documents_router, dashboard_router, ecr_router, eco_router, config_router
from .routers.attachments_v2 import router as attachments_v2_router
from .database import SessionLocal

app = FastAPI(
    title="BOM管理系统API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(parts_router, prefix="/api")
app.include_router(assemblies_router, prefix="/api")
app.include_router(bom_router, prefix="/api")
app.include_router(logs_router, prefix="/api")
app.include_router(attachments_v2_router, prefix="/api/v2")  # 新版附件API（支持分块上传）
app.include_router(custom_fields_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(ecr_router, prefix="/api")
app.include_router(eco_router, prefix="/api")
app.include_router(config_router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    """应用启动时执行数据库表结构检查和自动迁移"""
    db = SessionLocal()
    try:
        # 检查 document_attachments 表是否有 file_path 列
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
        for table_name in ['parts', 'assemblies', 'documents']:
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
