"""零部件类型自愈迁移：把"存在未删除 BOM 子项但 type='part'"的 master 修正为 'assembly'。

背景：BOM 子项可通过 CAD 同步（sync_cad_bom_children）等历史路径写入，
早期这些路径未同步 PartMaster.type，导致有子项的装配被标记为零件。
本迁移幂等，可重复执行；仅做 part→assembly 单向修正，
不反向处理（部件升版后尚未建立 BOM 关系的场景保持 assembly，见 parts.py 注释）。
"""
from sqlalchemy import text


def migrate_component_type_by_children(db, engine):
    """有 BOM 子项的零部件 → assembly（幂等）"""
    db.execute(text("""
        UPDATE part_masters m
        SET type = 'assembly'
        WHERE m.deleted_at IS NULL
          AND m.type = 'part'
          AND EXISTS (
              SELECT 1
              FROM part_revisions r
              JOIN bom_items b ON b.parent_revision_id = r.id AND b.deleted_at IS NULL
              WHERE r.master_id = m.id AND r.deleted_at IS NULL
          )
    """))
    db.commit()
