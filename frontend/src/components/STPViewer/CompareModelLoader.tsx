import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useViewerStore } from '../../stores/viewerStore';
import { useCompareVisualState } from './useCompareVisualState';
import { renderDecision } from './compareRenderRules';
import type { CompareNode, CompareInstanceNode, Side, ChangeType } from './compareTypes';
import type { AssemblyInstance } from '../../services/api';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

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

// 按 url 缓存：左右两版共用的零件 GLB url 相同，只下载一次
const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    const p = fetchGlbBuffer(url)
      .then((buf) => loader.parseAsync(buf, ''))
      .then((g) => g.scene)
      .catch((err) => {
        sceneCache.delete(url);
        throw err;
      });
    sceneCache.set(url, p);
  }
  return sceneCache.get(url)!;
}

// STEP(Z-up) → three(Y-up)
const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

/** 实例 bom_path 末段 "{bomItemId}" 或 "{bomItemId}:{idx}" → bomItemId */
function bomItemIdOf(inst: AssemblyInstance): string {
  const last = inst.bom_path[inst.bom_path.length - 1] || '';
  const i = last.indexOf(':');
  return i >= 0 ? last.slice(0, i) : last;
}

/** bomItemId → 配对行 key（按侧别建索引） */
function indexByBomItem(tree: CompareNode, side: Side): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (n: CompareNode) => {
    const s = n[side];
    if (s && s.bomItemId) map.set(s.bomItemId, n.key);
    n.children.forEach(visit);
  };
  visit(tree);
  return map;
}

/** 矩阵稳定标识（4 位小数取整） */
function matrixKey(m: number[]): string {
  return m.map(v => v.toFixed(4)).join(',');
}

/** 对同一 bomItemId 的左右实例做矩阵匹配，产出实例子节点列表 */
function matchInstances(
  nodeKey: string,
  leftMats: { idx: number; matrix: number[] }[],
  rightMats: { idx: number; matrix: number[] }[],
): CompareInstanceNode[] {
  const instances: CompareInstanceNode[] = [];
  const matchedRight = new Set<number>();

  // 左→右匹配
  for (const lm of leftMats) {
    const mk = matrixKey(lm.matrix);
    const ri = rightMats.findIndex((rm, i) => !matchedRight.has(i) && matrixKey(rm.matrix) === mk);
    if (ri >= 0) {
      matchedRight.add(ri);
      instances.push({ key: `${nodeKey}:inst:${lm.idx}`, changeType: 'none', side: 'both', leftIndex: lm.idx, rightIndex: rightMats[ri].idx, meshUuid: '', label: '', seq: 0 });
    } else {
      instances.push({ key: `${nodeKey}:inst:${lm.idx}`, changeType: 'delete', side: 'left', leftIndex: lm.idx, meshUuid: '', label: '', seq: 0 });
    }
  }
  // 右未匹配
  for (let i = 0; i < rightMats.length; i++) {
    if (!matchedRight.has(i)) {
      instances.push({ key: `${nodeKey}:inst:r${i}`, changeType: 'add', side: 'right', rightIndex: i, meshUuid: '', label: '', seq: 0 });
    }
  }
  return instances;
}

interface Props {
  leftInstances: AssemblyInstance[];
  rightInstances: AssemblyInstance[];
}

/**
 * 对比场景加载器：把左右两版实例按变更规则加载进同一场景。
 *
 * 坐标不做任何对齐补偿——两侧矩阵原样使用（设计决定）。
 * 未变件只画左侧一份以避免重合几何 z-fighting；modify 件两侧都画。
 */
export function CompareModelLoader({ leftInstances, rightInstances }: Props) {
  const mergeCompareMeshes = useViewerStore((s) => s.mergeCompareMeshes);
  const selectCompareByMesh = useViewerStore((s) => s.selectCompareByMesh);
  const setModelScale = useViewerStore((s) => s.setModelScale);
  const setLoadingState = useViewerStore((s) => s.setLoadingState);
  const setStreamProgress = useViewerStore((s) => s.setStreamProgress);
  const setInitialState = useViewerStore((s) => s.setInitialState);
  const resetViewTrigger = useViewerStore((s) => s.resetViewTrigger);
  const measureMode = useViewerStore((s) => s.measureMode);

  const groupRef = useRef<THREE.Group>(null);
  const [rootGroup] = useState(() => new THREE.Group());
  // mesh uuid → 是否为"叠加模式下的 modify 左侧"（幽灵候选），供视觉态使用
  const ghostCandidates = useRef<Set<string>>(new Set());
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();
  const userInteracted = useRef(false);

  useCompareVisualState(groupRef, ghostCandidates);

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

  useEffect(() => {
    let cancelled = false;
    userInteracted.current = false;
    rootGroup.matrixAutoUpdate = false;
    rootGroup.matrix.copy(Z_UP_TO_Y_UP);
    rootGroup.clear();
    ghostCandidates.current = new Set();

    const compare = useViewerStore.getState().compare;
    if (!compare) return;
    const tree = compare.tree;
    const leftIndex = indexByBomItem(tree, 'left');
    const rightIndex = indexByBomItem(tree, 'right');

    setLoadingState('ready');

    const fitToView = (preBBox?: THREE.Box3) => {
      if (!groupRef.current) return;
      groupRef.current.scale.setScalar(1);
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.updateMatrixWorld(true);
      const box = preBBox ? preBBox.clone() : new THREE.Box3().setFromObject(rootGroup);
      if (box.isEmpty()) return;
      const s = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(s.x, s.y, s.z);
      const scale = maxDim > 0.001 ? 16 / maxDim : 1;
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

    // 用两侧全部实例位置预取景，避免首个小零件定标导致大件穿过近裁剪面
    const all = [...leftInstances, ...rightInstances];
    if (all.length > 0) {
      const roughBox = new THREE.Box3();
      for (const inst of all) {
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

    // 逐实例排队：先左后右，保证 modify 的旧版先落位
    const queue: { inst: AssemblyInstance; side: Side }[] = [
      ...leftInstances.map((inst) => ({ inst, side: 'left' as Side })),
      ...rightInstances.map((inst) => ({ inst, side: 'right' as Side })),
    ];

    (async () => {
      // ── 第一遍：按 bomItemId 分组收集矩阵，做实例匹配 ──
      const groupLeft = new Map<string, { idx: number; matrix: number[] }[]>();
      const groupRight = new Map<string, { idx: number; matrix: number[] }[]>();
      let li = 0, ri = 0;
      for (const { inst, side } of queue) {
        const id = bomItemIdOf(inst);
        (side === 'left' ? groupLeft : groupRight).set(
          id, [...((side === 'left' ? groupLeft : groupRight).get(id) || []), { idx: side === 'left' ? li++ : ri++, matrix: inst.matrix }]
        );
      }
      const allIds = new Set([...groupLeft.keys(), ...groupRight.keys()]);
      for (const id of allIds) {
        const nodeKey = leftIndex.get(id) || rightIndex.get(id);
        if (!nodeKey) continue;
        const node = compare.nodeMap.get(nodeKey);
        if (!node) continue;
        const lms = groupLeft.get(id) || [];
        const rms = groupRight.get(id) || [];
        const instances = matchInstances(nodeKey, lms, rms);
        // 生成显示名：件号_版本_名称_序号
        const leftSide = node.left;
        const rightSide = node.right;
        let seq = 0;
        for (const inst of instances) {
          seq++;
          inst.seq = seq;
          const sideData = inst.side === 'left' ? leftSide : inst.side === 'right' ? rightSide : (leftSide || rightSide);
          const code = sideData?.code || id;
          const ver = sideData?.version || '';
          const name = sideData?.name || '';
          inst.label = [code, ver, name, seq].filter(Boolean).join('_');
        }
        node.instances = instances;
      }
      // 强制刷新 compare 状态以触发面板重渲染（实例数据直接修改了节点对象）
      const c = useViewerStore.getState().compare;
      if (c) {
        useViewerStore.setState({ compare: { ...c, tree: { ...c.tree } } });
      }

      // ── 第二遍：加载模型，按实例匹配结果着色 ──
      let loaded = 0;
      const total = queue.length;
      setStreamProgress({ loaded: 0, total });

      for (const { inst, side } of queue) {
        const bomItemId = bomItemIdOf(inst);
        const nodeKey = (side === 'left' ? leftIndex : rightIndex).get(bomItemId);
        if (!nodeKey) { loaded++; setStreamProgress({ loaded, total }); continue; }
        const node = compare.nodeMap.get(nodeKey);
        if (!node) { loaded++; setStreamProgress({ loaded, total }); continue; }

        // 查找该实例对应的实例子节点，确定其变更类型和颜色
        const instances = node.instances || [];
        const mk = matrixKey(inst.matrix);
        let instNode: CompareInstanceNode | undefined;
        if (side === 'left') {
          instNode = instances.find(i => i.leftIndex !== undefined && matrixKey(leftInstances[i.leftIndex]?.matrix || []) === mk);
        } else {
          instNode = instances.find(i => i.rightIndex !== undefined && matrixKey(rightInstances[i.rightIndex]?.matrix || []) === mk);
        }
        const instChangeType: ChangeType = instNode?.changeType ?? node.changeType;
        const decision = renderDecision(instChangeType, 'both');

        let coarse: THREE.Group, normal: THREE.Group, fine: THREE.Group;
        try {
          [coarse, normal, fine] = await Promise.all([
            loadScene(inst.glb_urls.coarse),
            loadScene(inst.glb_urls.normal),
            loadScene(inst.glb_urls.fine),
          ]);
        } catch (err) {
          console.warn(`对比零件加载失败，已跳过: ${inst.part_code}`, err);
          loaded++;
          setStreamProgress({ loaded, total: queue.length });
          continue;
        }
        if (cancelled) return;

        const lod = new THREE.LOD();
        const fineC = cloneSkeleton(fine) as THREE.Group;
        const normalC = cloneSkeleton(normal) as THREE.Group;
        const coarseC = cloneSkeleton(coarse) as THREE.Group;

        // 每个 mesh 独立材质并直接染成变更色（对比模式不走自动上色）
        for (const g of [fineC, normalC, coarseC]) {
          g.traverse((c) => {
            const m = c as THREE.Mesh;
            if (m.isMesh && m.material && !Array.isArray(m.material)) {
              m.material = (m.material as THREE.Material).clone();
              const std = m.material as THREE.MeshStandardMaterial;
              if (std.color) std.color.setHex(decision.color);
            }
          });
        }

        const size = new THREE.Box3().setFromObject(fineC).getSize(new THREE.Vector3()).length() || 1;
        lod.addLevel(fineC, 0);
        lod.addLevel(normalC, size * 4);
        lod.addLevel(coarseC, size * 12);

        lod.matrixAutoUpdate = false;
        lod.matrix.fromArray(inst.matrix).transpose(); // 行主序→three 列主序
        lod.userData.compareSide = side;
        lod.userData.compareKey = nodeKey;
        lod.userData.changeType = instChangeType;
        lod.userData.compareInstanceKey = instNode?.key || '';

        rootGroup.add(lod);

        const uuids: string[] = [];
        lod.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            uuids.push(c.uuid);
            c.userData.compareSide = side;
            c.userData.compareKey = nodeKey;
            c.userData.changeType = instChangeType;
            c.userData.compareInstanceKey = instNode?.key || '';
          }
        });
        if (decision.leftGhost && side === 'left') {
          uuids.forEach((u) => ghostCandidates.current.add(u));
        }
        mergeCompareMeshes(nodeKey, side, uuids);
        // 回填实例子节点的 meshUuid
        if (instNode && uuids.length > 0) {
          instNode.meshUuid = uuids[0];
        }

        loaded++;
        setStreamProgress({ loaded, total: queue.length });
      }

      if (cancelled) return;
      setStreamProgress(null);
      if (!userInteracted.current) fitToView();
      setLoadingState('ready');
    })();

    return () => { cancelled = true; rootGroup.clear(); setStreamProgress(null); };
  }, [leftInstances, rightInstances, rootGroup, mergeCompareMeshes, setModelScale, setLoadingState, setStreamProgress, setInitialState]);

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
    if (e.object?.uuid) selectCompareByMesh(e.object.uuid);
  };

  return (
    <group ref={groupRef}>
      <primitive object={rootGroup} onPointerDown={handlePointerDown} onClick={handleClick} />
    </group>
  );
}
