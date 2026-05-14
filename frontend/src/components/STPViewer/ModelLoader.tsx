import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { useGLTF } from '@react-three/drei';
import { useViewerStore } from '../../stores/viewerStore';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

interface ModelLoaderProps {
  url: string;
}

export function ModelLoader({ url }: ModelLoaderProps) {
  const { setLoadingState, selectPart, highlightedPartId, visibleParts, wireframe } =
    useViewerStore();
  const groupRef = useRef<THREE.Group>(null);

  const { scene } = useGLTF(url, true, false, (loader: any) => {
    loader.setDRACOLoader?.(dracoLoader);
  });

  useEffect(() => {
    if (scene) setLoadingState('ready');
  }, [scene, setLoadingState]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.wireframe = wireframe;
        const name = child.name || child.uuid;
        if (visibleParts.size > 0 && !visibleParts.has(name)) child.visible = false;
        else child.visible = true;
        if (highlightedPartId === name) {
          mat.emissive = new THREE.Color(0x4488ff);
          mat.emissiveIntensity = 0.6;
        } else {
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    });
  }, [wireframe, visibleParts, highlightedPartId]);

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (e.object?.name) selectPart(e.object.name);
  };

  return (
    <group ref={groupRef}>
      <primitive object={scene} onClick={handleClick} />
    </group>
  );
}
