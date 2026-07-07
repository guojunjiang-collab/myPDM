import uuid
from app import models, models_parts, crud_parts


def _mk(db, code):
    m = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=code, type="part")
    db.add(m); db.commit()
    r = models_parts.PartRevision(id=uuid.uuid4(), master_id=m.id, version="A", latest_iteration=1)
    db.add(r); db.commit()
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=r.id, iteration=1)
    db.add(it); db.commit()
    return m, r, it


def _link(db, parent_it, parent_rev, child_rev, matrix):
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=parent_it.id,
                       parent_revision_id=parent_rev.id, child_revision_id=child_rev.id,
                       quantity=1, sort_order=0,
                       cad_instances=[{"matrix": matrix, "source": "step", "label": "x"}])
    db.add(b); db.commit()
    return b


def test_two_level_world_matrix_composition(db):
    _, asm_r, asm_it = _mk(db, "ASM")
    _, sub_r, sub_it = _mk(db, "SUB")
    _, leaf_r, _ = _mk(db, "LEAF")
    _link(db, asm_it, asm_r, sub_r, [1,0,0,1, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    _link(db, sub_it, sub_r, leaf_r, [1,0,0,0, 0,1,0,2, 0,0,1,0, 0,0,0,1])

    def resolver(child_revision_id):
        return {"coarse": "c.glb", "normal": "n.glb", "fine": "f.glb"} if str(child_revision_id) == str(leaf_r.id) else None

    instances = crud_parts.get_assembly_instances(db, asm_r.id, resolver)
    assert len(instances) == 1
    inst = instances[0]
    assert inst["part_code"] == "LEAF"
    assert inst["matrix"][3] == 1.0 and inst["matrix"][7] == 2.0
    assert inst["glb_urls"]["fine"] == "f.glb"


def test_multi_instance_expands(db):
    _, asm_r, asm_it = _mk(db, "ASM2")
    _, leaf_r, _ = _mk(db, "BOLT")
    b = models.BOMItem(id=uuid.uuid4(), iteration_id=asm_it.id,
                       parent_revision_id=asm_r.id, child_revision_id=leaf_r.id,
                       quantity=2, sort_order=0, cad_instances=[
                           {"matrix": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b1"},
                           {"matrix": [1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1], "source": "step", "label": "b2"},
                       ])
    db.add(b); db.commit()
    instances = crud_parts.get_assembly_instances(db, asm_r.id, lambda cid: {"coarse":"c","normal":"n","fine":"f"})
    assert len(instances) == 2
    xs = sorted(i["matrix"][3] for i in instances)
    assert xs == [0.0, 5.0]


def test_instance_carries_bom_path(db):
    _, asm_r, asm_it = _mk(db, "ASM-BP")
    _, sub_r, sub_it = _mk(db, "SUB-BP")
    _, leaf_r, _ = _mk(db, "LEAF-BP")
    l1 = _link(db, asm_it, asm_r, sub_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    l2 = _link(db, sub_it, sub_r, leaf_r, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
    instances = crud_parts.get_assembly_instances(db, asm_r.id, lambda cid: {"coarse":"c","normal":"n","fine":"f"})
    assert instances[0]["bom_path"] == [str(l1.id), str(l2.id)]
