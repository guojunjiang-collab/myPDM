import pytest


def test_trsf_values_to_matrix_row_major():
    from app.cad.assembly_parser import _trsf_values_to_matrix
    class FakeTrsf:
        def Value(self, i, j):
            table = {
                (1,1):1,(1,2):0,(1,3):0,(1,4):100,
                (2,1):0,(2,2):1,(2,3):0,(2,4):200,
                (3,1):0,(3,2):0,(3,3):1,(3,4):300,
            }
            return table[(i, j)]
    m = _trsf_values_to_matrix(FakeTrsf())
    assert m == [1,0,0,100, 0,1,0,200, 0,0,1,300, 0,0,0,1]


def test_parse_assembly_step_smoke(tmp_path):
    OCC = pytest.importorskip("OCC")
    import os
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "mini_assembly.step")
    if not os.path.exists(fixture):
        pytest.skip("缺少 mini_assembly.step 夹具")
    from app.cad.assembly_parser import parse_assembly_step
    result = parse_assembly_step(fixture)
    assert result["unit"] == "mm"
    assert len(result["occurrences"]) >= 1
    for occ in result["occurrences"]:
        assert len(occ["local_matrix"]) == 16
