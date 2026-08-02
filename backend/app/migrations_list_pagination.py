"""启动时迁移：三大列表分页化所需的 SQL 函数与索引。

幂等：所有对象用 IF NOT EXISTS / OR REPLACE；失败仅打印不中断主流程。
"""
from sqlalchemy import text
from sqlalchemy.orm import Session


def apply(db: Session) -> None:
    """在 startup 钩子调用，创建 version_to_int 函数与排序/搜索索引。"""

    # 版本号 24 进制（不含 I/O）→ 整数，对齐 frontend versionToNumber
    # A=0, B=1, ..., Z=23, AA=24, AZ=47, BA=48, ZZ=599
    db.execute(text("""
        CREATE OR REPLACE FUNCTION version_to_int(v TEXT) RETURNS INTEGER AS $$
        DECLARE
            alphabet CHAR[] := ARRAY['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X','Y','Z'];
            result INTEGER := 0;
            ch CHAR;
            pos INTEGER;
        BEGIN
            IF v IS NULL OR v = '' OR v = 'A' THEN RETURN 0; END IF;
            FOR i IN 1..length(v) LOOP
                ch := upper(substr(v, i, 1));
                pos := array_position(alphabet, ch);
                IF pos IS NULL THEN
                    pos := 1;  -- 未知字符兜底视为 A
                END IF;
                result := result * 24 + pos;
            END LOOP;
            RETURN result - 1;
        END;
        $$ LANGUAGE plpgsql IMMUTABLE STRICT;
    """))

    # version 排序索引（按 master 分组内按版本号语义排序）
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_rev_version_order ON part_revisions (master_id, (version_to_int(version)) DESC)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_rev_version_order ON document_revisions (master_id, (version_to_int(version)) DESC)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_rev_version_order ON configuration_item_revisions (master_id, (version_to_int(version)) DESC)"))

    # code/name ILIKE 搜索加速（varchar_pattern_ops 让 LIKE '...' 走索引）
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_master_code_lower ON part_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_part_master_name_lower ON part_masters (lower(name) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_master_code_lower ON document_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_document_master_name_lower ON document_masters (lower(name) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_master_code_lower ON configuration_item_masters (lower(code) varchar_pattern_ops)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_config_master_name_lower ON configuration_item_masters (lower(name) varchar_pattern_ops)"))

    # 自定义字段搜索复合索引
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_cfv_entity ON custom_field_values (entity_type, entity_id, iteration_id)"))

    db.commit()