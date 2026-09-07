from pathlib import Path
from app import stp_converter as sc


def test_glb_cache_path_uses_uuid_key(tmp_path):
    """验证 glb 缓存路径以附件 UUID 为唯一键（零部件与图文档一致，不再按目录+stem）"""
    orig = sc.GLTF_CACHE_DIR
    sc.GLTF_CACHE_DIR = tmp_path
    try:
        p = sc.get_glb_cache_path("abc123", file_path="document/GD40_A/part.stp")
        assert p.name == "abc123.glb"
        assert p.parent == tmp_path
        p2 = sc.get_glb_cache_path("abc123", file_path="uploads/parts/X/A/1/x.stp", is_part=True)
        assert p2.name == "abc123.glb"
        assert p2.parent.name == "parts"
    finally:
        sc.GLTF_CACHE_DIR = orig


def test_lod_glb_paths_three_tiers(tmp_path):
    """验证 get_lod_glb_paths 基于 UUID 键返回 coarse/normal/fine 三档路径"""
    orig = sc.GLTF_CACHE_DIR
    sc.GLTF_CACHE_DIR = tmp_path
    try:
        paths = sc.get_lod_glb_paths("abc123", file_path="document/GD40_A/part.stp")
        assert set(paths.keys()) == {"coarse", "normal", "fine"}
        assert paths["coarse"].name == "abc123_coarse.glb"
        assert paths["normal"].name == "abc123_normal.glb"
        assert paths["fine"].name == "abc123_fine.glb"
        assert paths["coarse"].parent == paths["fine"].parent == tmp_path
    finally:
        sc.GLTF_CACHE_DIR = orig


def test_delete_glb_cache_removes_base_lods_and_failed(tmp_path):
    """验证 delete_glb_cache 删除 base + 三档 LOD + 失败标记"""
    orig = sc.GLTF_CACHE_DIR
    sc.GLTF_CACHE_DIR = tmp_path
    try:
        base = sc.get_glb_cache_path("abc123", is_part=True)
        lods = sc.get_lod_glb_paths("abc123", is_part=True)
        base.parent.mkdir(parents=True, exist_ok=True)
        for p in [base, *lods.values()]:
            p.write_bytes(b"x")
        base.with_suffix(".failed").touch()
        sc.delete_glb_cache("abc123", is_part=True)
        assert not base.exists()
        assert not any(p.exists() for p in lods.values())
        assert not base.with_suffix(".failed").exists()
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
