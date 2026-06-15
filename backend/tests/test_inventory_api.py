import uuid
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user
from app.models import User


@pytest.fixture
def client(db):
    user = User(id=uuid.uuid4(), username="eng", password_hash="x", real_name="工程师",
                role="engineer", status="active")
    db.add(user); db.commit(); db.refresh(user)

    # 注意：用 TestClient(app) 而非 with TestClient(app) —— 不触发 startup_event（避免连 PostgreSQL）
    # require_role 返回的 checker 依赖 get_current_active_user，覆盖它即可让所有端点放行为该用户
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: user
    yield TestClient(app), user
    app.dependency_overrides.clear()


def test_full_inbound_flow_via_api(client, db):
    c, user = client
    # 建仓库
    wh = c.post("/api/inventory/warehouses", json={"code": "WH01", "name": "原料库", "type": "raw"}).json()
    # 建物料
    mat = c.post("/api/inventory/materials", json={"code": "M001", "name": "螺丝", "unit": "个"}).json()
    # 建入库单（无审批人，提交即自动批准）
    doc = c.post("/api/inventory/documents", json={
        "doc_type": "inbound", "warehouse_id": wh["id"], "keeper_id": str(user.id),
        "lines": [{"material_id": mat["id"], "quantity": 10}],
    }).json()
    assert doc["status"] == "draft"
    doc = c.post(f"/api/inventory/documents/{doc['id']}/submit").json()
    assert doc["status"] == "approved"
    doc = c.post(f"/api/inventory/documents/{doc['id']}/post", json={}).json()
    assert doc["status"] == "posted"
    # 库存查询
    stock = c.get("/api/inventory/stock").json()
    assert any(s["quantity"] == 10.0 for s in stock["items"])
