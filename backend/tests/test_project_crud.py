import uuid
import pytest
from fastapi import HTTPException

from app import models_project  # noqa: F401
from app import crud_project
from app.schemas_project import ProjectCreate, ProjectEdit, MemberAdd


def _make_user(db, role="engineer"):
    from app import models
    u = models.User(id=uuid.uuid4(), username=f"u{uuid.uuid4().hex[:6]}",
                    password_hash="x", real_name="测试", role=role, status="active")
    db.add(u); db.commit(); db.refresh(u)
    return u


def test_create_project_auto_code_and_owner_member(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="项目A"), owner.id)
    assert p.code.startswith("PRJ-")
    assert p.owner_id == owner.id
    members = crud_project.list_members(db, p.id)
    assert any(m.user_id == owner.id and m.role_in_project == "经理" for m in members)


def test_create_project_sequential_codes(db):
    owner = _make_user(db)
    p1 = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    p2 = crud_project.create_project(db, ProjectCreate(name="B"), owner.id)
    assert p1.code != p2.code


def test_list_projects_only_member_visible(db):
    owner = _make_user(db)
    other = _make_user(db)
    crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    assert len(crud_project.list_projects(db, owner)) == 1
    assert len(crud_project.list_projects(db, other)) == 0


def test_admin_sees_all_projects(db):
    owner = _make_user(db)
    admin = _make_user(db, role="admin")
    crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    assert len(crud_project.list_projects(db, admin)) == 1


def test_add_and_remove_member(db):
    owner = _make_user(db); m = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    crud_project.add_member(db, p.id, MemberAdd(user_id=str(m.id)))
    assert crud_project.is_member(db, p.id, m.id) is True
    crud_project.remove_member(db, p.id, m.id)
    assert crud_project.is_member(db, p.id, m.id) is False


def test_delete_project_soft(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    crud_project.delete_project(db, p)
    assert p.deleted_at is not None
    assert len(crud_project.list_projects(db, owner)) == 0


from app.schemas_project import TaskCreate, TaskEdit, TaskMove, TaskLinkAdd, CommentAdd


def test_create_task_auto_code_and_tree(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    root = crud_project.create_task(db, p, TaskCreate(name="阶段一"))
    assert root.code.startswith(p.code + "-")
    child = crud_project.create_task(db, p, TaskCreate(name="子任务", parent_id=str(root.id)))
    assert child.parent_id == root.id
    tree = crud_project.get_task_tree(db, p.id)
    assert len(tree) == 1 and tree[0]["id"] == str(root.id)
    assert tree[0]["children"][0]["id"] == str(child.id)


def test_update_task_status(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    crud_project.update_task_status(db, t, "进行中")
    assert t.status == "进行中"


def test_delete_task_soft_cascades_subtree(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    root = crud_project.create_task(db, p, TaskCreate(name="R"))
    child = crud_project.create_task(db, p, TaskCreate(name="C", parent_id=str(root.id)))
    crud_project.delete_task(db, root)
    assert crud_project.get_task(db, root.id).deleted_at is not None
    assert crud_project.get_task(db, child.id).deleted_at is not None
    assert crud_project.get_task_tree(db, p.id) == []


def test_task_links_add_list_remove(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    link = crud_project.add_link(db, t.id, TaskLinkAdd(entity_type="part", entity_id=str(uuid.uuid4())))
    assert len(crud_project.list_links(db, t.id)) == 1
    crud_project.remove_link(db, link.id)
    assert len(crud_project.list_links(db, t.id)) == 0


def test_task_comments_add_list_delete(db):
    owner = _make_user(db)
    p = crud_project.create_project(db, ProjectCreate(name="A"), owner.id)
    t = crud_project.create_task(db, p, TaskCreate(name="T"))
    c = crud_project.add_comment(db, t.id, owner.id, CommentAdd(content="hi"))
    assert len(crud_project.list_comments(db, t.id)) == 1
    crud_project.delete_comment(db, c)
    assert len(crud_project.list_comments(db, t.id)) == 0
