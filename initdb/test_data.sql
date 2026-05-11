-- 测试数据：50零件 + 10部件 + 100图文档 + BOM关系
-- 执行: docker exec -i bom_postgres psql -U bomadmin -d bom_system < this_file.sql

DO $$
DECLARE
    asm_codes TEXT[] := ARRAY['10001','10002','10003','10004','10005','10006','10007','10008','10009','10010'];
    asm_names TEXT[] := ARRAY['减速器总成','传动轴组件','液压油缸','电气控制柜','主轴承座','齿轮箱体','联轴器组件','制动器总成','润滑系统','冷却装置'];
    asm_ids UUID[] := ARRAY[]::UUID[];
    part_names TEXT[] := ARRAY['壳体','端盖','密封圈','螺栓M8x30','垫圈Φ8','轴承6205','定位销','弹簧Φ2','O型圈','挡圈'];
    spec_texts TEXT[] := ARRAY['HT200','Q235-A','NBR','8.8级','Φ8','6205','Φ6x20','65Mn','Φ12x2','Φ25'];
    part_ids UUID[] := ARRAY[]::UUID[];
    part_codes TEXT[] := ARRAY[]::TEXT[];
    a_code TEXT;
    p_code TEXT;
    a_id UUID;
    p_id UUID;
    d_code TEXT;
    d_id UUID;
    i INTEGER;
    j INTEGER;
    part_idx INTEGER := 0;
    doc_idx INTEGER := 0;
    now_ts TIMESTAMPTZ := now();
    -- 状态轮换
    statuses TEXT[] := ARRAY['draft','frozen','released','draft','frozen','released','draft','frozen','released','draft'];
BEGIN

    -- ========================================
    -- 1. 插入 10 个部件
    -- ========================================
    FOR i IN 1..10 LOOP
        a_code := 'V01-' || asm_codes[i] || '-000';
        a_id := uuid_generate_v4();
        asm_ids := array_append(asm_ids, a_id);
        INSERT INTO assemblies (id, code, name, spec, version, status, remark, created_at, updated_at)
        VALUES (a_id, a_code, asm_names[i], '', 'A', statuses[i], '', now_ts, now_ts);
    END LOOP;

    -- ========================================
    -- 2. 插入 50 个零件（部件各5个）
    -- ========================================
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            part_idx := part_idx + 1;
            p_code := 'V01-' || asm_codes[i] || '-' || LPAD(j::TEXT, 3, '0');
            part_codes := array_append(part_codes, p_code);
            p_id := uuid_generate_v4();
            part_ids := array_append(part_ids, p_id);
            INSERT INTO parts (id, code, name, spec, version, status, remark, created_at, updated_at)
            VALUES (p_id, p_code, part_names[j] || part_idx::TEXT, spec_texts[j], 'A',
                    statuses[(i + j) % 10 + 1], '', now_ts, now_ts);
        END LOOP;
    END LOOP;

    -- ========================================
    -- 3. 插入 BOM 关系（零件关联到对应部件）
    -- ========================================
    part_idx := 0;
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            part_idx := part_idx + 1;
            INSERT INTO bom_items (id, parent_type, parent_id, child_type, child_id, quantity, created_at)
            VALUES (uuid_generate_v4(), 'assembly', asm_ids[i], 'part', part_ids[part_idx],
                    (random() * 4 + 1)::DECIMAL(10,3), now_ts);
        END LOOP;
    END LOOP;

    -- ========================================
    -- 4. 插入 100 个图文档
    --    DR 文档: 60个（10部件+50零件各1个DR）
    --    MD 文档: 35个（10部件+25零件）
    --    S-055TRxxx: 5个
    -- ========================================
    
    -- 4a. DR 文档 for 全部10个部件
    FOR i IN 1..10 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'DR_V01-' || asm_codes[i] || '-000';
        d_id := uuid_generate_v4();
        INSERT INTO documents (id, code, name, version, status, remark, file_name, created_at, updated_at)
        VALUES (d_id, d_code, asm_names[i] || '二维图纸', 'A', 'released', '', lower(d_code) || '.pdf', now_ts, now_ts);
        -- 更新部件 document_links
        UPDATE assemblies SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_id::TEXT,
            'category', '二维图纸',
            'sort_order', 0,
            'created_at', now_ts::TEXT
        )) WHERE id = asm_ids[i];
    END LOOP;

    -- 4b. DR 文档 for 全部50个零件
    FOR i IN 1..50 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'DR_' || part_codes[i];
        d_id := uuid_generate_v4();
        INSERT INTO documents (id, code, name, version, status, remark, file_name, created_at, updated_at)
        VALUES (d_id, d_code, '零件二维图纸', 'A', 'released', '', lower(d_code) || '.pdf', now_ts, now_ts);
        -- 更新零件 document_links
        UPDATE parts SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_id::TEXT,
            'category', '二维图纸',
            'sort_order', 0,
            'created_at', now_ts::TEXT
        )) WHERE id = part_ids[i];
    END LOOP;

    -- 4c. MD 文档 for 全部10个部件
    FOR i IN 1..10 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'MD_V01-' || asm_codes[i] || '-000';
        d_id := uuid_generate_v4();
        INSERT INTO documents (id, code, name, version, status, remark, file_name, created_at, updated_at)
        VALUES (d_id, d_code, asm_names[i] || '三维模型', 'A', 'released', '', lower(d_code) || '.stp', now_ts, now_ts);
        UPDATE assemblies SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT, 'document_id', d_id::TEXT,
            'category', '三维模型', 'sort_order', 1, 'created_at', now_ts::TEXT
        )) WHERE id = asm_ids[i];
    END LOOP;

    -- 4d. MD 文档 for 前25个零件
    FOR i IN 1..25 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'MD_' || part_codes[i];
        d_id := uuid_generate_v4();
        INSERT INTO documents (id, code, name, version, status, remark, file_name, created_at, updated_at)
        VALUES (d_id, d_code, '零件三维模型', 'A', 'released', '', lower(d_code) || '.stp', now_ts, now_ts);
        UPDATE parts SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT, 'document_id', d_id::TEXT,
            'category', '三维模型', 'sort_order', 1, 'created_at', now_ts::TEXT
        )) WHERE id = part_ids[i];
    END LOOP;

    -- 4e. S-055TRxxx 报告文档 (5个，补足100)
    FOR i IN 1..5 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'S-055TR' || LPAD(i::TEXT, 3, '0');
        d_id := uuid_generate_v4();
        INSERT INTO documents (id, code, name, version, status, remark, file_name, created_at, updated_at)
        VALUES (d_id, d_code, '055专业报告#' || i::TEXT, 'A', 'released', '', lower(d_code) || '.pdf', now_ts, now_ts);
    END LOOP;

    RAISE NOTICE 'Inserted: 10 assemblies, 50 parts, % documents', doc_idx;
END $$;
