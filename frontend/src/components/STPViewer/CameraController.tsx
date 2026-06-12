import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { ArcballControls } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';

const AXES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];

const VIEWS: Record<string, THREE.Vector3> = {
  front:  new THREE.Vector3(0, 0, 1),
  back:   new THREE.Vector3(0, 0, -1),
  left:   new THREE.Vector3(-1, 0, 0),
  right:  new THREE.Vector3(1, 0, 0),
  top:    new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};

/** 选与当前 up 最近的正交世界轴，跳过与视线平行的轴 */
function bestUp(viewDir: THREE.Vector3, currentUp: THREE.Vector3): THREE.Vector3 {
  let best = new THREE.Vector3(0, 1, 0);
  let bestDot = -Infinity;
  for (const axis of AXES) {
    if (Math.abs(axis.dot(viewDir)) > 0.001) continue;
    const d = axis.dot(currentUp);
    if (d > bestDot) { bestDot = d; best = axis; }
  }
  return best.clone();
}

export function CameraController() {
  const cameraMode = useViewerStore((s) => s.cameraMode);
  const viewTarget = useViewerStore((s) => s.viewTarget);
  const setViewTarget = useViewerStore((s) => s.setViewTarget);
  const { camera, set, size } = useThree();
  const controlsRef = useRef<any>(null);
  const prevMode = useRef<string | null>(null);
  const anim = useRef<{ start: THREE.Vector3; end: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3; elapsed: number } | null>(null);

  useEffect(() => {
    if (controlsRef.current) {
      (controlsRef.current as any).rotateSpeed = 1.3;
    }
  }, []);

  // Camera mode switching
  useEffect(() => {
    if (prevMode.current === cameraMode) return;
    prevMode.current = cameraMode;

    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();
    if (cameraMode === 'orthographic') {
      const frustumSize = 8;
      const aspect = size.width / size.height;
      const newCam = new THREE.OrthographicCamera(
        frustumSize * aspect / -2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        frustumSize / -2,
        0.1,
        1000
      );
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      set({ camera: newCam as any });
    } else {
      const newCam = new THREE.PerspectiveCamera(45, size.width / size.height, 0.1, 1000);
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      set({ camera: newCam as any });
    }
  }, [cameraMode, set, size]);

  // Standard view animation
  useEffect(() => {
    if (!viewTarget || !controlsRef.current) return;
    const dir = VIEWS[viewTarget];
    if (!dir) return;

    const controls = controlsRef.current;
    const target = (controls as any).target as THREE.Vector3 | undefined;
    const center = target ? target.clone() : new THREE.Vector3(0, 0, 0);
    const dist = camera.position.distanceTo(center) || 5;
    const endPos = center.clone().addScaledVector(dir, dist);
    const up = bestUp(dir, camera.up);
    anim.current = {
      start: camera.position.clone(),
      end: endPos,
      up,
      target: center.clone(),
      elapsed: 0,
    };
    setViewTarget(null);
  }, [viewTarget]);

  useFrame((_, delta) => {
    // 计算相机相对注视中心的归一化方向（用于 ViewCube 立方体跟随）
    const target = (controlsRef.current as any)?.target as THREE.Vector3 | undefined;
    const dir = target
      ? new THREE.Vector3().subVectors(camera.position, target).normalize()
      : camera.position.clone().normalize();
    useViewerStore.setState({ cameraDir: [dir.x, dir.y, dir.z] });

    if (!anim.current || !controlsRef.current) return;
    const { start, end, up, target: tgt } = anim.current;
    anim.current.elapsed += delta;
    const t = Math.min(anim.current.elapsed / 0.4, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(start, end, eased);
    camera.up.copy(up);
    (controlsRef.current as any).target.copy(tgt);
    (controlsRef.current as any).update();

    if (t >= 1) {
      camera.position.copy(end);
      camera.up.copy(up);
      (controlsRef.current as any).target.copy(tgt);
      (controlsRef.current as any).update();
      anim.current = null;
    }
  });

  return <ArcballControls ref={controlsRef} makeDefault />;
}
