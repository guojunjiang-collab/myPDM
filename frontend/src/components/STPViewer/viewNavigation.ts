import * as THREE from 'three';

/**
 * 标准视图导航的纯数学模块（与 CameraController 解耦，便于单元测试）。
 *
 * 背景：旧实现用 bestUp() 根据"当前相机 up 的历史"选取视图跳转的 up 轴，
 * 导致两个缺陷：
 *   1. 当当前 up 与所有候选轴点积相同（打平）时取 AXES 中第一个候选（+x 而非 +y），
 *      标准视图被滚动 90°（点击"前"后模型横躺）；
 *   2. up 选择强依赖历史姿态，同一视图在不同历史下结果不同（可能 +x/-x/+z/-z/-y），
 *      即"点击姿态球面后模型歪了，不是标准视图方向"。
 *
 * 修复：每个视图固定确定性 up 轴，不依赖历史：
 *   - front/back/left/right → +Y（模型"上"始终朝屏幕上方）
 *   - top → -Z（模型"前"朝屏幕上方，类 CAD"北朝上"约定）
 *   - bottom → +Z（与 top 对称）
 */

/** 各视图的观察方向（相机应位于 center + dir*dist，看向 center） */
export const VIEW_DIRS: Record<string, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

/** 各视图的标准 up 轴（确定性、与观察方向垂直、不依赖历史姿态） */
export const VIEW_UPS: Record<string, THREE.Vector3> = {
  front: new THREE.Vector3(0, 1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(0, 1, 0),
  right: new THREE.Vector3(0, 1, 0),
  top: new THREE.Vector3(0, 0, -1),
  bottom: new THREE.Vector3(0, 0, 1),
};

export interface ViewJump {
  /** 相机目标位置：center + dir*dist */
  endPos: THREE.Vector3;
  /** 标准 up 轴 */
  up: THREE.Vector3;
}

/**
 * 解析视图跳转目标（相机位置 + up 轴）。未知 viewKey 返回 null。
 */
export function resolveViewJump(viewKey: string, center: THREE.Vector3, dist: number): ViewJump | null {
  const dir = VIEW_DIRS[viewKey];
  if (!dir) return null;
  return {
    endPos: center.clone().addScaledVector(dir, dist),
    up: VIEW_UPS[viewKey].clone(),
  };
}

/** 重置视图：初始等距视角，up 固定为 +Y（初始相机姿态的 up） */
export function resolveResetJump(endPos: THREE.Vector3): ViewJump {
  return {
    endPos: endPos.clone(),
    up: new THREE.Vector3(0, 1, 0),
  };
}
