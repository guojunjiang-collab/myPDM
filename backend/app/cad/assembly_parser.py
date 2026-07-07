"""纯 Python 装配 STEP 解析器——抽取结构 + 每实例本地矩阵。无需 pythonocc-core。"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
import re
import math
import logging

logger = logging.getLogger(__name__)


# ── STEP 实体提取（括号计数，支持嵌套）──

_RE_ENTITY_START = re.compile(r'^#(\d+)\s*=\s*(\w+)\s*\(', re.MULTILINE)


def _extract_entities(content: str) -> Dict[int, tuple]:
    """从 STEP 文件中提取所有实体，括号计数处理嵌套。"""
    entities: Dict[int, tuple] = {}

    for m in _RE_ENTITY_START.finditer(content):
        eid = int(m.group(1))
        etype = m.group(2)
        pos = m.end() - 1  # 指向开括号 '('
        depth = 1
        body_start = m.end()
        while pos < len(content) and depth > 0:
            pos += 1
            if pos >= len(content):
                break
            if content[pos] == '(':
                depth += 1
            elif content[pos] == ')':
                depth -= 1
        body = content[body_start:pos]
        try:
            parsed = _parse_entity_body(body)
            entities[eid] = (etype, parsed)
        except Exception:
            pass

    return entities


# ── Unicode 解码（STEP 编码字符串）──

_RE_STEP_UNICODE = re.compile(r'\\X2\\([0-9A-Fa-f]+)\\X0\\')


def _decode_step_string(s: str) -> str:
    """解码 STEP 编码字符串，如 \\X2\\76f45347673a\\X0\\ → 零件"""
    if '\\X2\\' not in s:
        return s

    def _replace(m):
        hex_str = m.group(1)
        try:
            # UTF-16 编码字符串 → Unicode 字符
            code_points = []
            i = 0
            while i < len(hex_str):
                cp = int(hex_str[i:i+4], 16)
                code_points.append(cp)
                i += 4
            return ''.join(chr(cp) for cp in code_points)
        except (ValueError, OverflowError):
            return m.group(0)

    result = _RE_STEP_UNICODE.sub(_replace, s)
    # 清理残留的控制字符
    result = result.replace('\\X\\', '').replace('\\P\\', '')
    return result


# ── Tokenizer ──

_RE_TOKEN = re.compile(
    r"""'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|"""
    r"""[^\s,()'"]+|\(|\)|,|(?:\d+\.?\d*(?:[eE][+-]?\d+)?)""",
    re.DOTALL,
)


def _tokenize(body: str) -> List[str]:
    return [m.group(0) for m in _RE_TOKEN.finditer(body)]


def _parse_tokens(tokens: List[str], cursor: int = 0):
    token = tokens[cursor]
    cursor += 1

    if re.match(r'^[+-]?\d+\.?\d*(?:[eE][+-]?\d+)?$', token):
        try:
            return float(token) if ('.' in token or 'e' in token.lower()) else int(token), cursor
        except ValueError:
            return token, cursor

    if (token.startswith("'") and token.endswith("'")) or (token.startswith('"') and token.endswith('"')):
        return token[1:-1], cursor

    if token == '(':
        items = []
        while cursor < len(tokens):
            if tokens[cursor] == ')':
                cursor += 1
                break
            val, cursor = _parse_tokens(tokens, cursor)
            items.append(val)
            if cursor < len(tokens) and tokens[cursor] == ',':
                cursor += 1
        return items, cursor

    if token.startswith('.'):
        return token, cursor
    if token in ('$', '*'):
        return None, cursor
    if token.startswith('#'):
        return token, cursor

    return token, cursor


def _parse_entity_body(body: str) -> list:
    tokens = _tokenize(body)
    result = []
    cursor = 0
    while cursor < len(tokens):
        val, cursor = _parse_tokens(tokens, cursor)
        result.append(val)
        if cursor < len(tokens) and tokens[cursor] == ',':
            cursor += 1
    return result


# ── 核心解析 ──

def parse_assembly_step(step_path: str) -> Dict[str, Any]:
    """读入装配 STEP，返回 {unit, occurrences[]}。纯 Python，零外部依赖。"""
    with open(step_path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    # 统一换行
    content = content.replace('\r\n', '\n').replace('\r', '\n')

    entities = _extract_entities(content)

    # ── 基础索引 ──
    products: Dict[str, str] = {}
    product_def_to_product: Dict[str, str] = {}
    parent_links: Dict[str, str] = {}
    child_links: Dict[str, str] = {}
    placement_refs: Dict[str, int] = {}

    # PD → ShapeRepresentation 映射（用于 SolidWorks 格式）
    pd_to_shape: Dict[str, int] = {}

    # ITEM_DEFINED_TRANSFORMATION: idt_id → (child_axis_id, parent_axis_id)
    idt_map: Dict[int, tuple] = {}

    # REPRESENTATION_RELATIONSHIP: rep_rel_id → (parent_shape_id, child_shape_id, idt_id)
    rep_rel_map: Dict[int, tuple] = {}

    for eid, (etype, args) in entities.items():
        eid_str = f"#{eid}"

        if etype == 'PRODUCT':
            if len(args) >= 2:
                products[eid_str] = _decode_step_string(str(args[1]))

        elif etype == 'PRODUCT_DEFINITION':
            if len(args) >= 3:
                formation_ref = _ref_str(args[2])
                fid = _ref_id(formation_ref)
                if fid:
                    fent = entities.get(fid)
                    if fent:
                        fetype, fargs = fent
                        if fetype == 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE' and len(fargs) >= 3:
                            product_def_to_product[eid_str] = _ref_str(fargs[2])
                        elif fetype == 'PRODUCT_DEFINITION_FORMATION' and len(fargs) >= 1:
                            product_def_to_product[eid_str] = _ref_str(fargs[0])

        elif etype == 'NEXT_ASSEMBLY_USAGE_OCCURRENCE':
            if len(args) >= 5:
                parent_links[eid_str] = _ref_str(args[3])
                child_links[eid_str] = _ref_str(args[4])
                # SolidWorks 格式: placement 可能是 AXIS2_PLACEMENT_3D 引用
                if len(args) >= 6:
                    placement_refs[eid_str] = _ref_id(args[5])

        elif etype == 'ITEM_DEFINED_TRANSFORMATION':
            refs = [_ref_id(a) for a in args if _ref_id(a) is not None]
            if len(refs) >= 2:
                idt_map[eid] = (refs[-2], refs[-1])

        elif etype == 'REPRESENTATION_RELATIONSHIP':
            # args: (name, desc, shape1_id, shape2_id)
            # Multiple inheritance with transformation
            refs = [_ref_id(a) for a in args if _ref_id(a) is not None]
            if len(refs) >= 2:
                # 找关联的 ITEM_DEFINED_TRANSFORMATION
                idt_ref = None
                for a in args:
                    if isinstance(a, str) and a.startswith('#'):
                        aeid = int(a[1:])
                        aent = entities.get(aeid)
                        if aent and aent[0] == 'ITEM_DEFINED_TRANSFORMATION':
                            idt_ref = aeid
                            break
                rep_rel_map[eid] = (refs[0], refs[1], idt_ref)

        elif etype == 'PRODUCT_DEFINITION_SHAPE':
            # args: (name, desc, product_definition_ref)
            if len(args) >= 3:
                pd_ref = _ref_id(args[2])
                if pd_ref:
                    # 查找关联的 SHAPE_REPRESENTATION
                    shape_id = _find_shape_representation(pd_ref, entities)
                    if shape_id:
                        pd_str = f"#{pd_ref}"
                        pd_to_shape[pd_str] = shape_id

    # ── 构建 occurrence → 矩阵映射 ──
    # SolidWorks 多继承格式: 单行匹配 REPRESENTATION_RELATIONSHIP...WITH_TRANSFORMATION(#IDT)
    # 格式: REPRESENTATION_RELATIONSHIP('N','N', #PARENT, #SHAPE) ...WITH_TRANSFORMATION( #IDT )
    shape_to_idt: Dict[int, list] = {}
    for m in re.finditer(
        r'REPRESENTATION_RELATIONSHIP\s*\([^)]*#(\d+)\s*,[^(]*#(\d+)\s*\)\s*'
        r'REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)',
        content,
    ):
        s, i = int(m.group(2)), int(m.group(3))
        shape_to_idt.setdefault(s, []).append(i)

    def_id_to_matrix: Dict[int, list] = {}

    for pd_str, shape_id in pd_to_shape.items():
        idt_ids = shape_to_idt.get(shape_id, [])
        if idt_ids:
            matrices = []
            for idt_id in idt_ids:
                if idt_id in idt_map:
                    child_axis, parent_axis = idt_map[idt_id]
                    mat = _get_relative_matrix(child_axis, parent_axis, entities)
                    if mat:
                        matrices.append(mat)
            if matrices:
                def_id = _ref_id(pd_str)
                if def_id:
                    def_id_to_matrix[def_id] = matrices

    # ── 构建 occurrences ──
    occurrences: List[Dict[str, Any]] = []
    _matrix_counter: Dict[str, int] = {}

    for occ_id, child_ref in child_links.items():
        # 尝试通过 definition → shape → IDT 获取矩阵列表
        def_id = _ref_id(child_ref)
        matrices = def_id_to_matrix.get(def_id, [])
        
        child_name = _resolve_product_name(child_ref, products, entities, product_def_to_product)
        parent_name = _resolve_product_name(parent_links.get(occ_id, ''), products, entities, product_def_to_product)
        
        if matrices:
            # 使用计数器为每个 NAO 分配一个不同的矩阵
            counter_key = def_id or child_name
            _matrix_counter.setdefault(counter_key, 0)
            idx = _matrix_counter[counter_key] % len(matrices)
            _matrix_counter[counter_key] += 1
            mat = matrices[idx]
            label = f"{child_name}#{idx+1}" if len(matrices) > 1 else child_name
            occurrences.append({
                "name": _decode_step_string(child_name),  # 匹配用原名，不加 #N
                "path": [_decode_step_string(p) for p in ([parent_name, child_name] if parent_name else [child_name])],
                "parent_name": _decode_step_string(parent_name) if parent_name else None,
                "local_matrix": mat,
                "label": _decode_step_string(label),  # 标签带 #N
            })
        else:
            # 兜底：直接使用 NAO 中引用的 AXIS2_PLACEMENT_3D（非 SolidWorks 格式）
            placement_id = placement_refs.get(occ_id)
            local_matrix = _identity_16()
            if placement_id:
                placement_ent = entities.get(placement_id)
                if placement_ent and placement_ent[0] == 'AXIS2_PLACEMENT_3D':
                    local_matrix = _axis2placement_to_matrix(placement_ent[1], entities)
            occurrences.append({
                "name": _decode_step_string(child_name),
                "path": [_decode_step_string(p) for p in ([parent_name, child_name] if parent_name else [child_name])],
                "parent_name": _decode_step_string(parent_name) if parent_name else None,
                "local_matrix": local_matrix,
            })

    return {"unit": "mm", "occurrences": occurrences}


def _find_shape_representation(pd_id: int, entities: Dict[int, tuple]) -> Optional[int]:
    """从 PRODUCT_DEFINITION 找其 SHAPE_REPRESENTATION。
    链: PD → PRODUCT_DEFINITION_SHAPE (PDS) → SHAPE_DEFINITION_REPRESENTATION (SDR) → SHAPE_REPRESENTATION
    """
    for eid, (etype, args) in entities.items():
        if etype == 'PRODUCT_DEFINITION_SHAPE':
            refs = [_ref_id(a) for a in args if _ref_id(a) is not None]
            if refs and refs[-1] == pd_id:
                # 找 SHAPE_DEFINITION_REPRESENTATION 引用此 PDS
                for eid2, (etype2, args2) in entities.items():
                    if etype2 == 'SHAPE_DEFINITION_REPRESENTATION':
                        srefs = [_ref_id(a) for a in args2 if _ref_id(a) is not None]
                        if len(srefs) >= 2 and srefs[0] == eid:
                            return srefs[1]  # shape_representation id
    return None


def _get_relative_matrix(child_axis_id: int, parent_axis_id: int,
                         entities: Dict[int, tuple]) -> Optional[List[float]]:
    """计算 child_axis 相对 parent_axis 的变换矩阵。"""
    child_ent = entities.get(child_axis_id)
    parent_ent = entities.get(parent_axis_id)
    if not child_ent or not parent_ent:
        return None

    child_mat = _axis2placement_to_matrix(child_ent[1], entities)
    parent_mat = _axis2placement_to_matrix(parent_ent[1], entities)
    if not child_mat or not parent_mat:
        return None

    # 相对位移 = child - parent（旋转都是单位阵）
    from . import matrix_utils as _mu
    try:
        parent_inv = _invert_placement(parent_mat)
        return _mu.multiply(parent_inv, child_mat)
    except Exception:
        pass

    # 兜底：只用平移差值
    tx = child_mat[3] - parent_mat[3]
    ty = child_mat[7] - parent_mat[7]
    tz = child_mat[11] - parent_mat[11]
    return [
        child_mat[0], child_mat[1], child_mat[2], tx,
        child_mat[4], child_mat[5], child_mat[6], ty,
        child_mat[8], child_mat[9], child_mat[10], tz,
        0, 0, 0, 1,
    ]


def _invert_placement(mat: List[float]) -> List[float]:
    """对 AXIS2_PLACEMENT_3D 矩阵求逆（旋转部分转置，平移部分取负并乘以转置）。"""
    # 旋转矩阵转置
    r = [mat[0], mat[4], mat[8], 0,
         mat[1], mat[5], mat[9], 0,
         mat[2], mat[6], mat[10], 0,
         0, 0, 0, 1]
    # 平移 = -R^T * t
    tx = -(r[0] * mat[3] + r[1] * mat[7] + r[2] * mat[11])
    ty = -(r[4] * mat[3] + r[5] * mat[7] + r[6] * mat[11])
    tz = -(r[8] * mat[3] + r[9] * mat[7] + r[10] * mat[11])
    return [r[0], r[1], r[2], tx,
            r[4], r[5], r[6], ty,
            r[8], r[9], r[10], tz,
            0, 0, 0, 1]


# ── 辅助函数 ──

def _ref_str(val) -> str:
    if isinstance(val, str) and val.startswith('#'):
        return val
    return str(val)


def _ref_id(val) -> Optional[int]:
    if isinstance(val, str) and val.startswith('#'):
        try:
            return int(val[1:])
        except ValueError:
            return None
    return None


def _identity_16() -> List[float]:
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def _resolve_product_name(ref: str, products: Dict[str, str], entities: Dict[int, tuple],
                           def_to_product: Dict[str, str] = None) -> str:
    if not ref:
        return ""
    name = products.get(ref)
    if name:
        return name
    if def_to_product:
        product_ref = def_to_product.get(ref)
        if product_ref:
            name = products.get(product_ref)
            if name:
                return name
    if ref.startswith('#'):
        eid = int(ref[1:])
        ent = entities.get(eid)
        if ent:
            etype, args = ent
            if etype == 'PRODUCT_DEFINITION' and len(args) >= 3:
                return _resolve_product_name(_ref_str(args[2]), products, entities, def_to_product)
            elif etype == 'PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE' and len(args) >= 3:
                return _resolve_product_name(_ref_str(args[2]), products, entities, def_to_product)
            elif etype == 'PRODUCT_DEFINITION_FORMATION' and len(args) >= 1:
                return _resolve_product_name(_ref_str(args[0]), products, entities, def_to_product)
    return ref


def _axis2placement_to_matrix(args: list, entities: Dict[int, tuple]) -> List[float]:
    """AXIS2_PLACEMENT_3D → 4x4 变换矩阵（行主序 16 元素）。"""
    if len(args) < 4:
        return _identity_16()

    origin = _resolve_point(args[1], entities)
    z_axis = _resolve_direction(args[2], entities)
    x_ref = _resolve_direction(args[3], entities) if len(args) > 3 else [1.0, 0.0, 0.0]

    if not origin or not z_axis:
        return _identity_16()

    z = _normalize(z_axis)
    x = _normalize(x_ref)
    if not x:
        return _identity_16()

    y = _cross(z, x)
    y_norm = _normalize(y)
    if not y_norm:
        return _identity_16()

    x_ortho = _cross(y_norm, z)

    return [
        x_ortho[0], y_norm[0], z[0], origin[0],
        x_ortho[1], y_norm[1], z[1], origin[1],
        x_ortho[2], y_norm[2], z[2], origin[2],
        0.0,         0.0,        0.0,   1.0,
    ]


def _resolve_point(ref, entities: Dict[int, tuple]) -> Optional[List[float]]:
    if not ref:
        return None
    eid = _ref_id(ref)
    if not eid:
        return None
    ent = entities.get(eid)
    if not ent:
        return None
    etype, args = ent
    if etype == 'CARTESIAN_POINT':
        # 取最后一个元素（坐标列表）
        for a in reversed(args):
            if isinstance(a, list) and len(a) >= 3:
                try:
                    return [float(a[0]), float(a[1]), float(a[2])]
                except (ValueError, TypeError):
                    pass
    return None


def _resolve_direction(ref, entities: Dict[int, tuple]) -> Optional[List[float]]:
    if not ref:
        return None
    eid = _ref_id(ref)
    if not eid:
        return None
    ent = entities.get(eid)
    if not ent:
        return None
    etype, args = ent
    if etype == 'DIRECTION':
        for a in reversed(args):
            if isinstance(a, list) and len(a) >= 3:
                try:
                    return [float(a[0]), float(a[1]), float(a[2])]
                except (ValueError, TypeError):
                    pass
    return None


def _normalize(v: List[float]) -> Optional[List[float]]:
    ln = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if ln < 1e-12:
        return None
    return [v[0] / ln, v[1] / ln, v[2] / ln]


def _cross(a: List[float], b: List[float]) -> List[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
