import * as THREE from 'three';

/**
 * 禁用/启用单个 mesh 的射线检测，使隐藏的 mesh 不再拦截点击事件。
 *
 * 背景：three.js 的 Raycaster 默认不会跳过 visible=false 的对象，
 * 因此用 onClick 选中时，被隐藏的 mesh 仍会作为最近命中点抢走点击，
 * 导致背后可见的零件点不到。
 *
 * 解决：把隐藏 mesh 的 raycast 方法替换为空函数，Raycaster 在遍历场景
 * 时不会从该 mesh 收集到任何 Intersection，继续向后测试其它对象，
 * 从而让"射线穿透至背后可见的 mesh"。
 *
 * 恢复时把原 raycast 方法写回，并清理 userData 标记。
 */
export function setMeshRaycastEnabled(mesh: THREE.Mesh, enabled: boolean) {
  const ud = mesh.userData as { _raycastDisabled?: boolean; _origRaycast?: typeof mesh.raycast };
  if (!enabled && !ud._raycastDisabled) {
    ud._origRaycast = mesh.raycast;
    mesh.raycast = () => {};
    ud._raycastDisabled = true;
  } else if (enabled && ud._raycastDisabled) {
    if (ud._origRaycast) mesh.raycast = ud._origRaycast;
    delete ud._origRaycast;
    delete ud._raycastDisabled;
  }
}