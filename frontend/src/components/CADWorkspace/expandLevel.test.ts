import { describe, it, expect } from 'vitest';
import { maxLevelOf, buildCollapsedForLevel } from './expandLevel';
import type { BOMRow } from './CADBOMMatchTable';

function makeRow(overrides: Partial<BOMRow>): BOMRow {
  return {
    instance_name: '', part_number: '', path: '', level: 0, is_assembly: false,
    quantity: 1, instances: [], doc_path: '', builtin: {}, user_properties: {},
    pdm_match: null, match_status: 'unknown', checkout_status: null, ...overrides,
  };
}

// 树:0(根,有子) → 1(有子) → 2(叶) ; 另一根 0b(叶)
const tree = [
  makeRow({ path: 'a', level: 0 }),
  makeRow({ path: 'a.1', level: 1 }),
  makeRow({ path: 'a.1.2', level: 2 }),
  makeRow({ path: 'b', level: 0 }),
];

describe('maxLevelOf', () => {
  it('返回最大 level', () => {
    expect(maxLevelOf(tree)).toBe(2);
  });
  it('空数组返回 0', () => {
    expect(maxLevelOf([])).toBe(0);
  });
});

describe('buildCollapsedForLevel', () => {
  it('k=0 全部折叠:所有有子节点的行都折叠', () => {
    const s = buildCollapsedForLevel(tree, 0);
    expect([...s].sort()).toEqual(['a', 'a.1']);
  });
  it('k=Infinity 全部展开:空集合', () => {
    expect(buildCollapsedForLevel(tree, Infinity).size).toBe(0);
  });
  it('k=1 只折叠 level>=1 的有子节点', () => {
    const s = buildCollapsedForLevel(tree, 1);
    expect([...s]).toEqual(['a.1']);
  });
  it('k=2 无 level>=2 的有子节点 → 空集合(等价全展开)', () => {
    expect(buildCollapsedForLevel(tree, 2).size).toBe(0);
  });
  it('叶子节点永不进入集合', () => {
    const s = buildCollapsedForLevel(tree, 0);
    expect(s.has('a.1.2')).toBe(false);
    expect(s.has('b')).toBe(false);
  });
  it('空数组返回空集合', () => {
    expect(buildCollapsedForLevel([], 0).size).toBe(0);
  });
});
