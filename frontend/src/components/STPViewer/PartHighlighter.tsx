import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useViewerStore } from '../../stores/viewerStore';

interface PartHighlighterProps {
  url: string;
}

export function PartHighlighter({ url }: PartHighlighterProps) {
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId);
  const nodeMap = useViewerStore((s) => s.nodeMap);
  const lineRef = useRef<THREE.LineSegments>(null);

  const { scene } = useGLTF(url);

  const edgeGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    return new THREE.EdgesGeometry(box);
  }, []);

  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#4488ff',
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    []
  );

  const _box = useMemo(() => new THREE.Box3(), []);
  const _c = useMemo(() => new THREE.Vector3(), []);
  const _s = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    const node = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    if (!node) { line.visible = false; return; }

    const sel = new Set(node.meshUuids);
    _box.makeEmpty();
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && sel.has(o.uuid)) _box.expandByObject(o);
    });
    if (_box.isEmpty()) { line.visible = false; return; }

    _box.getCenter(_c);
    _box.getSize(_s);
    line.position.copy(_c);
    line.scale.set(Math.max(_s.x, 1e-3), Math.max(_s.y, 1e-3), Math.max(_s.z, 1e-3));
    line.visible = true;
  });

  return (
    <lineSegments
      ref={lineRef}
      visible={false}
      geometry={edgeGeometry}
      material={lineMaterial}
      renderOrder={999}
      // 纯装饰性高亮包围盒——任何拾取(测量/选中)都不应命中它。
      // three.js raycaster 不跳过 visible=false 的对象，故显式置空 raycast。
      raycast={() => null}
    />
  );
}
