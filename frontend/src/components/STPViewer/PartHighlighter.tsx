import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useViewerStore } from '../../stores/viewerStore';

/**
 * 选中零件的包围盒线框高亮。遍历实时场景(useThree().scene)按 mesh uuid 定位，
 * 单件与装配模式通用。
 *
 * 装配模式下同一件号可能有多个实例(每个实例 = 一个 THREE.LOD)：
 * 按 mesh 的最近 LOD 祖先分组，**每个实例画一个独立小包围盒**；
 * 单件模式无 LOD 祖先 → 整选区一个盒(行为不变)。
 */
export function PartHighlighter() {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const nodeMap = useViewerStore((s) => s.nodeMap);
  const { scene } = useThree();

  const groupRef = useRef<THREE.Group>(null);
  // 可复用的线框盒池：数量随选中实例数增长，多余的隐藏
  const poolRef = useRef<THREE.LineSegments[]>([]);

  const boxGeometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  const lineMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#4488ff', transparent: true, opacity: 0.85, depthTest: false }),
    [],
  );

  const _c = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const pool = poolRef.current;

    const node = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    if (!node) {
      for (const ls of pool) ls.visible = false;
      return;
    }

    const sel = new Set(node.meshUuids);

    // 按"最近 LOD 祖先"分组选中的 mesh，每组一个包围盒；无 LOD → 归入 'single'
    const boxes = new Map<string, THREE.Box3>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !sel.has(mesh.uuid)) return;
      let key = 'single';
      let p: THREE.Object3D | null = mesh;
      while (p) {
        if ((p as THREE.LOD).isLOD) { key = p.uuid; break; }
        p = p.parent;
      }
      let b = boxes.get(key);
      if (!b) { b = new THREE.Box3(); boxes.set(key, b); }
      b.expandByObject(mesh);
    });

    const keys = Array.from(boxes.keys());

    // 扩容盒池
    while (pool.length < keys.length) {
      const ls = new THREE.LineSegments(boxGeometry, lineMaterial);
      ls.renderOrder = 999;
      // 纯装饰性高亮，任何拾取(测量/选中)都不应命中它
      ls.raycast = () => null;
      group.add(ls);
      pool.push(ls);
    }

    // 逐组更新
    keys.forEach((k, i) => {
      const box = boxes.get(k)!;
      const ls = pool[i];
      if (box.isEmpty()) { ls.visible = false; return; }
      box.getCenter(_c);
      box.getSize(_s);
      ls.position.copy(_c);
      ls.scale.set(Math.max(_s.x, 1e-3), Math.max(_s.y, 1e-3), Math.max(_s.z, 1e-3));
      ls.visible = true;
    });
    // 隐藏多余
    for (let i = keys.length; i < pool.length; i++) pool[i].visible = false;
  });

  return <group ref={groupRef} />;
}
