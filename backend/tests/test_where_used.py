"""零部件反查：构型项 / 项目任务 / 构型配置。"""
import uuid
from app import models_parts
from app import crud_configuration as ccrud
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision,
    ConfigurationItemIteration, ConfigurationItemPart,
)


def _part(db, code="P1", versions=("A",)):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                      status="released", latest_iteration=1)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1", version="A"):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version=version, status="released")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(id=uuid.uuid4(), revision_id=cr.id, iteration=1)
    db.add(ci); db.commit()
    return cm, cr, ci


def test_where_used_configurations_matches_bound_version(db):
    m, revs = _part(db, versions=("A", "B"))
    cm, cr, ci = _config_iter(db)
    # 构型项绑定 A 版
    db.add(ConfigurationItemPart(id=uuid.uuid4(), iteration_id=ci.id, part_type="part",
                                 part_id=m.id, revision_id=revs[0].id, quantity=2)); db.commit()
    hit_a = ccrud.where_used_configurations(db, revs[0].id)
    assert len(hit_a) == 1
    assert hit_a[0]["config_item_revision_id"] == str(cr.id)
    assert hit_a[0]["code"] == cm.code
    assert hit_a[0]["quantity"] == 2
    # 查 B 版：不命中（绑定的是 A）
    assert ccrud.where_used_configurations(db, revs[1].id) == []
