import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { useViewerStore } from '../../stores/viewerStore';
import { buildModelTree } from './buildModelTree';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

interface ModelLoaderProps {
  url: string;
}

export function ModelLoader({ url }: ModelLoaderProps) {
  const {
    setLoadingState, setModelScale, setTreeData, selectByMesh,
    selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe,
  } = useViewerStore();
  const groupRef = useRef<THREE.Group>(null);

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setDRACOLoader(dracoLoader);
  });

  // Mark ready immediately, then compute scale in background
  useEffect(() => {
    if (!gltf?.scene || !groupRef.current) return;

    // 1) 每个 mesh 独立材质，避免隔离透明时共享材质互相影响
    gltf.scene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        m.material = (m.material as THREE.Material).clone();
      }
    });

    // 2) 解析装配树
    setTreeData(buildModelTree(gltf.scene));

    setLoadingState('ready');

    // 3) 缩放居中
    requestAnimationFrame(() => {
      if (!groupRef.current) return;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0.001 ? 4 / maxDim : 1;
      const unitScale = maxDim < 0.5 ? 1000 : 1;
      const modelScaleVal = unitScale > 1 ? scale / unitScale : scale;
      setModelScale(modelScaleVal);
      groupRef.current.scale.setScalar(scale);
      groupRef.current.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-scale));
    });
  }, [gltf, setLoadingState, setModelScale, setTreeData]);

  useEffect(() => {
    if (!groupRef.current) return;
    const selNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    const sel = selNode ? new Set(selNode.meshUuids) : null;

    groupRef.current.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      const std = mat as THREE.MeshStandardMaterial;

      std.wireframe = wireframe;
      mesh.visible = !hiddenParts.has(mesh.uuid);

      if (!sel) {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else if (sel.has(mesh.uuid)) {
        if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
        std.transparent = false; std.opacity = 1; std.depthWrite = true;
      } else {
        if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
        if (isolateMode) {
          std.transparent = true; std.opacity = 0.12; std.depthWrite = false;
        } else {
          std.transparent = false; std.opacity = 1; std.depthWrite = true;
        }
      }
      std.needsUpdate = true;
    });
  }, [selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe]);

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (e.object?.uuid) selectByMesh(e.object.uuid);
  };

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} onClick={handleClick} />
    </group>
  );
}
