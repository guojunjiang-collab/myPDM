"""回归测试：AssemblyTreeNodeDTO 必须保留 instance_index。

缺此字段时 response_model 会把它剥离，导致前端多实例零件的 mesh uuid
挂不上装配树 → 上色/选中/隔离对多实例零件全部失效（线框仍可用）。
"""
from app.schemas_parts import AssemblyTreeNodeDTO


def test_dto_preserves_instance_index_through_serialization():
    node = {
        "bom_item_id": "L1",
        "instance_index": 1,
        "part_code": "SCREW#2",
        "part_name": "螺钉",
        "quantity": 1,
        "instance_count": 1,
        "is_leaf": True,
        "children": [],
    }
    dto = AssemblyTreeNodeDTO.model_validate(node)
    assert dto.instance_index == 1
    # 模拟 response_model 序列化：字段不能被剥离
    assert dto.model_dump()["instance_index"] == 1


def test_dto_instance_index_optional_defaults_none():
    node = {
        "bom_item_id": "L2",
        "part_code": "BRACKET",
        "part_name": "支架",
        "quantity": 1,
        "instance_count": 1,
        "is_leaf": True,
        "children": [],
    }
    dto = AssemblyTreeNodeDTO.model_validate(node)
    assert dto.instance_index is None
    assert "instance_index" in dto.model_dump()
