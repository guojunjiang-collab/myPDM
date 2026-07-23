"""SolidWorks COM 互操作客户端"""
import json
import os
import logging

logger = logging.getLogger(__name__)


class SolidWorksClient:
    """SolidWorks COM 自动化接口封装（与 CATIAClient 接口对齐）"""

    # SW 中除标题/描述/材质等少量 SummaryInfo 属性外，绝大部分属性都走 CustomPropertyManager
    BUILTIN_ATTRS = {"Title", "Subject", "Author", "Keywords", "Comments"}

    def __init__(self, mapping_path: str = None):
        if mapping_path is None:
            mapping_path = os.path.join(os.path.dirname(__file__), "field_mapping.json")
        self.mapping = self._load_mapping(mapping_path)

    def _load_mapping(self, path: str) -> dict:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.warning(f"加载字段映射失败 ({path}): {e}")
            return {"builtin": {}, "properties": {}}

    def _get_sw_app(self):
        """通过 COM GetObject 获取已运行的 SolidWorks Application"""
        import pythoncom
        import traceback
        pythoncom.CoInitialize()
        try:
            from win32com.client import GetObject
            return GetObject(None, "SldWorks.Application")
        except Exception as e:
            logger.warning(f"SolidWorks GetObject 失败: {e}")
            logger.debug(traceback.format_exc())
            return None

    def _get_active_doc(self, sw):
        """获取当前活动文档。ActiveDoc 在 SW 失去焦点时可能返回 None，回退遍历文档集合。"""
        doc = sw.ActiveDoc
        if doc is None:
            try:
                docs = sw.GetDocuments()
                if docs is not None:
                    for d in docs:
                        try:
                            if d.GetType == 2:  # 优先取装配体
                                doc = d
                                break
                        except Exception:
                            pass
                    if doc is None:
                        # 无装配体，取第一个文档（零件或工程图）
                        try:
                            doc = docs[0]
                        except Exception:
                            pass
            except Exception:
                pass
        return doc

    def detect(self) -> dict:
        """检测 SolidWorks 是否运行，返回活动文档信息"""
        sw = self._get_sw_app()
        if sw is None:
            return {"active": False}

        try:
            doc = self._get_active_doc(sw)
            if doc is None:
                return {"active": True, "has_document": False}
            doc_type = self._get_doc_type(doc)
            return {
                "active": True,
                "has_document": True,
                "doc_name": doc.GetTitle,
                "doc_type": doc_type,
                "doc_path": doc.GetPathName or ""
            }
        except Exception as e:
            logger.error(f"检测 SolidWorks 文档失败: {e}")
            return {"active": True, "has_document": False, "error": str(e)}

    @staticmethod
    def _get_doc_type(doc) -> str:
        """获取文档类型（Part / Assembly / Drawing）"""
        try:
            t = doc.GetType
            type_map = {
                1: "Part",
                2: "Assembly",
                3: "Drawing",
            }
            return type_map.get(t, "Unknown")
        except Exception:
            return "Unknown"

    def read_assembly_tree(self, params: dict = None) -> dict:
        """读取活动装配体的完整结构树（swDocASSEMBLY 类型才支持）"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        doc = self._get_active_doc(sw)
        if doc is None:
            raise RuntimeError("NO_ACTIVE_DOC")

        if doc.GetType != 2:  # swDocASSEMBLY
            raise RuntimeError("当前文档不是装配体")

        root_name = doc.GetTitle
        root_path = doc.GetPathName or ""

        tree = {
            "instance_name": root_name,
            "path": "0",
            "level": 0,
            "is_assembly": True,
            "builtin": self._read_builtin_props(doc),
            "user_properties": self._read_custom_props(doc),
            "matrix": None,
            "doc_path": root_path,
            "children": []
        }

        components = doc.GetComponents(False)  # False = 仅顶层组件
        if components is not None:
            for comp in components:
                child = self._read_component_tree(comp, "0.1", 1, [1])
                if child is not None:
                    tree["children"].append(child)

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

    def _read_component_tree(self, comp, path: str, level: int, counter: list) -> dict | None:
        """递归读取组件树节点（含属性/矩阵/子组件）"""
        try:
            name = comp.Name2
        except Exception:
            return None

        model_doc = None
        try:
            model_doc = comp.GetModelDoc2()
        except Exception:
            pass

        is_assembly = False
        if model_doc is not None:
            try:
                is_assembly = model_doc.GetType == 2
            except Exception:
                pass

        builtin = self._read_builtin_props(model_doc)
        user_props = self._read_custom_props(model_doc)
        matrix = self._read_component_transform(comp) if level > 0 else None

        node = {
            "instance_name": name,
            "path": path,
            "level": level,
            "is_assembly": is_assembly,
            "builtin": builtin,
            "user_properties": user_props,
            "matrix": matrix,
            "doc_path": "",
            "children": []
        }

        try:
            node["doc_path"] = comp.GetPathName or ""
        except Exception:
            pass

        if is_assembly and model_doc is not None:
            children = model_doc.GetComponents(False)
            if children is not None:
                for child in children:
                    counter[0] += 1
                    child_node = self._read_component_tree(child, f"{path}.{counter[0]}", level + 1, counter)
                    if child_node is not None:
                        node["children"].append(child_node)

        return node

    def _read_builtin_props(self, model_doc) -> dict:
        """读取内置属性。SW 中 PartNumber/Revision 来自自定义属性。"""
        if model_doc is None:
            return {}
        props = {}

        def _get_custom_prop(cpm, names, *keys):
            if cpm is None or not names:
                return ""
            for key in keys:
                if key in names:
                    _, val, _ = cpm.Get5(key, False, False)
                    if val:
                        return str(val)
            return ""

        # PartNumber: 优先自定义属性，回退文件名
        part_number = ""
        try:
            part_number = model_doc.GetTitle or ""
        except Exception as e:
            logger.debug(f"读取 GetTitle 失败: {e}")
        if part_number:
            props["PartNumber"] = str(part_number)

        # Revision: 尝试从自定义属性读取
        try:
            ext = model_doc.Extension
            cpm = ext.CustomPropertyManager("")
            if cpm is not None:
                names = cpm.GetNames
                # 用自定义属性覆盖默认值
                pn = _get_custom_prop(cpm, names, "Part Number", "PartNumber")
                if pn:
                    props["PartNumber"] = pn
                rev = _get_custom_prop(cpm, names, "Revision", "Rev")
                if rev:
                    props["Revision"] = rev
        except Exception as e:
            logger.debug(f"读取 SW 自定义属性失败: {e}")

        # Description 从 SummaryInfo 读取
        try:
            desc = model_doc.SummaryInfo[2] if model_doc.SummaryInfo else None
            if desc:
                props["Description"] = str(desc)
        except Exception:
            pass
        # 配置名称
        try:
            configs = model_doc.GetConfigurationNames
            if configs and len(configs) > 0:
                props["ConfigurationName"] = str(configs[0])
        except Exception:
            pass
        return props

    def _read_custom_props(self, model_doc) -> dict:
        """读取自定义属性（CustomPropertyManager）"""
        if model_doc is None:
            return {}
        result = {}
        try:
            ext = model_doc.Extension
            cpm = ext.CustomPropertyManager("")  # 空字符串获取配置无关属性
            if cpm is None:
                return {}
            names = cpm.GetNames
            if names is None:
                return {}
            for name in names:
                try:
                    _, val, _ = cpm.Get5(name, False, False)
                    result[str(name)] = str(val) if val is not None else ""
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"读取自定义属性失败: {e}")
        return result

    def _read_component_transform(self, comp) -> list | None:
        """读取组件实例变换矩阵（相对父装配，4×4 行主序）"""
        try:
            transform = comp.Transform2
            if transform is None:
                return None
            data = transform.ArrayData
            if data is None:
                return None
            matrix = list(data)
            if len(matrix) != 16:
                return None
            # 至少有一个轴分量非零才是合法矩阵
            if all(abs(v) < 1e-12 for v in matrix[:12]):
                return None
            return matrix
        except Exception as e:
            logger.debug(f"读取组件矩阵失败: {e}")
            return None

    def read_properties(self, params: dict) -> dict:
        """读取指定路径零部件的所有属性"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(self._get_active_doc(sw), params.get("path", "0"))
        if product is None:
            model_doc = self._get_active_doc(sw)
        else:
            model_doc = None
            try:
                model_doc = product.GetModelDoc2()
            except Exception:
                pass

        if model_doc is None:
            raise RuntimeError("COMPONENT_NOT_FOUND")

        builtin = self._read_builtin_props(model_doc)
        user_props = self._read_custom_props(model_doc)
        return {"builtin": builtin, "user_properties": user_props}

    def write_property(self, params: dict) -> dict:
        """写入指定零部件的属性"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(self._get_active_doc(sw), params.get("path", "0"))
        if product is None:
            model_doc = self._get_active_doc(sw)
        else:
            model_doc = product.GetModelDoc2()

        if model_doc is None:
            raise RuntimeError("无法获取模型文档")

        prop_name = params["prop_name"]
        value = params["value"]

        # 尝试内置属性 setattr
        if prop_name in self.BUILTIN_ATTRS:
            try:
                setattr(model_doc, prop_name, str(value))
                return {"success": True, "prop_name": prop_name}
            except Exception as e:
                raise RuntimeError(f"写入内置属性 {prop_name} 失败: {e}")

        # 自定义属性走 CustomPropertyManager
        try:
            ext = model_doc.Extension
            cpm = ext.CustomPropertyManager("")
            if cpm is None:
                raise RuntimeError("无法获取 CustomPropertyManager")
            # 检查属性是否已存在
            names = cpm.GetNames
            if names and prop_name in names:
                cpm.Set2(prop_name, str(value))
            else:
                cpm.Add2(prop_name, 30, str(value))  # swCustomInfoText = 30
            # 重建模型以反映属性变更
            try:
                model_doc.ForceRebuild3(False)
            except Exception:
                pass
            return {"success": True, "prop_name": prop_name}
        except Exception as e:
            raise RuntimeError(f"写入自定义属性 {prop_name} 失败: {e}")

    def export_stp(self, params: dict) -> dict:
        """将指定路径零部件导出为 STP 文件，返回本地文件路径"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(self._get_active_doc(sw), params.get("path", "0"))
        if product is None:
            model_doc = self._get_active_doc(sw)
        else:
            model_doc = product.GetModelDoc2()
        if model_doc is None:
            raise RuntimeError("无法获取组件模型文档，不能导出 STP")

        if params.get("file_name"):
            file_name = params["file_name"]
        else:
            code = self._get_builtin_val(model_doc, 'PartNumber') or 'export'
            ver = self._get_builtin_val(model_doc, 'Revision') or ''
            prefix = os.environ.get("CAD_STP_PREFIX", "")
            file_name = f"{prefix}{code}_{ver}.stp"
        out_dir = os.path.abspath(params.get("out_dir") or os.path.join("cad_workspace", "stp_export"))
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, file_name)
        if os.path.exists(out_path):
            os.remove(out_path)

        # SaveAs3 通过文件扩展名 .stp 判断导出为 STEP 格式
        # Version=0 使用当前 SW 版本，Options=0 默认选项
        ret = model_doc.SaveAs3(out_path, 0, 0)
        if ret != 0:
            raise RuntimeError(f"SolidWorks STP 导出失败，错误码: {ret}")
        if not os.path.exists(out_path):
            raise RuntimeError("STP 导出失败：SolidWorks 未生成文件")
        logger.info(f"STP 导出完成: {out_path}")
        return {"file_path": out_path, "file_name": file_name}

    @staticmethod
    def _get_builtin_val(model_doc, attr: str) -> str:
        try:
            return str(getattr(model_doc, attr, ""))
        except Exception:
            return ""

    def export_drawing_pdf(self, params: dict) -> dict:
        """将零部件对应的工程图导出为 PDF，返回本地文件路径。
        按约定找到同目录同名的 .SLDDRW 文件，导出为 PDF。"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(self._get_active_doc(sw), params.get("path", "0"))
        if product is None:
            model_doc = self._get_active_doc(sw)
        else:
            model_doc = product.GetModelDoc2()
        if model_doc is None:
            raise RuntimeError("无法获取组件模型文档")

        doc_path = ""
        try:
            doc_path = model_doc.GetPathName
        except Exception:
            pass
        if not doc_path:
            try:
                doc_path = product.GetPathName
            except Exception:
                pass

        if not doc_path:
            raise RuntimeError("无法获取零部件源文档路径")

        base, _ = os.path.splitext(doc_path)
        drawing_path = base + ".SLDDRW"
        if not os.path.isfile(drawing_path):
            raise RuntimeError(f"未找到工程图文件: {os.path.basename(drawing_path)}")

        if params.get("file_name"):
            file_name = params["file_name"]
        else:
            code = self._get_builtin_val(model_doc, 'PartNumber') or 'drawing'
            ver = self._get_builtin_val(model_doc, 'Revision') or ''
            prefix = os.environ.get("CAD_PDF_PART_PREFIX", "")
            file_name = f"{prefix}{code}_{ver}.pdf"

        out_dir = os.path.abspath(params.get("out_dir") or os.path.join("cad_workspace", "pdf_export"))
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, file_name)
        if os.path.exists(out_path):
            os.remove(out_path)

        drawing_doc = None
        was_open = False
        try:
            docs = sw.GetDocuments()
            if docs is not None:
                for d in docs:
                    try:
                        if (d.GetPathName or "").lower() == drawing_path.lower():
                            drawing_doc = d
                            was_open = True
                            break
                    except Exception:
                        pass
        except Exception:
            pass

        if drawing_doc is None:
            drawing_doc = sw.OpenDoc6(drawing_path, 3, 0, "", 0, 0)  # swDocDRAWING = 3

        try:
            ret = drawing_doc.ExportToPDF(out_path, 0, 0)
            if ret != 0:
                raise RuntimeError(f"PDF 导出失败，错误码: {ret}")
        finally:
            if not was_open and drawing_doc is not None:
                try:
                    sw.CloseDoc(drawing_doc.GetTitle)
                except Exception:
                    pass

        if not os.path.exists(out_path):
            raise RuntimeError("PDF 导出失败：SolidWorks 未生成文件")
        logger.info(f"PDF 导出完成: {out_path}")
        return {"file_path": out_path, "file_name": file_name}

    def _find_component_by_path(self, doc, path: str):
        """根据路径在装配体树中查找组件，根路径返回 None（调用方需自行使用 ActiveDoc）"""
        if doc is None:
            return None
        parts = path.split(".")
        if len(parts) <= 1:
            return None  # 根路径 "0" 返回 None，由调用方处理

        current = doc.GetComponents(False)
        if current is None:
            return None
        for idx_str in parts[1:]:
            try:
                idx = int(idx_str)
            except ValueError:
                return None
            if idx < 1 or idx > len(current):
                return None
            comp = current[idx - 1]
            model = comp.GetModelDoc2()
            if model is not None and model.GetType == 2:
                current = model.GetComponents(False)
            else:
                current = []
        return comp


# 全局实例，__main__.py 中注册使用
sw_client = SolidWorksClient()
