#!/usr/bin/env python3
"""
STP → Draco-compressed glTF (glb) 转换脚本

优化后流程（无 STL 中间文件）:
  Step 1: gmsh 读取 STP → 网格化 → 内存中提取顶点和面
  Step 2: trimesh 从内存构建网格 → 导出临时 glb
  Step 3: gltf-draco-transcoder → Draco 压缩 → 最终 glb

用法: python3 stp_to_gltf.py <input.stp> <output.glb>
"""
import sys
import os
import logging
import tempfile
import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# CAD 零件材质色（浅蓝灰），避免纯白模型在白底上不可见
CAD_COLOR = [200, 214, 229, 255]  # #c8d6e5


def convert(input_path: str, output_path: str):
    if not os.path.exists(input_path):
        logger.error(f"输入文件不存在: {input_path}")
        sys.exit(1)

    logger.info(f"转换: {input_path} → {output_path}")

    # ── Step 1: gmsh 读取 STP → 网格化 → 内存提取 ──
    import gmsh
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Verbosity", 1)
        gmsh.open(input_path)

        # 预览模式网格参数（平衡质量与速度）
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 18)
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 1)
        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 1)
        gmsh.option.setNumber("Mesh.MeshSizeMax", 50)
        gmsh.option.setNumber("Mesh.Algorithm", 6)  # Frontal-Delaunay

        gmsh.model.mesh.generate(2)

        # 提取节点坐标
        node_tags, coords_flat, _ = gmsh.model.mesh.getNodes()
        if len(node_tags) == 0:
            logger.error("网格生成失败：无节点")
            sys.exit(1)

        coords = np.array(coords_flat, dtype=np.float64).reshape(-1, 3)
        logger.info(f"网格节点数: {len(coords)}")

        # 提取三角形面（element type 2 = 3-node triangle）
        element_types, element_tags, node_tags_list = gmsh.model.mesh.getElements()

        faces = None
        for i, et in enumerate(element_types):
            name, dim, order, num_nodes, *_ = gmsh.model.mesh.getElementProperties(et)
            if dim == 2 and num_nodes == 3:
                tri_conn_flat = np.array(node_tags_list[i], dtype=np.int64)
                # gmsh 节点 tag → 0-based 索引
                node_tag_to_idx = {tag.item(): idx for idx, tag in enumerate(node_tags)}
                face_indices = np.array(
                    [node_tag_to_idx[t.item()] for t in tri_conn_flat],
                    dtype=np.int64
                )
                faces = face_indices.reshape(-1, 3)
                logger.info(f"三角形面数: {len(faces)} (类型: {name})")
                break

        if faces is None:
            # 尝试其他 2D 元素（如 quad 4-node type 3 等）
            for i, et in enumerate(element_types):
                name, dim, order, num_nodes, *_ = gmsh.model.mesh.getElementProperties(et)
                if dim == 2:
                    logger.warning(f"未找到三角形，使用 {name}（{num_nodes}节点/面）")
                    conn_flat = np.array(node_tags_list[i], dtype=np.int64)
                    node_tag_to_idx = {tag.item(): idx for idx, tag in enumerate(node_tags)}
                    face_indices = np.array(
                        [node_tag_to_idx[t.item()] for t in conn_flat],
                        dtype=np.int64
                    )
                    faces = face_indices.reshape(-1, num_nodes)
                    break

        if faces is None:
            logger.error("网格中未找到任何面元素")
            sys.exit(1)

    finally:
        gmsh.finalize()

    # ── Step 2: trimesh 构建网格 → 导出临时 glb ──
    import trimesh
    from trimesh.exchange.gltf import export_glb
    mesh = trimesh.Trimesh(vertices=coords, faces=faces, process=False)

    # 计算法线（保留用于潜在的着色模式切换）
    mesh.fix_normals()

    # 赋 CAD 零件材质色（浅蓝灰 #c8d6e5）
    mesh.visual.face_colors = [CAD_COLOR] * len(mesh.faces)

    # Unlit 后处理器：创建材质并绑定 KHR_materials_unlit，
    # 使模型以原始颜色渲染，不受环境光照影响（CAD 预览标准做法）
    def _apply_unlit(tree):
        # 确保材质存在
        if not tree.get('materials'):
            tree['materials'] = [{'extensions': {'KHR_materials_unlit': {}}}]
        else:
            for mat in tree['materials']:
                mat.setdefault('extensions', {})['KHR_materials_unlit'] = {}

        # 绑定材质到所有 primitive
        for mesh in tree.get('meshes', []):
            for prim in mesh.get('primitives', []):
                if prim.get('material') is None:
                    prim['material'] = 0

        used = tree.setdefault('extensionsUsed', [])
        if 'KHR_materials_unlit' not in used:
            used.append('KHR_materials_unlit')

    # 导出到临时文件（unlit 模式 + 法线）
    tmp_fd, tmp_glb = tempfile.mkstemp(suffix='.glb', prefix='stp_')
    os.close(tmp_fd)
    try:
        glb_bytes = export_glb(
            mesh.scene(),
            include_normals=True,
            tree_postprocessor=_apply_unlit,
        )
        with open(tmp_glb, 'wb') as f:
            f.write(glb_bytes)
        uncompressed_size = os.path.getsize(tmp_glb)
        logger.info(f"无压缩 glb: {uncompressed_size / 1024:.1f} KB")

        # ── Step 3: Draco 压缩 ──
        try:
            from gltf_draco_transcoder import compress_gltf
            compressed = compress_gltf(
                tmp_glb,
                qp=14,   # position quantization (default 11, higher=better quality)
                qn=10,   # normal quantization
                cl=9,    # compression level (0-10, higher=better ratio)
            )
            with open(output_path, 'wb') as f:
                f.write(compressed.getvalue())
            final_size = os.path.getsize(output_path)
            ratio = uncompressed_size / final_size if final_size > 0 else 1
            logger.info(
                f"Draco 压缩完成: {uncompressed_size / 1024:.1f} KB → "
                f"{final_size / 1024:.1f} KB (压缩比 {ratio:.1f}:1)"
            )
        except ImportError:
            logger.warning(
                "gltf-draco-transcoder 未安装，使用无压缩 glb。"
                "安装: pip install gltf-draco-transcoder"
            )
            os.rename(tmp_glb, output_path)
            logger.info(f"转换完成（无压缩）: {os.path.getsize(output_path) / 1024:.1f} KB")
    finally:
        if os.path.exists(tmp_glb):
            os.unlink(tmp_glb)

    size = os.path.getsize(output_path)
    logger.info(f"最终文件大小: {size / 1024:.1f} KB")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"用法: {sys.argv[0]} <input.stp> <output.glb>")
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
