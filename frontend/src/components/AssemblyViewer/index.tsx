import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { assemblyViewerApi, type AssemblyInstance, type AssemblyTreeNode } from '../../services/api';
import { InstancedScene } from './InstancedScene';
import { AssemblyTreePanel } from './AssemblyTreePanel';
import { buildInstanceIndex } from './buildInstanceIndex';
import { useAssemblyStore } from './assemblyViewerStore';

interface Props { revisionId: string; }

export function AssemblyViewer({ revisionId }: Props) {
  const [instances, setInstances] = useState<AssemblyInstance[] | null>(null);
  const [tree, setTree] = useState<AssemblyTreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reset = useAssemblyStore((s) => s.reset);

  useEffect(() => {
    reset();
    Promise.all([assemblyViewerApi.instances(revisionId), assemblyViewerApi.tree(revisionId)])
      .then(([ins, tr]) => { setInstances(ins); setTree(tr); })
      .catch(() => setError('加载装配数据失败'));
  }, [revisionId, reset]);

  const index = useMemo(() => buildInstanceIndex(instances ?? []), [instances]);

  if (error) return <div className="p-4 text-red-500">{error}</div>;
  if (!instances) return <div className="p-4">加载中…</div>;
  if (instances.length === 0) return <div className="p-4">该装配暂无已摆位的零件（先导入装配 STEP）</div>;

  return (
    <div className="flex h-full">
      <AssemblyTreePanel tree={tree} />
      <div className="flex-1">
        <Canvas camera={{ position: [4, 4, 4], fov: 50 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 10, 7]} intensity={1} />
          <InstancedScene instances={instances} index={index} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
}
