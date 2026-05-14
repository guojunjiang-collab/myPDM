import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { Center, Bounds } from '@react-three/drei';
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

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setDRACOLoader(dracoLoader);
  });

  useEffect(() => {
    if (gltf) setLoadingState('ready');
  }, [gltf, setLoadingState]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material;
        if (Array.isArray(mat)) return;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.wireframe = wireframe;
        }
        const name = child.name || child.uuid;
        if (visibleParts.size > 0 && !visibleParts.has(name)) child.visible = false;
        else child.visible = true;
        if (highlightedPartId === name && mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive = new THREE.Color(0x4488ff);
          mat.emissiveIntensity = 0.6;
        } else if (mat instanceof THREE.MeshStandardMaterial) {
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
    <Center>
      <Bounds fit clip observe margin={1}>
        <group ref={groupRef}>
          <primitive object={gltf.scene} onClick={handleClick} />
        </group>
      </Bounds>
    </Center>
  );
}
