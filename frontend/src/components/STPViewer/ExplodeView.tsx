import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';

/**
 * Exploded view — lives inside the R3F Canvas.
 * Slides each mesh outward from the model center proportionally
 * to viewerStore.explodeDistance. Original positions are captured
 * on mount and restored when distance returns to 0.
 */
export function ExplodeView() {
  const { scene } = useThree();
  const explodeDistance = useViewerStore((s) => s.explodeDistance);

  // Map mesh → original world position
  const originMap = useRef(new Map<THREE.Object3D, THREE.Vector3>());
  const center = useRef(new THREE.Vector3());
  const captured = useRef(false);

  // Phase 1: capture original positions once the model is loaded
  useEffect(() => {
    // Wait for the model to appear in the scene (first mesh signals ready)
    const tryCapture = () => {
      const meshes: THREE.Mesh[] = [];
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      if (meshes.length === 0) return;

      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      box.getCenter(center.current);

      const map = new Map<THREE.Object3D, THREE.Vector3>();
      for (const m of meshes) {
        const worldPos = new THREE.Vector3();
        m.getWorldPosition(worldPos);
        map.set(m, worldPos.clone());
      }
      originMap.current = map;
      captured.current = true;
    };

    // Initial attempt after a short delay
    const t1 = setTimeout(tryCapture, 300);
    // Retry in case the model loads slowly
    const t2 = setTimeout(tryCapture, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      // Reset positions on unmount
      if (originMap.current.size > 0) {
        for (const [mesh, origin] of originMap.current) {
          setWorldPosition(mesh, origin);
        }
      }
      originMap.current.clear();
      captured.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // Phase 2: apply explode offset whenever distance changes
  useEffect(() => {
    if (!captured.current || originMap.current.size === 0) return;

    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const origin = originMap.current.get(child);
      if (!origin) return;

      if (explodeDistance === 0) {
        // Restore to original world position
        setWorldPosition(child, origin);
      } else {
        const dir = new THREE.Vector3()
          .subVectors(origin, center.current)
          .normalize();
        const target = origin.clone().addScaledVector(dir, explodeDistance);
        setWorldPosition(child, target);
      }
    });
  }, [explodeDistance, scene]);

  return null;
}

// --- helpers ---

/**
 * Set the world position of a child object by converting
 * the desired world coordinate into its parent's local space.
 */
function setWorldPosition(obj: THREE.Object3D, worldPos: THREE.Vector3) {
  const parent = obj.parent;
  if (parent) {
    const local = parent.worldToLocal(worldPos.clone());
    obj.position.copy(local);
  } else {
    obj.position.copy(worldPos);
  }
}
