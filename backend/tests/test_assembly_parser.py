import pytest
from app.cad.assembly_parser import (
    _tokenize, _parse_tokens, _parse_entity_body,
    _axis2placement_to_matrix, _identity_16,
    _normalize, _cross,
    parse_assembly_step,
)


class TestTokenizer:
    def test_simple_tokens(self):
        tokens = _tokenize("('hello', 123, 45.67)")
        assert tokens == ["(", "'hello'", ",", "123", ",", "45.67", ")"]

    def test_nested_parens(self):
        tokens = _tokenize("(1, (2, 3), 4)")
        assert "(" in tokens and ")" in tokens

    def test_reference(self):
        tokens = _tokenize("#123 = PRODUCT('ID','name','desc',(#456));")
        assert "#123" in tokens
        assert "PRODUCT" in tokens
        assert "'name'" in tokens

    def test_parse_simple_entity(self):
        parsed = _parse_entity_body("'ID','PART-1','desc',(#123)")
        assert parsed[0] == "ID"
        assert parsed[1] == "PART-1"

    def test_backslash_terminated_string(self):
        """CATIA 的 \\X2\\..\\X0\\ 编码以反斜杠结尾，闭合引号前是 `\\'`。
        STEP 标准用 '' 转义引号(非 C 风格 \\')，故字符串必须在此正确闭合，参数不能错位。"""
        # #17=PRODUCT_DEFINITION('\X2\93C8\X0\',' ',#6,#3)
        body = "'\\X2\\93C8\\X0\\',' ',#6,#3"
        parsed = _parse_entity_body(body)
        assert len(parsed) == 4, f"参数错位: {parsed}"
        assert parsed[0] == "\\X2\\93C8\\X0\\"    # id(编码), 不吞掉后续
        assert parsed[2] == "#6"                  # formation 引用位置正确
        assert parsed[3] == "#3"

    def test_step_doubled_quote_escape(self):
        """STEP 标准：字符串内两个连续单引号表示一个单引号。"""
        parsed = _parse_entity_body("'O''Brien','x'")
        assert parsed[0] == "O'Brien"
        assert parsed[1] == "x"


class TestMatrix:
    def test_identity(self):
        m = _identity_16()
        assert len(m) == 16
        assert m[0] == 1.0 and m[5] == 1.0 and m[10] == 1.0 and m[15] == 1.0

    def test_cross_product(self):
        a = [1, 0, 0]
        b = [0, 1, 0]
        c = _cross(a, b)
        assert c == [0, 0, 1]

    def test_normalize(self):
        v = _normalize([3, 0, 0])
        assert v == [1.0, 0.0, 0.0]

    def test_axis2placement_simple(self):
        """模拟 AXIS2_PLACEMENT_3D 的 args 结构"""
        # AXIS2_PLACEMENT_3D('', #origin, #z_axis, #x_axis)
        # origin: CARTESIAN_POINT('', (100, 200, 300))
        # z_axis: DIRECTION('', (0, 0, 1))
        # x_axis: DIRECTION('', (1, 0, 0))
        entities = {
            10: ("CARTESIAN_POINT", ["", [100.0, 200.0, 300.0]]),
            20: ("DIRECTION", ["", [0.0, 0.0, 1.0]]),
            30: ("DIRECTION", ["", [1.0, 0.0, 0.0]]),
        }
        args = ["", "#10", "#20", "#30"]
        m = _axis2placement_to_matrix(args, entities)
        assert len(m) == 16
        # 平移分量
        assert m[3] == 100.0
        assert m[7] == 200.0
        assert m[11] == 300.0

    def test_axis2placement_rotated(self):
        """Z轴向上(0,0,1), X轴向右(1,0,0) → 标准右手系"""
        entities = {
            10: ("CARTESIAN_POINT", ["", [0.0, 0.0, 0.0]]),
            20: ("DIRECTION", ["", [0.0, 0.0, 1.0]]),
            30: ("DIRECTION", ["", [1.0, 0.0, 0.0]]),
        }
        args = ["", "#10", "#20", "#30"]
        m = _axis2placement_to_matrix(args, entities)
        # X' = orthonormalized X → 应该接近 (1,0,0)
        assert abs(m[0] - 1.0) < 1e-6 and abs(m[4] - 0.0) < 1e-6 and abs(m[8] - 0.0) < 1e-6
        # Y = Z × X → (0,1,0)
        assert abs(m[1] - 0.0) < 1e-6 and abs(m[5] - 1.0) < 1e-6 and abs(m[9] - 0.0) < 1e-6
        # Z = (0,0,1)
        assert abs(m[2] - 0.0) < 1e-6 and abs(m[6] - 0.0) < 1e-6 and abs(m[10] - 1.0) < 1e-6


def test_parse_minimal_step(tmp_path):
    """用最小合法 STEP 装配文件测试端到端解析。"""
    step_content = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('AP214'),'1');
FILE_NAME('test.stp','2024-01-01',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('ORIGIN',(100.0,200.0,300.0));
#2 = DIRECTION('Z',(0.0,0.0,1.0));
#3 = DIRECTION('X',(1.0,0.0,0.0));
#4 = AXIS2_PLACEMENT_3D('',#1,#2,#3);
#5 = PRODUCT('ASM','ASSEMBLY','',(#6));
#6 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#5,.NOT_KNOWN.);
#7 = PRODUCT_DEFINITION('','',#6,#8);
#8 = PRODUCT_DEFINITION_CONTEXT('part definition',#9,'manufacturing');
#9 = APPLICATION_CONTEXT('mechanical design');
#10 = PRODUCT('BRACKET','BRACKET','',(#11));
#11 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#10,.NOT_KNOWN.);
#12 = PRODUCT_DEFINITION('','',#11,#8);
#13 = NEXT_ASSEMBLY_USAGE_OCCURRENCE(#5,'','',#7,#12,#4);
ENDSEC;
END-ISO-10303-21;
"""
    p = tmp_path / "test.stp"
    p.write_text(step_content)
    result = parse_assembly_step(str(p))
    assert result["unit"] == "mm"
    assert len(result["occurrences"]) >= 1
    occ = result["occurrences"][0]
    assert occ["name"] == "BRACKET"
    assert len(occ["local_matrix"]) == 16
    # 平移分量
    assert occ["local_matrix"][3] == 100.0
    assert occ["local_matrix"][7] == 200.0
    assert occ["local_matrix"][11] == 300.0
