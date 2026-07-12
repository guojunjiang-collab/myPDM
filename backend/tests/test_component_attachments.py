"""file_storage 与 components 迁移脚本的兼容性测试。

注：原针对已废弃 Component/ComponentAttachment 模型及 /api/components 路由的用例
已随 components→parts 三层模型迁移移除；零部件附件行为由
test_bom_attachments_download.py 等基于 /api/parts 的用例覆盖。
"""
from app import file_storage as fs_mod


def test_file_storage_allows_component_entity():
    # "component" 作为历史 entity_type 别名保留，兼容存量附件路径
    assert "component" in fs_mod.ALLOWED_ENTITY_TYPES
    assert fs_mod.ENTITY_TYPE_ALIASES.get("components") == "component"


def test_migrate_components_is_noop_on_sqlite(db):
    from app.migrations_components import migrate_components
    assert migrate_components(db, db.get_bind()) is None
