-- 测试数据：50零件 + 10部件 + 100图文档 + BOM关系 (三层模型版)
-- 兼容 feat/config 分支新表结构
-- 执行: docker exec -i bom_postgres psql -U bomadmin -d bom_system < this_file.sql

DO $$
DECLARE
    asm_codes TEXT[] := ARRAY['10001','10002','10003','10004','10005','10006','10007','10008','10009','10010'];
    asm_names TEXT[] := ARRAY['减速器总成','传动轴组件','液压油缸','电气控制柜','主轴承座','齿轮箱体','联轴器组件','制动器总成','润滑系统','冷却装置'];
    part_names TEXT[] := ARRAY['壳体','端盖','密封圈','螺栓M8x30','垫圈Φ8','轴承6205','定位销','弹簧Φ2','O型圈','挡圈'];
    spec_texts TEXT[] := ARRAY['HT200','Q235-A','NBR','8.8级','Φ8','6205','Φ6x20','65Mn','Φ12x2','Φ25'];
    part_rev_ids UUID[] := ARRAY[]::UUID[];
    asm_rev_ids UUID[] := ARRAY[]::UUID[];
    a_code TEXT;
    p_code TEXT;
    d_code TEXT;
    a_rev_id UUID;
    p_rev_id UUID;
    p_iter_id UUID;
    a_iter_id UUID;
    d_master_id UUID;
    d_rev_id UUID;
    d_iter_id UUID;
    i INTEGER;
    j INTEGER;
    part_idx INTEGER := 0;
    doc_idx INTEGER := 0;
    now_ts TIMESTAMPTZ := now();
    statuses TEXT[] := ARRAY['draft','frozen','released','draft','frozen','released','draft','frozen','released','draft'];
BEGIN

    -- ========================================
    -- 1. 插入 10 个部件 (三层模型: master → revision → iteration)
    -- ========================================
    FOR i IN 1..10 LOOP
        a_code := 'V01-' || asm_codes[i] || '-000';
        a_rev_id := uuid_generate_v4();
        asm_rev_ids := array_append(asm_rev_ids, a_rev_id);

        -- master
        INSERT INTO part_masters (id, code, name, type, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), a_code, asm_names[i], 'assembly', NULL, now_ts, now_ts);

        -- revision (get master id by code)
        INSERT INTO part_revisions (id, master_id, version, status, revision_note, latest_iteration, creator_id, created_at, updated_at)
        SELECT uuid_generate_v4(), pm.id, 'A', statuses[i], '', 1, NULL, now_ts, now_ts
        FROM part_masters pm WHERE pm.code = a_code AND pm.type = 'assembly'
        RETURNING id INTO a_rev_id;
        asm_rev_ids[i] := a_rev_id;

        -- iteration
        INSERT INTO part_iterations (id, revision_id, iteration, check_in_note, document_links, created_at)
        VALUES (uuid_generate_v4(), a_rev_id, 1, '', '[]', now_ts);
    END LOOP;

    -- ========================================
    -- 2. 插入 50 个零件 (部件各5个)
    -- ========================================
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            part_idx := part_idx + 1;
            p_code := 'V01-' || asm_codes[i] || '-' || LPAD(j::TEXT, 3, '0');

            -- master
            INSERT INTO part_masters (id, code, name, type, creator_id, created_at, updated_at)
            VALUES (uuid_generate_v4(), p_code, part_names[j] || part_idx::TEXT, 'part', NULL, now_ts, now_ts);

            -- revision
            INSERT INTO part_revisions (id, master_id, version, status, revision_note, latest_iteration, creator_id, created_at, updated_at)
            SELECT uuid_generate_v4(), pm.id, 'A', statuses[(i + j) % 10 + 1], spec_texts[j], 1, NULL, now_ts, now_ts
            FROM part_masters pm WHERE pm.code = p_code AND pm.type = 'part'
            RETURNING id INTO p_rev_id;
            part_rev_ids := array_append(part_rev_ids, p_rev_id);

            -- iteration
            INSERT INTO part_iterations (id, revision_id, iteration, check_in_note, document_links, created_at)
            VALUES (uuid_generate_v4(), p_rev_id, 1, '', '[]', now_ts);
        END LOOP;
    END LOOP;

    -- ========================================
    -- 3. 插入 BOM 关系 (三层模型: parent_revision_id + child_revision_id + iteration_id)
    -- ========================================
    part_idx := 0;
    FOR i IN 1..10 LOOP
        FOR j IN 1..5 LOOP
            part_idx := part_idx + 1;
            -- 获取部件的第一个 iteration
            INSERT INTO bom_items (id, parent_revision_id, child_revision_id, iteration_id, quantity, created_at)
            SELECT uuid_generate_v4(), asm_rev_ids[i], part_rev_ids[part_idx], pi2.id,
                   (random() * 4 + 1)::INTEGER, now_ts
            FROM part_iterations pi2
            WHERE pi2.revision_id = part_rev_ids[part_idx] AND pi2.iteration = 1;
        END LOOP;
    END LOOP;

    -- ========================================
    -- 4. 插入 100 个图文档 (三层模型)
    --    DR 文档: 60个（10部件+50零件各1个DR）
    --    MD 文档: 35个（10部件+25零件）
    --    S-055TRxxx: 5个
    -- ========================================

    -- 4a. DR 文档 for 全部10个部件
    FOR i IN 1..10 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'DR_V01-' || asm_codes[i] || '-000';
        d_master_id := uuid_generate_v4();

        -- master
        INSERT INTO document_masters (id, code, name, creator_id, created_at, updated_at)
        VALUES (d_master_id, d_code, asm_names[i] || '二维图纸', NULL, now_ts, now_ts);

        -- revision
        INSERT INTO document_revisions (id, master_id, version, status, latest_iteration, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), d_master_id, 'A', 'released', 1, NULL, now_ts, now_ts);

        -- iteration
        INSERT INTO document_iterations (id, revision_id, iteration, check_in_note, created_at)
        SELECT uuid_generate_v4(), dr.id, 1, '', now_ts
        FROM document_revisions dr WHERE dr.master_id = d_master_id AND dr.version = 'A'
        LIMIT 1;

        -- 更新部件的 document_links
        UPDATE part_iterations pi
        SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_master_id::TEXT,
            'category', '二维图纸',
            'sort_order', 0,
            'created_at', now_ts::TEXT
        ))
        FROM part_revisions pr
        WHERE pi.revision_id = pr.id
          AND pr.id = asm_rev_ids[i]
          AND pi.iteration = 1;
    END LOOP;

    -- 4b. DR 文档 for 全部50个零件
    FOR i IN 1..50 LOOP
        doc_idx := doc_idx + 1;
        -- 取零件code
        SELECT pm.code INTO p_code FROM part_masters pm
        JOIN part_revisions pr ON pr.master_id = pm.id
        WHERE pr.id = part_rev_ids[i] AND pm.type = 'part';
        d_code := 'DR_' || p_code;
        d_master_id := uuid_generate_v4();

        INSERT INTO document_masters (id, code, name, creator_id, created_at, updated_at)
        VALUES (d_master_id, d_code, '零件二维图纸', NULL, now_ts, now_ts);

        INSERT INTO document_revisions (id, master_id, version, status, latest_iteration, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), d_master_id, 'A', 'released', 1, NULL, now_ts, now_ts);

        INSERT INTO document_iterations (id, revision_id, iteration, check_in_note, created_at)
        SELECT uuid_generate_v4(), dr.id, 1, '', now_ts
        FROM document_revisions dr WHERE dr.master_id = d_master_id AND dr.version = 'A'
        LIMIT 1;

        -- 更新零件的 document_links
        UPDATE part_iterations pi
        SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_master_id::TEXT,
            'category', '二维图纸',
            'sort_order', 0,
            'created_at', now_ts::TEXT
        ))
        WHERE pi.revision_id = part_rev_ids[i] AND pi.iteration = 1;
    END LOOP;

    -- 4c. MD 文档 for 全部10个部件
    FOR i IN 1..10 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'MD_V01-' || asm_codes[i] || '-000';
        d_master_id := uuid_generate_v4();

        INSERT INTO document_masters (id, code, name, creator_id, created_at, updated_at)
        VALUES (d_master_id, d_code, asm_names[i] || '三维模型', NULL, now_ts, now_ts);

        INSERT INTO document_revisions (id, master_id, version, status, latest_iteration, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), d_master_id, 'A', 'released', 1, NULL, now_ts, now_ts);

        INSERT INTO document_iterations (id, revision_id, iteration, check_in_note, created_at)
        SELECT uuid_generate_v4(), dr.id, 1, '', now_ts
        FROM document_revisions dr WHERE dr.master_id = d_master_id AND dr.version = 'A'
        LIMIT 1;

        UPDATE part_iterations pi
        SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_master_id::TEXT,
            'category', '三维模型',
            'sort_order', 1,
            'created_at', now_ts::TEXT
        ))
        FROM part_revisions pr
        WHERE pi.revision_id = pr.id
          AND pr.id = asm_rev_ids[i]
          AND pi.iteration = 1;
    END LOOP;

    -- 4d. MD 文档 for 前25个零件
    FOR i IN 1..25 LOOP
        doc_idx := doc_idx + 1;
        SELECT pm.code INTO p_code FROM part_masters pm
        JOIN part_revisions pr ON pr.master_id = pm.id
        WHERE pr.id = part_rev_ids[i] AND pm.type = 'part';
        d_code := 'MD_' || p_code;
        d_master_id := uuid_generate_v4();

        INSERT INTO document_masters (id, code, name, creator_id, created_at, updated_at)
        VALUES (d_master_id, d_code, '零件三维模型', NULL, now_ts, now_ts);

        INSERT INTO document_revisions (id, master_id, version, status, latest_iteration, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), d_master_id, 'A', 'released', 1, NULL, now_ts, now_ts);

        INSERT INTO document_iterations (id, revision_id, iteration, check_in_note, created_at)
        SELECT uuid_generate_v4(), dr.id, 1, '', now_ts
        FROM document_revisions dr WHERE dr.master_id = d_master_id AND dr.version = 'A'
        LIMIT 1;

        UPDATE part_iterations pi
        SET document_links = document_links || jsonb_build_array(jsonb_build_object(
            'id', uuid_generate_v4()::TEXT,
            'document_id', d_master_id::TEXT,
            'category', '三维模型',
            'sort_order', 1,
            'created_at', now_ts::TEXT
        ))
        WHERE pi.revision_id = part_rev_ids[i] AND pi.iteration = 1;
    END LOOP;

    -- 4e. S-055TRxxx 报告文档 (5个，补足100)
    FOR i IN 1..5 LOOP
        doc_idx := doc_idx + 1;
        d_code := 'S-055TR' || LPAD(i::TEXT, 3, '0');
        d_master_id := uuid_generate_v4();

        INSERT INTO document_masters (id, code, name, creator_id, created_at, updated_at)
        VALUES (d_master_id, d_code, '055专业报告#' || i::TEXT, NULL, now_ts, now_ts);

        INSERT INTO document_revisions (id, master_id, version, status, latest_iteration, creator_id, created_at, updated_at)
        VALUES (uuid_generate_v4(), d_master_id, 'A', 'released', 1, NULL, now_ts, now_ts);

        INSERT INTO document_iterations (id, revision_id, iteration, check_in_note, created_at)
        SELECT uuid_generate_v4(), dr.id, 1, '', now_ts
        FROM document_revisions dr WHERE dr.master_id = d_master_id AND dr.version = 'A'
        LIMIT 1;
    END LOOP;

    RAISE NOTICE 'Inserted: 10 assemblies, 50 parts, % documents', doc_idx;
END $$;
