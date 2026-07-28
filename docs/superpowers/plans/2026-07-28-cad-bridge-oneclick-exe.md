# CAD 桥接程序一键封装实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 cad_bridge 封装为单个 `cad_bridge.exe`，双击即可启动，无需安装 Python

**Architecture:** 新建 `launcher.py` 作为 PyInstaller 打包入口，修改 `catia/client.py` 和 `solidworks/client.py` 支持 exe 同目录外部配置文件覆盖，使用 `pyinstaller --onefile` 打包产出 `cad_bridge/dist/cad_bridge.exe`

**Tech Stack:** Python 3.10+, PyInstaller 6.x, pywin32, websockets, httpx

## Global Constraints

- 仅 Windows 平台（COM 接口限制）
- 产物路径: `cad_bridge/dist/cad_bridge.exe`
- 配置文件放在 exe 同目录外部可编辑，优先级：外部 > 内置
- 保持 `python -m cad_bridge` 命令行方式不变
- exe 控制台窗口模式（--console）
- 监听地址固定 `127.0.0.1:9527`

---

### Task 1: 修改 `catia/client.py` —— 支持外部映射文件

**Files:**
- Modify: `cad_bridge/catia/client.py`

**Interfaces:**
- Consumes: 无
- Produces: `CATIAClient.__init__` 在 PyInstaller 打包后优先读取 exe 同目录 `catia/field_mapping.json`

- [ ] **Step 1: 在文件顶部添加 `import sys`**

当前第 2 行是 `import os`，在其后增加一行：

```python
import sys
```

- [ ] **Step 2: 修改 `__init__` 方法（第 14-17 行），增加外部映射文件解析**

将 `__init__` 方法（第 14-17 行）替换为：

```python
    def __init__(self, mapping_path: str = None):
        if mapping_path is None:
            mapping_path = os.path.join(os.path.dirname(__file__), "field_mapping.json")
        # PyInstaller 打包后：优先使用 exe 同目录的外部映射文件
        if getattr(sys, 'frozen', False):
            external = os.path.join(os.path.dirname(sys.executable), 'catia', 'field_mapping.json')
            if os.path.isfile(external):
                mapping_path = external
                logger.info(f"CATIA 使用外部映射文件: {external}")
        self.mapping = self._load_mapping(mapping_path)
```

- [ ] **Step 3: Commit**

```bash
git add cad_bridge/catia/client.py
git commit -m "feat: CATIAClient 支持 exe 同目录外部映射文件覆盖"
```

---

### Task 2: 修改 `solidworks/client.py` —— 支持外部映射文件

**Files:**
- Modify: `cad_bridge/solidworks/client.py`

**Interfaces:**
- Consumes: 无
- Produces: `SolidWorksClient.__init__` 在 PyInstaller 打包后优先读取 exe 同目录 `solidworks/field_mapping.json`

- [ ] **Step 1: 在文件顶部添加 `import sys`**

当前第 2 行是 `import os`，在其后增加一行：

```python
import sys
```

- [ ] **Step 2: 修改 `__init__` 方法（第 15-18 行），增加外部映射文件解析**

将 `__init__` 方法（第 15-18 行）替换为：

```python
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
```

- [ ] **Step 3: Commit**

```bash
git add cad_bridge/solidworks/client.py
git commit -m "feat: SolidWorksClient 支持 exe 同目录外部映射文件覆盖"
```

---

### Task 3: 修改 `cad_bridge/__main__.py` —— 开发模式也支持外部 .env

**Files:**
- Modify: `cad_bridge/__main__.py`

**Interfaces:**
- Consumes: 无
- Produces: `_load_dotenv()` 在 PyInstaller 打包后也读取 exe 同目录的 `.env`

- [ ] **Step 1: 修改 `_load_dotenv` 函数（第 17-33 行），增加 exe 目录的 .env 加载**

将 `_load_dotenv` 函数替换为：

```python
def _load_dotenv():
    """加载 .env 文件，优先级：exe同目录 > cad_bridge 目录 > 系统环境变量"""
    # PyInstaller 打包后：exe 同目录的 .env
    if getattr(sys, 'frozen', False):
        env_file = os.path.join(os.path.dirname(sys.executable), '.env')
        if os.path.isfile(env_file):
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' not in line:
                        continue
                    key, val = line.split('=', 1)
                    key = key.strip()
                    val = val.strip()
                    if key:
                        os.environ.setdefault(key, val)
            return

    # 开发模式：cad_bridge 目录下的 .env
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if not os.path.isfile(env_file):
        return
    with open(env_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            key, val = line.split('=', 1)
            key = key.strip()
            val = val.strip()
            if key:
                os.environ.setdefault(key, val)
```

- [ ] **Step 2: Commit**

```bash
git add cad_bridge/__main__.py
git commit -m "feat: __main__ 支持 PyInstaller 打包后读取 exe 同目录 .env"
```

---

### Task 4: 创建 `cad_bridge/launcher.py` —— PyInstaller 打包入口

**Files:**
- Create: `cad_bridge/launcher.py`

**Interfaces:**
- Consumes: `cad_bridge.server.BridgeServer`, `cad_bridge.pdm_client.PDMClient`, `cad_bridge.catia.client.CATIAClient`, `cad_bridge.solidworks.client.SolidWorksClient`
- Produces: `main()` 函数，作为 PyInstaller 入口，处理 `sys._MEIPASS` 资源路径

`launcher.py` 与 `__main__.py` 的主要差异：
1. `sys._MEIPASS` 环境下通过 `--add-data` 内嵌的 `.env` 和 `field_mapping.json` 作为回退数据源
2. CATIA/SolidWorks 客户端实例化时传入解析后的外部映射路径

- [ ] **Step 1: 编写 `cad_bridge/launcher.py`**

```python
"""CAD 桥接服务 PyInstaller 打包入口
用于生成 cad_bridge.exe，双击启动。
与 __main__.py 的差异：支持 sys._MEIPASS（PyInstaller 临时解压目录）下的内置资源回退。
"""
import sys
import os
import asyncio
import logging
import argparse

from cad_bridge.server import BridgeServer
from cad_bridge.pdm_client import PDMClient
from cad_bridge.catia.client import CATIAClient
from cad_bridge.solidworks.client import SolidWorksClient


def _get_exe_dir():
    """获取 exe 所在目录（开发时返回 launcher.py 所在目录）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _load_dotenv():
    """加载 .env 文件，优先级：exe同目录 > MEIPASS内置 > 系统环境变量"""
    env_file = None
    if getattr(sys, 'frozen', False):
        env_file = os.path.join(_get_exe_dir(), '.env')
        if not os.path.isfile(env_file):
            env_file = os.path.join(sys._MEIPASS, '.env')
    else:
        env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')

    if env_file and os.path.isfile(env_file):
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' not in line:
                    continue
                key, val = line.split('=', 1)
                key = key.strip()
                val = val.strip()
                if key:
                    os.environ.setdefault(key, val)


def _resolve_mapping_path(cad_type: str) -> str:
    """解析 field_mapping.json 路径，优先级：exe同目录 > MEIPASS内置"""
    relative = os.path.join(cad_type, 'field_mapping.json')
    if getattr(sys, 'frozen', False):
        external = os.path.join(_get_exe_dir(), relative)
        if os.path.isfile(external):
            return external
        internal = os.path.join(sys._MEIPASS, relative)
        if os.path.isfile(internal):
            return internal
    return os.path.join(os.path.dirname(__file__), relative)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("cad_bridge")


def register_handlers(server: BridgeServer, pdm_client: PDMClient,
                      catia_client: CATIAClient, sw_client: SolidWorksClient):
    """注册所有 JSON-RPC 方法处理器（与 __main__.py 完全一致）"""

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
        if params.get("include_drawing"):
            base, _ = os.path.splitext(file_path)
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


def main():
    _load_dotenv()
    parser = argparse.ArgumentParser(description="CAD 桥接服务")
    parser.add_argument("--port", type=int, default=9527, help="WebSocket 监听端口（默认 9527）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--pdm-url", type=str, default="",
                        help="PDM 后端地址（可选回退值；实际地址由浏览器前端动态提供）")
    args = parser.parse_args()

    pdm_client = PDMClient(base_url=args.pdm_url)
    server = BridgeServer(host=args.host, port=args.port)

    catia_client = CATIAClient(mapping_path=_resolve_mapping_path('catia'))
    sw_client = SolidWorksClient(mapping_path=_resolve_mapping_path('solidworks'))
    register_handlers(server, pdm_client, catia_client, sw_client)

    logger.info(f"CAD 桥接服务启动中...")
    logger.info(f"  WebSocket: ws://{args.host}:{args.port}")
    logger.info(f"  EXE 目录: {_get_exe_dir()}")
    if args.pdm_url:
        logger.info(f"  PDM 后端（回退值）: {args.pdm_url}")
    else:
        logger.info(f"  PDM 地址由浏览器前端动态提供（无需手动指定）")

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("服务已停止")
    except Exception as e:
        logger.error(f"服务异常退出: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add cad_bridge/launcher.py
git commit -m "feat: 创建 launcher.py 作为 PyInstaller 打包入口"
```

---

### Task 5: 创建 `cad_bridge/build_exe.py` —— 打包脚本

**Files:**
- Create: `cad_bridge/build_exe.py`

**Interfaces:**
- Consumes: PyInstaller 已安装 (`pip install pyinstaller`)
- Produces: `cad_bridge/dist/cad_bridge.exe`

- [ ] **Step 1: 编写 `cad_bridge/build_exe.py`**

```python
"""CAD 桥接程序打包脚本
用法: cd cad_bridge && python build_exe.py
产物: dist/cad_bridge.exe
"""
import subprocess
import sys
import os


def build():
    workdir = os.path.dirname(os.path.abspath(__file__))

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--console",
        "--name", "cad_bridge",
        "--add-data", os.path.join(workdir, ".env") + ";.",
        "--add-data", os.path.join(workdir, "catia", "field_mapping.json") + ";catia",
        "--add-data", os.path.join(workdir, "solidworks", "field_mapping.json") + ";solidworks",
        "--hidden-import", "win32com.client",
        "--hidden-import", "win32com.client.dynamic",
        "--hidden-import", "pythoncom",
        "--exclude-module", "tkinter",
        "--distpath", os.path.join(workdir, "dist"),
        "--workpath", os.path.join(workdir, "build"),
        os.path.join(workdir, "launcher.py"),
    ]

    print("=" * 60)
    print("开始打包 CAD 桥接程序...")
    print("=" * 60)
    result = subprocess.run(cmd, cwd=workdir)
    if result.returncode == 0:
        exe_path = os.path.join(workdir, "dist", "cad_bridge.exe")
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print(f"\n打包成功: {exe_path} ({size_mb:.1f} MB)")
    else:
        print(f"\n打包失败，退出码: {result.returncode}")
        sys.exit(result.returncode)


if __name__ == "__main__":
    build()
```

- [ ] **Step 2: Commit**

```bash
git add cad_bridge/build_exe.py
git commit -m "feat: 创建 build_exe.py 打包脚本"
```

---

### Task 6: 安装 PyInstaller 并打包

**Files:**
- 产物: `cad_bridge/dist/cad_bridge.exe`

- [ ] **Step 1: 安装 PyInstaller**

```powershell
pip install pyinstaller
```

- [ ] **Step 2: 执行打包**

```powershell
cd cad_bridge
python build_exe.py
```

期望输出：`打包成功: cad_bridge/dist/cad_bridge.exe (XX.X MB)`

- [ ] **Step 3: 验证产物存在**

```powershell
Test-Path -LiteralPath "cad_bridge/dist/cad_bridge.exe"
```

期望输出：`True`

- [ ] **Step 4: Commit .gitignore（可选：忽略 build/dist 目录）**

确认 `cad_bridge/.gitignore` 包含：

```
build/
dist/
*.spec
```

如不存在则创建 `cad_bridge/.gitignore`：

```bash
git add cad_bridge/.gitignore
git commit -m "chore: 添加 cad_bridge .gitignore 忽略 build/dist"
```
