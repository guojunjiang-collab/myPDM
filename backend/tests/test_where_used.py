"""零部件反查：构型项 / 项目任务 / 构型配置。"""
import uuid
from app import models_parts
from app import crud_configuration as ccrud
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision,
    ConfigurationItemIteration, ConfigurationItemPart,
    ConfigurationProfile, ConfigurationProfileItem,
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


from app import crud_project as pcrud
from app.models_project import Project, ProjectTask, ProjectTaskLink


def _task_with_link(db, entity_rev_id, entity_type="part"):
    proj = Project(id=uuid.uuid4(), code=f"PRJ-{uuid.uuid4().hex[:5]}", name="proj", owner_id=uuid.uuid4())
    db.add(proj); db.flush()
    t = ProjectTask(id=uuid.uuid4(), project_id=proj.id, code="T1", name="任务1")
    db.add(t); db.flush()
    db.add(ProjectTaskLink(id=uuid.uuid4(), task_id=t.id, entity_type=entity_type, entity_id=entity_rev_id))
    db.commit()
    return proj, t


def test_where_used_tasks_matches_revision(db):
    m, revs = _part(db, versions=("A",))
    proj, t = _task_with_link(db, revs[0].id, entity_type="part")
    rows = pcrud.where_used_tasks(db, revs[0].id)
    assert len(rows) == 1
    task, project = rows[0]
    assert str(task.id) == str(t.id)
    assert str(project.id) == str(proj.id)
    # 无引用版本 → 空
    m2, revs2 = _part(db, code="P2", versions=("A",))
    assert pcrud.where_used_tasks(db, revs2[0].id) == []


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


def test_where_used_profiles_matches_bound_version(db):
    m, revs = _part(db, versions=("A", "B"))
    prof = ConfigurationProfile(
        id=uuid.uuid4(), code=f"CFG-{uuid.uuid4().hex[:5]}", name="配置1",
        status="active", creator_id=uuid.uuid4(), reviewers=[], review_mode="all", cc_users=[],
    )
    db.add(prof); db.flush()
    db.add(ConfigurationProfileItem(
        id=uuid.uuid4(), profile_id=prof.id, item_type="part", item_id=m.id,
        item_code=m.code, item_name=m.name, part_revision_id=revs[0].id,
        is_required=True, is_selected=True, quantity=1, source_type="direct", sort_order=0,
    )); db.commit()
    hit = ccrud.where_used_profiles(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["profile_id"] == str(prof.id)
    assert hit[0]["code"] == prof.code
    # 绑定 A，查 B → 空
    assert ccrud.where_used_profiles(db, revs[1].id) == []
