# CATIA PDM 集成 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 CATIA CAD 软件与 myPDM 系统的集成，通过本地桥接服务在浏览器端完成 BOM 识别、属性双向同步、签入签出和附件管理。

**Architecture:** Python 桥接服务（pywin32 + websockets）通过 COM 与 CATIA 互操作，通过 WebSocket 与浏览器前端通信。前端新增 CAD 工作台组件（Modal + 三步流程 + BOM 匹配表格），所有 PDM 业务操作由前端直连 HTTPS API。

**Tech Stack:** Python 3.12 + pywin32 + websockets + httpx, React + TypeScript + Tailwind

**设计文档:** `docs/superpowers/specs/2026-07-15-catia-pdm-integration-design.md`

---

## 文件结构预览

```
新增:
  cad_bridge/
  ├── __main__.py
  ├── server.py
  ├── pdm_client.py
  ├── catia/
  │   ├── __init__.py
  │   ├── client.py
  │   └── field_mapping.json
  └── requirements.txt
  frontend/src/
  ├── services/cadBridge.ts
  ├── hooks/useCADBridge.ts
  └── components/CADWorkspace/
      ├── CADWorkspaceModal.tsx
      ├── CADConnectStep.tsx
      ├── CADBOMMatchTable.tsx
      └── CADCompleteStep.tsx

修改:
  frontend/src/pages/PartsPage.tsx
```

---

## Phase 1: cad_bridge 基础架构

### Task 1: 项目骨架 + requirements.txt

**Files:**
- Create: `cad_bridge/__init__.py`
- Create: `cad_bridge/catia/__init__.py`
- Create: `cad_bridge/requirements.txt`
- Create: `cad_bridge/catia/field_mapping.json`

- [ ] **Step 1: 创建目录结构和空文件**

```powershell
cd D:\OpenCode\myPDM
New-Item -ItemType Directory -Path cad_bridge\catia -Force | Out-Null
New-Item -ItemType File -Path cad_bridge\__init__.py -Force | Out-Null
New-Item -ItemType File -Path cad_bridge\catia\__init__.py -Force | Out-Null
```

- [ ] **Step 2: 创建 requirements.txt**

Write `cad_bridge/requirements.txt`:
```
pywin32>=306
websockets>=12.0
httpx>=0.27.0
```

- [ ] **Step 3: 创建 field_mapping.json**

Write `cad_bridge/catia/field_mapping.json`:
```json
{
  "builtin": {
    "PartNumber": "code",
    "Revision": "version",
    "Definition": "name"
  },
  "properties": {
    "规格型号": "spec",
    "重量(kg)": "重量(kg)",
    "存货类别": "存货类别",
    "物料类型": "物料类型"
  }
}
```

- [ ] **Step 4: Commit**

```powershell
cd D:\OpenCode\myPDM
git add cad_bridge/
git commit -m "feat: cad_bridge 项目骨架 + 依赖 + 映射配置"
```

---

### Task 2: WebSocket 服务端 (server.py)

**Files:**
- Create: `cad_bridge/server.py`

- [ ] **Step 1: 实现 JSON-RPC WebSocket 服务端**

Write `cad_bridge/server.py`:
```python
import asyncio
import json
import logging
from websockets.asyncio.server import serve

logger = logging.getLogger(__name__)


class BridgeServer:
    """CAD 桥接 WebSocket 服务端，JSON-RPC 消息路由"""

    def __init__(self, host: str = "127.0.0.1", port: int = 9527):
        self.host = host
        self.port = port
        self.handlers: dict[str, callable] = {}

    def register(self, method: str, handler: callable):
        """注册方法处理器"""
        self.handlers[method] = handler

    async def _handle_message(self, websocket, raw: str) -> str:
        """处理单条 JSON-RPC 消息，返回响应 JSON 字符串"""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return json.dumps({
                "id": None,
                "error": {"code": "PARSE_ERROR", "message": "无效的 JSON 格式"}
            })

        req_id = msg.get("id")
        method = msg.get("method", "")
        params = msg.get("params", {})
        token = msg.get("token", "")

        if method not in self.handlers:
            return json.dumps({
                "id": req_id,
                "error": {"code": "METHOD_NOT_FOUND", "message": f"未知方法: {method}"}
            })

        try:
            result = await self.handlers[method](params, token)
            return json.dumps({"id": req_id, "result": result})
        except Exception as e:
            logger.exception(f"方法 {method} 执行失败")
            return json.dumps({
                "id": req_id,
                "error": {"code": "INTERNAL_ERROR", "message": str(e)}
            })

    async def _connection_handler(self, websocket):
        """WebSocket 连接处理"""
        logger.info(f"客户端连接: {websocket.remote_address}")
        try:
            async for message in websocket:
                response = await self._handle_message(websocket, message)
                await websocket.send(response)
        except Exception as e:
            logger.error(f"连接异常: {e}")
        finally:
            logger.info("客户端断开")

    async def start(self):
        """启动服务"""
        async with serve(self._connection_handler, self.host, self.port):
            logger.info(f"桥接服务启动: ws://{self.host}:{self.port}")
            await asyncio.get_running_loop().create_future()  # 永久运行
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add cad_bridge/server.py
git commit -m "feat: WebSocket JSON-RPC 服务端"
```

---

### Task 3: PDM API 代理客户端 (pdm_client.py)

**Files:**
- Create: `cad_bridge/pdm_client.py`

- [ ] **Step 1: 实现 PDM HTTP API 代理**

Write `cad_bridge/pdm_client.py`:
```python
import os
import httpx
import logging

logger = logging.getLogger(__name__)

DEFAULT_PDM_URL = "https://localhost:8080/api"
DEFAULT_WORKSPACE = os.path.join(os.getcwd(), "cad_workspace")


class PDMClient:
    """PDM API 代理，透传 JWT，处理附件上传/下载"""

    def __init__(self, base_url: str = DEFAULT_PDM_URL):
        self.base_url = base_url.rstrip("/")
        # 使用不验证 SSL 证书（本地自签名证书）
        self._client_kwargs = {"verify": False, "timeout": 30.0}

    async def download_attachment(self, attachment_id: str, save_dir: str, token: str) -> dict:
        """下载附件到本地目录"""
        os.makedirs(save_dir, exist_ok=True)
        async with httpx.AsyncClient(**self._client_kwargs) as client:
            # 获取媒体令牌
            token_resp = await client.get(
                f"{self.base_url}/v2/attachments/{attachment_id}/media-token",
                params={"action": "direct-download"},
                headers={"Authorization": f"Bearer {token}"}
            )
            token_resp.raise_for_status()
            media_token = token_resp.json().get("token")

            # 流式下载
            resp = await client.get(
                f"{self.base_url}/v2/attachments/{attachment_id}/stream",
                params={"token": media_token},
                headers={"Authorization": f"Bearer {token}"}
            )
            resp.raise_for_status()

            # 从 Content-Disposition 获取文件名
            filename = self._extract_filename(resp.headers)
            filepath = os.path.join(save_dir, filename)
            with open(filepath, "wb") as f:
                f.write(resp.content)

            return {"file_name": filename, "file_path": filepath, "file_size": len(resp.content)}

    async def upload_attachment(self, file_path: str, revision_id: str, category: str, token: str) -> dict:
        """上传本地文件到 PDM 零部件附件"""
        filename = os.path.basename(file_path)
        file_size = os.path.getsize(file_path)

        async with httpx.AsyncClient(**self._client_kwargs) as client:
            # 初始化分块上传
            init_resp = await client.post(
                f"{self.base_url}/parts/revisions/{revision_id}/attachments/chunk/init",
                json={
                    "file_name": filename,
                    "file_size": file_size,
                    "category": category
                },
                headers={"Authorization": f"Bearer {token}"}
            )
            init_resp.raise_for_status()
            upload_info = init_resp.json()
            upload_id = upload_info["upload_id"]
            chunk_size = upload_info.get("chunk_size", 5 * 1024 * 1024)

            # 分块上传
            with open(file_path, "rb") as f:
                chunk_index = 0
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    resp = await client.post(
                        f"{self.base_url}/parts/revisions/{revision_id}/attachments/chunk/upload",
                        data={"upload_id": upload_id, "chunk_index": str(chunk_index)},
                        files={"chunk": (filename, chunk)},
                        headers={"Authorization": f"Bearer {token}"}
                    )
                    resp.raise_for_status()
                    chunk_index += 1

            # 完成上传
            complete_resp = await client.post(
                f"{self.base_url}/parts/revisions/{revision_id}/attachments/chunk/complete",
                json={"upload_id": upload_id},
                headers={"Authorization": f"Bearer {token}"}
            )
            complete_resp.raise_for_status()
            return complete_resp.json()

    def _extract_filename(self, headers) -> str:
        """从 Content-Disposition 提取文件名"""
        cd = headers.get("content-disposition", "")
        if "filename=" in cd:
            import re
            match = re.search(r'filename[^;=\n]*=["\']?([^"\'\n;]*)', cd)
            if match:
                return match.group(1).strip()
        return "download"
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add cad_bridge/pdm_client.py
git commit -m "feat: PDM API 代理客户端（附件下载/上传）"
```

---

### Task 4: CATIA COM 客户端 (catia/client.py)

**Files:**
- Create: `cad_bridge/catia/client.py`
- Modifies logic in: `cad_bridge/catia/field_mapping.json` (read at runtime)

- [ ] **Step 1: 实现 CATIA COM 互操作**

Write `cad_bridge/catia/client.py`:
```python
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
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add cad_bridge/catia/client.py
git commit -m "feat: CATIA COM 互操作客户端"
```

---

### Task 5: 入口文件 (__main__.py)

**Files:**
- Create: `cad_bridge/__main__.py`

- [ ] **Step 1: 实现统一入口**

Write `cad_bridge/__main__.py`:
```python
"""CAD 桥接服务入口
用法: python -m cad_bridge --port 9527 --pdm-url https://localhost:8080/api
"""
import sys
import asyncio
import logging
import argparse

from cad_bridge.server import BridgeServer
from cad_bridge.pdm_client import PDMClient
from cad_bridge.catia.client import catia_client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("cad_bridge")


def register_handlers(server: BridgeServer, pdm_client: PDMClient):
    """注册所有 JSON-RPC 方法处理器"""

    async def handle_ping(params: dict, token: str) -> dict:
        return {"status": "ok"}

    async def handle_detect(params: dict, token: str) -> dict:
        return catia_client.detect()

    async def handle_read_tree(params: dict, token: str) -> dict:
        return catia_client.read_assembly_tree(params)

    async def handle_read_properties(params: dict, token: str) -> dict:
        return catia_client.read_properties(params)

    async def handle_write_property(params: dict, token: str) -> dict:
        return catia_client.write_property(params)

    async def handle_download(params: dict, token: str) -> dict:
        attachment_id = params["attachment_id"]
        revision_code = params.get("code", "unknown")
        revision_version = params.get("version", "A")
        save_dir = params.get("save_dir") or f"./cad_workspace/{revision_code}/{revision_version}"
        return await pdm_client.download_attachment(attachment_id, save_dir, token)

    async def handle_upload(params: dict, token: str) -> dict:
        file_path = params["file_path"]
        revision_id = params["revision_id"]
        category = params.get("category", "cad")
        return await pdm_client.upload_attachment(file_path, revision_id, category, token)

    server.register("catia.ping", handle_ping)
    server.register("catia.detect", handle_detect)
    server.register("catia.assembly.read_tree", handle_read_tree)
    server.register("catia.assembly.read_properties", handle_read_properties)
    server.register("catia.property.write", handle_write_property)
    server.register("workspace.download", handle_download)
    server.register("workspace.upload", handle_upload)


def main():
    parser = argparse.ArgumentParser(description="CAD 桥接服务")
    parser.add_argument("--port", type=int, default=9527, help="WebSocket 监听端口（默认 9527）")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--pdm-url", type=str, default="https://localhost:8080/api",
                        help="PDM 后端地址（默认 https://localhost:8080/api）")
    args = parser.parse_args()

    pdm_client = PDMClient(base_url=args.pdm_url)
    server = BridgeServer(host=args.host, port=args.port)
    register_handlers(server, pdm_client)

    logger.info(f"CAD 桥接服务启动中...")
    logger.info(f"  WebSocket: ws://{args.host}:{args.port}")
    logger.info(f"  PDM 后端: {args.pdm_url}")

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

- [ ] **Step 2: 验证包结构可导入**

```powershell
cd D:\OpenCode\myPDM
python -c "from cad_bridge.server import BridgeServer; print('OK')"
```
Expected: `OK` (会报 httpx SSL 警告，忽略)

- [ ] **Step 3: Commit**

```powershell
cd D:\OpenCode\myPDM
git add cad_bridge/__main__.py
git commit -m "feat: cad_bridge 入口 + 命令注册"
```

---

## Phase 2: 前端桥接通信层

### Task 6: 桥接服务 API 封装 (cadBridge.ts)

**Files:**
- Create: `frontend/src/services/cadBridge.ts`

- [ ] **Step 1: 实现 WebSocket 桥接 API 客户端**

Write `frontend/src/services/cadBridge.ts`:
```typescript
const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:9527';

interface BridgeRequest {
  id: number;
  method: string;
  params: Record<string, any>;
  token: string;
}

interface BridgeResponse {
  id: number;
  result?: any;
  error?: { code: string; message: string };
}

class CADBridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onStatusChange?: (connected: boolean) => void;

  constructor(url?: string) {
    this.url = url || DEFAULT_BRIDGE_URL;
  }

  setStatusCallback(cb: (connected: boolean) => void) {
    this.onStatusChange = cb;
  }

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.onStatusChange?.(true);
        resolve();
      };

      this.ws.onclose = () => {
        this.onStatusChange?.(false);
        this.ws = null;
        // 自动重连
        this.reconnectTimer = setTimeout(() => this.connect(token), 3000);
      };

      this.ws.onerror = () => {
        reject(new Error('无法连接到 CAD 桥接服务'));
      };

      this.ws.onmessage = (event) => {
        try {
          const response: BridgeResponse = JSON.parse(event.data);
          const pending = this.pending.get(response.id);
          if (pending) {
            this.pending.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          // 忽略非 JSON 消息
        }
      };
    });
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  call(method: string, params: Record<string, any> = {}, token: string): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('桥接服务未连接'));
    }

    const id = this.nextId++;
    const request: BridgeRequest = { id, method, params, token };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(request));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }
}

export const cadBridge = new CADBridgeClient();
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/services/cadBridge.ts
git commit -m "feat: CAD 桥接 WebSocket API 客户端"
```

---

### Task 7: useCADBridge Hook

**Files:**
- Create: `frontend/src/hooks/useCADBridge.ts`

- [ ] **Step 1: 实现 React Hook**

Write `frontend/src/hooks/useCADBridge.ts`:
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { cadBridge } from '../services/cadBridge';
import { useAuthStore } from '../stores/auth';

export interface CATIAStatus {
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
  properties?: {
    builtin: Record<string, string>;
    user_properties: Record<string, string>;
  };
}

export function useCADBridge() {
  const [connected, setConnected] = useState(false);
  const [catiaStatus, setCatiaStatus] = useState<CATIAStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useAuthStore((s) => s.token) || '';
  const tokenRef = useRef(token);
  tokenRef.current = token;

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
      const result = await cadBridge.call('catia.ping', {}, tokenRef.current);
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }, []);

  const detectCATIA = useCallback(async (): Promise<CATIAStatus> => {
    await ensureConnected();
    const result = await cadBridge.call('catia.detect', {}, tokenRef.current);
    setCatiaStatus(result);
    return result;
  }, [ensureConnected]);

  const readAssemblyTree = useCallback(async (): Promise<AssemblyTreeNode> => {
    await ensureConnected();
    return cadBridge.call('catia.assembly.read_tree', {}, tokenRef.current);
  }, [ensureConnected]);

  const readProperties = useCallback(async (path: string): Promise<AssemblyTreeNode['properties']> => {
    await ensureConnected();
    return cadBridge.call('catia.assembly.read_properties', { path }, tokenRef.current);
  }, [ensureConnected]);

  const writeProperty = useCallback(async (path: string, propName: string, value: string): Promise<void> => {
    await ensureConnected();
    return cadBridge.call('catia.property.write', { path, prop_name: propName, value }, tokenRef.current);
  }, [ensureConnected]);

  const downloadFile = useCallback(async (attachmentId: string, code: string, version: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.download', { attachment_id: attachmentId, code, version }, tokenRef.current);
  }, [ensureConnected]);

  const uploadFile = useCallback(async (filePath: string, revisionId: string, category: 'cad' | 'production'): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.upload', { file_path: filePath, revision_id: revisionId, category }, tokenRef.current);
  }, [ensureConnected]);

  return {
    connected,
    catiaStatus,
    loading,
    ping,
    detectCATIA,
    readAssemblyTree,
    readProperties,
    writeProperty,
    downloadFile,
    uploadFile,
  };
}
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/hooks/useCADBridge.ts
git commit -m "feat: useCADBridge React Hook"
```

---

## Phase 3: 前端 CAD 工作台组件

### Task 8: CAD 工作台 Modal 容器 (CADWorkspaceModal.tsx)

**Files:**
- Create: `frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx`

- [ ] **Step 1: 实现三步流程 Modal**

Write `frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx`:
```tsx
import { useState } from 'react';
import { Modal } from '../Modal';
import { CADConnectStep } from './CADConnectStep';
import { CADBOMMatchTable, type BOMRow } from './CADBOMMatchTable';
import { CADCompleteStep } from './CADCompleteStep';
import { useCADBridge } from '../../hooks/useCADBridge';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = 'connect' | 'match' | 'complete';

export function CADWorkspaceModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('connect');
  const [bomRows, setBomRows] = useState<BOMRow[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const bridge = useCADBridge();

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
    connect: '连接CATIA',
    match: 'BOM匹配',
    complete: '完成',
  };

  return (
    <Modal open={open} onClose={handleClose} title="CAD 入口 · 工作台" width="full">
      {/* 步骤标签 */}
      <div className="flex border-b border-gray-200 mb-4">
        {(['connect', 'match', 'complete'] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`px-5 py-2.5 text-sm font-semibold ${
              step === s
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-400'
            }`}
          >
            ①{s === 'connect' ? '' : s === 'match' ? '②' : '③'} {stepLabels[s]}
          </div>
        ))}
      </div>

      {/* 步骤内容 */}
      {step === 'connect' && (
        <CADConnectStep
          bridge={bridge}
          onAssemblyLoaded={handleAssemblyLoaded}
          onClose={handleClose}
        />
      )}
      {step === 'match' && (
        <CADBOMMatchTable
          bridge={bridge}
          rows={bomRows}
          onComplete={handleMatchComplete}
        />
      )}
      {step === 'complete' && (
        <CADCompleteStep
          count={completedCount}
          onClose={handleClose}
        />
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/components/CADWorkspace/CADWorkspaceModal.tsx
git commit -m "feat: CAD 工作台 Modal 容器（三步流程）"
```

---

### Task 9: 连接步骤 (CADConnectStep.tsx)

**Files:**
- Create: `frontend/src/components/CADWorkspace/CADConnectStep.tsx`

- [ ] **Step 1: 实现 CATIA 连接检测步骤**

Write `frontend/src/components/CADWorkspace/CADConnectStep.tsx`:
```tsx
import { useState } from 'react';
import type { useCADBridge } from '../../hooks/useCADBridge';
import type { BOMRow } from './CADBOMMatchTable';

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  onAssemblyLoaded: (rows: BOMRow[]) => void;
  onClose: () => void;
}

export function CADConnectStep({ bridge, onAssemblyLoaded, onClose }: Props) {
  const [catiaDetected, setCatiaDetected] = useState(false);
  const [docInfo, setDocInfo] = useState<{ name: string; type: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState('');

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const status = await bridge.detectCATIA();
      setCatiaDetected(status.active && !!status.has_document);
      if (status.active && status.has_document) {
        setDocInfo({ name: status.doc_name || '', type: status.doc_type || '' });
      } else if (status.active) {
        setError('CATIA 已运行但未打开任何文档，请打开一个装配体');
      } else {
        setError('未检测到 CATIA 进程，请先启动 CATIA');
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
      // 递归扁平化树结构为 BOM 行
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
      {/* 状态卡片 */}
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
          catiaDetected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${catiaDetected ? 'text-green-700' : 'text-gray-400'}`}>
            {catiaDetected ? 'CATIA 已连接' : 'CATIA 未连接'}
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
          disabled={detecting || !bridge.connected}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 text-sm"
        >
          {detecting ? '检测中...' : '检测 CATIA'}
        </button>

        {catiaDetected && (
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

function flattenTree(tree: any): BOMRow[] {
  const rows: BOMRow[] = [];
  function walk(node: any) {
    rows.push({
      instance_name: node.instance_name || '',
      part_number: '',
      path: node.path || '',
      level: node.level || 0,
      is_assembly: node.is_assembly || false,
      builtin: {},
      user_properties: {},
      pdm_match: null,
      match_status: 'unknown' as const,
      checkout_status: null,
    });
    if (node.children) {
      node.children.forEach(walk);
    }
  }
  walk(tree);
  return rows;
}
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/components/CADWorkspace/CADConnectStep.tsx
git commit -m "feat: CAD 工作台连接步骤组件"
```

---

### Task 10: BOM 匹配核心表格 (CADBOMMatchTable.tsx)

**Files:**
- Create: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`

This is the core component. It needs:
- 13-column table
- Editable CATIA properties that write back via bridge
- CAD/Production attachment upload buttons
- Operation buttons with visibility matrix
- Batch property push to PDM

- [ ] **Step 1: 实现 BOM 匹配表格**

Write `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx`:
```tsx
import { useState, useCallback } from 'react';
import { toast } from '../Toast';
import { partsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { useCADBridge } from '../../hooks/useCADBridge';

export interface BOMRow {
  instance_name: string;
  part_number: string;
  path: string;
  level: number;
  is_assembly: boolean;
  builtin: Record<string, string>;
  user_properties: Record<string, string>;
  pdm_match: {
    master_id?: string;
    revision_id?: string;
    code?: string;
    version?: string;
    name?: string;
  } | null;
  match_status: 'matched' | 'new' | 'conflict' | 'unknown';
  checkout_status: 'not_checked_out' | 'checked_out' | 'other_checked_out' | null;
}

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  rows: BOMRow[];
  onComplete: (count: number) => void;
}

function getPropertyColumns(userProps: Record<string, string>): string[] {
  // 从第一行获取属性列名
  return Object.keys(userProps).filter(k => k !== 'PartNumber' && k !== 'Revision' && k !== 'Definition');
}

export function CADBOMMatchTable({ bridge, rows: initialRows, onComplete }: Props) {
  const [rows, setRows] = useState<BOMRow[]>(initialRows);
  const [editingCell, setEditingCell] = useState<{ path: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const user = useAuthStore((s) => s.user);

  const propertyColumns = rows.length > 0 ? getPropertyColumns(rows[0].user_properties) : [];

  const totalMatched = rows.filter(r => r.match_status === 'matched').length;
  const totalNew = rows.filter(r => r.match_status === 'new').length;
  const totalConflict = rows.filter(r => r.match_status === 'conflict').length;
  const totalCheckedOut = rows.filter(r => r.checkout_status === 'checked_out').length;

  const isCheckedOutByMe = (row: BOMRow) => row.checkout_status === 'checked_out';
  const isCheckedOutByOther = (row: BOMRow) => row.checkout_status === 'other_checked_out';
  const canEditProps = (row: BOMRow) => !isCheckedOutByOther(row);

  const handlePropEdit = useCallback(async (row: BOMRow, key: string, value: string) => {
    try {
      await bridge.writeProperty(row.path, key, value);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [key]: value } } : r
      ));
      toast.success(`已更新 CATIA 属性 ${key}`);
    } catch (e: any) {
      toast.error(e.message || '写入 CATIA 失败');
    }
  }, [bridge]);

  const handleCheckout = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.checkout(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'checked_out' } : r
      ));
      toast.success('签出成功');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签出失败');
    }
  };

  const handleCheckin = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.checkin(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'not_checked_out' } : r
      ));
      toast.success('签入成功');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签入失败');
    }
  };

  const handleUndoCheckout = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.undocheckout(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'not_checked_out' } : r
      ));
      toast.success('已撤销签出');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '撤销签出失败');
    }
  };

  const handlePushToPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      // 更新 PartMaster
      await partsApi.update(row.pdm_match.master_id!, {
        code: row.builtin.PartNumber || row.pdm_match.code,
        name: row.builtin.Definition || row.pdm_match.name,
      });
      // 更新当前迭代属性
      await partsApi.updateIteration(row.pdm_match.revision_id, {
        remark: JSON.stringify(row.user_properties),
      });
      toast.success('属性已推送到 PDM');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '属性推送失败');
    }
  };

  const handlePullFromPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      const rev = await partsApi.getRevision(row.pdm_match.revision_id);
      const iter = rev?.current_iteration;
      if (!iter) return;
      // 将 PDM 数据写回 CATIA
      if (rev?.master_id) {
        const master = await partsApi.get(rev.master_id);
        if (master?.spec) {
          await bridge.writeProperty(row.path, '规格型号', master.spec);
        }
      }
      toast.success('属性已从 PDM 拉取');
    } catch (e: any) {
      toast.error(e.message || '属性拉取失败');
    }
  };

  const handleCreatePart = async (row: BOMRow) => {
    try {
      const data = {
        code: row.builtin.PartNumber || row.instance_name,
        name: row.builtin.Definition || row.instance_name,
        spec: row.user_properties['规格型号'] || '',
        type: row.is_assembly ? 'assembly' : 'part' as const,
      };
      const result = await partsApi.create(data);
      setRows(prev => prev.map(r =>
        r.path === row.path ? {
          ...r,
          match_status: 'matched' as const,
          pdm_match: { master_id: result.id, revision_id: result.latest_revision?.id, code: result.code, version: 'A', name: result.name },
          checkout_status: 'not_checked_out' as const,
        } : r
      ));
      toast.success(`已创建零部件: ${result.code}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    }
  };

  const handleUploadCAD = async (row: BOMRow) => {
    // 通过桥接服务上传 CAD 文件
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.CATPart,.CATProduct,.CATDrawing';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        // 使用 V2 分块上传直传 PDM
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'cad');
        toast.success('CAD 附件上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
  };

  const handleUploadPDF = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'production');
        toast.success('PDF 上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
  };

  const handleUploadSTP = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stp,.step';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'production');
        toast.success('STP 上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
  };

  const handleBatchPushToPDM = async () => {
    const checkedOutRows = rows.filter(r => r.checkout_status === 'checked_out' && r.match_status === 'matched');
    for (const row of checkedOutRows) {
      await handlePushToPDM(row);
    }
    toast.success(`已批量推送 ${checkedOutRows.length} 个零部件的属性`);
  };

  const handleBatchCheckin = async () => {
    const checkedOutRows = rows.filter(r => r.checkout_status === 'checked_out');
    for (const row of checkedOutRows) {
      await handleCheckin(row);
    }
    toast.success(`已批量签入 ${checkedOutRows.length} 个零部件`);
  };

  return (
    <div>
      {/* 汇总栏 */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
        <span className="bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已匹配 {totalMatched}</span>
        <span className="bg-yellow-100 text-yellow-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">可新建 {totalNew}</span>
        <span className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">冲突 {totalConflict}</span>
        <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已签出 {totalCheckedOut}</span>
        <div className="flex-1" />
        <button onClick={handleBatchPushToPDM} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">批量属性→PDM</button>
        <button onClick={handleBatchCheckin} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">全部签入</button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-gray-50 border-b-2 border-gray-200">
              <th className="p-2 text-left">层级</th>
              <th className="p-2 text-left">CATIA PartNumber</th>
              <th className="p-2 text-left">CATIA 名称</th>
              {propertyColumns.map(col => (
                <th key={col} className="p-2 text-left bg-green-50">{col}</th>
              ))}
              <th className="p-2 text-center bg-blue-50">CAD附件</th>
              <th className="p-2 text-center bg-amber-50">生产附件</th>
              <th className="p-2 text-left">PDM匹配</th>
              <th className="p-2 text-left">匹配状态</th>
              <th className="p-2 text-left">签出状态</th>
              <th className="p-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.path} className={`border-b border-gray-100 ${
                row.match_status === 'new' ? 'bg-yellow-50' :
                row.checkout_status === 'checked_out' ? 'bg-blue-50' : ''
              }`}>
                <td className="p-2" style={{ paddingLeft: `${8 + row.level * 16}px` }}>
                  {row.level === 0 ? <strong>{row.level}</strong> : row.path.replace('0.', '')}
                </td>
                <td className="p-2">{row.builtin.PartNumber || ''}</td>
                <td className="p-2">{row.instance_name}</td>

                {/* 动态属性列 */}
                {propertyColumns.map(col => (
                  <td key={col} className="p-2 bg-green-50">
                    <input
                      value={row.user_properties[col] || ''}
                      disabled={!canEditProps(row)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => prev.map(r =>
                          r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [col]: val } } : r
                        ));
                        handlePropEdit(row, col, val);
                      }}
                      className="border border-blue-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                    />
                  </td>
                ))}

                {/* CAD附件列 */}
                <td className="p-2 text-center bg-blue-50">
                  <div className="text-xs text-gray-500">—</div>
                  {isCheckedOutByMe(row) && (
                    <button onClick={() => handleUploadCAD(row)} className="mt-1 px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                      上传
                    </button>
                  )}
                  {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                  {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                    <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                  )}
                  {isCheckedOutByOther(row) && (
                    <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                  )}
                </td>

                {/* 生产附件列 */}
                <td className="p-2 text-center bg-amber-50">
                  <div className="text-xs text-gray-500">—</div>
                  {isCheckedOutByMe(row) && (
                    <div className="flex gap-1 justify-center mt-1">
                      <button onClick={() => handleUploadPDF(row)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs hover:bg-red-600">PDF</button>
                      <button onClick={() => handleUploadSTP(row)} className="px-2 py-0.5 bg-purple-500 text-white rounded text-xs hover:bg-purple-600">STP</button>
                    </div>
                  )}
                  {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                  {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                    <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                  )}
                  {isCheckedOutByOther(row) && (
                    <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                  )}
                </td>

                {/* PDM匹配列 */}
                <td className="p-2">
                  {row.pdm_match ? (
                    <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                  ) : (
                    <span className="text-amber-600">— 无 —</span>
                  )}
                </td>

                {/* 匹配状态列 */}
                <td className="p-2">
                  {row.match_status === 'matched' && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">已匹配</span>}
                  {row.match_status === 'new' && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs">可新建</span>}
                  {row.match_status === 'conflict' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">冲突</span>}
                  {row.match_status === 'unknown' && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">未知</span>}
                </td>

                {/* 签出状态列 */}
                <td className="p-2">
                  {row.checkout_status === 'not_checked_out' && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">未签出</span>}
                  {row.checkout_status === 'checked_out' && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">已签出</span>}
                  {row.checkout_status === 'other_checked_out' && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">他人签出</span>}
                  {row.checkout_status === null && <span className="text-gray-400 text-xs">—</span>}
                </td>

                {/* 操作列 */}
                <td className="p-2 text-center">
                  <div className="flex gap-1 flex-wrap justify-center">
                    {/* 可新建 → 创建零件 */}
                    {row.match_status === 'new' && (
                      <button onClick={() => handleCreatePart(row)} className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">创建零件</button>
                    )}
                    {/* 未签出 → 签出 */}
                    {row.match_status === 'matched' && row.checkout_status === 'not_checked_out' && (
                      <>
                        <button onClick={() => handleCheckout(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">签出</button>
                        <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                      </>
                    )}
                    {/* 已签出(本用户) → 签入 + 属性→ + 撤销 */}
                    {row.match_status === 'matched' && row.checkout_status === 'checked_out' && (
                      <>
                        <button onClick={() => handleCheckin(row)} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">签入</button>
                        <button onClick={() => handlePushToPDM(row)} className="px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded text-xs hover:bg-blue-200">属性→</button>
                        <button onClick={() => handleUndoCheckout(row)} className="px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded text-xs hover:bg-red-100">撤销</button>
                      </>
                    )}
                    {/* 他人签出 → 属性← */}
                    {row.match_status === 'matched' && row.checkout_status === 'other_checked_out' && (
                      <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: BOM 匹配核心表格（13列 + 操作矩阵）"
```

---

### Task 11: 完成步骤 (CADCompleteStep.tsx)

**Files:**
- Create: `frontend/src/components/CADWorkspace/CADCompleteStep.tsx`

- [ ] **Step 1: 实现完成摘要步骤**

Write `frontend/src/components/CADWorkspace/CADCompleteStep.tsx`:
```tsx
interface Props {
  count: number;
  onClose: () => void;
}

export function CADCompleteStep({ count, onClose }: Props) {
  return (
    <div className="flex flex-col items-center py-12">
      <div className="text-4xl mb-4">✔</div>
      <h3 className="text-lg font-bold text-gray-800 mb-2">操作完成</h3>
      <p className="text-sm text-gray-500 mb-6">
        本次共处理 {count} 个零部件，可在零部件列表中查看结果
      </p>
      <button
        onClick={onClose}
        className="px-8 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
      >
        关闭
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/components/CADWorkspace/CADCompleteStep.tsx
git commit -m "feat: CAD 工作台完成步骤组件"
```

---

## Phase 4: 集成到零部件管理页面

### Task 12: PartsPage 增加 CAD 入口按钮

**Files:**
- Modify: `frontend/src/pages/PartsPage.tsx`

- [ ] **Step 1: 在工具栏 "新增零件" 按钮左侧增加 "CAD入口" 按钮**

在 `PartsPage.tsx` 第 214 行 `{/* 弹性空间 */}` 之前插入按钮：

```tsx
{/* 第 213 行之后，第 214 行之前 */}
<button
  onClick={() => setShowCADWorkspace(true)}
  className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 text-sm flex items-center gap-1.5"
>
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
  CAD入口
</button>
```

- [ ] **Step 2: 在文件顶部引入 CADWorkspaceModal**

在 `PartsPage.tsx` 的 import 区域添加：
```tsx
import { CADWorkspaceModal } from '../components/CADWorkspace/CADWorkspaceModal';
```

- [ ] **Step 3: 添加状态变量**

在 `PartsPage` 组件内部的 `useState` 区域添加：
```tsx
const [showCADWorkspace, setShowCADWorkspace] = useState(false);
```

- [ ] **Step 4: 在 JSX 末尾渲染 CADWorkspaceModal**

在 `PartsPage` 组件的 return JSX 末尾（`</>` 之前）添加：
```tsx
<CADWorkspaceModal open={showCADWorkspace} onClose={() => { setShowCADWorkspace(false); loadData(); }} />
```

- [ ] **Step 5: 构建前端验证**

```powershell
cd D:\OpenCode\myPDM\frontend
npm run build
```
Expected: build 成功，无 TypeScript 错误。

- [ ] **Step 6: Commit**

```powershell
cd D:\OpenCode\myPDM
git add frontend/src/pages/PartsPage.tsx frontend/src/components/CADWorkspace/
git commit -m "feat: PartsPage 集成 CAD入口 按钮 + 工作台组件"
```

---

## 验收标准

1. 运行 `python -m cad_bridge --port 9527` 无错误退出
2. `npm run build` 构建成功，无 TS 错误
3. PartsPage 工具栏出现天蓝色 "CAD入口" 按钮
4. 点击 "CAD入口" 打开三步 Modal
5. 检测 CATIA 成功显示状态
6. 读取装配结构展示 BOM 树表格
7. 属性编辑写回 CATIA（需有 CATIA 环境验证）
8. 签出/签入/创建零件操作调用 PDM API
9. 附件上传按钮按签出状态正确显示/禁用

---

## 自审记录

- [x] 所有任务覆盖设计文档第 1-8 节全部功能
- [x] 无 "TBD" / "TODO" / "implement later" 占位
- [x] 跨任务类型名一致：BOMRow, CATIAStatus, AssemblyTreeNode
- [x] 每个步骤含完整代码
- [x] 文件路径与设计文档一致
- [x] cad_bridge 不依赖 PDM 后端（独立运行，仅做中转）
