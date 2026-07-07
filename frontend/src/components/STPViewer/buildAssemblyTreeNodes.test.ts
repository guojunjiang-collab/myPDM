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

  it('labels multi-instance leaves with a count suffix', () => {
    const tree: AssemblyTreeNode[] = [
      node({ bom_item_id: 'b', part_code: 'SCREW', instance_count: 4 }),
    ];
    const root = buildAssemblyTreeNodes(tree, new Map([['b', ['a', 'b', 'c', 'd']]]))!;
    expect(root.name).toBe('SCREW ×4');
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
