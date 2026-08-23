import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { ArcballControls } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';
import { resolveViewJump, resolveResetJump } from './viewNavigation';

export function CameraController() {
  const cameraMode = useViewerStore((s) => s.cameraMode);
  const viewTarget = useViewerStore((s) => s.viewTarget);
  const setViewTarget = useViewerStore((s) => s.setViewTarget);
  const resetViewTrigger = useViewerStore((s) => s.resetViewTrigger);
  const streamProgress = useViewerStore((s) => s.streamProgress);
  const loadingState = useViewerStore((s) => s.loadingState);
  const { camera, set, size } = useThree();
  const controlsRef = useRef<any>(null);
  const prevMode = useRef<string | null>(null);
  const anim = useRef<{ start: THREE.Vector3; end: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3; elapsed: number } | null>(null);

  const isStreaming = streamProgress !== null && streamProgress.loaded < streamProgress.total;

  useEffect(() => {
    if (controlsRef.current) {
      (controlsRef.current as any).rotateSpeed = 1.3;
    }
  }, []);

  // Camera mode switching — 保持视角和缩放不变
  useEffect(() => {
    if (prevMode.current === cameraMode) return;
    prevMode.current = cameraMode;

    const pos = camera.position.clone();
    const quat = camera.quaternion.clone();
    const target = (controlsRef.current as any)?.target as THREE.Vector3 | undefined;
    const dist = target ? pos.distanceTo(target) : 5;

    if (cameraMode === 'orthographic') {
      const fov = (camera as THREE.PerspectiveCamera).fov || 45;
      const frustumSize = 2 * dist * Math.tan((fov * Math.PI) / 360);
      const aspect = size.width / size.height;
      const newCam = new THREE.OrthographicCamera(
        frustumSize * aspect / -2, frustumSize * aspect / 2,
        frustumSize / 2, frustumSize / -2,
        0.1, 1000
      );
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      // 标记为 manual，阻止 R3F 在画布尺寸变化时用"像素级视锥"覆盖我们的正交视锥
      // （否则拖动模型树改变画布宽度会导致模型被缩放）。视锥由下面的 [size] 副作用统一维护。
      (newCam as any).manual = true;
      set({ camera: newCam as any });
    } else {
      const cam = camera as THREE.OrthographicCamera;
      const frustumSize = (cam.top - cam.bottom) || 8;
      const fov = 2 * Math.atan(frustumSize / (2 * dist)) * (180 / Math.PI);
      const newCam = new THREE.PerspectiveCamera(fov, size.width / size.height, 0.1, 1000);
      newCam.position.copy(pos);
      newCam.quaternion.copy(quat);
      set({ camera: newCam as any });
    }
  }, [cameraMode, set, size]);

  // 窗口大小变化时更新正交相机视锥，保持模型视觉大小不变
  useEffect(() => {
    if (cameraMode !== 'orthographic' || !(camera instanceof THREE.OrthographicCamera)) return;
    const aspect = size.width / size.height;
    const halfH = (camera.top - camera.bottom) / 2;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.updateProjectionMatrix();
  }, [size, cameraMode]);

  // Standard view animation
  useEffect(() => {
    if (!viewTarget || !controlsRef.current) return;
    const controls = controlsRef.current;
    const target = (controls as any).target as THREE.Vector3 | undefined;
    const center = target ? target.clone() : new THREE.Vector3(0, 0, 0);
    const dist = camera.position.distanceTo(center) || 5;
    // 确定性标准视图：每个视图固定 up 轴（不依赖历史姿态），避免"点击面后模型歪了"
    const jump = resolveViewJump(viewTarget, center, dist);
    if (!jump) return;
    anim.current = {
      start: camera.position.clone(),
      end: jump.endPos,
      up: jump.up,
      target: center.clone(),
      elapsed: 0,
    };
    setViewTarget(null);
  }, [viewTarget]);

  // 重置：恢复到初始视角（up 固定为初始 +Y）
  useEffect(() => {
    if (resetViewTrigger === 0) return;
    const { initCamPos, initCamTarget } = useViewerStore.getState();
    const endPos = new THREE.Vector3(...initCamPos);
    const tgt = new THREE.Vector3(...initCamTarget);
    const jump = resolveResetJump(endPos);
    anim.current = {
      start: camera.position.clone(),
      end: jump.endPos,
      up: jump.up,
      target: tgt,
      elapsed: 0,
    };
  }, [resetViewTrigger]);

  useFrame((_, delta) => {
    // 同步相机四元数到 store（用于 ViewCube 完美跟随）
    const q = camera.quaternion;
    useViewerStore.setState({ cameraQuat: [q.x, q.y, q.z, q.w] });

    if (!anim.current || !controlsRef.current) return;
    const { start, end, up, target: tgt } = anim.current;
    anim.current.elapsed += delta;
    const t = Math.min(anim.current.elapsed / 0.4, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(start, end, eased);
    camera.up.copy(up);
    (controlsRef.current as any).target.copy(tgt);
    camera.lookAt(tgt);
    (controlsRef.current as any).update();

    if (t >= 1) {
      camera.position.copy(end);
      camera.up.copy(up);
      (controlsRef.current as any).target.copy(tgt);
      camera.lookAt(tgt);
      (controlsRef.current as any).update();
      anim.current = null;
    }
  });

  return <ArcballControls ref={controlsRef} makeDefault enabled={loadingState === 'ready' && !isStreaming} />;
}
