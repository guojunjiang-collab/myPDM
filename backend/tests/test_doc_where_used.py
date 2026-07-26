"""图文档反查：构型项 / 零部件 / 任务 / ECO / ECR。"""
import uuid
from app import models
from app import crud_configuration as ccrud
from app.models_configuration import (
    ConfigurationItemMaster, ConfigurationItemRevision, ConfigurationItemIteration,
)


def _doc(db, code="D1", versions=("A",)):
    m = models.DocumentMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(m); db.flush()
    revs = []
    for v in versions:
        r = models.DocumentRevision(id=uuid.uuid4(), master_id=m.id, version=v, status="released")
        db.add(r); db.flush(); revs.append(r)
    db.commit()
    return m, revs


def _config_iter(db, code="CI1", doc_rev_ids=()):
    cm = ConfigurationItemMaster(id=uuid.uuid4(), code=code, name=code)
    db.add(cm); db.flush()
    cr = ConfigurationItemRevision(id=uuid.uuid4(), master_id=cm.id, version="A", status="released")
    db.add(cr); db.flush()
    ci = ConfigurationItemIteration(
        id=uuid.uuid4(), revision_id=cr.id, iteration=1,
        document_links=[{"document_id": str(d), "document_name": "x"} for d in doc_rev_ids],
    )
    db.add(ci); db.commit()
    return cm, cr, ci


def test_where_used_configs_by_document(db):
    m, revs = _doc(db, versions=("A", "B"))
    cm, cr, ci = _config_iter(db, doc_rev_ids=[revs[0].id])
    hit = ccrud.where_used_configurations_by_document(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["config_item_revision_id"] == str(cr.id)
    assert hit[0]["code"] == cm.code
    assert ccrud.where_used_configurations_by_document(db, revs[1].id) == []


# ====== Task 2: 零部件反查 ======

from app import crud_documents as dcrud
from app import models_parts


def _part_iter(db, code="P1", doc_rev_ids=()):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.flush()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", status="released", latest_iteration=1)
    db.add(r); db.flush()
    it = models_parts.PartIteration(
        id=uuid.uuid4(), revision_id=r.id, iteration=1,
        document_links=[{"document_id": str(d), "document_name": "x"} for d in doc_rev_ids],
    )
    db.add(it); db.commit()
    return m, r, it


def test_where_used_parts_by_document(db):
    m, revs = _doc(db, code="D2", versions=("A", "B"))
    pm, pr, it = _part_iter(db, doc_rev_ids=[revs[0].id])
    hit = dcrud.where_used_parts_by_document(db, revs[0].id)
    assert len(hit) == 1
    assert hit[0]["master_id"] == str(pm.id)
    assert hit[0]["revision_id"] == str(pr.id)
    assert hit[0]["code"] == pm.code
    assert dcrud.where_used_parts_by_document(db, revs[1].id) == []


# ====== Task 3: 项目任务反查 ======

from app import crud_project as pcrud
from app.models_project import Project, ProjectTask, ProjectTaskLink


def test_where_used_tasks_by_document(db):
    m, revs = _doc(db, code="D3", versions=("A",))
    proj = Project(id=uuid.uuid4(), code=f"PRJ-{uuid.uuid4().hex[:5]}", name="proj", owner_id=uuid.uuid4())
    db.add(proj); db.flush()
    t = ProjectTask(id=uuid.uuid4(), project_id=proj.id, code="T1", name="任务1")
    db.add(t); db.flush()
    db.add(ProjectTaskLink(id=uuid.uuid4(), task_id=t.id, entity_type="document", entity_id=revs[0].id))
    db.commit()
    rows = pcrud.where_used_tasks_by_document(db, revs[0].id)
    assert len(rows) == 1
    task, project = rows[0]
    assert str(task.id) == str(t.id) and str(project.id) == str(proj.id)
    m2, revs2 = _doc(db, code="D3B", versions=("A",))
    assert pcrud.where_used_tasks_by_document(db, revs2[0].id) == []


# ====== Task 4: ECO/ECR 反查 ======

from app import crud_eco, crud_ecr
from app.models_eco import ECO
from app.models_ecr import ECR


def test_where_used_ecos_and_ecrs_by_document(db):
    m, revs = _doc(db, code="D4", versions=("A", "B"))
    eco = ECO(id=uuid.uuid4(), eco_number="ECO-1", title="变更1", reason="设计", creator_id=uuid.uuid4(),
              document_links=[{"document_id": str(revs[0].id), "document_name": "x"}])
    ecr = ECR(id=uuid.uuid4(), ecr_number="ECR-1", title="请求1", reason="设计", creator_id=uuid.uuid4(),
              document_links=[{"document_id": str(revs[0].id), "document_name": "x"}])
    db.add_all([eco, ecr]); db.commit()
    eco_hit = crud_eco.where_used_by_document(db, revs[0].id)
    ecr_hit = crud_ecr.where_used_by_document(db, revs[0].id)
    assert len(eco_hit) == 1 and eco_hit[0]["eco_number"] == "ECO-1"
    assert len(ecr_hit) == 1 and ecr_hit[0]["ecr_number"] == "ECR-1"
    assert crud_eco.where_used_by_document(db, revs[1].id) == []
    assert crud_ecr.where_used_by_document(db, revs[1].id) == []
