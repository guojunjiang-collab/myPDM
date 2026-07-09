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
    """拆出的叶件必须带上 B-rep 实体几何 + 完整关联骨架（否则 OpenCASCADE 读不出/转不出）。"""
    idx = build_structure_index(MINI_GEOM)
    out = split_subitem_step(idx, idx.root_pd_by_product_name['P1'], 'P1.STEP')
    assert 'MANIFOLD_SOLID_BREP' in out, "拆出文件缺实体几何"
    assert 'ADVANCED_FACE' in out
    # 关联骨架：PD→PDS→SDR→放置SR→SRR→几何ABSR，缺一 OpenCASCADE 就 File transfer problem
    assert 'PRODUCT_DEFINITION_SHAPE' in out, "缺 PD→shape 锚点"
    assert 'SHAPE_DEFINITION_REPRESENTATION' in out, "缺 PDS→SR 关联"
    assert 'SHAPE_REPRESENTATION_RELATIONSHIP' in out, "缺 放置SR→几何 桥接关系"
    # 无悬空引用
    import re
    defined = set(re.findall(r'(?m)^#(\d+)\s*=', out))
    used = set(re.findall(r'#(\d+)', out))
    assert used.issubset(defined), f"悬空引用: {used - defined}"


# 两个叶件 P1/P2 共享同一 PRODUCT_CONTEXT #2 与几何 context #40（CATIA 的典型结构）。
MINI_SHARED = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('a.stp','',(''),(''),'','CATIA V5','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('P1','P1','',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#3=APPLICATION_CONTEXT('core');
#8=PRODUCT('P2','P2','',(#2));
#5=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#1,.NOT_KNOWN.);
#9=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#8,.NOT_KNOWN.);
#10=PRODUCT_DEFINITION('','',#5,#6);
#11=PRODUCT_DEFINITION('','',#9,#6);
#6=PRODUCT_DEFINITION_CONTEXT('',#3,'design');
#20=PRODUCT_DEFINITION_SHAPE('','',#10);
#21=PRODUCT_DEFINITION_SHAPE('','',#11);
#25=SHAPE_DEFINITION_REPRESENTATION(#20,#30);
#26=SHAPE_DEFINITION_REPRESENTATION(#21,#31);
#30=SHAPE_REPRESENTATION('',(#32),#40);
#31=SHAPE_REPRESENTATION('',(#33),#40);
#32=AXIS2_PLACEMENT_3D('',#34,$,$);
#33=AXIS2_PLACEMENT_3D('',#35,$,$);
#34=CARTESIAN_POINT('',(0.,0.,0.));
#35=CARTESIAN_POINT('',(1.,1.,1.));
#40=(GEOMETRIC_REPRESENTATION_CONTEXT(3));
#50=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#51,#32),#40);
#51=MANIFOLD_SOLID_BREP('p1solid',#52);
#52=CLOSED_SHELL('',(#53));
#53=ADVANCED_FACE('',(),#54,.T.);
#54=PLANE('',#32);
#60=SHAPE_REPRESENTATION_RELATIONSHIP('','',#30,#50);
#70=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#71,#33),#40);
#71=MANIFOLD_SOLID_BREP('p2solid',#72);
#72=CLOSED_SHELL('',(#73));
#73=ADVANCED_FACE('',(),#74,.T.);
#74=PLANE('',#33);
#80=SHAPE_REPRESENTATION_RELATIONSHIP('','',#31,#70);
ENDSEC;
END-ISO-10303-21;
"""


def test_split_leaf_no_sibling_bleed():
    """共享 PRODUCT_CONTEXT 时，拆 P1 不得因反向补全级联串入兄弟 P2（CATIA 空文件 bug）。"""
    import re
    idx = build_structure_index(MINI_SHARED)
    out = split_subitem_step(idx, idx.root_pd_by_product_name['P1'], 'P1.STEP')
    assert 'p1solid' in out, "缺自身几何"
    assert 'p2solid' not in out, "串入了兄弟零件几何"
    assert out.count('MANIFOLD_SOLID_BREP') == 1
    assert len(re.findall(r'#\d+=PRODUCT\(', out)) == 1, "混入了兄弟 PRODUCT"


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
