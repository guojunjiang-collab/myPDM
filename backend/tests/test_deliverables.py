"""项目交付物汇总：四类对象聚合、版本去重、来源任务合并。"""
import uuid
from datetime import datetime, timezone

from app import models, crud_deliverables
from app.models_parts import PartMaster, PartRevision
from app.models_project import Project, ProjectTask, ProjectTaskLink


# ────────── 构造辅助 ──────────

def _user(db, name="张三"):
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}", password_hash="x",
                    real_name=name, role="engineer", status="active")
    db.add(u); db.commit()
    return u


def _project(db, owner, code="PRJ-1"):
    p = Project(id=uuid.uuid4(), code=code, name="项目一", owner_id=owner.id)
    db.add(p); db.commit()
    return p


def _task(db, project, code="T-01", name="结构设计", deleted=False):
    t = ProjectTask(id=uuid.uuid4(), project_id=project.id, code=code, name=name,
                    deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(t); db.commit()
    return t


def _link(db, task, entity_type, entity_id):
    lk = ProjectTaskLink(id=uuid.uuid4(), task_id=task.id,
                         entity_type=entity_type, entity_id=entity_id)
    db.add(lk); db.commit()
    return lk


def _part(db, creator, code="P-001", versions=("A",), ptype="part",
          status="released", deleted=False):
    m = PartMaster(id=uuid.uuid4(), code=code, name=f"{code}名称", type=ptype,
                   creator_id=creator.id,
                   deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = PartRevision(id=uuid.uuid4(), master_id=m.id, version=v, status=status,
                         creator_id=creator.id)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


# ────────── 用例 ──────────

def test_empty_project_returns_empty_list(db):
    owner = _user(db)
    p = _project(db, owner)
    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_part_linked_by_two_tasks_is_one_row_with_two_tasks(db):
    owner = _user(db)
    p = _project(db, owner)
    t1 = _task(db, p, code="T-01", name="设计")
    t2 = _task(db, p, code="T-02", name="校核")
    m, revs = _part(db, owner)
    _link(db, t1, "part", revs[0].id)
    _link(db, t2, "part", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    it = items[0]
    assert it["code"] == "P-001"
    assert it["version"] == "A"
    assert it["status"] == "released"
    assert it["creator_name"] == "张三"
    assert it["extra"] == "零件"
    assert it["entity_type"] == "part"
    assert it["master_id"] == str(m.id)
    assert [t["code"] for t in it["tasks"]] == ["T-01", "T-02"]


def test_two_versions_of_same_master_are_two_rows(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, versions=("A", "B"))
    _link(db, t, "part", revs[0].id)
    _link(db, t, "part", revs[1].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 2
    assert sorted(i["version"] for i in items) == ["A", "B"]


def test_deleted_task_link_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p, deleted=True)
    m, revs = _part(db, owner)
    _link(db, t, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_deleted_part_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, deleted=True)
    _link(db, t, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db)) == []


def test_obsolete_part_is_included(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, status="obsolete")
    _link(db, t, "part", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["status"] == "obsolete"


def test_assembly_extra_label_is_bujian(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _part(db, owner, code="A-001", ptype="assembly")
    _link(db, t, "assembly", revs[0].id)

    items = crud_deliverables.list_parts(db, p.id, crud_deliverables._user_names(db))
    assert items[0]["extra"] == "部件"
    assert items[0]["entity_type"] == "assembly"


def test_other_project_links_are_not_mixed_in(db):
    owner = _user(db)
    p1 = _project(db, owner, code="PRJ-1")
    p2 = _project(db, owner, code="PRJ-2")
    t2 = _task(db, p2)
    m, revs = _part(db, owner)
    _link(db, t2, "part", revs[0].id)

    assert crud_deliverables.list_parts(db, p1.id, crud_deliverables._user_names(db)) == []


# ────────── Task 2: 图文档与构型项 ──────────

from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision, ConfigurationItemIteration,
)


def _document(db, creator, code="D-001", versions=("A",), status="released",
              remark="首版", deleted=False):
    m = models.DocumentMaster(id=uuid.uuid4(), code=code, name=f"{code}图纸",
                              creator_id=creator.id,
                              deleted_at=datetime.now(timezone.utc) if deleted else None)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models.DocumentRevision(id=uuid.uuid4(), master_id=m.id, version=v,
                                    status=status, remark=remark, creator_id=creator.id)
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_item(db, creator, code="CI-001", version="A", status="released",
                 latest_iteration=2, version_name="首轮构型"):
    m = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=f"{code}构型",
                                creator_id=creator.id)
    db.add(m); db.flush()
    r = ConfigurationItemRevision(id=uuid.uuid4(), master_id=m.id, version=version,
                                  status=status, latest_iteration=latest_iteration,
                                  creator_id=creator.id)
    db.add(r); db.flush()
    # 造两个迭代，确认取的是 latest_iteration 那个而不是第一个
    db.add(ConfigurationItemIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1,
                                      version_name="旧名"))
    db.add(ConfigurationItemIteration(id=uuid.uuid4(), revision_id=r.id,
                                      iteration=latest_iteration, version_name=version_name))
    db.commit()
    return m, r


def test_document_extra_is_remark(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _document(db, owner, remark="出图版")
    _link(db, t, "document", revs[0].id)

    items = crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["code"] == "D-001"
    assert items[0]["extra"] == "出图版"
    assert items[0]["entity_type"] == "document"
    assert items[0]["master_id"] == str(m.id)
    assert items[0]["version"] == "A"


def test_deleted_document_is_excluded(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, revs = _document(db, owner, deleted=True)
    _link(db, t, "document", revs[0].id)

    assert crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db)) == []


def test_documents_sorted_by_code(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    for code in ("D-003", "D-001", "D-002"):
        _, revs = _document(db, owner, code=code)
        _link(db, t, "document", revs[0].id)

    items = crud_deliverables.list_documents(db, p.id, crud_deliverables._user_names(db))
    assert [i["code"] for i in items] == ["D-001", "D-002", "D-003"]


def test_config_item_extra_is_latest_iteration_version_name(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m, rev = _config_item(db, owner, version_name="二轮构型")
    _link(db, t, "config_item", rev.id)

    items = crud_deliverables.list_config_items(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["code"] == "CI-001"
    assert items[0]["extra"] == "二轮构型"
    assert items[0]["entity_type"] == "config_item"
    assert items[0]["master_id"] == str(m.id)


def test_config_item_without_matching_iteration_has_empty_extra(db):
    owner = _user(db)
    p = _project(db, owner)
    t = _task(db, p)
    m = ConfigurationItemMaster(id=uuid.uuid4(), code="CI-009", name="无迭代构型",
                                creator_id=owner.id)
    db.add(m); db.flush()
    rev = ConfigurationItemRevision(id=uuid.uuid4(), master_id=m.id, version="A",
                                    status="draft", latest_iteration=5, creator_id=owner.id)
    db.add(rev); db.commit()
    _link(db, t, "config_item", rev.id)

    items = crud_deliverables.list_config_items(db, p.id, crud_deliverables._user_names(db))
    assert len(items) == 1
    assert items[0]["extra"] == ""
