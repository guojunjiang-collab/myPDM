import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssemblyInstance } from '../../services/api';
import type { InstanceIndex } from './buildInstanceIndex';
import { useAssemblyStore } from './assemblyViewerStore';

const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const sceneCache = new Map<string, Promise<THREE.Group>>();
function loadScene(url: string): Promise<THREE.Group> {
  if (!sceneCache.has(url)) {
    sceneCache.set(url, loader.loadAsync(url).then((g) => g.scene));
  }
  return sceneCache.get(url)!;
}

const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

interface Props { instances: AssemblyInstance[]; index: InstanceIndex; }

export function InstancedScene({ instances, index }: Props) {
  const [root] = useState(() => new THREE.Group());
  const lodByPath = useRef<Map<string, THREE.LOD>>(new Map());
  const selectBomItem = useAssemblyStore((s) => s.selectBomItem);

  useEffect(() => {
    let cancelled = false;
    root.matrixAutoUpdate = false;
    root.matrix.copy(Z_UP_TO_Y_UP);
    lodByPath.current.clear();

    (async () => {
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
        fineC.traverse((c: THREE.Object3D) => {
          const m = c as THREE.Mesh;
          if (m.isMesh && m.material && !Array.isArray(m.material)) m.material = (m.material as THREE.Material).clone();
        });

        const size = new THREE.Box3().setFromObject(fineC).getSize(new THREE.Vector3()).length() || 1;
        lod.addLevel(fineC, 0);
        lod.addLevel(normalC, size * 4);
        lod.addLevel(coarseC, size * 12);

        lod.matrixAutoUpdate = false;
        lod.matrix.fromArray(inst.matrix).transpose();
        lod.userData.path = inst.path;
        lod.userData.bomPath = inst.bom_path;
        root.add(lod);
        lodByPath.current.set(inst.path, lod);
      }
    })();

    return () => { cancelled = true; root.clear(); lodByPath.current.clear(); };
  }, [instances, root]);

  useEffect(() => {
    const apply = (state: ReturnType<typeof useAssemblyStore.getState>) => {
      const { selectedBomItemId, hiddenBomItemIds, isolateMode } = state;
      const selectedPaths = selectedBomItemId
        ? index.pathsByBomItem.get(selectedBomItemId) ?? new Set<string>()
        : null;

      lodByPath.current.forEach((lod, path) => {
        const bomPath: string[] = lod.userData.bomPath ?? [];
        const hidden = bomPath.some((id) => hiddenBomItemIds.has(id));
        lod.visible = !hidden;

        const isSelected = selectedPaths ? selectedPaths.has(path) : false;
        lod.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (!mesh.isMesh || Array.isArray(mesh.material)) return;
          const std = mesh.material as THREE.MeshStandardMaterial;
          if (!selectedPaths) {
            if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
            std.transparent = false; std.opacity = 1; std.depthWrite = true;
          } else if (isSelected) {
            if (std.emissive) { std.emissive.setHex(0x224488); std.emissiveIntensity = 0.5; }
            std.transparent = false; std.opacity = 1; std.depthWrite = true;
          } else {
            if (std.emissive) { std.emissive.setHex(0x000000); std.emissiveIntensity = 0; }
            if (isolateMode) { std.transparent = true; std.opacity = 0.12; std.depthWrite = false; }
            else { std.transparent = false; std.opacity = 1; std.depthWrite = true; }
          }
          std.needsUpdate = true;
        });
      });
    };
    apply(useAssemblyStore.getState());
    return useAssemblyStore.subscribe(apply);
  }, [index]);

  useEffect(() => {
    let prev = useAssemblyStore.getState().wireframe;
    const apply = (wf: boolean) => {
      lodByPath.current.forEach((lod) => {
        lod.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (mesh.isMesh && !Array.isArray(mesh.material)) {
            (mesh.material as any).wireframe = wf;
          }
        });
      });
    };
    apply(prev);
    return useAssemblyStore.subscribe((s) => {
      if (s.wireframe !== prev) { prev = s.wireframe; apply(s.wireframe); }
    });
  }, []);

  useEffect(() => {
    let prev = useAssemblyStore.getState().explodeFactor;
    const apply = (ef: number) => {
      lodByPath.current.forEach((lod, path) => {
        const inst = instances.find((i) => i.path === path);
        if (!inst) return;
        const center = new THREE.Vector3(inst.matrix[3], inst.matrix[7], inst.matrix[11]);
        const len = center.length();
        if (len < 0.001) return;
        const dir = center.clone().normalize();
        const offset = dir.multiplyScalar(ef * 0.5);
        lod.matrix.fromArray(inst.matrix).transpose();
        lod.matrix.elements[12] += offset.x;
        lod.matrix.elements[13] += offset.y;
        lod.matrix.elements[14] += offset.z;
      });
    };
    apply(prev);
    return useAssemblyStore.subscribe((s) => {
      if (s.explodeFactor !== prev) { prev = s.explodeFactor; apply(s.explodeFactor); }
    });
  }, [instances]);

  const handleClick = (e: any) => {
    e.stopPropagation();
    let obj: THREE.Object3D | null = e.object;
    while (obj && !(obj as THREE.LOD).isLOD) obj = obj.parent;
    const bomPath: string[] | undefined = obj?.userData?.bomPath;
    if (bomPath && bomPath.length) selectBomItem(bomPath[bomPath.length - 1]);
  };

  return <primitive object={root} onClick={handleClick} />;
}
