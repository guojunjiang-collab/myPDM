import { useEffect, type RefObject, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';
import { buildColorMap } from './autoColor';

/**
 * 共享的"把 viewerStore 视觉态施加到场景根节点"逻辑。
 *
 * 单件(ModelLoader)与装配(AssemblyModelLoader)复用同一套：
 *  - 选中高亮 / 隔离半透明 / 按 mesh uuid 显隐 / 线框
 *  - 自动上色（按零件名着色，关闭时还原原色）
 *
 * 所有交互都以 mesh uuid + viewerStore(treeData/nodeMap/hiddenParts...) 为锚点，
 * 与"场景由一个 glb 还是多个摆好的 glb 组成"无关 —— 这是两种模式合一的关键。
 *
 * @param groupRef 场景根 Object3D（其后代 mesh 承载所有零件几何）
 * @param origColorRef 各 mesh 的原始颜色（由调用方在加载完成时填充，供自动上色还原）
 */
export function useSceneVisualState(
  groupRef: RefObject<THREE.Object3D | null>,
  origColorRef: MutableRefObject<Map<string, number>>,
) {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const isolateMode = useViewerStore((s) => s.isolateMode);
  const nodeMap = useViewerStore((s) => s.nodeMap);
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const wireframe = useViewerStore((s) => s.wireframe);
  const autoColor = useViewerStore((s) => s.autoColor);

  // 选中高亮 / 隔离 / 显隐 / 线框
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const selNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    const sel = selNode ? new Set(selNode.meshUuids) : null;

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      // 显隐不依赖材质，先处理，使多材质 mesh 也能正常隐藏/显示
      mesh.visible = !hiddenParts.has(mesh.uuid);

      const mat = mesh.material;
      if (Array.isArray(mat)) return; // 多材质 mesh：跳过高亮/隔离/线框样式
      const std = mat as THREE.MeshStandardMaterial;

      std.wireframe = wireframe;

      if (!sel) {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else if (sel.has(mesh.uuid)) {
        if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        if (isolateMode) {
          std.transparent = true; std.opacity = 0.12; std.depthWrite = false;
        } else {
          std.transparent = false; std.opacity = 1; std.depthWrite = true;
        }
      }
      std.needsUpdate = true;
    });
  }, [groupRef, selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe]);

  // 自动上色：按零件名称着色；关闭时还原原始色。只改 color，不触碰 emissive/opacity。
  useEffect(() => {
    const group = groupRef.current;
    const { treeData } = useViewerStore.getState();
    if (!group || !treeData) return;

    const target = new Map<string, number>();
    if (autoColor) {
      const names: string[] = [];
      nodeMap.forEach((n) => { if (n.type === 'part') names.push(n.name); });
      const colorMap = buildColorMap(names);
      nodeMap.forEach((n) => {
        if (n.type !== 'part') return;
        const color = colorMap.get(n.name);
        if (color === undefined) return;
        n.meshUuids.forEach((u) => target.set(u, color));
      });
    } else {
      origColorRef.current.forEach((hex, uuid) => target.set(uuid, hex));
    }

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      const std = mat as THREE.MeshStandardMaterial;
      const hex = target.get(mesh.uuid);
      if (hex === undefined || !std.color) return;
      std.color.setHex(hex);
      std.needsUpdate = true;
    });
  }, [groupRef, origColorRef, autoColor, nodeMap]);
}
