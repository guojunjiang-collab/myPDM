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

function hasAnyMesh(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((o) => { if (!found && isMeshObj(o)) found = true; });
  return found;
}

function buildNode(obj: THREE.Object3D, parentId: string | null): TreeNode {
  const isMesh = isMeshObj(obj);

  const childNodes: TreeNode[] = [];
  let hasNonMeshChild = false;
  if (!isMesh) {
    for (const c of obj.children) {
      if (!hasAnyMesh(c)) continue;
      if (!isMeshObj(c)) hasNonMeshChild = true;
      childNodes.push(buildNode(c, obj.uuid));
    }
  }

  // mesh 节点→叶子；group 节点若所有子节点都是 mesh（无子装配）→折叠为叶子
  const collapse = isMesh || (!hasNonMeshChild && childNodes.length > 0);

  return {
    id: obj.uuid,
    name: obj.name || (isMesh ? '未命名零件' : '未命名组件'),
    type: collapse ? 'part' : 'group',
    meshUuids: collectMeshUuids(obj),
    parentId,
    children: collapse ? [] : childNodes,
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

  // 唯一例外：虚拟根不对应任何 Object3D，用固定 id（其余节点 id 均为 obj.uuid）
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
