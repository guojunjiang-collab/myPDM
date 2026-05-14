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

      // Exclude measurement markers from being hit
      const hit = intersects.find(
        (i) => !(i.object instanceof THREE.Mesh && i.object.name === '__measure_marker__'),
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

  // 还原真实尺寸：模型被 scale 缩放，测量值需除以 scale 还原
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
              {distance.toFixed(1)} mm{(modelScale > 0 && modelScale !== 1 ? ` (×${(1/modelScale).toFixed(0)})` : '')}
            </div>
          </Html>
        </>
      )}
    </>
  );
}
