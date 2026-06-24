import uuid
from app import models_project  # noqa: F401
from app.models_project import Project, ProjectMember, ProjectTask, ProjectTaskLink, ProjectTaskComment


def test_project_and_task_tree_insert(db):
    p = Project(code="PRJ-001", name="X300 整机研发", owner_id=uuid.uuid4())
    db.add(p); db.commit(); db.refresh(p)
    assert p.id is not None and p.status == "进行中" and p.deleted_at is None

    root = ProjectTask(project_id=p.id, code="PRJ-001-01", name="方案设计阶段")
    db.add(root); db.commit(); db.refresh(root)
    assert root.task_type == "任务" and root.status == "未开始" and root.priority == "中"

    child = ProjectTask(project_id=p.id, parent_id=root.id, code="PRJ-001-02", name="BOM 搭建")
    db.add(child); db.commit(); db.refresh(child)
    assert child.parent_id == root.id


def test_member_link_comment_insert(db):
    pid = uuid.uuid4(); uid = uuid.uuid4(); tid = uuid.uuid4()
    db.add(ProjectMember(project_id=pid, user_id=uid, role_in_project="经理"))
    db.add(ProjectTaskLink(task_id=tid, entity_type="part", entity_id=uuid.uuid4()))
    db.add(ProjectTaskComment(task_id=tid, user_id=uid, content="第一条评论"))
    db.commit()
    assert db.query(ProjectMember).count() == 1
    assert db.query(ProjectTaskLink).count() == 1
    assert db.query(ProjectTaskComment).count() == 1
