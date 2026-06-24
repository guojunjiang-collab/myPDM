import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { useViewerStore } from '../../stores/viewerStore';
import { buildModelTree } from './buildModelTree';
import { buildColorMap } from './autoColor';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

interface ModelLoaderProps {
  url: string;
}

export function ModelLoader({ url }: ModelLoaderProps) {
  const {
    setLoadingState, setModelScale, setTreeData, selectByMesh,
    selectedNodeId, isolateMode, nodeMap, hiddenParts, wireframe, resetViewTrigger,
    measureMode, autoColor,
  } = useViewerStore();
  const setInitialState = useViewerStore((s) => s.setInitialState);
  const groupRef = useRef<THREE.Group>(null);
  const origColorRef = useRef<Map<string, number>>(new Map());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.setDRACOLoader(dracoLoader);
  });

  // Mark ready immediately, then compute scale in background
  useEffect(() => {
    if (!gltf?.scene || !groupRef.current) return;

    // 1) 每个 mesh 独立材质，避免隔离透明时共享材质互相影响。
    // 注意：这会就地修改 useLoader 缓存的 gltf.scene 材质（按 url 缓存），
    // 同一模型的其他消费者(如 PartHighlighter)将看到 clone 后的材质。
    // 高亮/隔离 useEffect 依赖此步先于其执行——二者同一次挂载内按声明顺序运行。
    gltf.scene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        m.material = (m.material as THREE.Material).clone();
      }
    });

    // 2) 解析装配树
    // 1b) 记录每个单材质 mesh 的原始颜色，供自动上色关闭时还原
    origColorRef.current = new Map();
    gltf.scene.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        const std = m.material as THREE.MeshStandardMaterial;
        if (std.color) origColorRef.current.set(m.uuid, std.color.getHex());
      }
    });

    setTreeData(buildModelTree(gltf.scene));

    setLoadingState('ready');

    // 3) 缩放居中 + 保存初始状态
    requestAnimationFrame(() => {
      if (!groupRef.current) return;
      const box = new THREE.Box3().setFromObject(gltf.scene);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0.001 ? 4 / maxDim : 1;
      // Mayo/OpenCascade 导出的 glTF 以"米"为单位(1 单位=1000mm)。
      // modelScale = 显示坐标 → 真实毫米 的换算系数，供测量工具反算物理尺寸。
      // distance_mm = worldDist / modelScale = (mDist_米 * scale) / (scale/1000) = mDist_米 * 1000
      setModelScale(scale / 1000);
      const center = box.getCenter(new THREE.Vector3());
      groupRef.current.scale.setScalar(scale);
      groupRef.current.position.copy(center.multiplyScalar(-scale));
      // 保存初始状态用于重置
      setInitialState({
        groupScale: scale,
        groupPos: [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z],
        camPos: [5, 5, 5],
        camTarget: [0, 0, 0],
      });
    });
  }, [gltf, setLoadingState, setModelScale, setTreeData]);

  // 重置：恢复到加载时的初始视角和大小
  useEffect(() => {
    if (resetViewTrigger === 0) return;
    if (!groupRef.current) return;
    const { initGroupScale, initGroupPos } = useViewerStore.getState();
    groupRef.current.scale.setScalar(initGroupScale);
    groupRef.current.position.set(...initGroupPos);
  }, [resetViewTrigger]);

  useEffect(() => {
    if (!groupRef.current) return;
    const selNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    const sel = selNode ? new Set(selNode.meshUuids) : null;

    groupRef.current.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;

      // 显隐不依赖材质，先处理，使多材质 mesh 也能正常隐藏/显示
      mesh.visible = !hiddenParts.has(mesh.uuid);

      const mat = mesh.material;
      if (Array.isArray(mat)) return; // 多材质 mesh：跳过高亮/隔离/线框样式
      const std = mat as THREE.MeshStandardMaterial;

      std.wireframe = wireframe;

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

  // 自动上色：按零件名称着色；关闭时还原原始色。只改 color，不触碰 emissive/opacity。
  useEffect(() => {
    const group = groupRef.current;
    const { treeData } = useViewerStore.getState();
    if (!group || !treeData) return;

    const target = new Map<string, number>();
    if (autoColor) {
      const names: string[] = [];
      nodeMap.forEach((n) => { if (n.type === 'part') names.push(n.name); });
      const colorMap = buildColorMap(names);
      nodeMap.forEach((n) => {
        if (n.type !== 'part') return;
        const color = colorMap.get(n.name);
        if (color === undefined) return;
        n.meshUuids.forEach((u) => target.set(u, color));
      });
    } else {
      origColorRef.current.forEach((hex, uuid) => target.set(uuid, hex));
    }

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) return;
      const std = mat as THREE.MeshStandardMaterial;
      const hex = target.get(mesh.uuid);
      if (hex === undefined || !std.color) return;
      std.color.setHex(hex);
      std.needsUpdate = true;
    });
  }, [autoColor, nodeMap]);

  const handlePointerDown = (e: any) => {
    pointerDown.current = { x: e.clientX, y: e.clientY };
  };

  const handleClick = (e: any) => {
    e.stopPropagation();
    // 测量模式下屏蔽零件选中/高亮，让左键专用于拾取测量点
    if (measureMode !== 'off') {
      pointerDown.current = null;
      return;
    }
    // 旋转/拖拽过程中不触发选中（移动超过 3px 视为拖拽）
    if (pointerDown.current) {
      const dx = e.clientX - pointerDown.current.x;
      const dy = e.clientY - pointerDown.current.y;
      pointerDown.current = null;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) return;
    }
    if (e.object?.uuid) selectByMesh(e.object.uuid);
  };

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} onPointerDown={handlePointerDown} onClick={handleClick} />
    </group>
  );
}
