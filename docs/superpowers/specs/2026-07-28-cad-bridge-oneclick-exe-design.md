# CAD 桥接程序一键封装设计

## 1. 背景与目标

当前 `cad_bridge` 需要通过命令行 `python -m cad_bridge` 启动，要求机器预装 Python 3.10+ 环境。对于只安装了 CATIA/SolidWorks 的工程师而言，安装 Python 并通过命令行启动是不小的门槛。

**目标**：将 `cad_bridge` 封装为单个 `cad_bridge.exe` 可执行文件，双击即可启动，无需安装 Python 环境，无需打开命令行。

## 2. 需求摘要

| 需求 | 说明 |
|------|------|
| 启动方式 | 双击 exe，弹出控制台窗口显示日志 |
| Python 依赖 | 不依赖系统 Python（exe 内置嵌入式 Python） |
| 配置文件 | `.env`、`field_mapping.json` 放在 exe 同目录下，用户可直接编辑 |
| 命令行兼容 | 保留原有 `python -m cad_bridge` 方式 |
| 产物位置 | `cad_bridge/dist/cad_bridge.exe` |

## 3. 方案：PyInstaller --onefile

使用 PyInstaller 将 `cad_bridge` 及其所有依赖（Python 运行时 + 第三方包 + 内置资源）打包为单个 exe。

### 3.1 为什么选 PyInstaller

- 业内最成熟的 Python → exe 工具，对 pywin32/COM 的支持已经过大量验证
- `--onefile` 模式产出真正的单文件，分发最干净
- 支持 `--console` 模式原生控制台窗口，符合用户期望
- 支持 `--add-data` 将资源文件内嵌，同时支持运行时读取外部覆盖

### 3.2 运行时架构

```
cad_bridge.exe 所在目录/
├── cad_bridge.exe              ← 双击启动
├── .env                        ← 可选：外部覆盖配置
├── catia/
│   └── field_mapping.json      ← 可选：外部覆盖 CATIA 映射
├── solidworks/
│   └── field_mapping.json      ← 可选：外部覆盖 SolidWorks 映射
└── cad_workspace/              ← 运行时生成（工作目录）
```

**配置加载优先级**：exe 同目录外部文件 > exe 内置资源文件

### 3.3 启动流程

```
1. 双击 cad_bridge.exe
2. Python 运行时从 exe 自解压到 %TEMP%/_MEIxxxxx/ （PyInstaller 机制）
3. 执行 launcher.py main()
4.   定位 exe 所在目录 → 加载 .env（外部优先）
5.   定位配置文件路径（外部优先，内置回退）
6.   初始化日志 → 控制台输出
7.   启动 BridgeServer (ws://127.0.0.1:9527)
8.   控制台显示 "CAD 桥接服务启动中..." 及日志
9.   等待 Ctrl+C 或关闭窗口 → 退出
```

## 4. 新增文件

| 文件 | 作用 |
|------|------|
| `cad_bridge/launcher.py` | PyInstaller 打包入口，处理 `_MEIPASS` vs 外部目录的配置加载 |
| `cad_bridge/build_exe.py` | 打包脚本（可选），封装 pyinstaller 命令行参数 |
| `cad_bridge/dist/cad_bridge.exe` | **最终产物**（需运行 build 脚本生成，不提交 git） |

## 5. 现有代码改动

### 5.1 `launcher.py`（新增入口）

替换 `__main__.py` 作为 PyInstaller 入口，核心差异在配置加载：

```python
def _get_exe_dir():
    """获取 exe 所在目录（开发时返回 __file__ 目录）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

def _load_resource(filename, *parts):
    """加载资源文件：外部目录优先，内置回退"""
    external = os.path.join(_get_exe_dir(), *parts, filename)
    if os.path.isfile(external):
        return external
    # PyInstaller 打包后的内置路径
    if getattr(sys, 'frozen', False):
        internal = os.path.join(sys._MEIPASS, *parts, filename)
        if os.path.isfile(internal):
            return internal
    # 开发模式下的内部路径
    internal = os.path.join(os.path.dirname(__file__), *parts, filename)
    if os.path.isfile(internal):
        return internal
    return None
```

### 5.2 `catia/client.py` 和 `solidworks/client.py`

当前它们通过 `__file__` 相对路径加载 `field_mapping.json`。需要改为支持外部路径注入：

```python
# 变更前
_mapping_path = os.path.join(os.path.dirname(__file__), 'field_mapping.json')

# 变更后：允许外部指定路径
def get_mapping_path(external_base: str = None):
    if external_base:
        path = os.path.join(external_base, 'field_mapping.json')
        if os.path.isfile(path):
            return path
    return os.path.join(os.path.dirname(__file__), 'field_mapping.json')
```

`launcher.py` 在初始化 client 时传入外部配置路径。

### 5.3 `__main__.py`

**不变**。保留原有命令行启动方式。

## 6. 打包命令

```powershell
cd cad_bridge
pip install pyinstaller

pyinstaller --onefile --console --name cad_bridge `
  --add-data ".env;." `
  --add-data "catia/field_mapping.json;catia" `
  --add-data "solidworks/field_mapping.json;solidworks" `
  --hidden-import win32com.client `
  --hidden-import win32com.client.dynamic `
  --hidden-import pythoncom `
  --exclude-module tkinter `
  --distpath ./dist `
  launcher.py
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--onefile` | 单文件输出 |
| `--console` | 控制台子系统（显示 cmd 窗口） |
| `--add-data` | 内嵌资源文件 |
| `--hidden-import` | pywin32 COM 的隐式依赖，PyInstaller 无法自动检测 |
| `--exclude-module tkinter` | 不依赖 GUI，排除以减小体积 |
| `--distpath ./dist` | 产物输出到 `cad_bridge/dist/` |

## 7. 依赖清单

| 包 | 版本要求 | 说明 |
|----|---------|------|
| pywin32 | >=306 | CATIA/SolidWorks COM 互操作 |
| websockets | >=12.0 | WebSocket 服务端 |
| httpx | >=0.27.0 | PDM API HTTP 调用 |
| pyinstaller | >=6.0 | 打包工具（仅构建时，不打包进 exe） |

## 8. 测试要点

| 测试项 | 验证方法 |
|--------|---------|
| 无 Python 环境启动 | 在未安装 Python 的虚拟机或同事电脑上双击 exe |
| 控制台日志正常输出 | 双击后看到 "CAD 桥接服务启动中..." |
| 外部配置文件覆盖 | 在 exe 同目录放自定义 .env，验证读取的是外部文件 |
| CATIA COM 调用 | 启动 CATIA，前端连接 ws://127.0.0.1:9527，执行 detect |
| SolidWorks COM 调用 | 同理 |
| 附件上传/下载 | 通过前端 CAD 工作台执行完整流程 |
| Ctrl+C 优雅退出 | 控制台窗口中 Ctrl+C，验证无残留进程 |

## 9. 限制与注意事项

1. **仅 Windows**：pywin32 COM 接口仅 Windows 可用
2. **exe 体积**：约 15-25MB（Python 运行时 + 依赖 + 代码）
3. **首次启动**：PyInstaller --onefile 首次启动会解压到 `%TEMP%/_MEIxxxxx/`，耗时 1-3 秒
4. **杀软误报**：PyInstaller 打包的 exe 可能被部分杀软误报，需加入白名单
5. **CAD 软件必须同机**：桥接服务须与 CATIA/SolidWorks 在同一台机器
6. **仅本机访问**：WebSocket 监听 `127.0.0.1:9527`，仅本机浏览器可连接
