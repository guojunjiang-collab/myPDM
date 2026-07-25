"""构型项零部件版本级绑定：列/写入/更新/详情解析。"""
import uuid
from app import models_parts
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision,
    ConfigurationItemIteration, ConfigurationItemPart,
)


def _part(db, code="P1", ptype="part", versions=("A",)):
    """建一个零件 master + 若干 revision（按传入顺序创建，最后一个为最新）。返回 (master, [rev...])。"""
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type=ptype)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                      status="released", latest_iteration=1)
        db.add(r); db.flush()
        revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1"):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version="A")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(id=uuid.uuid4(), revision_id=cr.id, iteration=1)
    db.add(ci); db.commit()
    return cm, cr, ci


def test_part_link_persists_revision_id(db):
    m, revs = _part(db, versions=("A",))
    _, _, ci = _config_iter(db)
    link = ConfigurationItemPart(
        id=uuid.uuid4(), iteration_id=ci.id, part_type="part",
        part_id=m.id, revision_id=revs[0].id, quantity=1,
    )
    db.add(link); db.commit(); db.refresh(link)
    assert link.revision_id == revs[0].id
