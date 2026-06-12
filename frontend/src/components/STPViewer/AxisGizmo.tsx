import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';

const AXES = [
  { axis: 'x' as const, color: '#ef4444', label: 'X' },
  { axis: 'y' as const, color: '#22c55e', label: 'Y' },
  { axis: 'z' as const, color: '#3b82f6', label: 'Z' },
];

function makeSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
  return new THREE.Sprite(mat);
}

function GizmoModel() {
  const quat = useViewerStore((s) => s.cameraQuat);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const [x, y, z, w] = quat;
    groupRef.current.quaternion.set(-x, y, -z, w);
  });

  const sprites = useMemo(() => AXES.map((a) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = a.color;
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.label, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false });
    return { axis: a.axis, sprite: new THREE.Sprite(mat) };
  }), []);

  return (
    <group ref={groupRef}>
      {AXES.map((a) => {
        const [dx, dy, dz] = a.axis === 'x' ? [1, 0, 0] : a.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
        const col = new THREE.Color(a.color);
        // 从原点出发的轴线
        const mid = [dx * 0.55, dy * 0.55, dz * 0.55] as const;
        const end = [dx * 1.0, dy * 1.0, dz * 1.0] as const;
        const tip = [dx * 1.08, dy * 1.08, dz * 1.08] as const;
        const lbl = [dx * 1.22, dy * 1.22, dz * 1.22] as const;
        return (
          <group key={a.axis}>
            {/* 轴线（圆柱） */}
            <mesh position={mid}>
              <cylinderGeometry args={[0.03, 0.03, 1.1, 8]} />
              <meshBasicMaterial color={col} depthTest={false} />
            </mesh>
            {/* 箭头（圆锥） */}
            <mesh position={tip}>
              <coneGeometry args={[0.08, 0.16, 8]} />
              <meshBasicMaterial color={col} depthTest={false} />
            </mesh>
            {/* 标签 sprite */}
            <primitive
              object={sprites.find((s) => s.axis === a.axis)!.sprite}
              position={lbl}
              scale={[0.28, 0.28, 1]}
            />
          </group>
        );
      })}
    </group>
  );
}

export function AxisGizmo() {
  return (
    <div className="absolute top-10 right-10 z-20" style={{ width: 56, height: 56 }}>
      <Canvas
        orthographic
        camera={{ position: [0.6, 0.45, 0.6], zoom: 50 }}
        gl={{ antialias: true, alpha: true }}
        style={{ width: 56, height: 56, background: 'transparent' }}
      >
        <GizmoModel />
      </Canvas>
    </div>
  );
}
