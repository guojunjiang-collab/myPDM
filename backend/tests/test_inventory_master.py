import uuid
import pytest
from app import crud_inventory
from app.schemas_inventory import WarehouseCreate, MaterialCreate, MaterialEnableFromPDM
from app.models import Component


def test_create_warehouse_and_material(db, engineer_user):
    wh = crud_inventory.create_warehouse(db, WarehouseCreate(code="WH01", name="原料库", type="raw"))
    assert wh.code == "WH01"

    m = crud_inventory.create_material(db, MaterialCreate(code="M001", name="螺丝", unit="个"))
    assert m.source_type == "standalone" and m.track_mode == "quantity"


def test_enable_material_from_pdm_part(db):
    part = Component(id=uuid.uuid4(), code="P-100", name="法兰", version="A", status="released")
    db.add(part); db.commit()
    m = crud_inventory.enable_material_from_pdm(
        db, MaterialEnableFromPDM(entity_type="part", entity_id=str(part.id), unit="件")
    )
    assert m.source_type == "part"
    assert m.ref_entity_id == part.id
    # 编码用 code_version 避免版本不清
    assert m.code == "P-100_A" and m.name == "法兰"
