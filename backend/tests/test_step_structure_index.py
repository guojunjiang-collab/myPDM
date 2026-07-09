from app.cad.assembly_parser import build_structure_index

# 最小合成 STEP：一个产品 P1，PD #10，shape rep #30
MINI = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('a.step','',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('P1','P1','',(#2));
#2=PRODUCT_CONTEXT('',#3,'mechanical');
#3=APPLICATION_CONTEXT('core');
#5=PRODUCT_DEFINITION_FORMATION('','',#1);
#10=PRODUCT_DEFINITION('','',#5,#6);
#6=PRODUCT_DEFINITION_CONTEXT('',#3,'design');
#20=PRODUCT_DEFINITION_SHAPE('','',#10);
#25=SHAPE_DEFINITION_REPRESENTATION(#20,#30);
#30=SHAPE_REPRESENTATION('',(#31),#40);
#31=AXIS2_PLACEMENT_3D('',#32,$,$);
#32=CARTESIAN_POINT('',(0.,0.,0.));
#40=(GEOMETRIC_REPRESENTATION_CONTEXT(3));
ENDSEC;
END-ISO-10303-21;
"""


def test_structure_index_basic():
    idx = build_structure_index(MINI)
    # 原始语句可取回，且含引用
    assert idx.raw_by_id[10].startswith('#10=PRODUCT_DEFINITION')
    assert '#5' in idx.raw_by_id[10]
    # 产品名 → 根 PD
    assert idx.root_pd_by_product_name['P1'] == 10
    # PD → shape rep
    assert idx.shape_rep_by_pd[10] == 30
    # header 保留
    assert 'FILE_SCHEMA' in idx.header


def test_refs_of_parses_all_ids():
    from app.cad.assembly_parser import refs_of
    assert refs_of("#30=SHAPE_REPRESENTATION('',(#31),#40);") == {31, 40}
