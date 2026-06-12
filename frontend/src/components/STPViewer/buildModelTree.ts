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
  const isMesh = isMeshObj(obj);
  // 约定：part = 自身带 mesh 的节点；group = 仅分组的节点。
  // 真实 Mayo/OCC 装配 GLB 里 part 一般是叶子(无子节点)，group 才有子节点。
  // 但若某 part 节点恰好也带子节点(部分导出器可能产生)，仍会被归为 part，
  // 且其 meshUuids 会聚合整子树——下游高亮/显隐据此处理。
  return {
    id: obj.uuid,
    name: obj.name || (isMesh ? '未命名零件' : '未命名组件'),
    type: isMesh ? 'part' : 'group',
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
