import { useEffect, useState, useCallback, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';

type MeasurePhase = 0 | 1 | 2;

/**
 * Distance measurement tool — lives inside the R3F Canvas.
 * Active only when viewerStore.measureMode === 'distance'.
 * Click two points on the model → renders a line segment + distance label.
 */
export function MeasureTool() {
  const measureMode = useViewerStore((s) => s.measureMode);
  const modelScale = useViewerStore((s) => s.modelScale);
  const { gl, camera, raycaster, scene } = useThree();

  const [pointA, setPointA] = useState<THREE.Vector3 | null>(null);
  const [pointB, setPointB] = useState<THREE.Vector3 | null>(null);
  const phaseRef = useRef<MeasurePhase>(0);
  const pointerDownRef = useRef({ x: 0, y: 0 });

  const active = measureMode === 'distance';

  const handlePointerDown = useCallback((e: PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      // Ignore drags (orbit/pan) — only respond to clicks (< 3 px movement)
      const dx = e.clientX - pointerDownRef.current.x;
      const dy = e.clientY - pointerDownRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 3) return;

      const rect = gl.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      // 测量点只落在真实模型网格表面上：
      //  - 排除测量标记球(__measure_marker__)
      //  - 排除装饰性叠加层（高亮包围盒是 LineSegments、测量线段是 Line，均非 Mesh）
      //  - 排除隐藏的零件（three.js 的 raycaster 不会自动跳过 visible=false 的对象，
      //    故包围盒 ESC 取消后仍残留可命中，必须显式过滤）
      const hit = intersects.find(
        (i) =>
          (i.object as THREE.Mesh).isMesh &&
          i.object.visible !== false &&
          i.object.name !== '__measure_marker__',
      );
      if (!hit) return;

      const pt = hit.point.clone();
      const phase = phaseRef.current;

      if (phase === 0) {
        phaseRef.current = 1;
        setPointA(pt);
        setPointB(null);
      } else if (phase === 1) {
        phaseRef.current = 2;
        setPointB(pt);
      } else {
        // Start a new measurement pair
        phaseRef.current = 1;
        setPointA(pt);
        setPointB(null);
      }
    },
    [gl, camera, raycaster, scene],
  );

  // Bind / unbind event listeners when measureMode changes
  useEffect(() => {
    if (!active) {
      phaseRef.current = 0;
      setPointA(null);
      setPointB(null);
      return;
    }

    const el = gl.domElement;
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointerup', handlePointerUp);
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointerup', handlePointerUp);
    };
  }, [active, handlePointerDown, handlePointerUp, gl]);

  // Not active — render nothing
  if (!active || !pointA) return null;

  const midPoint = pointB
    ? new THREE.Vector3().addVectors(pointA, pointB).multiplyScalar(0.5)
    : pointA.clone();

  // modelScale = 显示坐标→真实毫米 的换算系数（由 ModelLoader 按 glTF 米单位算出）
  const distance = pointB ? pointA.distanceTo(pointB) / Math.max(modelScale, 0.001) : 0;

  return (
    <>
      {/* Point A marker */}
      <mesh name="__measure_marker__" position={pointA}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color="#ff4444" depthTest={false} />
      </mesh>

      {pointB && (
        <>
          {/* Point B marker */}
          <mesh name="__measure_marker__" position={pointB}>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshBasicMaterial color="#ff4444" depthTest={false} />
          </mesh>

          {/* Connecting line */}
          <Line
            points={[pointA, pointB]}
            color="#ff4444"
            lineWidth={2}
            depthTest={false}
          />

          {/* Distance label */}
          <Html position={midPoint.add(new THREE.Vector3(0, 0.15, 0))} center style={{ pointerEvents: 'none' }}>
            <div className="rounded bg-gray-900/85 px-2 py-1 text-xs text-white shadow-lg whitespace-nowrap">
              {distance.toFixed(1)} mm
            </div>
          </Html>
        </>
      )}
    </>
  );
}
