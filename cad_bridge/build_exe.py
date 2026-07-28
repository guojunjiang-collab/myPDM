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
        "--add-data", os.path.join(workdir, ".env") + ";cad_bridge",
        "--add-data", os.path.join(workdir, "catia", "field_mapping.json") + ";cad_bridge/catia",
        "--add-data", os.path.join(workdir, "solidworks", "field_mapping.json") + ";cad_bridge/solidworks",
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
