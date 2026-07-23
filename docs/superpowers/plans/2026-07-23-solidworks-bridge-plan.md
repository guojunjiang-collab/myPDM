# SolidWorks 桥接程序实施计划

> **For agentic workers:** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐步实施。步骤使用 checkbox (`- [ ]`) 语法跟踪。

**目标:** 在现有 Catia 桥接程序基础上新增 SolidWorks 桥接支持，实现全部 11 个 JSON-RPC 方法。

**架构:** 在 `cad_bridge/solidworks/` 下镜像 Catia 结构，`__main__.py` 并行注册 `sw.*` 方法，前端 Hook 按 `cadType` 路由命名空间，Modal 增加 CAD 类型选择。

**技术栈:** Python 3.12 + pywin32 COM + websockets（后端），React + TypeScript（前端）

## 全局约束

- Python 依赖不新增，pywin32 已满足
- 所有新代码中文注释
- Catia 路径零改动（`server.py`、`pdm_client.py`、`catia/` 不动）
- WebSocket 地址 `ws://127.0.0.1:9527` 不变
- 前端构建后需重启 Nginx 部署

---

### 任务 1: 创建 SolidWorks 字段映射文件和包初始化

**文件:**
- 创建: `cad_bridge/solidworks/__init__.py`
- 创建: `cad_bridge/solidworks/field_mapping.json`

**接口:**
- 产出: `field_mapping.json` — 包含 `builtin` 和 `properties` 两区，结构同 `catia/field_mapping.json`

- [ ] **Step 1: 创建 `cad_bridge/solidworks/__init__.py`**

```python
# SolidWorks 桥接模块
```

- [ ] **Step 2: 创建 `cad_bridge/solidworks/field_mapping.json`**

```json
{
  "builtin": {
    "PartNumber": "code",
    "Revision": "version",
    "Description": "name"
  },
  "properties": {
    "零部件类型": "零部件类型",
    "零部件尺寸": "零部件尺寸",
    "材料名称": "材料名称",
    "材料牌号": "材料牌号",
    "材料标准": "材料标准",
    "工艺方法": "工艺方法",
    "表面处理": "表面处理",
    "最终状态（热处理）": "最终状态（热处理）",
    "互换性": "互换性",
    "特性分类（关重特性）": "特性分类（关重特性）",
    "单件重量(g)": "单件重量(g)",
    "存货类别": "存货类别",
    "物料属性": "物料属性",
    "备注": "备注"
  }
}
```

- [ ] **Step 3: 提交**

```powershell
git add cad_bridge/solidworks/__init__.py cad_bridge/solidworks/field_mapping.json
git commit -m "feat: SolidWorks 字段映射配置与包初始化"
```

---

### 任务 2: 创建 SolidWorks COM 客户端

**文件:**
- 创建: `cad_bridge/solidworks/client.py`

**接口:**
- 产出: `SolidWorksClient` 类 — 与 `CATIAClient` 接口对齐，提供 `detect()`、`read_assembly_tree()`、`read_properties()`、`write_property()`、`export_stp()`、`export_drawing_pdf()`、`mapping` 方法
- 产出: 全局实例 `sw_client = SolidWorksClient()`

- [ ] **Step 1: 编写 `SolidWorksClient` 类框架和 `_get_sw_app`**

```python
"""SolidWorks COM 互操作客户端"""
import json
import os
import logging

logger = logging.getLogger(__name__)


class SolidWorksClient:
    """SolidWorks COM 自动化接口封装（与 CATIAClient 接口对齐）"""

    BUILTIN_ATTRS = {"PartNumber", "Revision", "Description", "Material", "Weight", "Density", "Cost", "Vendor", "DocumentName"}

    def __init__(self, mapping_path: str = None):
        if mapping_path is None:
            mapping_path = os.path.join(os.path.dirname(__file__), "field_mapping.json")
        self.mapping = self._load_mapping(mapping_path)

    def _load_mapping(self, path: str) -> dict:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

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
```

- [ ] **Step 2: 编写 `detect()` 方法**

```python
    def detect(self) -> dict:
        """检测 SolidWorks 是否运行，返回活动文档信息"""
        sw = self._get_sw_app()
        if sw is None:
            return {"active": False}

        try:
            doc = sw.ActiveDoc
            if doc is None:
                return {"active": True, "has_document": False}
            doc_type = self._get_doc_type(doc)
            return {
                "active": True,
                "has_document": True,
                "doc_name": doc.GetTitle(),
                "doc_type": doc_type,
                "doc_path": doc.GetPathName() or ""
            }
        except Exception as e:
            logger.error(f"检测 SolidWorks 文档失败: {e}")
            return {"active": True, "has_document": False, "error": str(e)}

    @staticmethod
    def _get_doc_type(doc) -> str:
        """获取文档类型（Part / Assembly / Drawing）"""
        try:
            t = doc.GetType()
            type_map = {
                1: "Part",
                2: "Assembly",
                3: "Drawing",
            }
            return type_map.get(t, "Unknown")
        except Exception:
            return "Unknown"
```

- [ ] **Step 3: 编写 `read_assembly_tree()` 和递归辅助方法**

```python
    def read_assembly_tree(self, params: dict = None) -> dict:
        """读取活动装配体的完整结构树（swDocASSEMBLY 类型才支持）"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        doc = sw.ActiveDoc
        if doc is None:
            raise RuntimeError("NO_ACTIVE_DOC")

        if doc.GetType() != 2:  # swDocASSEMBLY
            raise RuntimeError("当前文档不是装配体")

        root_name = doc.GetTitle()
        root_path = doc.GetPathName() or ""

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
                is_assembly = model_doc.GetType() == 2
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
            node["doc_path"] = comp.GetPathName() or ""
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
        """读取内置属性（SummaryInfo / CustomInfo）"""
        if model_doc is None:
            return {}
        props = {}
        for attr in self.BUILTIN_ATTRS:
            try:
                val = getattr(model_doc, attr, None)
                if val is not None and val != "":
                    props[attr] = str(val)
            except Exception:
                pass
        # 补充 CustomInfo2 中的 ConfigurationName
        try:
            configs = model_doc.GetConfigurationNames()
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
            names = cpm.GetNames()
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
```

- [ ] **Step 4: 编写 `read_properties()` 方法**

```python
    def read_properties(self, params: dict) -> dict:
        """读取指定路径零部件的所有属性"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(sw.ActiveDoc, params.get("path", "0"))
        if product is None:
            raise RuntimeError("COMPONENT_NOT_FOUND")

        model_doc = None
        try:
            model_doc = product.GetModelDoc2()
        except Exception:
            pass

        builtin = self._read_builtin_props(model_doc)
        user_props = self._read_custom_props(model_doc)
        return {"builtin": builtin, "user_properties": user_props}
```

- [ ] **Step 5: 编写 `write_property()` 方法**

```python
    def write_property(self, params: dict) -> dict:
        """写入指定零部件的属性"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(sw.ActiveDoc, params.get("path", "0"))
        if product is None:
            raise RuntimeError("COMPONENT_NOT_FOUND")

        prop_name = params["prop_name"]
        value = params["value"]
        model_doc = product.GetModelDoc2()
        if model_doc is None:
            raise RuntimeError("无法获取模型文档")

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
            names = cpm.GetNames()
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
```

- [ ] **Step 6: 编写 `export_stp()` 方法**

```python
    def export_stp(self, params: dict) -> dict:
        """将指定路径零部件导出为 STP 文件，返回本地文件路径"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(sw.ActiveDoc, params.get("path", "0"))
        if product is None:
            raise RuntimeError("COMPONENT_NOT_FOUND")

        model_doc = product.GetModelDoc2()
        if model_doc is None:
            # 如果组件没有关联文档，可能是虚拟零部件
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

        # swSTEP: 保存类型常量值 214（STEP AP214）
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
```

- [ ] **Step 7: 编写 `export_drawing_pdf()` 方法**

```python
    def export_drawing_pdf(self, params: dict) -> dict:
        """将零部件对应的工程图导出为 PDF，返回本地文件路径。
        按约定找到同目录同名的 .SLDDRW 文件，导出为 PDF。"""
        sw = self._get_sw_app()
        if sw is None:
            raise RuntimeError("SW_NOT_FOUND")

        product = self._find_component_by_path(sw.ActiveDoc, params.get("path", "0"))
        if product is None:
            raise RuntimeError("COMPONENT_NOT_FOUND")

        model_doc = product.GetModelDoc2()
        if model_doc is None:
            raise RuntimeError("无法获取组件模型文档")

        doc_path = ""
        try:
            doc_path = model_doc.GetPathName()
        except Exception:
            pass
        if not doc_path:
            try:
                doc_path = product.GetPathName()
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
                        if (d.GetPathName() or "").lower() == drawing_path.lower():
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
            ret = drawing_doc.SaveAs3(out_path, 0, 0)  # 0=默认选项, 保存类型由扩展名决定
            if ret != 0:
                raise RuntimeError(f"PDF 导出失败，错误码: {ret}")
        finally:
            if not was_open and drawing_doc is not None:
                try:
                    sw.CloseDoc(drawing_doc.GetTitle())
                except Exception:
                    pass

        if not os.path.exists(out_path):
            raise RuntimeError("PDF 导出失败：SolidWorks 未生成文件")
        logger.info(f"PDF 导出完成: {out_path}")
        return {"file_path": out_path, "file_name": file_name}
```

- [ ] **Step 8: 编写 `_find_component_by_path()` 辅助方法**

```python
    def _find_component_by_path(self, doc, path: str):
        """根据路径在装配体树中查找组件"""
        if doc is None:
            return None
        parts = path.split(".")
        if len(parts) <= 1:
            return doc  # 根路径 "0" 返回文档

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
            if model is not None and model.GetType() == 2:
                current = model.GetComponents(False)
            else:
                current = []
        return comp
```

- [ ] **Step 9: 添加全局实例**

在 `client.py` 末尾：

```python
# 全局实例，__main__.py 中注册使用
sw_client = SolidWorksClient()
```

- [ ] **Step 10: 提交**

```powershell
git add cad_bridge/solidworks/client.py
git commit -m "feat: SolidWorks COM 客户端（检测/读树/读写属性/STP/PDF）"
```

---

### 任务 3: 在 `__main__.py` 中注册 SolidWorks 方法

**文件:**
- 修改: `cad_bridge/__main__.py`

**接口:**
- 消费: `SolidWorksClient` 和 `sw_client` 全局实例（从 `cad_bridge.solidworks.client` 导入）
- 产出: 7 个新 JSON-RPC 方法注册（`sw.detect`、`sw.assembly.read_tree`、`sw.assembly.read_properties`、`sw.property.write`、`sw.mapping.get`、`sw.workspace.export_stp_upload`、`sw.workspace.export_pdf_upload`）

- [ ] **Step 1: 在 `__main__.py` 添加导入**

将第 13 行后增加 SW 客户端导入：

```python
from cad_bridge.server import BridgeServer
from cad_bridge.pdm_client import PDMClient
from cad_bridge.catia.client import catia_client
from cad_bridge.solidworks.client import sw_client
```

- [ ] **Step 2: 在 `register_handlers()` 中增加 SW handler 和注册**

在现有 handler 定义之后（第 104 行 `server.register("catia.ping", ...)` 之前），增加 SW handler 定义。并在现有注册行之后增加 SW 注册。完整替换 `register_handlers` 函数体如下：

```python
def register_handlers(server: BridgeServer, pdm_client: PDMClient):
    """注册所有 JSON-RPC 方法处理器（CATIA + SolidWorks 并行）"""

    # --- 共用 handler ---

    async def handle_ping(params: dict, token: str) -> dict:
        return {"status": "ok"}

    async def handle_download(params: dict, token: str) -> dict:
        attachment_id = params["attachment_id"]
        revision_code = params.get("code", "unknown")
        revision_version = params.get("version", "A")
        save_dir = params.get("save_dir") or f"./cad_workspace/{revision_code}/{revision_version}"
        pdm_url = params.get("pdm_url")
        return await pdm_client.download_attachment(attachment_id, save_dir, token, base_url=pdm_url)

    async def handle_upload(params: dict, token: str) -> dict:
        file_path = params["file_path"]
        revision_id = params["revision_id"]
        category = params.get("category", "cad")
        overwrite = bool(params.get("overwrite", False))
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(file_path, revision_id, category, token, overwrite=overwrite, base_url=pdm_url)
        uploaded = [os.path.basename(file_path)]
        # 上传源文件时，同目录同名的工程图（若存在）一并上传
        if params.get("include_drawing"):
            base, _ = os.path.splitext(file_path)
            # CATIA 工程图
            for ext in (".CATDrawing", ".SLDDRW"):
                drawing_path = base + ext
                if os.path.isfile(drawing_path):
                    await pdm_client.upload_attachment(drawing_path, revision_id, category, token, overwrite=overwrite, base_url=pdm_url)
                    uploaded.append(os.path.basename(drawing_path))
        return {"uploaded": uploaded, **(result or {})}

    # --- CATIA handler ---

    async def handle_catia_detect(params: dict, token: str) -> dict:
        return catia_client.detect()

    async def handle_catia_read_tree(params: dict, token: str) -> dict:
        return catia_client.read_assembly_tree(params)

    async def handle_catia_read_properties(params: dict, token: str) -> dict:
        return catia_client.read_properties(params)

    async def handle_catia_write_property(params: dict, token: str) -> dict:
        return catia_client.write_property(params)

    async def handle_catia_mapping_get(params: dict, token: str) -> dict:
        return catia_client.mapping

    async def handle_catia_export_stp_upload(params: dict, token: str) -> dict:
        export = catia_client.export_stp(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    async def handle_catia_export_pdf_upload(params: dict, token: str) -> dict:
        export = catia_client.export_drawing_pdf(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    # --- SolidWorks handler ---

    async def handle_sw_detect(params: dict, token: str) -> dict:
        return sw_client.detect()

    async def handle_sw_read_tree(params: dict, token: str) -> dict:
        return sw_client.read_assembly_tree(params)

    async def handle_sw_read_properties(params: dict, token: str) -> dict:
        return sw_client.read_properties(params)

    async def handle_sw_write_property(params: dict, token: str) -> dict:
        return sw_client.write_property(params)

    async def handle_sw_mapping_get(params: dict, token: str) -> dict:
        return sw_client.mapping

    async def handle_sw_export_stp_upload(params: dict, token: str) -> dict:
        export = sw_client.export_stp(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    async def handle_sw_export_pdf_upload(params: dict, token: str) -> dict:
        export = sw_client.export_drawing_pdf(params)
        pdm_url = params.get("pdm_url")
        result = await pdm_client.upload_attachment(
            export["file_path"], params["revision_id"], "production", token, overwrite=True, base_url=pdm_url
        )
        return {"file_name": export["file_name"], **(result or {})}

    # --- 注册：CATIA 专用 ---
    server.register("catia.ping", handle_ping)
    server.register("catia.detect", handle_catia_detect)
    server.register("catia.assembly.read_tree", handle_catia_read_tree)
    server.register("catia.assembly.read_properties", handle_catia_read_properties)
    server.register("catia.property.write", handle_catia_write_property)
    server.register("catia.mapping.get", handle_catia_mapping_get)
    server.register("catia.workspace.export_stp_upload", handle_catia_export_stp_upload)
    server.register("catia.workspace.export_pdf_upload", handle_catia_export_pdf_upload)

    # --- 注册：SolidWorks 专用 ---
    server.register("sw.ping", handle_ping)
    server.register("sw.detect", handle_sw_detect)
    server.register("sw.assembly.read_tree", handle_sw_read_tree)
    server.register("sw.assembly.read_properties", handle_sw_read_properties)
    server.register("sw.property.write", handle_sw_write_property)
    server.register("sw.mapping.get", handle_sw_mapping_get)
    server.register("sw.workspace.export_stp_upload", handle_sw_export_stp_upload)
    server.register("sw.workspace.export_pdf_upload", handle_sw_export_pdf_upload)

    # --- 注册：共用 ---
    server.register("workspace.download", handle_download)
    server.register("workspace.upload", handle_upload)
```

- [ ] **Step 2 补充说明**：`catia.ping` → `handle_ping` 保持不变；新增 `sw.ping` → `handle_ping` 同一 handler。`workspace.download` 和 `workspace.upload` 保持共用。`workspace.export_stp_upload` / `workspace.export_pdf_upload` 改为 `catia.workspace.*` 和 `sw.workspace.*`，保持向后兼容，旧的 `workspace.export_stp_upload` / `workspace.export_pdf_upload` 注册行需要删除。

- [ ] **Step 3: 提交**

```powershell
git add cad_bridge/__main__.py
git commit -m "feat: __main__.py 注册 SolidWorks JSON-RPC 方法（sw.* 命名空间）"
```

---

### 任务 4: 修改前端 Hook `useCADBridge.ts` 支持 CAD 类型路由

**文件:**
- 修改: `frontend/src/hooks/useCADBridge.ts`

**接口:**
- 消费: `cadBridge` WebSocket 客户端单例（`services/cadBridge.ts`）
- 产出: Hook 接受 `cadType: 'catia' | 'solidworks'` 参数，内部按命名空间路由 RPC 方法名

- [ ] **Step 1: 修改 `useCADBridge` 函数签名和内部路由**

将 `useCADBridge` 改为接受 `cadType` 参数，所有 `catia.*` 硬编码方法名按 `ns` 变量动态路由：

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { cadBridge } from '../services/cadBridge';
import { useAuthStore } from '../stores/auth';

export interface CADStatus {
  active: boolean;
  has_document?: boolean;
  doc_name?: string;
  doc_type?: string;
  doc_path?: string;
}

export interface AssemblyTreeNode {
  instance_name: string;
  path: string;
  level: number;
  is_assembly: boolean;
  children: AssemblyTreeNode[];
  matrix?: number[] | null;
  properties?: {
    builtin: Record<string, string>;
    user_properties: Record<string, string>;
  };
}

export type CADType = 'catia' | 'solidworks';

export function useCADBridge(cadType: CADType = 'catia') {
  const [connected, setConnected] = useState(false);
  const [cadStatus, setCadStatus] = useState<CADStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useAuthStore((s) => s.token) || '';
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const ns = cadType === 'catia' ? 'catia' : 'sw';

  useEffect(() => {
    cadBridge.setStatusCallback(setConnected);
    return () => {
      cadBridge.disconnect();
    };
  }, []);

  const ensureConnected = useCallback(async (): Promise<void> => {
    if (connected) return;
    setLoading(true);
    try {
      await cadBridge.connect(tokenRef.current);
    } catch (e: any) {
      throw new Error('无法连接到 CAD 桥接服务，请确认服务已启动');
    } finally {
      setLoading(false);
    }
  }, [connected]);

  const ping = useCallback(async (): Promise<boolean> => {
    try {
      const result = await cadBridge.call(`${ns}.ping`, {}, tokenRef.current);
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }, [ns]);

  const detectCAD = useCallback(async (): Promise<CADStatus> => {
    await ensureConnected();
    const result = await cadBridge.call(`${ns}.detect`, {}, tokenRef.current);
    setCadStatus(result);
    return result;
  }, [ensureConnected, ns]);

  const readAssemblyTree = useCallback(async (): Promise<AssemblyTreeNode> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.assembly.read_tree`, {}, tokenRef.current, 300000);
  }, [ensureConnected, ns]);

  const readProperties = useCallback(async (path: string): Promise<AssemblyTreeNode['properties']> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.assembly.read_properties`, { path }, tokenRef.current);
  }, [ensureConnected, ns]);

  const writeProperty = useCallback(async (path: string, propName: string, value: string): Promise<void> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.property.write`, { path, prop_name: propName, value }, tokenRef.current);
  }, [ensureConnected, ns]);

  const getFieldMapping = useCallback(async (): Promise<{
    builtin: Record<string, string>;
    properties: Record<string, string>;
  }> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.mapping.get`, {}, tokenRef.current);
  }, [ensureConnected, ns]);

  const pdmUrlRef = useRef(window.location.origin + '/api');
  pdmUrlRef.current = window.location.origin + '/api';

  const downloadFile = useCallback(async (attachmentId: string, code: string, version: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.download', { attachment_id: attachmentId, code, version, pdm_url: pdmUrlRef.current }, tokenRef.current);
  }, [ensureConnected]);

  const uploadFile = useCallback(async (filePath: string, revisionId: string, category: 'cad' | 'production', overwrite = false, includeDrawing = false): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.upload', { file_path: filePath, revision_id: revisionId, category, overwrite, include_drawing: includeDrawing, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected]);

  const exportStpUpload = useCallback(async (path: string, fileName: string, revisionId: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.workspace.export_stp_upload`, { path, file_name: fileName, revision_id: revisionId, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected, ns]);

  const exportPdfUpload = useCallback(async (path: string, fileName: string, revisionId: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.workspace.export_pdf_upload`, { path, file_name: fileName, revision_id: revisionId, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected, ns]);

  return {
    connected,
    cadStatus,
    loading,
    ping,
    detectCAD,
    readAssemblyTree,
    readProperties,
    writeProperty,
    getFieldMapping,
    downloadFile,
    uploadFile,
    exportStpUpload,
    exportPdfUpload,
  };
}
```

- [ ] **Step 2: 查找并更新所有引用旧接口的代码**

`CADWorkspaceModal.tsx` 和 `CADBOMMatchTable.tsx` 等文件引用 `bridge.catiaStatus`、`bridge.detectCATIA()` 等旧名称。需要更新这些引用处。先运行类型检查找出所有编译错误：

```powershell
cd frontend; npx tsc --noEmit 2>&1 | Select-String "detectCATIA|catiaStatus"
```

- [ ] **Step 3: 修复 `CADBOMMatchTable.tsx` 中的引用**

`CADBOMMatchTable.tsx` 使用 `bridge.detectCATIA` 和 `bridge.catiaStatus`，需替换为新的名称。找到文件中所有引用，替换：

```
bridge.detectCATIA()  →  bridge.detectCAD()
bridge.catiaStatus    →  bridge.cadStatus
```

在 `CADBOMMatchTable.tsx` 中搜索这些模式并全部替换（`replaceAll`）。

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/hooks/useCADBridge.ts frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: useCADBridge 支持 cadType 参数（catia/sw 命名空间路由）"
```

---

### 任务 5: 修改 `CADWorkspaceModal.tsx` 增加 CAD 类型选择

**文件:**
- 修改: `frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx`

**接口:**
- 消费: `useCADBridge(cadType)` 和 `CADType` 类型
- 产出: Modal 顶部增加 CAD 类型下拉选择，`cadType` 状态全局传递给子步骤

- [ ] **Step 1: 完整替换 `CADWorkspaceModal.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow, type NamingPrefixes } from './CADBOMMatchTable';
import { CADCompleteStep } from './CADCompleteStep';
import { useCADBridge, type CADType } from '../../hooks/useCADBridge';
import { settingsApi } from '../../services/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'connect' | 'match' | 'complete';

export function CADWorkspaceModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [cadType, setCadType] = useState<CADType>('catia');
  const [bomRows, setBomRows] = useState<BOMRow[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [namingPrefixes, setNamingPrefixes] = useState<NamingPrefixes>({
    pdfPartPrefix: '',
    pdfAssemblyPrefix: '',
    stpPrefix: '',
  });
  const bridge = useCADBridge(cadType);

  useEffect(() => {
    if (open) {
      settingsApi.cadNaming().then(setNamingPrefixes).catch(() => {});
    }
  }, [open]);

  const handleClose = () => {
    setStep('connect');
    setBomRows([]);
    onClose();
  };

  const handleAssemblyLoaded = (rows: BOMRow[]) => {
    setBomRows(rows);
    setStep('match');
  };

  const handleMatchComplete = (count: number) => {
    setCompletedCount(count);
    setStep('complete');
  };

  const stepLabels: Record<Step, string> = {
    connect: '连接CAD',
    match: 'BOM匹配',
    complete: '完成',
  };

  const cadLabel = cadType === 'catia' ? 'CATIA V5' : 'SolidWorks';

  return (
    <Modal open={open} onClose={handleClose} title="CAD 入口 · 工作台" width="max" height="85vh">
      <div className="flex flex-col h-full">
        {/* CAD 类型选择 + 步骤标签 */}
        <div className="flex border-b border-gray-200 mb-4 shrink-0 items-end justify-between">
          <div className="flex">
            {(['connect', 'match', 'complete'] as Step[]).map((s, i) => (
              <div
                key={s}
                className={`px-5 py-2.5 text-sm font-semibold ${
                  step === s
                    ? 'text-primary-600 border-b-2 border-primary-600'
                    : 'text-gray-400'
                }`}
              >
                {i === 0 ? '①' : i === 1 ? '②' : '③'} {stepLabels[s]}
              </div>
            ))}
          </div>
          {step === 'connect' && (
            <div className="flex items-center gap-2 pr-4 pb-2">
              <span className="text-xs text-gray-500">选择CAD软件:</span>
              <select
                value={cadType}
                onChange={(e) => setCadType(e.target.value as CADType)}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="catia">CATIA V5</option>
                <option value="solidworks">SolidWorks</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0">
          {step === 'connect' && (
            <CADConnectStep
              bridge={bridge}
              cadType={cadType}
              onAssemblyLoaded={handleAssemblyLoaded}
              onClose={handleClose}
            />
          )}
          {step === 'match' && (
            <CADBOMMatchTable
              bridge={bridge}
              rows={bomRows}
              onComplete={handleMatchComplete}
              namingPrefixes={namingPrefixes}
            />
          )}
          {step === 'complete' && (
            <CADCompleteStep
              count={completedCount}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx
git commit -m "feat: CADWorkspaceModal 增加 CAD 类型选择（CATIA/SolidWorks）"
```

---

### 任务 6: 修改 `CADConnectStep.tsx` 文案适配

**文件:**
- 修改: `frontend/src/components/CADWorkspace/CADConnectStep.tsx`

**接口:**
- 消费: `cadType` prop（从 `CADWorkspaceModal` 传入）、`bridge` Hook 返回的新接口
- 产出: 状态卡片/按钮文案随 `cadType` 变化，`detectCATIA()` → `detectCAD()`

- [ ] **Step 1: 完整替换 `CADConnectStep.tsx`**

```typescript
import { useState } from 'react';
import type { useCADBridge, CADType } from '../../hooks/useCADBridge';
import type { BOMRow } from './CADBOMMatchTable';
import { flattenTree } from './flattenTree';

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  cadType: CADType;
  onAssemblyLoaded: (rows: BOMRow[]) => void;
  onClose: () => void;
}

export function CADConnectStep({ bridge, cadType, onAssemblyLoaded, onClose }: Props) {
  const [cadDetected, setCadDetected] = useState(false);
  const [docInfo, setDocInfo] = useState<{ name: string; type: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState('');

  const cadLabel = cadType === 'catia' ? 'CATIA' : 'SolidWorks';

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const status = await bridge.detectCAD();
      setCadDetected(status.active && !!status.has_document);
      if (status.active && status.has_document) {
        setDocInfo({ name: status.doc_name || '', type: status.doc_type || '' });
      } else if (status.active) {
        setError(`${cadLabel} 已运行但未打开任何文档，请打开一个装配体`);
      } else {
        setError(`未检测到 ${cadLabel} 进程，请先启动 ${cadLabel}`);
      }
    } catch (e: any) {
      setError(e.message || '桥接服务连接失败');
    } finally {
      setDetecting(false);
    }
  };

  const handleLoadAssembly = async () => {
    setLoadingTree(true);
    try {
      const tree = await bridge.readAssemblyTree();
      if (!tree) {
        setError('读取装配结构失败');
        return;
      }
      const rows = flattenTree(tree);
      onAssemblyLoaded(rows);
    } catch (e: any) {
      setError(e.message || '读取装配结构失败');
    } finally {
      setLoadingTree(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-8">
      <div className="flex gap-4 mb-6">
        <div className={`flex-1 border rounded-lg p-4 text-center min-w-[200px] ${
          bridge.connected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${bridge.connected ? 'text-green-700' : 'text-gray-400'}`}>
            {bridge.connected ? '桥接服务在线' : '桥接服务离线'}
          </div>
          <div className="text-xs text-gray-500 mt-1">ws://127.0.0.1:9527</div>
        </div>

        <div className={`flex-1 border rounded-lg p-4 text-center min-w-[200px] ${
          cadDetected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${cadDetected ? 'text-green-700' : 'text-gray-400'}`}>
            {cadDetected ? `${cadLabel} 已连接` : `${cadLabel} 未连接`}
          </div>
          {docInfo && (
            <div className="text-xs text-gray-500 mt-1">{docInfo.name} ({docInfo.type})</div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 text-sm"
        >
          {detecting ? '检测中...' : `检测 ${cadLabel}`}
        </button>

        {cadDetected && (
          <button
            onClick={handleLoadAssembly}
            disabled={loadingTree}
            className="px-6 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:bg-gray-300 text-sm"
          >
            {loadingTree ? '读取中...' : '读取装配结构'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```powershell
git add frontend/src/components/CADWorkspace/CADConnectStep.tsx
git commit -m "feat: CADConnectStep 文案随 CAD 类型适配（CATIA/SolidWorks）"
```

---

## 验证清单

全部任务完成后：

```powershell
# 1. 类型检查
cd frontend; npx tsc --noEmit

# 2. 构建前端
cd frontend; npm run build

# 3. 部署
docker-compose up -d --force-recreate nginx

# 4. 手动功能验证
# - 启动 cad_bridge: python -m cad_bridge
# - 启动 SolidWorks，打开一个装配体
# - 浏览器打开 PDM，零部件管理 → CAD入口 → 选择 SolidWorks
# - 验证 检测、读装配树、属性编辑、STP/PDF 导出上传
```
