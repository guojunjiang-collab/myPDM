import { describe, it, expect } from 'vitest';
import { filterCompareTree } from './compareTreeFilter';
import type { CompareNode, ChangeType } from './compareTypes';

const n = (key: string, changeType: ChangeType, children: CompareNode[] = []): CompareNode => ({
  key, parentKey: null, level: 0, changeType,
  left: null, right: null, children,
});

const keys = (node: CompareNode): string[] => [node.key, ...node.children.flatMap(keys)];

describe('filterCompareTree', () => {
  it('onlyDiff=false 时原样返回同一棵树', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    expect(filterCompareTree(root, false)).toBe(root);
  });

  it('剪掉纯未变子树', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    expect(keys(filterCompareTree(root, true))).toEqual(['ROOT', '/B']);
  });

  it('保留含差异子孙的未变父节点（作为路径上下文）', () => {
    const root = n('ROOT', 'internal', [
      n('/G', 'internal', [n('/G/X', 'add'), n('/G/Y', 'none')]),
      n('/H', 'none', [n('/H/Z', 'none')]),
    ]);
    const out = filterCompareTree(root, true);
    expect(keys(out)).toEqual(['ROOT', '/G', '/G/X']);
  });

  it('ROOT 始终保留，即使全无差异', () => {
    const root = n('ROOT', 'none', [n('/A', 'none')]);
    const out = filterCompareTree(root, true);
    expect(out.key).toBe('ROOT');
    expect(out.children).toEqual([]);
  });

  it('不修改原树（返回新对象）', () => {
    const root = n('ROOT', 'internal', [n('/A', 'none'), n('/B', 'add')]);
    const out = filterCompareTree(root, true);
    expect(root.children).toHaveLength(2);
    expect(out).not.toBe(root);
  });

  it('modify / delete 与 add 一样被保留', () => {
    const root = n('ROOT', 'internal', [n('/A', 'modify'), n('/B', 'delete'), n('/C', 'none')]);
    expect(keys(filterCompareTree(root, true))).toEqual(['ROOT', '/A', '/B']);
  });
});
