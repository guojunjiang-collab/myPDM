"""三大列表分页/排序/搜索的单测。"""
import uuid
import pytest
from sqlalchemy import text

from app import models, models_parts, crud_parts
from app.models import CustomFieldDefinition, CustomFieldValue


# ===== 版本号工具 =====

VERSION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"


def _version_to_int(v: str) -> int:
    """Python 版 version_to_int，与 crud_parts.VERSION_CHARS 对齐。"""
    if not v or v == 'A':
        return 0
    result = 0
    for ch in v:
        pos = VERSION_CHARS.index(ch.upper()) + 1  # 1-based
        result = result * 24 + pos
    return result - 1


def _version_from_int(n: int) -> str:
    """0→A, 1→B, ..., 23→Z, 24→AA, ..."""
    if n < 0:
        raise ValueError("n must be >= 0")
    if n == 0:
        return VERSION_CHARS[0]
    result = []
    n += 1
    while n > 0:
        n -= 1
        result.append(VERSION_CHARS[n % 24])
        n //= 24
    return ''.join(reversed(result))


# ===== SQLite 兼容层 =====


@pytest.fixture(autouse=True)
def register_version_to_int_udf(db):
    """在 SQLite 连接上注册 version_to_int UDF，替代 PG 的 PL/pgSQL 函数。"""
    raw_conn = db.connection().connection
    raw_conn.create_function("version_to_int", 1, _version_to_int)


@pytest.fixture(autouse=True)
def patch_ilike_for_sqlite(db, monkeypatch):
    """SQLite 不支持 ILIKE，替换为 LIKE（SQLite LIKE 对 ASCII 大小写不敏感）。"""
    _orig = db.execute

    def _patched(stmt, *args, **kwargs):
        sql = getattr(stmt, 'text', str(stmt))
        sql = sql.replace('ILIKE', 'LIKE')
        return _orig(text(sql), *args, **kwargs)

    monkeypatch.setattr(db, 'execute', _patched, raising=False)


# ===== 版本号单元测试 =====


def test_version_to_int_basic():
    """验证 Python 版 version_to_int 与预期一致。"""
    cases = [
        ('A', 0), ('B', 1), ('C', 2), ('H', 7), ('J', 8),
        ('N', 12), ('P', 13), ('Z', 23),
        ('AA', 24), ('AB', 25), ('AZ', 47),
        ('BA', 48), ('ZZ', 599),
    ]
    for v, expected in cases:
        actual = _version_to_int(v)
        assert actual == expected, f"version_to_int('{v}')={actual}, expected={expected}"


def test_version_from_int_roundtrip():
    """version_from_int → _version_to_int 往返一致性。"""
    for n in range(60):
        v = _version_from_int(n)
        assert _version_to_int(v) == n, f"roundtrip failed at n={n}, v={v}"


def test_version_to_int_invalid_char():
    """I/O 不在 VERSION_CHARS 中，index() 应抛出 ValueError。"""
    with pytest.raises(ValueError):
        _version_to_int('I')
    with pytest.raises(ValueError):
        _version_to_int('O')


# ===== 辅助工厂 =====


def _make_sample_parts(db, masters=5, versions=3, base_code="P"):
    """创建测试零件数据。返回 [(master_id, revision_id, code, version), ...]"""
    results = []
    for m_idx in range(masters):
        code = f"{base_code}-{m_idx + 1:04d}"
        m = models_parts.PartMaster(
            id=uuid.uuid4(), code=code, name=f"零件{m_idx + 1}", type="part",
        )
        db.add(m)
        db.flush()
        for v_idx in range(versions):
            version = _version_from_int(v_idx)
            r = models_parts.PartRevision(
                id=uuid.uuid4(), master_id=m.id, version=version,
                status="draft", latest_iteration=1,
            )
            db.add(r)
            db.flush()
            results.append((m.id, r.id, code, version))
    db.commit()
    return results


# ===== 分页测试 =====


def test_list_part_masters_pagination(db):
    """show_all_versions=True 时按 revision 分页。"""
    _make_sample_parts(db, masters=5, versions=3)
    items, total = crud_parts.list_part_masters(
        db, page=1, page_size=10, show_all_versions=True,
    )
    assert len(items) == 10
    assert total >= 10
    assert all('version_count' in it for it in items)


def test_list_part_masters_page2(db):
    """page=2 应返回正确偏移量。"""
    _make_sample_parts(db, masters=5, versions=3)
    page1, total = crud_parts.list_part_masters(
        db, page=1, page_size=10, show_all_versions=True,
    )
    page2, _ = crud_parts.list_part_masters(
        db, page=2, page_size=10, show_all_versions=True,
    )
    assert total == len(page1) + len(page2)
    p1_ids = {it['revision_id'] for it in page1}
    p2_ids = {it['revision_id'] for it in page2}
    assert p1_ids.isdisjoint(p2_ids)


def test_list_part_masters_empty_page(db):
    """空数据集返回空列表、total=0。"""
    items, total = crud_parts.list_part_masters(
        db, page=1, page_size=50, show_all_versions=True,
    )
    assert items == []
    assert total == 0


# ===== 排序测试 =====


def test_list_part_masters_sort_code_asc(db):
    """按件号升序排列（show_all_versions=True 避免 LATERAL）。"""
    codes = ["P-0003", "P-0001", "P-0002"]
    for code in codes:
        m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
        db.add(m)
        db.flush()
        db.add(models_parts.PartRevision(
            id=uuid.uuid4(), master_id=m.id, version="A", status="draft", latest_iteration=1,
        ))
    db.commit()

    items, _ = crud_parts.list_part_masters(
        db, page=1, page_size=50, sort_field='code', sort_order='asc',
        show_all_versions=True,
    )
    codes_out = [it['code'] for it in items]
    assert codes_out == sorted(codes_out)


def test_list_part_masters_sort_code_desc(db):
    """按件号降序排列。"""
    codes = ["P-0001", "P-0003", "P-0002"]
    for code in codes:
        m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
        db.add(m)
        db.flush()
        db.add(models_parts.PartRevision(
            id=uuid.uuid4(), master_id=m.id, version="A", status="draft", latest_iteration=1,
        ))
    db.commit()

    items, _ = crud_parts.list_part_masters(
        db, page=1, page_size=50, sort_field='code', sort_order='desc',
        show_all_versions=True,
    )
    codes_out = [it['code'] for it in items]
    assert codes_out == sorted(codes_out, reverse=True)


def test_list_part_masters_sort_version_desc(db):
    """按版本降序排列——依赖 version_to_int UDF。"""
    # 5 masters × 3 versions = 15 rows
    _make_sample_parts(db, masters=5, versions=3)
    items, _ = crud_parts.list_part_masters(
        db, page=1, page_size=50, sort_field='version', sort_order='desc',
        show_all_versions=True,
    )
    versions = [it['version'] for it in items]
    nums = [_version_to_int(v) for v in versions]
    assert nums == sorted(nums, reverse=True)


def test_list_part_masters_sort_name_asc(db):
    """按名称升序排列。"""
    names = ["零件C", "零件A", "零件B"]
    for name in names:
        m = models_parts.PartMaster(
            id=uuid.uuid4(), code=f"P-{name}", name=name, type="part",
        )
        db.add(m)
        db.flush()
        db.add(models_parts.PartRevision(
            id=uuid.uuid4(), master_id=m.id, version="A", status="draft", latest_iteration=1,
        ))
    db.commit()

    items, _ = crud_parts.list_part_masters(
        db, page=1, page_size=50, sort_field='name', sort_order='asc',
        show_all_versions=True,
    )
    names_out = [it['name'] for it in items]
    assert names_out == sorted(names_out)


def test_list_part_masters_sort_invalid_field(db):
    """非法排序字段应抛出 ValueError。"""
    with pytest.raises(ValueError):
        crud_parts.list_part_masters(db, sort_field='invalid_field')


# ===== 搜索测试 =====


def test_list_part_masters_search_code(db):
    """按件号搜索（show_all_versions=True, ILIKE→LIKE 适配 SQLite）。"""
    _make_sample_parts(db, masters=3, versions=1)
    items, _ = crud_parts.list_part_masters(
        db, search='P-0001', search_field='code', page=1, page_size=50,
        show_all_versions=True,
    )
    assert len(items) >= 1
    assert all('P-0001' in it['code'].upper() for it in items)


def test_list_part_masters_search_name(db):
    """按名称搜索。"""
    names = ["螺栓", "螺母", "垫圈"]
    for name in names:
        m = models_parts.PartMaster(
            id=uuid.uuid4(), code=f"P-{name}", name=name, type="part",
        )
        db.add(m)
        db.flush()
        db.add(models_parts.PartRevision(
            id=uuid.uuid4(), master_id=m.id, version="A", status="draft", latest_iteration=1,
        ))
    db.commit()

    items, _ = crud_parts.list_part_masters(
        db, search='螺栓', search_field='name', page=1, page_size=50,
        show_all_versions=True,
    )
    assert len(items) == 1
    assert items[0]['name'] == '螺栓'


def test_list_part_masters_search_no_match(db):
    """搜索无匹配应返回空列表。"""
    _make_sample_parts(db, masters=2, versions=1)
    items, total = crud_parts.list_part_masters(
        db, search='ZZZZZZZZ', search_field='code', page=1, page_size=50,
        show_all_versions=True,
    )
    assert items == []
    assert total == 0


# ===== 总量一致性 =====


def test_list_part_masters_show_all_versions_total_consistency(db):
    """total 应与返回行数一致。"""
    _make_sample_parts(db, masters=5, versions=2)
    items, total = crud_parts.list_part_masters(
        db, page=1, page_size=1000, show_all_versions=True,
    )
    assert total == len(items)
    assert total >= 10


# ===== 类型过滤测试 =====


def test_list_part_masters_type_filter(db):
    """type 参数过滤零件/部件。"""
    m_part = models_parts.PartMaster(id=uuid.uuid4(), code="P-TYPE-01", name="零件", type="part")
    db.add(m_part)
    db.flush()
    db.add(models_parts.PartRevision(
        id=uuid.uuid4(), master_id=m_part.id, version="A", status="draft", latest_iteration=1,
    ))
    m_asm = models_parts.PartMaster(id=uuid.uuid4(), code="A-TYPE-01", name="部件", type="assembly")
    db.add(m_asm)
    db.flush()
    db.add(models_parts.PartRevision(
        id=uuid.uuid4(), master_id=m_asm.id, version="A", status="draft", latest_iteration=1,
    ))
    db.commit()

    parts, _ = crud_parts.list_part_masters(
        db, type='part', show_all_versions=True, page=1, page_size=50,
    )
    asms, _ = crud_parts.list_part_masters(
        db, type='assembly', show_all_versions=True, page=1, page_size=50,
    )
    assert all(it['component_type'] == 'part' for it in parts)
    assert all(it['component_type'] == 'assembly' for it in asms)
    assert len(parts) == 1
    assert len(asms) == 1


# ===== 需要跳过的测试（SQLite 不支持的 PG 特性） =====


@pytest.mark.skip(reason="SQLite 不支持 JOIN LATERAL（show_all_versions=False 需要）")
def test_list_part_masters_sort_code_asc_latest(db):
    """按件号排序，仅显示最新版本（需要 LATERAL）。"""
    _make_sample_parts(db, masters=5, versions=1)
    items, _ = crud_parts.list_part_masters(
        db, page=1, page_size=50, sort_field='code', sort_order='asc',
        show_all_versions=False,
    )
    codes = [it['code'] for it in items]
    assert codes == sorted(codes)


@pytest.mark.skip(reason="SQLite 不支持 JOIN LATERAL（show_all_versions=False 需要）")
def test_list_part_masters_status_filter_show_all_false(db):
    """show_all_versions=False + status 过滤器（需要 LATERAL）。"""
    _make_sample_parts(db, masters=3, versions=2)
    items, total = crud_parts.list_part_masters(
        db, show_all_versions=False, status='draft', page=1, page_size=50,
    )
    assert total >= 0


@pytest.mark.skip(reason="SQLite 不支持 to_char/::text 及 ILIKE 组合（自定义字段搜索需要 PG 函数）")
def test_list_part_masters_search_include_custom_fields(db):
    """include_custom_fields=True 时 search 命中自定义字段值。"""
    masters = _make_sample_parts(db, masters=3, versions=1)
    cf_field = db.query(CustomFieldDefinition).first()
    if not cf_field:
        cf_field = CustomFieldDefinition(
            id=uuid.uuid4(), name="颜色", field_key="color",
            field_type="text", applies_to=["component"],
        )
        db.add(cf_field)
        db.flush()
    cfv = CustomFieldValue(
        field_id=cf_field.id, entity_type="component",
        entity_id=masters[0][0], value_text="红色", iteration_id=None,
    )
    db.add(cfv)
    db.commit()

    items_without, _ = crud_parts.list_part_masters(
        db, search="红色", search_field="all", include_custom_fields=False,
        show_all_versions=True,
    )
    items_with, _ = crud_parts.list_part_masters(
        db, search="红色", search_field="all", include_custom_fields=True,
        show_all_versions=True,
    )
    assert len(items_with) > len(items_without)
