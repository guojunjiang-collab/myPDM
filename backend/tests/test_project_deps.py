import uuid
import datetime
from app import models_project  # noqa: F401
from app.models_project import Project, ProjectTask, ProjectTaskDep


def test_task_date_columns_accept_date_objects(db):
    p = Project(code="PRJ-001", name="X", owner_id=uuid.uuid4())
    db.add(p); db.commit(); db.refresh(p)
    t = ProjectTask(
        project_id=p.id, code="PRJ-001-01", name="T",
        planned_start=datetime.date(2026, 1, 1), planned_end=datetime.date(2026, 1, 5),
    )
    db.add(t); db.commit(); db.refresh(t)
    assert t.planned_start == datetime.date(2026, 1, 1)
    assert t.planned_end == datetime.date(2026, 1, 5)


def test_dep_insert(db):
    pid = uuid.uuid4(); a = uuid.uuid4(); b = uuid.uuid4()
    d = ProjectTaskDep(project_id=pid, predecessor_id=a, successor_id=b,
                       dep_type="FS", lag_days=0)
    db.add(d); db.commit(); db.refresh(d)
    assert d.dep_type == "FS" and d.lag_days == 0


import pytest
from fastapi import HTTPException
from app import crud_project
from app.schemas_project import ProjectCreate, TaskCreate, DepCreate


def _mk_user(db, role="engineer"):
    from app import models
    import uuid as _u
    u = models.User(id=_u.uuid4(), username=f"u{_u.uuid4().hex[:6]}",
                    password_hash="x", real_name="T", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def _mk_proj_tasks(db, n=3):
    owner = _mk_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="P"), owner.id)
    tasks = [crud_project.create_task(db, p, TaskCreate(name=f"T{i}")) for i in range(n)]
    return p, tasks


def test_add_list_remove_dep(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    d = crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    assert d.dep_type == "FS"
    assert len(crud_project.list_deps(db, p.id)) == 1
    crud_project.remove_dep(db, p.id, d.id)
    assert len(crud_project.list_deps(db, p.id)) == 0


def test_self_loop_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    with pytest.raises(HTTPException) as ei:
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(a.id)))
    assert ei.value.status_code == 400


def test_duplicate_dep_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    with pytest.raises(HTTPException) as ei:
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    assert ei.value.status_code == 400


def test_cycle_rejected(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(b.id), successor_id=str(c.id)))
    with pytest.raises(HTTPException) as ei:  # c->a 会成环 a->b->c->a
        crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(c.id), successor_id=str(a.id)))
    assert ei.value.status_code == 400


def test_delete_task_removes_deps(db):
    p, (a, b, c) = _mk_proj_tasks(db)
    crud_project.add_dep(db, p.id, DepCreate(predecessor_id=str(a.id), successor_id=str(b.id)))
    crud_project.delete_task(db, a)
    assert len(crud_project.list_deps(db, p.id)) == 0
