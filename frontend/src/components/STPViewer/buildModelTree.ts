import * as THREE from 'three';
import type { TreeNode } from './treeTypes';

function isMeshObj(obj: THREE.Object3D): boolean {
  return (obj as THREE.Mesh).isMesh === true;
}

/** 收集 obj 自身及所有后代里的 mesh uuid */
function collectMeshUuids(obj: THREE.Object3D): string[] {
  const out: string[] = [];
  obj.traverse((o) => {
    if (isMeshObj(o)) out.push(o.uuid);
  });
  return out;
}

function buildNode(obj: THREE.Object3D, parentId: string | null): TreeNode {
  const mesh = isMeshObj(obj);
  return {
    id: obj.uuid,
    name: obj.name || (mesh ? '未命名零件' : '未命名组件'),
    type: mesh ? 'part' : 'group',
    meshUuids: collectMeshUuids(obj),
    parentId,
    children: obj.children.map((c) => buildNode(c, obj.uuid)),
  };
}

/**
 * 把 gltf.scene 的 Object3D 层级解析成装配树。
 * - 单一顶层节点(典型 Mayo 装配根) → 直接以它为树根
 * - 多个顶层节点(扁平 GLB) → 合成虚拟根，子节点平铺
 * - 空场景 → null
 */
export function buildModelTree(root: THREE.Object3D): TreeNode | null {
  const top = root.children;
  if (top.length === 0) return null;
  if (top.length === 1) return buildNode(top[0], null);

  const virtualId = 'virtual-root';
  return {
    id: virtualId,
    name: '模型',
    type: 'group',
    meshUuids: collectMeshUuids(root),
    parentId: null,
    children: top.map((c) => buildNode(c, virtualId)),
  };
}
