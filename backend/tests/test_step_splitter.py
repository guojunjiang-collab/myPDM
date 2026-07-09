from app.cad.assembly_parser import build_structure_index
from app.cad.step_splitter import split_subitem_step
from tests.test_step_structure_index import MINI


# 复现起落架"拆出文件无几何"：SolidWorks AP214 里零件几何在独立的
# ADVANCED_BREP_SHAPE_REPRESENTATION，通过纯 SHAPE_REPRESENTATION_RELATIONSHIP
# 与放置 SHAPE_REPRESENTATION 关联（区别于装配用的 ..._WITH_TRANSFORMATION）。
MINI_GEOM = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('a.step','',(''),(''),'','SolidWorks','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('P1','P1','',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#3=APPLICATION_CONTEXT('core');
#5=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#1,.NOT_KNOWN.);
#10=PRODUCT_DEFINITION('','',#5,#6);
#6=PRODUCT_DEFINITION_CONTEXT('',#3,'design');
#20=PRODUCT_DEFINITION_SHAPE('','',#10);
#25=SHAPE_DEFINITION_REPRESENTATION(#20,#30);
#30=SHAPE_REPRESENTATION('placement',(#31),#40);
#31=AXIS2_PLACEMENT_3D('',#32,$,$);
#32=CARTESIAN_POINT('',(0.,0.,0.));
#40=(GEOMETRIC_REPRESENTATION_CONTEXT(3));
#50=ADVANCED_BREP_SHAPE_REPRESENTATION('geom',(#51,#31),#40);
#51=MANIFOLD_SOLID_BREP('solid',#52);
#52=CLOSED_SHELL('',(#53));
#53=ADVANCED_FACE('face',(),#54,.T.);
#54=PLANE('',#31);
#60=SHAPE_REPRESENTATION_RELATIONSHIP('NONE','NONE',#30,#50);
ENDSEC;
END-ISO-10303-21;
"""


def test_split_leaf_includes_solid_geometry():
    """拆出的叶件必须带上 B-rep 实体几何（复现并防回归：起落架空文件 bug）。"""
    idx = build_structure_index(MINI_GEOM)
    out = split_subitem_step(idx, idx.root_pd_by_product_name['P1'], 'P1.STEP')
    assert 'MANIFOLD_SOLID_BREP' in out, "拆出文件缺实体几何"
    assert 'ADVANCED_FACE' in out
    # 无悬空引用
    import re
    defined = set(re.findall(r'(?m)^#(\d+)\s*=', out))
    used = set(re.findall(r'#(\d+)', out))
    assert used.issubset(defined), f"悬空引用: {used - defined}"


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
