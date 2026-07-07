import uuid
from app import models, models_parts
from app import crud_parts


def _make_part(db, code, name):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=name, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", latest_iteration=1)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def test_apply_matrices_matches_by_code_and_backfills(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-1", "总装")
    child_m, child_rev, _ = _make_part(db, "BRACKET-01", "支架")
    bom = models.BOMItem(
        id=uuid.uuid4(), iteration_id=asm_it.id,
        parent_revision_id=asm_rev.id, child_revision_id=child_rev.id,
        quantity=1, sort_order=0, cad_instances=[],
    )
    db.add(bom); db.commit()

    parsed = {"unit": "mm", "occurrences": [
        {"name": "BRACKET-01", "path": ["ASM-1", "BRACKET-01"],
         "parent_name": "ASM-1",
         "local_matrix": [1,0,0,1000, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    report = crud_parts.apply_step_matrices(db, asm_rev.id, parsed)

    db.refresh(bom)
    assert len(bom.cad_instances) == 1
    assert bom.cad_instances[0]["matrix"][3] == 1.0
    assert bom.cad_instances[0]["source"] == "step"
    assert report["matched"] == ["BRACKET-01"]
    assert report["unmatched"] == []


def test_apply_matrices_reports_unmatched(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-2", "总装2")
    parsed = {"unit": "mm", "occurrences": [
        {"name": "GHOST", "path": ["ASM-2", "GHOST"], "parent_name": "ASM-2",
         "local_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    report = crud_parts.apply_step_matrices(db, asm_rev.id, parsed)
    assert report["unmatched"] == ["GHOST"]
    assert report["matched"] == []


def test_apply_matrices_is_idempotent(db):
    _, asm_rev, asm_it = _make_part(db, "ASM-3", "总装3")
    _, child_rev, _ = _make_part(db, "P-9", "件9")
    bom = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                         parent_revision_id=asm_rev.id, child_revision_id=child_rev.id,
                         quantity=1, sort_order=0, cad_instances=[])
    db.add(bom); db.commit()
    parsed = {"unit": "mm", "occurrences": [
        {"name": "P-9", "path": ["ASM-3", "P-9"], "parent_name": "ASM-3",
         "local_matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]},
    ]}
    crud_parts.apply_step_matrices(db, asm_rev.id, parsed)
    crud_parts.apply_step_matrices(db, asm_rev.id, parsed)
    db.refresh(bom)
    step_items = [c for c in bom.cad_instances if c["source"] == "step"]
    assert len(step_items) == 1
