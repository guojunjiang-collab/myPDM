from app import models_inventory  # noqa: F401
from app.models_inventory import Warehouse, InventoryMaterial, InventoryDocument


def test_models_create_and_insert(db):
    wh = Warehouse(code="WH01", name="原料库", type="raw")
    db.add(wh); db.commit(); db.refresh(wh)
    assert wh.id is not None and wh.status == "active"

    m = InventoryMaterial(code="M001", name="螺丝", unit="个", track_mode="quantity")
    db.add(m); db.commit(); db.refresh(m)
    assert m.source_type == "standalone"
