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
