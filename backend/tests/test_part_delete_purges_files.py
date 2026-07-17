"""零部件删除时物理清理附件记录与磁盘文件测试"""
import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User
from app import models_parts, crud_parts


def _make_user(db, role="admin"):
    user = User(
        id=uuid.uuid4(),
        username=f"u_{uuid.uuid4().hex[:8]}",
        password_hash="x",
        real_name="测试用户",
        role=role,
    )
    db.add(user)
    db.commit()
    return user


def _make_part_with_attachment(db, user, code, tmp_path):
    """创建零件（版本A+迭代1）并挂一个指向真实临时文件的附件"""
    master = crud_parts.create_part_master(db, {"code": code, "name": code}, user.id)
    rev = (
        db.query(models_parts.PartRevision)
        .filter(models_parts.PartRevision.master_id == master.id)
        .first()
    )
    iteration = (
        db.query(models_parts.PartIteration)
        .filter(models_parts.PartIteration.revision_id == rev.id)
        .first()
    )
    file_path = tmp_path / f"{code}.CATPart"
    file_path.write_bytes(b"dummy")
    att = models_parts.PartAttachment(
        iteration_id=iteration.id,
        category="cad",
        file_name=f"{code}.CATPart",
        file_size=5,
        file_path=str(file_path),
        file_hash="h",
    )
    db.add(att)
    db.commit()
    return master, rev, att, file_path


def test_delete_master_purges_attachment_files_and_records(db, tmp_path):
    user = _make_user(db)
    master, _, att, file_path = _make_part_with_attachment(db, user, "DEL-001", tmp_path)
    assert file_path.exists()
    ok = crud_parts.delete_part_master(db, master.id)
    assert ok
    # 磁盘文件已删除
    assert not file_path.exists()
    # 附件记录已物理删除
    remaining = db.query(models_parts.PartAttachment).filter(
        models_parts.PartAttachment.id == att.id
    ).count()
    assert remaining == 0
    # 主数据保持软删除（可恢复）
    m = db.query(models_parts.PartMaster).filter(models_parts.PartMaster.id == master.id).first()
    assert m.deleted_at is not None


def test_purge_revision_attachment_files(db, tmp_path):
    user = _make_user(db)
    _, rev, att, file_path = _make_part_with_attachment(db, user, "DEL-002", tmp_path)
    crud_parts.purge_revision_attachment_files(db, rev)
    assert not file_path.exists()
    remaining = db.query(models_parts.PartAttachment).filter(
        models_parts.PartAttachment.id == att.id
    ).count()
    assert remaining == 0


def test_admin_purge_removes_part_upload_dirs(db, tmp_path, monkeypatch):
    """清理软删除数据时，兜底删除零部件上传目录"""
    monkeypatch.chdir(tmp_path)
    user = _make_user(db, role="admin")
    master, _, _, _ = _make_part_with_attachment(db, user, "DEL-003", tmp_path)
    crud_parts.delete_part_master(db, master.id)
    # 模拟残留的件号上传目录
    upload_dir = tmp_path / "uploads" / "parts" / "DEL-003"
    upload_dir.mkdir(parents=True)
    (upload_dir / "residual.CATPart").write_bytes(b"x")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    try:
        client = TestClient(app)
        r = client.post("/api/admin/purge-soft-deleted", json={
            "tables": ["part_revisions", "part_masters"],
            "confirm": True,
        })
        assert r.status_code == 200
        assert not upload_dir.exists()
    finally:
        app.dependency_overrides.clear()
