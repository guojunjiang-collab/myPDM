import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useViewerStore } from '../../stores/viewerStore';
import { useSceneVisualState } from './useSceneVisualState';
import { buildAssemblyTreeNodes } from './buildAssemblyTreeNodes';
import { mergeMeshUuidsIntoConfigTree } from './buildConfigTreeNodes';
import type { TreeNode } from './treeTypes';
import type { AssemblyInstance, AssemblyTreeNode } from '../../services/api';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

// 拉取 GLB 二进制；若叶项尚未转换（后端返回 202），轮询等待转换完成后再解析。
async function fetchGlbBuffer(url: string): Promise<ArrayBuffer> {
  const maxTries = 60; // 最多 ~120 秒
  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(url);
    if (resp.status === 200) return await resp.arrayBuffer();
    if (resp.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    throw new Error(`GLB 加载失败: ${resp.status}`);
  }
  throw new Error('GLB 转换超时');
}

// 按 url 缓存已加载的 GLB 场景（去重：同一零件只下载一次）
const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    const p = fetchGlbBuffer(url)
      .then((buf) => loader.parseAsync(buf, ''))
      .then((g) => g.scene)
      .catch((err) => {
        sceneCache.delete(url); // 失败不缓存，允许重试
        throw err;
      });
    sceneCache.set(url, p);
  }
  return sceneCache.get(url)!;
}

// STEP(Z-up) → three(Y-up)：绕 X 轴 -90°，施加在装配根 group
const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

// 按装配树 DFS 得到叶子 key 顺序（key 与实例 bom_path 末段一致），用于让画面自上而下填充
function leafOrderFromTree(tree: AssemblyTreeNode[]): string[] {
  const order: string[] = [];
  const keyOf = (n: AssemblyTreeNode) =>
    n.instance_index !== undefined && n.instance_index !== null
      ? `${n.bom_item_id}:${n.instance_index}`
      : n.bom_item_id;
  const walk = (nodes: AssemblyTreeNode[]) => {
    for (const n of nodes) {
      if (n.is_leaf || !n.children || n.children.length === 0) order.push(keyOf(n));
      else walk(n.children);
    }
  };
  walk(tree);
  return order;
}

interface Props {
  instances: AssemblyInstance[];
  tree: AssemblyTreeNode[];
  applyZUp?: boolean;
  displayTree?: TreeNode | null;
}

/**
 * 装配场景加载器：把每个实例 GLB clone + 贴世界矩阵摆好，
 * 并把结构/几何注册进 viewerStore（与单件 ModelLoader 同构），
 * 从而复用同一套树面板/工具栏/高亮/隔离/剖切/测量/爆炸/重置逻辑。
 */
export function AssemblyModelLoader({ instances, tree, applyZUp = true, displayTree }: Props) {
  const { setTreeData, setModelScale, setLoadingState, selectByMesh, resetViewTrigger, measureMode, mergeInstanceMeshes, setStreamProgress } =
    useViewerStore();
  const setInitialState = useViewerStore((s) => s.setInitialState);
  const groupRef = useRef<THREE.Group>(null);
  const [rootGroup] = useState(() => new THREE.Group());
  const origColorRef = useRef<Map<string, number>>(new Map());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();
  const userInteracted = useRef(false);

  // 选中高亮 / 隔离 / 显隐 / 线框 / 自动上色 —— 与单件模式共用
  useSceneVisualState(groupRef, origColorRef);

  // 探测用户是否手动操作过相机：一旦交互，收尾 refit 让位、不再抢镜头
  useEffect(() => {
    const el = gl.domElement;
    const mark = () => { userInteracted.current = true; };
    el.addEventListener('pointerdown', mark);
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', mark);
      el.removeEventListener('wheel', mark);
    };
  }, [gl]);

  // 加载 + 摆位 + 注册进 viewerStore
  useEffect(() => {
    let cancelled = false;
    userInteracted.current = false;
    rootGroup.matrixAutoUpdate = false;
    if (applyZUp) {
      rootGroup.matrix.copy(Z_UP_TO_Y_UP);
    } else {
      rootGroup.matrix.identity();
    }
    rootGroup.clear();
    // config 模式有 displayTree 时，树数据已由 STPViewer 预设好，不覆盖 loadingState
    if (!displayTree) {
      // 装配模式：立即用空 mesh 的完整树渲染面板，并让画布可见可交互
      setTreeData(buildAssemblyTreeNodes(tree, new Map<string, string[]>()));
      setLoadingState('ready');
      setStreamProgress({ loaded: 0, total: instances.length });
    }

    const fitToView = (preBBox?: THREE.Box3) => {
      if (!groupRef.current) return;
      // 先把外层 group 复位到单位变换再测量：setFromObject 取的是世界包围盒，
      // 而 rootGroup 是 groupRef 的子级；若不复位，本次测量会包含上一次取景施加的
      // 缩放/位移，导致反复取景时缩放不断被重复相除，模型越缩越小、漂出视野。
      groupRef.current.scale.setScalar(1);
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.updateMatrixWorld(true);
      const box = preBBox ? preBBox.clone() : new THREE.Box3().setFromObject(rootGroup);
      if (box.isEmpty()) return;
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z);
      const scale = maxDim > 0.001 ? 10 / maxDim : 1;
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
    };

    // 装配模式：用所有实例位置预计算整体空间范围，做一次初始取景
    // 避免仅依赖首个(可能很小的)零件定标导致后续大零件穿过近裁剪面
    if (!displayTree && instances.length > 0) {
      const roughBox = new THREE.Box3();
      for (const inst of instances) {
        const p = new THREE.Vector3(inst.matrix[3], inst.matrix[7], inst.matrix[11]);
        p.applyMatrix4(Z_UP_TO_Y_UP);
        roughBox.expandByPoint(p);
      }
      const diag = roughBox.getSize(new THREE.Vector3()).length();
      if (diag < 0.001) {
        roughBox.expandByPoint(new THREE.Vector3(1, 1, 1));
        roughBox.expandByPoint(new THREE.Vector3(-1, -1, -1));
      }
      roughBox.expandByScalar(diag * 0.15);
      fitToView(roughBox);
    }

    (async () => {
      const meshByBomItem = new Map<string, string[]>();
      const origColor = new Map<string, number>();

      const order = leafOrderFromTree(tree);
      const orderIdx = new Map(order.map((k, i) => [k, i]));
      const rank = (inst: AssemblyInstance) => {
        const k = inst.bom_path[inst.bom_path.length - 1];
        const i = orderIdx.get(k);
        return i === undefined ? Number.MAX_SAFE_INTEGER : i;
      };
      const ordered = [...instances].sort((a, b) => rank(a) - rank(b));
      let loadedCount = 0;
      for (const inst of ordered) {
        let coarse: THREE.Group, normal: THREE.Group, fine: THREE.Group;
        try {
          [coarse, normal, fine] = await Promise.all([
            loadScene(inst.glb_urls.coarse),
            loadScene(inst.glb_urls.normal),
            loadScene(inst.glb_urls.fine),
          ]);
        } catch (err) {
          // 单个零件加载/转换失败时跳过，不影响整个装配渲染
          console.warn(`装配零件加载失败，已跳过: ${inst.part_code}`, err);
          continue;
        }
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

        // 叶子 BOM 链接 id = bom_path 末段；收集该实例所有层级的 mesh uuid（单次遍历）
        const leafBom = inst.bom_path[inst.bom_path.length - 1];
        const uuids: string[] = [];
        lod.traverse((c) => { if ((c as THREE.Mesh).isMesh) uuids.push(c.uuid); });
        if (leafBom) {
          const list = meshByBomItem.get(leafBom) ?? [];
          list.push(...uuids);
          meshByBomItem.set(leafBom, list);
        }
        // 流式：装配模式增量把该实例 mesh 并入树节点并更新进度
        if (!displayTree) {
          if (leafBom) mergeInstanceMeshes(leafBom, uuids);
          loadedCount++;
          setStreamProgress({ loaded: loadedCount, total: ordered.length });
        }
      }

      if (cancelled) return;
      origColorRef.current = origColor;

      if (displayTree) {
        // config 模式：树保持一次性写入（退化路径，不做增量流式）
        const merged = mergeMeshUuidsIntoConfigTree(displayTree, tree, meshByBomItem);
        setTreeData(merged);
        fitToView();
      } else {
        // 装配模式：树已在流式中增量写好；进度收尾清空
        setStreamProgress(null);
        // 收尾按完整装配取景（让位于用户交互）
        if (!userInteracted.current) fitToView();
      }

      setLoadingState('ready');
    })();

    return () => { cancelled = true; rootGroup.clear(); setStreamProgress(null); };
  }, [instances, tree, rootGroup, setTreeData, setModelScale, setLoadingState, setInitialState, mergeInstanceMeshes, setStreamProgress, displayTree]);

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
