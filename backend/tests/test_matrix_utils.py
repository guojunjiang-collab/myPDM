import numpy as np
from app.cad import matrix_utils as mu


def test_bomitem_has_cad_instances(db):
    import uuid
    from app import models
    item = models.BOMItem(id=uuid.uuid4(), quantity=1, sort_order=0, cad_instances=[])
    db.add(item); db.commit(); db.refresh(item)
    assert item.cad_instances == []


def test_identity_is_16_floats():
    m = mu.identity()
    assert len(m) == 16
    assert m == [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]


def test_multiply_identity_keeps_matrix():
    a = mu.identity()
    b = [1,0,0,5, 0,1,0,6, 0,0,1,7, 0,0,0,1]
    assert mu.multiply(a, b) == b


def test_multiply_composes_translations():
    t1 = [1,0,0,10, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    t2 = [1,0,0,0, 0,1,0,20, 0,0,1,0, 0,0,0,1]
    out = mu.multiply(t1, t2)
    assert out[3] == 10 and out[7] == 20 and out[11] == 0


def test_normalize_mm_to_m_divides_translation_only():
    m = [1,0,0,1000, 0,1,0,2000, 0,0,1,3000, 0,0,0,1]
    out = mu.normalize_translation_mm_to_m(m)
    assert out[3] == 1.0 and out[7] == 2.0 and out[11] == 3.0
    assert out[0] == 1.0 and out[5] == 1.0 and out[10] == 1.0


def test_z_up_to_y_up_maps_z_axis_to_y():
    R = np.array(mu.z_up_to_y_up()).reshape(4, 4)
    v = np.array([0, 0, 1, 1.0])
    out = R @ v
    assert abs(out[1] - 1.0) < 1e-6
