"""用 pythonocc-core(OCCT) 解析装配 STEP，抽取结构 + 每实例本地矩阵。"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


def _trsf_values_to_matrix(trsf) -> List[float]:
    """OCCT gp_Trsf → 行主序 16 元素矩阵。"""
    rows = []
    for i in range(1, 4):
        for j in range(1, 5):
            rows.append(float(trsf.Value(i, j)))
    rows += [0.0, 0.0, 0.0, 1.0]
    return rows


def parse_assembly_step(step_path: str) -> Dict[str, Any]:
    """读入装配 STEP，返回 {unit, occurrences[]}。"""
    from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
    from OCC.Core.TDocStd import TDocStd_Document
    from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool
    from OCC.Core.TCollection import TCollection_ExtendedString
    from OCC.Core.TDF import TDF_LabelSequence, TDF_Label
    from OCC.Core.TDataStd import TDataStd_Name

    doc = TDocStd_Document(TCollection_ExtendedString("pdm-doc"))
    reader = STEPCAFControl_Reader()
    reader.ReadFile(step_path)
    reader.Transfer(doc)

    shape_tool = XCAFDoc_DocumentTool.ShapeTool(doc.Main())

    def label_name(label) -> str:
        name_attr = TDataStd_Name()
        if label.FindAttribute(TDataStd_Name.GetID(), name_attr):
            return name_attr.Get().ToExtString()
        return ""

    occurrences: List[Dict[str, Any]] = []

    def walk(label, path: List[str], parent_name: Optional[str]):
        comps = TDF_LabelSequence()
        shape_tool.GetComponents(label, comps)
        for i in range(1, comps.Length() + 1):
            comp_label = comps.Value(i)
            name = label_name(comp_label) or f"occ_{i}"
            from OCC.Core.XCAFDoc import XCAFDoc_Location
            loc = shape_tool.GetLocation(comp_label)
            trsf = loc.Transformation()
            local_matrix = _trsf_values_to_matrix(trsf)
            this_path = path + [name]
            occurrences.append({
                "name": name,
                "path": this_path,
                "parent_name": parent_name,
                "local_matrix": local_matrix,
            })
            ref_label = comp_label
            referred = shape_tool.GetReferredShape(comp_label, ref_label)
            target = ref_label if referred else comp_label
            if shape_tool.IsAssembly(target):
                walk(target, this_path, name)

    free_shapes = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free_shapes)
    for i in range(1, free_shapes.Length() + 1):
        root = free_shapes.Value(i)
        root_name = label_name(root) or "root"
        if shape_tool.IsAssembly(root):
            walk(root, [root_name], None)

    return {"unit": "mm", "occurrences": occurrences}
