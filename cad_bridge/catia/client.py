"""CATIA COM 互操作客户端"""
import json
import os
import logging

logger = logging.getLogger(__name__)


class CATIAClient:
    """CATIA COM 自动化接口封装"""

    BUILTIN_ATTRS = {"PartNumber", "Revision", "Definition", "Nomenclature", "Name", "Source", "DescriptionRef"}

    def __init__(self, mapping_path: str = None):
        if mapping_path is None:
            mapping_path = os.path.join(os.path.dirname(__file__), "field_mapping.json")
        self.mapping = self._load_mapping(mapping_path)

    def _load_mapping(self, path: str) -> dict:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _get_catia_app(self):
        """通过 COM GetObject 获取已运行的 CATIA Application"""
        import pythoncom
        import traceback
        pythoncom.CoInitialize()
        try:
            from win32com.client import GetObject
            return GetObject(None, "CATIA.Application")
        except Exception as e:
            logger.warning(f"CATIA GetObject 失败: {e}")
            logger.debug(traceback.format_exc())
            return None

    def detect(self) -> dict:
        """检测 CATIA 是否运行，返回活动文档信息"""
        catia = self._get_catia_app()
        if catia is None:
            return {"active": False}

        try:
            doc = catia.ActiveDocument
            if doc is None:
                return {"active": True, "has_document": False}
            return {
                "active": True,
                "has_document": True,
                "doc_name": doc.Name,
                "doc_type": self._get_doc_type(doc),
                "doc_path": doc.FullName if hasattr(doc, 'FullName') else ""
            }
        except Exception as e:
            logger.error(f"检测 CATIA 文档失败: {e}")
            return {"active": True, "has_document": False, "error": str(e)}

    def read_assembly_tree(self, params: dict = None) -> dict:
        """读取当前装配体的完整产品结构树"""
        catia = self._get_catia_app()
        if catia is None:
            raise RuntimeError("CATIA_NOT_FOUND")

        doc = catia.ActiveDocument
        if doc is None:
            raise RuntimeError("NO_ACTIVE_DOC")

        product = doc.Product
        tree = self._read_product_tree(product, path="0", level=0)
        # 矩阵读取统计日志，便于排查"推送无矩阵"类问题
        total, ok = [0], [0]
        def _count(node):
            if node.get("level", 0) > 0:
                total[0] += 1
                if node.get("matrix"):
                    ok[0] += 1
            for ch in node.get("children") or []:
                _count(ch)
        _count(tree)
        logger.info(f"装配树读取完成: 实例 {total[0]} 个, 矩阵读取成功 {ok[0]} 个")
        return tree

    def _get_ref_product(self, product):
        """获取实例引用的产品对象。
        CATIA 装配中的子节点是实例（Instance），其 PartNumber/Definition/
        UserRefProperties 等属性存储在 ReferenceProduct 上；
        根产品的 ReferenceProduct 为自身。读/写属性必须走引用产品。
        """
        try:
            ref = product.ReferenceProduct
            if ref is not None:
                return ref
        except Exception:
            pass
        return product

    @staticmethod
    def _short_prop_name(full_name: str) -> str:
        """UserRefProperties 项的 Name 为全路径（如 'Part1\\属性\\存货类别'），
        且每个零部件前缀不同。统一取最后一段作为短名，
        保证各节点属性 key 一致，前端才能按同一列名对齐显示。"""
        return str(full_name).split("\\")[-1]

    def _read_user_props(self, ref) -> dict:
        """读取引用产品的 UserRefProperties，key 为属性短名"""
        user_props = {}
        try:
            for prop in ref.UserRefProperties:
                try:
                    key = self._short_prop_name(prop.Name)
                    user_props[key] = str(prop.Value) if prop.Value is not None else ""
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"读取 UserRefProperties 失败: {e}")
        return user_props

    def _read_position_matrix(self, product):
        """读取实例的变换矩阵（相对父装配）。
        CATIA Position.GetComponents 返回 12 分量：
        [Ux,Uy,Uz, Vx,Vy,Vz, Wx,Wy,Wz, Tx,Ty,Tz]（三个轴向量 + 平移，平移单位 mm）。
        转为 4x4 行主序矩阵返回（平移保持 mm，单位换算由 PDM 后端负责）；
        读取失败返回 None（调用方按单位矩阵处理）。

        方式1 直接 COM SAFEARRAY byref 在 pywin32 下常不回写（平台已知限制），
        因此提供方式2 SystemService.Evaluate 执行 VBScript 读取（pycatia 同源方案）。
        """
        c = None
        # 方式1：直接 COM byref SAFEARRAY
        try:
            import pythoncom
            from win32com.client import VARIANT
            arr = VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8 | pythoncom.VT_BYREF, [0.0] * 12)
            product.Position.GetComponents(arr)
            vals = list(arr.value)
            # 全零说明 COM 未回写（合法矩阵至少有一个轴分量非零），视为失败转方式2
            if len(vals) == 12 and any(abs(v) > 1e-12 for v in vals[:9]):
                c = vals
        except Exception as e:
            logger.debug(f"直接读取实例矩阵失败，转用 VBScript 方案: {e}")
        # 方式2：SystemService.Evaluate 执行 VBScript
        if c is None:
            try:
                app = product.Application
                vbs = (
                    "Public Function get_components(oPos)\n"
                    "    Dim c(11)\n"
                    "    oPos.GetComponents c\n"
                    "    get_components = c\n"
                    "End Function"
                )
                result = app.SystemService.Evaluate(vbs, 0, "get_components", [product.Position])
                vals = list(result)
                if len(vals) == 12:
                    c = [float(v) for v in vals]
            except Exception as e:
                logger.warning(f"读取实例矩阵失败(VBScript): {e}")
        if c is None or len(c) != 12:
            return None
        return [
            c[0], c[3], c[6], c[9],
            c[1], c[4], c[7], c[10],
            c[2], c[5], c[8], c[11],
            0.0, 0.0, 0.0, 1.0,
        ]

    def _read_product_tree(self, product, path: str, level: int) -> dict:
        """递归读取产品树节点（含属性）"""
        is_assembly = False
        try:
            is_assembly = product.Products.Count > 0
        except Exception:
            pass

        # 属性从引用产品读取（子实例直接读会失败）
        ref = self._get_ref_product(product)

        # 读取内置属性
        builtin = {}
        for attr in self.BUILTIN_ATTRS:
            try:
                val = getattr(ref, attr, None)
                if val is not None:
                    builtin[attr] = str(val)
            except Exception:
                pass

        # 读取 UserRefProperties 自定义属性
        user_props = self._read_user_props(ref)

        node = {
            "instance_name": str(product.Name),
            "path": path,
            "level": level,
            "is_assembly": is_assembly,
            "builtin": builtin,
            "user_properties": user_props,
            "matrix": self._read_position_matrix(product) if level > 0 else None,
            "children": []
        }

        if is_assembly:
            child_count = product.Products.Count
            for i in range(1, child_count + 1):
                try:
                    child = product.Products.Item(i)
                    child_node = self._read_product_tree(
                        child,
                        path=f"{path}.{i}",
                        level=level + 1
                    )
                    node["children"].append(child_node)
                except Exception as e:
                    logger.warning(f"读取子产品 {i} 失败: {e}")

        return node

    def read_properties(self, params: dict) -> dict:
        """读取指定路径零部件的所有属性"""
        catia = self._get_catia_app()
        if catia is None:
            raise RuntimeError("CATIA_NOT_FOUND")

        product = self._find_product_by_path(catia.ActiveDocument.Product, params.get("path", "0"))
        if product is None:
            raise RuntimeError("PRODUCT_NOT_FOUND")

        ref = self._get_ref_product(product)

        props = {}
        # 读取内置属性
        for attr in self.BUILTIN_ATTRS:
            try:
                val = getattr(ref, attr, None)
                if val is not None:
                    props[attr] = str(val)
            except Exception:
                pass

        # 读取 UserRefProperties
        user_props = self._read_user_props(ref)

        return {"builtin": props, "user_properties": user_props}

    def write_property(self, params: dict) -> dict:
        """写入指定零部件的属性"""
        catia = self._get_catia_app()
        if catia is None:
            raise RuntimeError("CATIA_NOT_FOUND")

        product = self._find_product_by_path(catia.ActiveDocument.Product, params.get("path", "0"))
        if product is None:
            raise RuntimeError("PRODUCT_NOT_FOUND")

        prop_name = params["prop_name"]
        value = params["value"]

        # 写属性同样必须走引用产品
        ref = self._get_ref_product(product)

        # 内置属性直接 setattr
        if prop_name in self.BUILTIN_ATTRS:
            try:
                setattr(ref, prop_name, value)
            except Exception as e:
                raise RuntimeError(f"写入内置属性 {prop_name} 失败: {e}")
        else:
            # 自定义属性：按短名匹配已有项（Name 为全路径，无法直接 Item）
            prop = self._find_user_prop(ref, prop_name)
            if prop is not None:
                self._set_param_value(prop, value)
            else:
                # 不存在则新建字符串参数（Parameters 集合无 Add 方法）
                try:
                    ref.UserRefProperties.CreateString(self._short_prop_name(prop_name), str(value))
                except Exception as e:
                    raise RuntimeError(f"创建自定义属性 {prop_name} 失败: {e}")

        return {"success": True, "prop_name": prop_name}

    def _find_user_prop(self, ref, prop_name: str):
        """按短名遍历查找 UserRefProperties 中的属性项"""
        short = self._short_prop_name(prop_name)
        try:
            for prop in ref.UserRefProperties:
                try:
                    if self._short_prop_name(prop.Name) == short:
                        return prop
                except Exception:
                    pass
        except Exception:
            pass
        return None

    @staticmethod
    def _set_param_value(prop, value):
        """按参数实际类型写入值。
        CATIA 参数分 String/Real/Integer 等类型，Real 参数（如 重量(kg)）
        直接赋字符串会失败，需依次尝试类型适配。"""
        try:
            prop.Value = value
            return
        except Exception:
            pass
        try:
            prop.Value = float(value)
            return
        except Exception:
            pass
        try:
            prop.ValuateFromString(str(value))
        except Exception as e:
            raise RuntimeError(f"写入属性值失败（类型不匹配）: {e}")

    def _find_product_by_path(self, product, path: str):
        """根据路径查找产品节点"""
        parts = path.split(".")
        current = product
        for idx_str in parts[1:]:  # 跳过 "0"（根节点）
            try:
                idx = int(idx_str)
                current = current.Products.Item(idx)
            except Exception:
                return None
        return current

    def _get_doc_type(self, doc) -> str:
        """获取文档类型字符串"""
        try:
            from win32com.client import constants
            if hasattr(constants, 'catProduct'):
                type_map = {
                    constants.catProduct: "Product",
                    constants.catPart: "Part",
                    constants.catDrawing: "Drawing",
                }
                return type_map.get(doc.Type, "Unknown")
        except Exception:
            pass
        return str(doc.Type) if hasattr(doc, 'Type') else "Unknown"


# 全局实例，server.py 中初始化
catia_client = CATIAClient()
