from pathlib import Path
from app import stp_converter as sc


def test_lod_glb_paths_three_tiers(tmp_path):
    """验证 get_lod_glb_paths 返回 coarse/normal/fine 三档路径"""
    orig = sc.GLTF_CACHE_DIR
    sc.GLTF_CACHE_DIR = tmp_path
    try:
        paths = sc.get_lod_glb_paths("abc123", file_path="document/GD40_A/part.stp")
        assert set(paths.keys()) == {"coarse", "normal", "fine"}
        assert paths["coarse"].name == "part_coarse.glb"
        assert paths["normal"].name == "part_normal.glb"
        assert paths["fine"].name == "part_fine.glb"
        assert paths["coarse"].parent == paths["fine"].parent
    finally:
        sc.GLTF_CACHE_DIR = orig


def test_read_glb_bbox_parses_min_max(tmp_path):
    """验证 read_gltf_bbox 解析 glTF 的 accessor min/max"""
    import json
    gltf = {
        "asset": {"version": "2.0"},
        "accessors": [{"type": "VEC3", "componentType": 5126, "count": 2,
                       "min": [-1.0, -2.0, -3.0], "max": [4.0, 5.0, 6.0]}],
    }
    p = tmp_path / "m.gltf"
    p.write_text(json.dumps(gltf))
    bbox = sc.read_gltf_bbox(str(p))
    assert bbox == {"min": [-1.0, -2.0, -3.0], "max": [4.0, 5.0, 6.0]}
