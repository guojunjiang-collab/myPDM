"""SolidWorks COM 互操作客户端"""
import json
import os
import sys
import logging

logger = logging.getLogger(__name__)


class SolidWorksClient:
    """SolidWorks COM 自动化接口封装（与 CATIAClient 接口对齐）"""

    # SW 中除标题/描述/材质等少量 SummaryInfo 属性外，绝大部分属性都走 CustomPropertyManager
    BUILTIN_ATTRS = {"Title", "Subject", "Author", "Keywords", "Comments"}

    def __init__(self, mapping_path: str = None):
        if mapping_path is None:
            mapping_path = os.path.join(os.path.dirname(__file__), "field_mapping.json")
        # PyInstaller 打包后：优先使用 exe 同目录的外部映射文件
        if getattr(sys, 'frozen', False):
            external = os.path.join(os.path.dirname(sys.executable), 'solidworks', 'field_mapping.json')
            if os.path.isfile(external):
                mapping_path = external
                logger.info(f"SolidWorks 使用外部映射文件: {external}")
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

    def read_assembly_tree(self, params: dict = None, on_progress=None) -> dict:
        """读取活动装配体的完整结构树（swDocASSEMBLY 类型才支持）。
        on_progress(count, name) 可选：每读取一个节点（先序）回调一次，
        count 为已读节点数、name 为节点名，用于前端显示读取进度。"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        doc = self._get_active_doc(sw)
        if doc is None:
            raise RuntimeError("NO_ACTIVE_DOC")

        if doc.GetType != 2:  # swDocASSEMBLY
            raise RuntimeError("当前文档不是装配体")

        # 一次性解析所有轻量化组件（含子装配体），避免逐级递归时读不到属性
        try:
            doc.ResolveAllLightWeightComponents(True)
            logger.info("SW 已解析所有轻量化组件")
        except Exception:
            pass
        # 备选：ResolveAllLightWeight（不同 SW 版本 API 名不同）
        try:
            doc.ResolveAllLightWeight(True)
            logger.info("SW ResolveAllLightWeight 成功")
        except Exception:
            pass
        try:
            doc.EditRebuild3()
            logger.info("SW EditRebuild3 完成")
        except Exception:
            pass

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

        # 文档缓存：按文件路径去重，本次读取后台打开的文档统一在末尾关闭，
        # 避免逐件打开-关闭时误关子装配导致读不到下一级（旧实现的时序 bug）
        doc_cache: dict = {}
        counter = {"n": 1}
        if on_progress is not None:
            on_progress(1, root_name)
        try:
            components = doc.GetComponents(True)  # True = 仅顶层组件
            if components is not None:
                comp_list = list(components)
                logger.info(f"SW 顶层组件数: {len(comp_list)}")
                for i, comp in enumerate(comp_list):
                    child = self._read_component_tree(sw, comp, f"0.{i+1}", 1, doc_cache, on_progress=on_progress, counter=counter)
                    if child is not None:
                        tree["children"].append(child)
            else:
                logger.warning("SW doc.GetComponents(True) 返回 None")
        finally:
            self._close_cached_docs(sw, doc_cache)

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

    def _open_model_doc(self, sw, path_name: str):
        """后台静默打开 SW 文件，返回 model_doc（用完需 close_opened_doc）。

        OpenDoc6 的 Errors/Warnings 为 [out] 参数，pywin32 下须用 VARIANT byref
        传递，否则在对 COM 类型敏感的环境会抛"类型不匹配"，导致读不到轻量化
        组件属性（本项目此前即因传 0,0 而静默失败）。首选 VARIANT，失败再回退。"""
        pl = (path_name or "").lower()
        if pl.endswith('.sldprt'):
            doc_type = 1
        elif pl.endswith('.sldasm'):
            doc_type = 2
        elif pl.endswith('.slddrw'):
            doc_type = 3
        else:
            return None
        try:
            import pythoncom
            from win32com.client import VARIANT
            errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
            warnings = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
            md = sw.OpenDoc6(path_name, doc_type, 1, "", errors, warnings)  # 1=Silent
            if md is not None:
                return md
        except Exception as e:
            logger.debug(f"OpenDoc6(VARIANT) 失败，回退普通参数: {e}")
        try:
            return sw.OpenDoc6(path_name, doc_type, 1, "", 0, 0)  # 1=Silent
        except Exception as e:
            logger.warning(f"OpenDoc6 打开失败 {path_name}: {e}")
            return None

    @staticmethod
    def _close_opened_doc(sw, model_doc):
        """关闭后台静默打开的 SW 文件"""
        try:
            sw.CloseDoc(model_doc.GetTitle)
        except Exception:
            pass

    @staticmethod
    def _find_open_doc(sw, path_name: str):
        """在 SW 已打开的文档集合中按路径查找（命中则复用，不应关闭）"""
        if not path_name:
            return None
        try:
            docs = sw.GetDocuments()
        except Exception:
            return None
        if not docs:
            return None
        for d in docs:
            try:
                if (d.GetPathName or "").lower() == path_name.lower():
                    return d
            except Exception:
                pass
        return None

    def _resolve_model_doc(self, sw, comp, path_name: str, cache: dict):
        """获取组件模型文档：优先 GetModelDoc2（已解析），否则后台静默打开。
        按文件路径缓存去重，多处引用同一文件只打开一次；本方法打开的文档
        标记 owned=True，供读取完成后统一关闭。"""
        key = (path_name or "").lower()
        if key and key in cache:
            return cache[key]["doc"]
        md = None
        try:
            md = comp.GetModelDoc2()
        except Exception:
            md = None
        owned = False
        if md is None and path_name:
            md = self._find_open_doc(sw, path_name)
            if md is None:
                md = self._open_model_doc(sw, path_name)
                owned = md is not None
        if key:
            cache[key] = {"doc": md, "owned": owned}
        return md

    def _close_cached_docs(self, sw, cache: dict):
        """关闭本次读取由 _resolve_model_doc 后台打开的所有文档"""
        for entry in cache.values():
            if entry.get("owned") and entry.get("doc") is not None:
                self._close_opened_doc(sw, entry["doc"])

    @staticmethod
    def _safe_pathname(comp) -> str:
        try:
            return comp.GetPathName or ""
        except Exception:
            return ""

    def _child_components(self, comp, model_doc) -> list:
        """列出组件的直接子组件。

        关键：轻量化子装配的组件实例在父装配上下文里 GetChildren 常枚举不到子级；
        真正可靠的是从"已加载/后台打开的装配文档"上 GetComponents(True) 枚举。
        因此优先用 model_doc.GetComponents(True)，再回退 IComponent2.GetChildren。"""
        if model_doc is not None:
            try:
                ch = model_doc.GetComponents(True)  # True = 仅直接子级
                if ch is not None:
                    lst = list(ch)
                    if lst:
                        return lst
            except Exception as e:
                logger.debug(f"model_doc.GetComponents 失败: {e}")
        # 回退：GetChildren（方法/属性两种 COM 绑定都尝试）
        for as_call in (True, False):
            try:
                ch = comp.GetChildren() if as_call else comp.GetChildren
                if ch is None or callable(ch):
                    continue
                lst = list(ch)
                if lst:
                    return lst
            except Exception:
                pass
        return []

    def _read_component_tree(self, sw, comp, path: str, level: int, cache: dict, on_progress=None, counter=None) -> dict | None:
        """递归读取组件树节点（含属性/矩阵/子组件）"""
        counter = counter if counter is not None else {"n": 0}
        try:
            name = comp.Name2
        except Exception:
            return None

        try:
            path_name = comp.GetPathName or ""
        except Exception:
            path_name = ""

        # 扩展名先判定装配体（轻量化下也可靠）
        is_assembly = path_name.lower().endswith('.sldasm')

        model_doc = self._resolve_model_doc(sw, comp, path_name, cache)
        if model_doc is not None and not is_assembly:
            try:
                is_assembly = model_doc.GetType == 2
            except Exception:
                pass

        builtin = self._read_builtin_props(model_doc)
        if not builtin.get("PartNumber"):
            part_number = ""
            if path_name:
                part_number = os.path.splitext(os.path.basename(str(path_name)))[0]
            if not part_number:
                part_number = str(name)
            builtin["PartNumber"] = part_number
        # 补充 CAD 原生属性名，供映射 Part Number → code 等查找
        if builtin.get("PartNumber") and "Part Number" not in builtin:
            builtin["Part Number"] = builtin["PartNumber"]

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
            "doc_path": path_name,
            "children": []
        }

        # 节点读取完成，报告进度（先序）
        counter["n"] += 1
        if on_progress is not None:
            on_progress(counter["n"], name)

        # 从已加载/后台打开的装配文档枚举直接子级并递归（可读全部层级）
        if is_assembly:
            children = self._child_components(comp, model_doc)
            if children:
                logger.info(f"  [{name}] 子组件数: {len(children)}")
            else:
                logger.warning(f"  [{name}] 装配体但未枚举到子级 (model_doc={'有' if model_doc else '无'})")
            for i, child in enumerate(children):
                child_node = self._read_component_tree(sw, child, f"{path}.{i+1}", level + 1, cache, on_progress=on_progress, counter=counter)
                if child_node is not None:
                    node["children"].append(child_node)

        return node

    def _read_builtin_props(self, model_doc) -> dict:
        """提取 PartNumber（文件名）和 Revision（自定义属性），供前端件号+版本匹配。"""
        if model_doc is None:
            return {}
        props = {}
        # PartNumber: 始终从文件名提取（不含扩展名）
        try:
            title = model_doc.GetTitle or ""
            props["PartNumber"] = str(os.path.splitext(str(title))[0])
        except Exception:
            pass
        # Revision: 从自定义属性读取
        try:
            ext = model_doc.Extension
            cpm = ext.CustomPropertyManager("")
            if cpm is not None:
                names = cpm.GetNames
                if names is not None:
                    for name in names:
                        n = str(name)
                        if n in ("版本", "Revision", "Rev"):
                            try:
                                val = cpm.Get(n)
                                if val and str(val).strip():
                                    props["Revision"] = str(val).strip()
                            except Exception:
                                pass
                        elif n == "中文名称":
                            try:
                                val = cpm.Get(n)
                                if val and str(val).strip():
                                    props["Nomenclature"] = str(val).strip()
                                    props["中文名称"] = str(val).strip()
                            except Exception:
                                pass
        except Exception as e:
            logger.debug(f"提取 SW 内置属性失败: {e}")
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
                    val = cpm.Get(str(name))
                    result[str(name)] = str(val) if val is not None else ""
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"读取自定义属性失败: {e}")
        return result

    def _read_component_transform(self, comp) -> list | None:
        """读取组件实例变换矩阵（相对父装配），输出与 CATIA/后端一致的
        4×4 行主序、16 元素、平移单位 mm 的列表。

        SolidWorks IMathTransform.ArrayData 的布局与通用 4×4 矩阵不同：
          [0..8]  三个基向量依次排列：d0..2=子系 X 轴、d3..5=Y 轴、d6..8=Z 轴
                  在父系中的方向分量（即列向量约定下旋转矩阵的三列）
          [9..11] 平移向量（SolidWorks 内部单位为米）
          [12]    缩放因子，[13..15] 保留未用
        因此需重排为「基向量作列」的行主序 4×4，并把平移由米转毫米
        （后端 _mm_matrix_to_m 会再按 mm→m 处理，最终落为 SW 原生的米）。
        直接透传 ArrayData 会让后端把旋转分量当平移误除以 1000、真正平移
        （索引 9~11）被忽略，导致装配子项矩阵错误。"""
        try:
            transform = comp.Transform2
            if transform is None:
                return None
            data = transform.ArrayData
            if data is None:
                return None
            d = list(data)
            if len(d) < 12:
                return None
            # 旋转部分全零视为无效矩阵
            if all(abs(v) < 1e-12 for v in d[:9]):
                return None
            mm = 1000.0
            return [
                d[0], d[3], d[6], d[9] * mm,
                d[1], d[4], d[7], d[10] * mm,
                d[2], d[5], d[8], d[11] * mm,
                0.0, 0.0, 0.0, 1.0,
            ]
        except Exception as e:
            logger.debug(f"读取组件矩阵失败: {e}")
            return None

    def _locate_component(self, sw, path: str, cache: dict):
        """按路径逐级定位组件，返回目标 IComponent2（根路径返回 None）。
        每下钻一级都用该(子装配)组件的模型文档 GetComponents(True) 枚举下一级，
        与 read_assembly_tree 的遍历方式一致（索引对齐），轻量化子装配同样可用。
        沿途后台打开的文档记入 cache，由调用方统一关闭。"""
        active = self._get_active_doc(sw)
        if active is None:
            return None
        parts = path.split(".")
        if len(parts) <= 1:
            return None  # 根路径由调用方用活动文档处理
        current = list(active.GetComponents(True) or [])
        steps = parts[1:]
        comp = None
        for i, idx_str in enumerate(steps):
            try:
                idx = int(idx_str)
            except ValueError:
                return None
            if idx < 1 or idx > len(current):
                return None
            comp = current[idx - 1]
            if i < len(steps) - 1:  # 还需继续下钻
                md = self._resolve_model_doc(sw, comp, self._safe_pathname(comp), cache)
                current = self._child_components(comp, md)
        return comp

    def _resolve_doc_for_op(self, sw, path: str, cache: dict):
        """为读/写/导出定位指定路径的模型文档；后台打开的文档记入 cache。
        根路径用活动文档；子项优先 GetModelDoc2，轻量化时按源文件后台静默打开。"""
        comp = self._locate_component(sw, path, cache)
        if comp is None:
            return self._get_active_doc(sw)  # 根路径
        return self._resolve_model_doc(sw, comp, self._safe_pathname(comp), cache)

    @staticmethod
    def _is_owned(cache: dict, doc) -> bool:
        """判断某文档是否由本次操作后台打开（需保存/关闭）"""
        for e in cache.values():
            if e.get("doc") is doc:
                return bool(e.get("owned"))
        return False

    def read_properties(self, params: dict) -> dict:
        """读取指定路径零部件的所有属性"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        cache: dict = {}
        try:
            model_doc = self._resolve_doc_for_op(sw, params.get("path", "0"), cache)
            if model_doc is None:
                raise RuntimeError("COMPONENT_NOT_FOUND")
            builtin = self._read_builtin_props(model_doc)
            user_props = self._read_custom_props(model_doc)
            return {"builtin": builtin, "user_properties": user_props}
        finally:
            self._close_cached_docs(sw, cache)

    # 前端内部键 → SW 自定义属性别名（读取时反向映射，写入时按此定位/新建）
    REVISION_ALIASES = ("版本", "Revision", "Rev")
    NOMENCLATURE_ALIASES = ("中文名称", "Nomenclature")

    def _write_custom_prop(self, model_doc, prop_name: str, value: str):
        """写自定义属性。版本/中文名称在 SW 中实际存为「版本」「中文名称」，
        按别名定位已有项更新，否则以中文规范名新建，避免写出前端读不到的重复项。"""
        ext = model_doc.Extension
        cpm = ext.CustomPropertyManager("")
        if cpm is None:
            raise RuntimeError("无法获取 CustomPropertyManager")
        names = list(cpm.GetNames or [])
        target = prop_name
        if prop_name == "Revision":
            target = next((a for a in self.REVISION_ALIASES if a in names), "版本")
        elif prop_name == "Nomenclature":
            target = next((a for a in self.NOMENCLATURE_ALIASES if a in names), "中文名称")
        if target in names:
            cpm.Set2(target, value)
        else:
            cpm.Add2(target, 30, value)  # swCustomInfoText = 30

    def _save_doc(self, model_doc):
        """静默保存文档（后台打开写属性后须保存才落盘）"""
        try:
            import pythoncom
            from win32com.client import VARIANT
            errors = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
            warnings = VARIANT(pythoncom.VT_BYREF | pythoncom.VT_I4, 0)
            model_doc.Save3(1, errors, warnings)  # 1=swSaveAsOptions_Silent
            return
        except Exception as e:
            logger.debug(f"Save3(VARIANT) 失败，回退: {e}")
        try:
            model_doc.Save3(1, 0, 0)
        except Exception as e:
            logger.warning(f"保存文档失败: {e}")

    def write_property(self, params: dict) -> dict:
        """写入指定零部件的属性（轻量化组件后台打开源文件写入并保存）"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        cache: dict = {}
        try:
            model_doc = self._resolve_doc_for_op(sw, params.get("path", "0"), cache)
            if model_doc is None:
                raise RuntimeError("无法获取模型文档")
            opened = self._is_owned(cache, model_doc)

            prop_name = params["prop_name"]
            value = params["value"]
            # 真正的文档内置属性（Title/Author 等）走 setattr，其余走自定义属性
            if prop_name in self.BUILTIN_ATTRS:
                try:
                    setattr(model_doc, prop_name, str(value))
                except Exception as e:
                    raise RuntimeError(f"写入内置属性 {prop_name} 失败: {e}")
            else:
                try:
                    self._write_custom_prop(model_doc, prop_name, str(value))
                except Exception as e:
                    raise RuntimeError(f"写入自定义属性 {prop_name} 失败: {e}")
            # 后台打开的文档保存落盘；活动文档仅重建以反映变更
            if opened:
                self._save_doc(model_doc)
            else:
                try:
                    model_doc.ForceRebuild3(False)
                except Exception:
                    pass
            return {"success": True, "prop_name": prop_name}
        finally:
            self._close_cached_docs(sw, cache)

    def export_stp(self, params: dict) -> dict:
        """将指定路径零部件导出为 STP 文件，返回本地文件路径"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        cache: dict = {}
        try:
            model_doc = self._resolve_doc_for_op(sw, params.get("path", "0"), cache)
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
        finally:
            self._close_cached_docs(sw, cache)

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

        cache: dict = {}
        try:
            model_doc = self._resolve_doc_for_op(sw, params.get("path", "0"), cache)
            if model_doc is None:
                raise RuntimeError("无法获取组件模型文档")
            doc_path = ""
            try:
                doc_path = model_doc.GetPathName
            except Exception:
                pass
        finally:
            # 源模型文档定位到路径后即可释放（工程图是另一份文件，不再需要它）
            self._close_cached_docs(sw, cache)

        if not doc_path:
            raise RuntimeError("无法获取零部件源文档路径")

        base, _ = os.path.splitext(doc_path)
        drawing_path = base + ".SLDDRW"
        if not os.path.isfile(drawing_path):
            raise RuntimeError(f"未找到工程图文件: {os.path.basename(drawing_path)}")

        if params.get("file_name"):
            file_name = params["file_name"]
        else:
            # 源文档已释放，件号取自文件名（工程图导出通常由前端传入 file_name）
            code = os.path.splitext(os.path.basename(doc_path))[0] or 'drawing'
            prefix = os.environ.get("CAD_PDF_PART_PREFIX", "")
            file_name = f"{prefix}{code}.pdf"

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


# 全局实例，__main__.py 中注册使用
sw_client = SolidWorksClient()
