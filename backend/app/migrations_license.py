"""licenses 审计表建表迁移。幂等，PostgreSQL。"""
from sqlalchemy import text


def migrate_licenses(db, engine):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS licenses (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            license_id VARCHAR(64) NOT NULL,
            customer VARCHAR(255) NOT NULL,
            machine_code VARCHAR(64) NOT NULL,
            issued_at VARCHAR(16) NOT NULL,
            expires_at VARCHAR(16) NOT NULL,
            max_users INTEGER NOT NULL DEFAULT 0,
            modules JSONB DEFAULT '[]'::jsonb,
            edition VARCHAR(32) NOT NULL DEFAULT 'basic',
            uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL
        )
    """))
    db.commit()
