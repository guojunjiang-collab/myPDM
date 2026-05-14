#!/usr/bin/env python3
"""
STP → glTF (glb) 转换脚本
Step 1: gmsh 读取 STP → 网格化 → 导出 STL
Step 2: trimesh 读取 STL → 导出 glb

用法: python3 stp_to_gltf.py <input.stp> <output.glb>
"""
import sys, os, logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def convert(input_path: str, output_path: str):
    if not os.path.exists(input_path):
        logger.error(f"输入文件不存在: {input_path}")
        sys.exit(1)

    stl_path = output_path.replace('.glb', '.stl')
    logger.info(f"转换: {input_path} → {output_path}")

    # Step 1: gmsh STP→STL
    import gmsh
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Verbosity", 1)
        gmsh.open(input_path)

        # 曲率自适应网格：曲面越弯网格越密，平面自动放大
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 22)       # 每 π 弧度 22 个单元（默认 18）
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)   # 边界细网格向内传播
        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 1)           # 特征点参与尺寸计算
        gmsh.option.setNumber("Mesh.MeshSizeMax", 1e6)                # 平面区域不设上限
        gmsh.option.setNumber("Mesh.Algorithm", 6)                    # Frontal-Delaunay，三角形更规整

        gmsh.model.mesh.generate(2)
        gmsh.write(stl_path)
    finally:
        gmsh.finalize()

    if not os.path.exists(stl_path):
        logger.error("STL 导出失败")
        sys.exit(1)

    # Step 2: trimesh STL→glb
    import trimesh
    mesh = trimesh.load(stl_path)
    # 赋 CAD 零件材质色（浅蓝灰），避免纯白模型在白底上不可见
    cad_color = [200, 214, 229, 255]  # #c8d6e5
    if mesh.visual.kind == 'face':
        mesh.visual.face_colors = [cad_color] * len(mesh.faces)
    else:
        mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=[cad_color] * len(mesh.faces))
    mesh.export(output_path)
    os.unlink(stl_path)

    size = os.path.getsize(output_path)
    logger.info(f"转换完成 ({size / 1024:.1f} KB)")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"用法: {sys.argv[0]} <input.stp> <output.glb>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
