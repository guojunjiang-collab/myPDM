import { describe, it, expect } from 'vitest';
import { buildAssemblyTreeNodes } from './buildAssemblyTreeNodes';
import type { AssemblyTreeNode } from '../../services/api';

const node = (over: Partial<AssemblyTreeNode>): AssemblyTreeNode => ({
  bom_item_id: 'x', part_code: 'X', part_name: '', quantity: 1,
  instance_count: 1, is_leaf: true, children: [], ...over,
});

describe('buildAssemblyTreeNodes', () => {
  it('returns null for empty tree', () => {
    expect(buildAssemblyTreeNodes([], new Map())).toBeNull();
  });

  it('converts a sub-assembly with a leaf and attaches mesh uuids to the leaf', () => {
    const tree: AssemblyTreeNode[] = [
      node({
        bom_item_id: 'sub', part_code: 'SUB', is_leaf: false,
        children: [node({ bom_item_id: 'leaf', part_code: 'BOLT' })],
      }),
    ];
    const meshes = new Map<string, string[]>([['leaf', ['m1', 'm2']]]);
    const root = buildAssemblyTreeNodes(tree, meshes)!;

    expect(root.type).toBe('group');
    expect(root.id).toBe('sub');
    const leaf = root.children[0];
    expect(leaf.type).toBe('part');
    expect(leaf.meshUuids).toEqual(['m1', 'm2']);
    // 非叶子节点的 meshUuids = 后代叶子并集
    expect(root.meshUuids).toEqual(['m1', 'm2']);
    expect(leaf.parentId).toBe('sub');
  });

  it('names single/root nodes by part_code only (no name, no count)', () => {
    const tree: AssemblyTreeNode[] = [
      node({ bom_item_id: 'b', part_code: 'SCREW', part_name: '内六角螺钉', instance_count: 4 }),
    ];
    const root = buildAssemblyTreeNodes(tree, new Map([['b', ['a']]]))!;
    expect(root.name).toBe('SCREW');
  });

  it('names expanded instances as "件号#序号" (1-based)', () => {
    const tree: AssemblyTreeNode[] = [
      node({ bom_item_id: 'b', instance_index: 0, part_code: 'SCREW', is_leaf: true }),
      node({ bom_item_id: 'b', instance_index: 1, part_code: 'SCREW', is_leaf: true }),
    ];
    const root = buildAssemblyTreeNodes(tree, new Map([['b:0', ['m0']], ['b:1', ['m1']]]))!;
    expect(root.children.map((c) => c.name).sort()).toEqual(['SCREW#1', 'SCREW#2']);
  });

  it('uses "{bom_item_id}:{instance_index}" key for expanded instances (matches bom_path)', () => {
    // 多实例展开：两节点共享 bom_item_id='b'，靠 instance_index 区分；
    // mesh 按 "b:0" / "b:1" 归属（与实例 bom_path 末段一致）
    const tree: AssemblyTreeNode[] = [
      node({ bom_item_id: 'b', instance_index: 0, part_code: 'SCREW#1', is_leaf: true }),
      node({ bom_item_id: 'b', instance_index: 1, part_code: 'SCREW#2', is_leaf: true }),
    ];
    const meshes = new Map<string, string[]>([['b:0', ['m0']], ['b:1', ['m1']]]);
    const root = buildAssemblyTreeNodes(tree, meshes)!;
    // 顶层多节点 → 虚拟根；两个实例各自拿到自己的 mesh，id 不冲突
    const ids = root.children.map((c) => c.id).sort();
    expect(ids).toEqual(['b:0', 'b:1']);
    const byId = new Map(root.children.map((c) => [c.id, c]));
    expect(byId.get('b:0')!.meshUuids).toEqual(['m0']);
    expect(byId.get('b:1')!.meshUuids).toEqual(['m1']);
  });

  it('wraps multiple top-level nodes in a virtual root', () => {
    const tree: AssemblyTreeNode[] = [
      node({ bom_item_id: 'p1', part_code: 'A' }),
      node({ bom_item_id: 'p2', part_code: 'B' }),
    ];
    const root = buildAssemblyTreeNodes(tree, new Map([['p1', ['x']], ['p2', ['y']]]))!;
    expect(root.id).toBe('assembly-root');
    expect(root.children.map((c) => c.id)).toEqual(['p1', 'p2']);
    expect(root.meshUuids).toEqual(['x', 'y']);
  });
});
