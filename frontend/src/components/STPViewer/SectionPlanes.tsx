import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../../stores/viewerStore';

/**
 * Clipping plane component — lives inside the R3F Canvas.
 * Reads clipPlanes from viewerStore and applies them as
 * THREE.Plane objects to both the renderer and all mesh materials.
 */
export function SectionPlanes() {
  const { scene, gl } = useThree();
  const clipPlanes = useViewerStore((s) => s.clipPlanes);

  useEffect(() => {
    gl.localClippingEnabled = true;

    const planes: THREE.Plane[] = clipPlanes.map((cp) => {
      const sign = cp.flip ? -1 : 1;
      const normal = new THREE.Vector3(
        cp.axis === 'x' ? sign : 0,
        cp.axis === 'y' ? sign : 0,
        cp.axis === 'z' ? sign : 0,
      );
      return new THREE.Plane(normal, -cp.position * sign);
    });

    // Global clipping fallback
    gl.clippingPlanes = planes;

    // Per-material clipping (required when localClippingEnabled = true)
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material)
        ? child.material
        : [child.material];
      for (const mat of mats) {
        mat.clippingPlanes = planes.length > 0 ? planes : null;
        mat.clipShadows = true;
        mat.needsUpdate = true;
      }
    });

    // Restore on unmount
    return () => {
      gl.clippingPlanes = [];
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const mat of mats) {
          mat.clippingPlanes = null;
          mat.needsUpdate = true;
        }
      });
    };
  }, [clipPlanes, scene, gl]);

  return null;
}
