"""SolidWorks 客户端装配树/属性读写单元测试（用假 COM 对象模拟轻量化组件）。

复现并锁定 BOM 匹配 TAB 的三个缺陷：
  1. 子项只显示 1 级、缺 2 级（应树形显示所有层级）
  2. 1 级子项缺 版本/中文名称/自定义字段
  3. 轻量化子项属性写入报错

轻量化组件的关键特征：``comp.GetModelDoc2()`` 返回 None，
属性/子结构必须通过后台静默打开文件(OpenDoc6)或 ``comp.GetChildren()`` 获取。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from cad_bridge.solidworks.client import SolidWorksClient


class FakeCPM:
    def __init__(self, props):
        self._props = dict(props)

    @property
    def GetNames(self):
        return list(self._props.keys())

    def Get(self, name):
        return self._props.get(name)

    def Set2(self, name, val):
        self._props[name] = val
        return 0

    def Add2(self, name, typ, val):
        self._props[name] = val
        return 0


class FakeExt:
    def __init__(self, cpm):
        self._cpm = cpm

    def CustomPropertyManager(self, conf):
        return self._cpm


class FakeModelDoc:
    """模拟已打开的 SW 文档（零件或装配体）。

    关键：子级只能从"已加载的装配文档" GetComponents(True) 枚举得到，
    模拟真实环境下轻量化父组件 comp.GetChildren() 枚举不到子级的行为。"""

    def __init__(self, title, doc_type, path, props):
        self._title = title
        self._type = doc_type  # 1=Part 2=Assembly
        self._path = path
        self.cpm = FakeCPM(props)
        self.saved = False
        self.top_components = []  # 本装配文档的直接子组件

    @property
    def GetTitle(self):
        return self._title

    @property
    def GetType(self):
        return self._type

    @property
    def GetPathName(self):
        return self._path

    @property
    def Extension(self):
        return FakeExt(self.cpm)

    # 装配文档枚举直接子组件（top_only=True）
    def GetComponents(self, top_only):
        return list(self.top_components)

    def ResolveAllLightWeightComponents(self, arg):
        return 0

    def EditRebuild3(self):
        return True

    def ForceRebuild3(self, arg):
        return True

    def Save3(self, options, err, warn):
        self.saved = True
        return True


class FakeComponent:
    """模拟装配体中的组件实例。

    轻量化：GetModelDoc2 返回 None，且 GetChildren 在父装配上下文中枚举不到
    子级（返回空）——子结构必须由后台打开的装配文档 GetComponents(True) 提供。"""

    def __init__(self, name, path_name, lightweight=True):
        self._name = name
        self._path_name = path_name
        self._lightweight = lightweight

    @property
    def Name2(self):
        return self._name

    @property
    def GetPathName(self):
        return self._path_name

    def GetModelDoc2(self):
        return None if self._lightweight else self._model_doc

    def GetChildren(self):
        return []  # 轻量化父组件枚举不到子级

    @property
    def Transform2(self):
        return None


class FakeSW:
    """模拟 SldWorks.Application：OpenDoc6 从 file_map 返回文档并记录开关。"""

    def __init__(self, active_doc, file_map):
        self.ActiveDoc = active_doc
        self._file_map = {k.lower(): v for k, v in file_map.items()}
        self.opened = []
        self.closed = []

    def GetDocuments(self):
        return None

    def OpenDoc6(self, path, doc_type, options, conf, err, warn):
        md = self._file_map.get((path or "").lower())
        if md is not None:
            self.opened.append(path)
        return md

    def CloseDoc(self, title):
        self.closed.append(title)


def _build_scene():
    """根装配 -> (子装配[含1个零件], 零件X)，全部轻量化。"""
    sub_asm_doc = FakeModelDoc("subA.SLDASM", 2, r"C:\a\subA.SLDASM",
                               {"版本": "B", "中文名称": "子装配A", "材料名称": "钢"})
    part_y_doc = FakeModelDoc("partY.SLDPRT", 1, r"C:\a\partY.SLDPRT",
                              {"版本": "C", "中文名称": "零件Y"})
    part_x_doc = FakeModelDoc("partX.SLDPRT", 1, r"C:\a\partX.SLDPRT",
                              {"版本": "A", "中文名称": "零件X", "材料名称": "铝"})
    root_doc = FakeModelDoc("总装.SLDASM", 2, r"C:\a\总装.SLDASM",
                            {"版本": "R1", "中文名称": "总装"})

    part_y_comp = FakeComponent("partY-1", r"C:\a\partY.SLDPRT")
    sub_asm_comp = FakeComponent("subA-1", r"C:\a\subA.SLDASM")
    part_x_comp = FakeComponent("partX-1", r"C:\a\partX.SLDPRT")
    # 子级只经"已加载装配文档"暴露：根 → [子装配, 零件X]，子装配 → [零件Y]
    root_doc.top_components = [sub_asm_comp, part_x_comp]
    sub_asm_doc.top_components = [part_y_comp]

    file_map = {
        r"C:\a\subA.SLDASM": sub_asm_doc,
        r"C:\a\partY.SLDPRT": part_y_doc,
        r"C:\a\partX.SLDPRT": part_x_doc,
    }
    sw = FakeSW(root_doc, file_map)
    return sw, file_map


def _patch(client, sw):
    client._get_sw_app = lambda: sw
    client._get_active_doc = lambda _sw: _sw.ActiveDoc


def _find(node, part_number):
    if node.get("builtin", {}).get("PartNumber") == part_number:
        return node
    for ch in node.get("children") or []:
        hit = _find(ch, part_number)
        if hit is not None:
            return hit
    return None


def test_tree_shows_all_levels_with_props():
    client = SolidWorksClient()
    sw, _ = _build_scene()
    _patch(client, sw)

    tree = client.read_assembly_tree({})

    # 顶层
    assert tree["level"] == 0
    assert tree["builtin"]["Revision"] == "R1"

    # 1 级子项：子装配 + 零件X
    sub = _find(tree, "subA")
    part_x = _find(tree, "partX")
    assert sub is not None and part_x is not None
    assert sub["level"] == 1 and sub["is_assembly"] is True
    # 缺陷3：1 级子项应含版本/中文名称/自定义字段
    assert sub["builtin"]["Revision"] == "B"
    assert sub["builtin"]["Nomenclature"] == "子装配A"
    assert sub["user_properties"].get("材料名称") == "钢"
    assert part_x["builtin"]["Revision"] == "A"
    assert part_x["user_properties"].get("材料名称") == "铝"

    # 缺陷2：应显示 2 级子项
    part_y = _find(tree, "partY")
    assert part_y is not None, "2 级子项 partY 未出现在装配树中"
    assert part_y["level"] == 2
    assert part_y["builtin"]["Revision"] == "C"

    # 后台打开的文档应在读取完成后被关闭，且不关闭根活动文档
    assert len(sw.closed) >= 3
    assert "总装.SLDASM" not in sw.closed


def test_write_property_on_lightweight_child():
    client = SolidWorksClient()
    sw, file_map = _build_scene()
    _patch(client, sw)

    # 缺陷3：轻量化 1 级零件 partX（path "0.2"）写自定义属性应成功并保存
    res = client.write_property({"path": "0.2", "prop_name": "材料名称", "value": "钛"})
    assert res["success"] is True

    part_x_doc = file_map[r"C:\a\partX.SLDPRT"]
    assert part_x_doc.cpm.Get("材料名称") == "钛"
    assert part_x_doc.saved is True


def test_write_property_on_level2_node():
    """缺陷2+3：写 2 级子项(path 0.1.1)需经 GetChildren 逐级定位到轻量化零件。"""
    client = SolidWorksClient()
    sw, file_map = _build_scene()
    _patch(client, sw)

    res = client.write_property({"path": "0.1.1", "prop_name": "Revision", "value": "D"})
    assert res["success"] is True

    part_y_doc = file_map[r"C:\a\partY.SLDPRT"]
    # 版本经别名映射写入 SW 实际属性名「版本」，而非字面 "Revision"
    assert part_y_doc.cpm.Get("版本") == "D"
    assert part_y_doc.saved is True
