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
        pythoncom.CoInitialize()
        try:
            from win32com.client import GetObject
            return GetObject(None, "CATIA.Application")
        except Exception:
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
        return self._read_product_tree(product, path="0", level=0)

    def _read_product_tree(self, product, path: str, level: int) -> dict:
        """递归读取产品树节点"""
        is_assembly = False
        try:
            is_assembly = product.Products.Count > 0
        except Exception:
            pass

        node = {
            "instance_name": str(product.Name),
            "path": path,
            "level": level,
            "is_assembly": is_assembly,
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

        props = {}
        # 读取内置属性
        for attr in self.BUILTIN_ATTRS:
            try:
                val = getattr(product, attr, None)
                if val is not None:
                    props[attr] = str(val)
            except Exception:
                pass

        # 读取 UserRefProperties
        user_props = {}
        try:
            for prop in product.UserRefProperties:
                try:
                    user_props[prop.Name] = str(prop.Value) if prop.Value is not None else ""
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"读取 UserRefProperties 失败: {e}")

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

        # 内置属性直接 setattr
        if prop_name in self.BUILTIN_ATTRS:
            try:
                setattr(product, prop_name, value)
            except Exception as e:
                raise RuntimeError(f"写入内置属性 {prop_name} 失败: {e}")
        else:
            # 自定义属性写入 UserRefProperties
            try:
                try:
                    prop = product.UserRefProperties.Item(prop_name)
                    prop.Value = value
                except Exception:
                    product.UserRefProperties.Add(prop_name, value)
            except Exception as e:
                raise RuntimeError(f"写入自定义属性 {prop_name} 失败: {e}")

        return {"success": True, "prop_name": prop_name}

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
