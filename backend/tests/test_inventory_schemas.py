from app.schemas_inventory import DocumentCreate


def test_document_create_parses_lines():
    d = DocumentCreate(
        doc_type="inbound", warehouse_id="w1",
        lines=[{"material_id": "m1", "quantity": 5}],
    )
    assert d.doc_type == "inbound"
    assert d.lines[0].quantity == 5
    assert d.review_mode == "all"
