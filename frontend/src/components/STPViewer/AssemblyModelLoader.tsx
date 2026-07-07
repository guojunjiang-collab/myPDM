import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useViewerStore } from '../../stores/viewerStore';
import { useSceneVisualState } from './useSceneVisualState';
import { buildAssemblyTreeNodes } from './buildAssemblyTreeNodes';
import type { AssemblyInstance, AssemblyTreeNode } from '../../services/api';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

// 按 url 缓存已加载的 GLB 场景（去重：同一零件只下载一次）
const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    sceneCache.set(url, loader.loadAsync(url).then((g) => g.scene));
  }
  return sceneCache.get(url)!;
}

// STEP(Z-up) → three(Y-up)：绕 X 轴 -90°，施加在装配根 group
const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

interface Props {
  instances: AssemblyInstance[];
  tree: AssemblyTreeNode[];
}

/**
 * 装配场景加载器：把每个实例 GLB clone + 贴世界矩阵摆好，
 * 并把结构/几何注册进 viewerStore（与单件 ModelLoader 同构），
 * 从而复用同一套树面板/工具栏/高亮/隔离/剖切/测量/爆炸/重置逻辑。
 */
export function AssemblyModelLoader({ instances, tree }: Props) {
  const { setTreeData, setModelScale, setLoadingState, selectByMesh, resetViewTrigger, measureMode } =
    useViewerStore();
  const setInitialState = useViewerStore((s) => s.setInitialState);
  const groupRef = useRef<THREE.Group>(null);
  const [rootGroup] = useState(() => new THREE.Group());
  const origColorRef = useRef<Map<string, number>>(new Map());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);

  // 选中高亮 / 隔离 / 显隐 / 线框 / 自动上色 —— 与单件模式共用
  useSceneVisualState(groupRef, origColorRef);

  // 加载 + 摆位 + 注册进 viewerStore
  useEffect(() => {
    let cancelled = false;
    rootGroup.matrixAutoUpdate = false;
    rootGroup.matrix.copy(Z_UP_TO_Y_UP);
    rootGroup.clear();
    setLoadingState('loading');

    (async () => {
      const meshByBomItem = new Map<string, string[]>();
      const origColor = new Map<string, number>();

      for (const inst of instances) {
        const [coarse, normal, fine] = await Promise.all([
          loadScene(inst.glb_urls.coarse),
          loadScene(inst.glb_urls.normal),
          loadScene(inst.glb_urls.fine),
        ]);
        if (cancelled) return;

        const lod = new THREE.LOD();
        const fineC = cloneSkeleton(fine) as THREE.Group;
        const normalC = cloneSkeleton(normal) as THREE.Group;
        const coarseC = cloneSkeleton(coarse) as THREE.Group;

        // 每个 mesh 独立材质，避免隔离透明/上色互相影响；同时记录原色
        for (const g of [fineC, normalC, coarseC]) {
          g.traverse((c) => {
            const m = c as THREE.Mesh;
            if (m.isMesh && m.material && !Array.isArray(m.material)) {
              m.material = (m.material as THREE.Material).clone();
              const std = m.material as THREE.MeshStandardMaterial;
              if (std.color) origColor.set(m.uuid, std.color.getHex());
            }
          });
        }

        const size = new THREE.Box3().setFromObject(fineC).getSize(new THREE.Vector3()).length() || 1;
        lod.addLevel(fineC, 0);
        lod.addLevel(normalC, size * 4);
        lod.addLevel(coarseC, size * 12);

        lod.matrixAutoUpdate = false;
        lod.matrix.fromArray(inst.matrix).transpose(); // 行主序→three 列主序

        rootGroup.add(lod);

        // 叶子 BOM 链接 id = bom_path 末段；收集该实例所有层级的 mesh uuid
        const leafBom = inst.bom_path[inst.bom_path.length - 1];
        if (leafBom) {
          const list = meshByBomItem.get(leafBom) ?? [];
          lod.traverse((c) => { if ((c as THREE.Mesh).isMesh) list.push(c.uuid); });
          meshByBomItem.set(leafBom, list);
        }
      }

      if (cancelled) return;
      origColorRef.current = origColor;

      // 注册装配树（走 viewerStore，树面板/高亮/隔离全部复用）
      setTreeData(buildAssemblyTreeNodes(tree, meshByBomItem));

      // 缩放居中 + 保存初始状态（同 ModelLoader）
      rootGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rootGroup);
      if (!box.isEmpty() && groupRef.current) {
        const s = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(s.x, s.y, s.z);
        const scale = maxDim > 0.001 ? 4 / maxDim : 1;
        setModelScale(scale / 1000);
        const center = box.getCenter(new THREE.Vector3());
        groupRef.current.scale.setScalar(scale);
        groupRef.current.position.copy(center.multiplyScalar(-scale));
        setInitialState({
          groupScale: scale,
          groupPos: [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z],
          camPos: [5, 5, 5],
          camTarget: [0, 0, 0],
        });
      }

      setLoadingState('ready');
    })();

    return () => { cancelled = true; rootGroup.clear(); };
  }, [instances, tree, rootGroup, setTreeData, setModelScale, setLoadingState, setInitialState]);

  // 重置：恢复到加载时的初始视角和大小
  useEffect(() => {
    if (resetViewTrigger === 0 || !groupRef.current) return;
    const { initGroupScale, initGroupPos } = useViewerStore.getState();
    groupRef.current.scale.setScalar(initGroupScale);
    groupRef.current.position.set(...initGroupPos);
  }, [resetViewTrigger]);

  const handlePointerDown = (e: any) => { pointerDown.current = { x: e.clientX, y: e.clientY }; };

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (measureMode !== 'off') { pointerDown.current = null; return; }
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
      <primitive object={rootGroup} onPointerDown={handlePointerDown} onClick={handleClick} />
    </group>
  );
}
