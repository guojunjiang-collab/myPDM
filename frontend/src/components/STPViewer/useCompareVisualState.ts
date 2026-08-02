import { useEffect, type RefObject, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';
import { renderDecision } from './compareRenderRules';
import { setMeshRaycastEnabled } from './raycastFilter';
import type { ChangeType, Side } from './compareTypes';

/**
 * 对比模式的视觉态施加：按显示模式 / 仅显示差异 / 选中 / 幽灵透明度 / 显隐 / 线框
 * 逐 mesh 计算 visible 与 opacity。
 *
 * 与 useSceneVisualState 并列而非合并：对比模式是"配对选中 + 变更色源"，
 * 语义与单件/装配模式的"单选 + 自动上色"已分叉。
 *
 * @param groupRef 场景根 Object3D
 * @param ghostCandidates 叠加模式下 modify 件左侧(旧版)的 mesh uuid 集合
 */
export function useCompareVisualState(
  groupRef: RefObject<THREE.Object3D | null>,
  ghostCandidates: MutableRefObject<Set<string>>,
) {
  const compare = useViewerStore((s) => s.compare);
  const hiddenParts = useViewerStore((s) => s.hiddenParts);
  const wireframe = useViewerStore((s) => s.wireframe);
  const isolateMode = useViewerStore((s) => s.isolateMode);

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !compare) return;

    const { displayMode, onlyDiff, ghostOpacity, selectedKey, nodeMap } = compare;

    // 选中行涉及的 mesh（左右两侧一起）。
    // BOM 行 key 在 nodeMap 里，直接取两侧 meshUuids；
    // 实例行 key（形如 "<nodeKey>:inst:3"）不在 nodeMap 里，
    // 改按 mesh 上回填的 userData.compareInstanceKey 反查。
    const selected = new Set<string>();
    if (selectedKey) {
      const node = nodeMap.get(selectedKey);
      if (node) {
        node.left?.meshUuids.forEach((u) => selected.add(u));
        node.right?.meshUuids.forEach((u) => selected.add(u));
      } else {
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && child.userData.compareInstanceKey === selectedKey) {
            selected.add(child.uuid);
          }
        });
      }
    }

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      const side = mesh.userData.compareSide as Side | undefined;
      const changeType = mesh.userData.changeType as ChangeType | undefined;
      if (!side || !changeType) return;

      // 1) 显示模式决定这份该不该出现在场景里
      const decision = renderDecision(changeType, displayMode);
      const wanted = side === 'left' ? decision.drawLeft : decision.drawRight;

      // 2) 手动显隐（树上的眼睛按钮）优先级最高
      const visible = wanted && !hiddenParts.has(mesh.uuid);
      mesh.visible = visible;
      // 隐藏 mesh 的射线检测需一并禁用，否则点击仍会命中它而挡住背后可见 mesh
      setMeshRaycastEnabled(mesh, visible);
      if (!mesh.visible) return;

      const mat = mesh.material;
      if (Array.isArray(mat)) return; // 多材质 mesh：跳过样式处理
      const std = mat as THREE.MeshStandardMaterial;
      std.wireframe = wireframe;

      // 3) 透明度：选中实体高亮 > 幽灵（未变件/旧版/隔离） > 实体
      const isSelected = selected.has(mesh.uuid);
      const ghostByModify = displayMode === 'both' && ghostCandidates.current.has(mesh.uuid);
      const ghostByOnlyDiff = onlyDiff && changeType === 'none';
      const ghostByIsolate = isolateMode && selectedKey !== null && !isSelected;
      const ghost = ghostByModify || ghostByOnlyDiff || ghostByIsolate;

      if (isSelected) {
        if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        if (ghost) {
          std.transparent = true; std.opacity = ghostOpacity; std.depthWrite = false;
        } else {
          std.transparent = false; std.opacity = 1; std.depthWrite = true;
        }
      }
      std.needsUpdate = true;
    });
  }, [groupRef, ghostCandidates, compare, hiddenParts, wireframe, isolateMode]);
}
