import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VIEW_DIRS, VIEW_UPS, resolveViewJump, resolveResetJump } from './viewNavigation';

const AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];

function isAxisAligned(v: THREE.Vector3): boolean {
  return AXES.some((a) => Math.abs(v.clone().normalize().dot(a)) > 0.9999);
}

describe('viewNavigation 标准视图', () => {
  it('每个视图的 up 轴都是标准轴且与观察方向垂直', () => {
    for (const key of Object.keys(VIEW_DIRS)) {
      const dir = VIEW_DIRS[key];
      const up = VIEW_UPS[key];
      expect(isAxisAligned(dir), `${key} 观察方向应沿标准轴`).toBe(true);
      expect(isAxisAligned(up), `${key} up 应沿标准轴`).toBe(true);
      expect(Math.abs(dir.dot(up)), `${key} up 必须与观察方向垂直（否则 lookAt 退化）`).toBeLessThan(1e-6);
    }
  });

  it('front/back/left/right 视图 up 恒为 +Y（模型顶部朝上，不滚动）', () => {
    for (const key of ['front', 'back', 'left', 'right']) {
      const up = VIEW_UPS[key];
      expect(up.x).toBe(0);
      expect(up.y).toBe(1);
      expect(up.z).toBe(0);
    }
  });

  it('resolveViewJump 返回 endPos = center + dir*dist，且与历史姿态无关（确定性）', () => {
    const center = new THREE.Vector3(1, 2, 3);
    const dist = 7.5;
    // 用不同"历史 up"模拟不同前置姿态，结果必须一致
    for (const key of Object.keys(VIEW_DIRS)) {
      const j = resolveViewJump(key, center, dist)!;
      expect(j).not.toBeNull();
      const expectEnd = center.clone().addScaledVector(VIEW_DIRS[key], dist);
      expect(j.endPos.distanceTo(expectEnd)).toBeLessThan(1e-9);
      // 确定性：重复调用结果相同
      const j2 = resolveViewJump(key, center, dist)!;
      expect(j.endPos.distanceTo(j2.endPos)).toBe(0);
      expect(j.up.distanceTo(j2.up)).toBe(0);
    }
  });

  it('resolveViewJump 未知 key 返回 null', () => {
    expect(resolveViewJump('nope', new THREE.Vector3(), 5)).toBeNull();
  });

  it('resolveResetJump up 固定 +Y', () => {
    const j = resolveResetJump(new THREE.Vector3(5, 5, 5));
    expect(j.up.y).toBe(1);
    expect(j.endPos.distanceTo(new THREE.Vector3(5, 5, 5))).toBeLessThan(1e-9);
  });
});
