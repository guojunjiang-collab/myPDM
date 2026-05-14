import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useViewerStore } from '../../stores/viewerStore';

interface PartHighlighterProps {
  /** The GLB model URL — must match the URL passed to ModelLoader */
  url: string;
}

/**
 * PartHighlighter renders a bounding-box outline around the currently
 * selected mesh in the 3D scene. It reads `selectedPartId` from viewerStore
 * and overlays a pulsing wireframe box on the target mesh.
 *
 * Integration: add `<PartHighlighter url={modelUrl} />` inside the
 * `<Suspense>` block in ViewerCanvas, as a sibling of `<ModelLoader>`.
 * The same `useGLTF` URL ensures drei's internal cache prevents a second load.
 */
export function PartHighlighter({ url }: PartHighlighterProps) {
  const selectedPartId = useViewerStore((s) => s.selectedPartId);
  const lineRef = useRef<THREE.LineSegments>(null);

  // Access the cached scene (drei reuses the same GLTF loaded by ModelLoader)
  const { scene } = useGLTF(url);

  // Shared unit-box EdgesGeometry — scaled & positioned per frame
  const edgeGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.EdgesGeometry(box);
  }, []);

  // Shared material — opacity is updated per frame for pulse effect
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#4488ff',
        transparent: true,
        opacity: 0.8,
        depthTest: true,
      }),
    []
  );

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    if (!selectedPartId) {
      line.visible = false;
      return;
    }

    // Traverse scene to find the selected mesh
    let found = false;
    scene.traverse((child) => {
      if (found) return; // short-circuit after first match

      if (child instanceof THREE.Mesh && child.name === selectedPartId) {
        // Compute world-space bounding box (accounts for parent transforms)
        const box = new THREE.Box3().setFromObject(child);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Position & scale the outline to match the mesh bounds
        line.position.copy(center);
        line.scale.copy(size);
        line.visible = true;

        // Pulse opacity for visual feedback
        const t = Date.now() * 0.003;
        (line.material as THREE.LineBasicMaterial).opacity =
          0.55 + Math.sin(t) * 0.25;

        found = true;
      }
    });

    if (!found) {
      line.visible = false;
    }
  });

  return (
    <lineSegments ref={lineRef} visible={false} geometry={edgeGeometry} material={lineMaterial} />
  );
}
