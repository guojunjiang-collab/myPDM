from app.cad.assembly_parser import build_structure_index
from app.cad.step_splitter import split_subitem_step
from tests.test_step_structure_index import MINI


def test_split_leaf_is_self_contained():
    idx = build_structure_index(MINI)
    root_pd = idx.root_pd_by_product_name['P1']
    out = split_subitem_step(idx, root_pd, 'P1.STEP')

    # 合法外壳
    assert out.startswith('ISO-10303-21;')
    assert 'DATA;' in out and 'END-ISO-10303-21;' in out
    # 无悬空引用：出现的每个 #N 都在文件内被定义
    import re
    defined = set(re.findall(r'(?m)^#(\d+)\s*=', out))
    used = set(re.findall(r'#(\d+)', out))
    assert used.issubset(defined), f"悬空引用: {used - defined}"
    # 几何仍在（重编号后 CARTESIAN_POINT 应出现）
    assert 'CARTESIAN_POINT' in out
    # 重编号从 #1 起
    assert '#1=' in out.replace(' ', '')


def test_split_reparseable():
    # 拆出的叶件 STEP 应能被 parse_assembly_step 读取而不抛异常
    from app.cad.assembly_parser import parse_assembly_step
    import tempfile, os
    idx = build_structure_index(MINI)
    out = split_subitem_step(idx, idx.root_pd_by_product_name['P1'], 'P1.STEP')
    fd, path = tempfile.mkstemp(suffix='.step')
    os.close(fd)
    try:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        result = parse_assembly_step(path)  # 不抛异常即可
        assert result['unit'] == 'mm'
    finally:
        os.unlink(path)
