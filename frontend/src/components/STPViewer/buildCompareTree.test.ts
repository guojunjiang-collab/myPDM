import { describe, it, expect } from 'vitest';
import { buildCompareTree } from './buildCompareTree';
import type { CompareNode } from './compareTypes';
import type { BOMCompareResponse, BOMCompareNode } from '../../types';
import type { AssemblyTreeNode } from '../../services/api';

const side = (bomItemId: string, code: string, version = 'V1', quantity = 1) => ({
  id: bomItemId,
  child_type: 'part',
  child_id: 'm-' + code,
  child_master_id: 'm-' + code,
  child_revision_id: 'r-' + code,
  quantity,
  detail: { code, name: code + '名', spec: '', version, status: 'released' },
});

const cmp = (over: Partial<BOMCompareNode>): BOMCompareNode => ({
  key: '/A', level: 0, sort: '0', path: '/A', change_type: 'none',
  left: null, right: null, ...over,
});

const resp = (comparison: BOMCompareNode[]): BOMCompareResponse => ({
  left_assembly: { id: 'L', code: 'ASM', name: '总成', spec: '', version: 'V1', status: 'released' },
  right_assembly: { id: 'R', code: 'ASM', name: '总成', spec: '', version: 'V2', status: 'released' },
  comparison,
  summary: { total: 0, added: 0, deleted: 0, modified: 0, internal_changes: 0, unchanged: 0 },
});

const asmNode = (over: Partial<AssemblyTreeNode>): AssemblyTreeNode => ({
  bom_item_id: 'x', part_code: 'X', part_name: '', quantity: 1,
  instance_count: 1, is_leaf: true, children: [], ...over,
});

/** 深度优先找到指定 key 的节点 */
function find(root: CompareNode, key: string): CompareNode | null {
  if (root.key === key) return root;
  for (const c of root.children) {
    const hit = find(c, key);
    if (hit) return hit;
  }
  return null;
}

describe('buildCompareTree', () => {
  it('把扁平 comparison 按 path 还原成树，根节点为 ROOT', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/A', path: '/A', level: 0, left: side('b1', 'A'), right: side('b1r', 'A') }),
        cmp({ key: '/A/B', path: '/A/B', level: 1, left: side('b2', 'B'), right: side('b2r', 'B') }),
      ]),
      [], [],
    );

    expect(root.key).toBe('ROOT');
    expect(root.parentKey).toBeNull();
    expect(root.level).toBe(-1);
    expect(root.children.map((c) => c.key)).toEqual(['/A']);
    expect(root.children[0].children.map((c) => c.key)).toEqual(['/A/B']);
    expect(find(root, '/A/B')!.parentKey).toBe('/A');
  });

  it('支持任意深度（5 层），不丢节点', () => {
    const paths = ['/A', '/A/B', '/A/B/C', '/A/B/C/D', '/A/B/C/D/E'];
    const root = buildCompareTree(
      resp(paths.map((p, i) => cmp({
        key: p, path: p, level: i,
        left: side('b' + i, p.split('/').pop()!),
        right: side('b' + i + 'r', p.split('/').pop()!),
      }))),
      [], [],
    );
    expect(find(root, '/A/B/C/D/E')).not.toBeNull();
    expect(find(root, '/A/B/C/D/E')!.parentKey).toBe('/A/B/C/D');
    expect(find(root, '/A/B/C/D/E')!.level).toBe(4);
  });

  it('填充 add / delete / modify / none 四种类型的左右两侧', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/ADD', path: '/ADD', change_type: 'add', right: side('br', 'ADD') }),
        cmp({ key: '/DEL', path: '/DEL', change_type: 'delete', left: side('bl', 'DEL') }),
        cmp({ key: '/MOD', path: '/MOD', change_type: 'modify', left: side('bl2', 'MOD', 'V1'), right: side('br2', 'MOD', 'V2') }),
        cmp({ key: '/SAME', path: '/SAME', change_type: 'none', left: side('bl3', 'SAME'), right: side('br3', 'SAME') }),
      ]),
      [], [],
    );

    expect(find(root, '/ADD')!.left).toBeNull();
    expect(find(root, '/ADD')!.right!.bomItemId).toBe('br');
    expect(find(root, '/DEL')!.right).toBeNull();
    expect(find(root, '/DEL')!.left!.bomItemId).toBe('bl');
    expect(find(root, '/MOD')!.left!.version).toBe('V1');
    expect(find(root, '/MOD')!.right!.version).toBe('V2');
    expect(find(root, '/SAME')!.changeType).toBe('none');
  });

  it('派生 internal：自身未变但子孙有差异的节点标为 internal', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/G', path: '/G', level: 0, change_type: 'none', left: side('g', 'G'), right: side('gr', 'G') }),
        cmp({ key: '/G/X', path: '/G/X', level: 1, change_type: 'add', right: side('xr', 'X') }),
        cmp({ key: '/H', path: '/H', level: 0, change_type: 'none', left: side('h', 'H'), right: side('hr', 'H') }),
        cmp({ key: '/H/Y', path: '/H/Y', level: 1, change_type: 'none', left: side('y', 'Y'), right: side('yr', 'Y') }),
      ]),
      [], [],
    );
    expect(find(root, '/G')!.changeType).toBe('internal');
    expect(find(root, '/H')!.changeType).toBe('none');
    // 根节点本身因版本不同已被标为 modify，不会被 derive 降级
    expect(root.changeType).toBe('modify');
  });

  it('根节点两侧版本不同时标为 modify', () => {
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'none', left: side('a', 'A'), right: side('ar', 'A') })]),
      [], [],
    );
    // left_assembly V1 vs right_assembly V2
    expect(root.changeType).toBe('modify');
    expect(root.left!.code).toBe('ASM');
    expect(root.right!.version).toBe('V2');
  });

  it('从装配树回填 hasModel：树里有该 bom_item 的叶子才算有模型', () => {
    const leftAsm: AssemblyTreeNode[] = [asmNode({ bom_item_id: 'bl', part_code: 'A' })];
    const rightAsm: AssemblyTreeNode[] = [];
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'modify', left: side('bl', 'A'), right: side('br', 'A') })]),
      leftAsm, rightAsm,
    );
    expect(find(root, '/A')!.left!.hasModel).toBe(true);
    expect(find(root, '/A')!.right!.hasModel).toBe(false);
  });

  it('多实例零件：装配树里的 "{bom_item_id}:{idx}" 也算该 bom_item 有模型', () => {
    const leftAsm: AssemblyTreeNode[] = [
      asmNode({ bom_item_id: 'bl', instance_index: 0, part_code: 'A' }),
      asmNode({ bom_item_id: 'bl', instance_index: 1, part_code: 'A' }),
    ];
    const root = buildCompareTree(
      resp([cmp({ key: '/A', path: '/A', change_type: 'none', left: side('bl', 'A', 'V1', 2), right: side('bl', 'A', 'V1', 2) })]),
      leftAsm, leftAsm,
    );
    expect(find(root, '/A')!.left!.hasModel).toBe(true);
    expect(find(root, '/A')!.left!.quantity).toBe(2);
  });

  it('子节点在 comparison 中先于父节点出现时也能正确挂载', () => {
    const root = buildCompareTree(
      resp([
        cmp({ key: '/P/C', path: '/P/C', level: 1, change_type: 'none', left: side('c', 'C'), right: side('cr', 'C') }),
        cmp({ key: '/P', path: '/P', level: 0, change_type: 'none', left: side('p', 'P'), right: side('pr', 'P') }),
      ]),
      [], [],
    );
    expect(find(root, '/P')!.children.map((c) => c.key)).toEqual(['/P/C']);
  });

  it('父节点缺失的孤儿节点挂到 ROOT 下，不丢数据', () => {
    const root = buildCompareTree(
      resp([cmp({ key: '/GONE/C', path: '/GONE/C', level: 1, change_type: 'add', right: side('c', 'C') })]),
      [], [],
    );
    expect(root.children.map((c) => c.key)).toEqual(['/GONE/C']);
  });
});
