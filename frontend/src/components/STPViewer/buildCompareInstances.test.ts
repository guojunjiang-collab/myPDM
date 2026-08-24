import { describe, it, expect } from 'vitest';
import { buildCompareInstances, type CompareLeafInput } from './buildCompareInstances';
import type { CompareNode, Side } from './compareTypes';
import type { InstanceMatch } from './matchInstances';

function node(key: string, level = 0): CompareNode {
  return {
    key,
    parentKey: null,
    level,
    changeType: 'none',
    left: null,
    right: null,
    children: [],
    instances: [],
  };
}

function leaf(side: Side, index: number, keyPath: string[], seqs: (number | null)[]): CompareLeafInput {
  return { side, index, keyPath, seqs };
}

function addPair(map: Map<string, InstanceMatch>, leftIdx: number, rightIdx: number, changeType: InstanceMatch['changeType'] = 'none') {
  const m: InstanceMatch = { changeType, side: 'both', leftIndex: leftIdx, rightIndex: rightIdx };
  map.set(`left:${leftIdx}`, m);
  map.set(`right:${rightIdx}`, m);
}

describe('buildCompareInstances 实例层级树', () => {
  it('多实例装配：实例层挂在装配行下，每个实例展开到自己的子项行，子项行再挂叶子实例', () => {
    // /A 多实例装配（4 个实例），每个实例下 1 个单实例叶子子项 /A/B —— 对应真实数据 HP10-32100-000(×4) → HP10-32100-001
    const map = new Map<string, CompareNode>();
    const A = node('/A');
    const B = node('/A/B', 1);
    map.set('/A', A);
    map.set('/A/B', B);

    const leaves: CompareLeafInput[] = [];
    const matchByRef = new Map<string, InstanceMatch>();
    for (let i = 0; i < 4; i++) {
      leaves.push(leaf('left', i, ['/A', '/A/B'], [i, null]));
      leaves.push(leaf('right', i, ['/A', '/A/B'], [i, null]));
      addPair(matchByRef, i, i);
    }

    const instByRef = buildCompareInstances(leaves, map, matchByRef);

    // 装配行实例层：4 个实例
    expect(A.instances).toHaveLength(4);
    A.instances!.forEach((inst, i) => {
      expect(inst.seq).toBe(i + 1);
      expect(inst.changeType).toBe('none');
    });

    // 每个实例 1 个子项行（/A/B），子项行挂 1 个叶子实例
    for (const inst of A.instances!) {
      expect(inst.children).toHaveLength(1);
      const row = inst.children![0];
      expect(row.node.key).toBe('/A/B');
      expect(row.instances).toHaveLength(1);
      expect(row.instances![0].seq).toBe(1);
    }

    // 左右聚合到同一叶子实例节点（挂在实例的子项行下）
    expect(instByRef.get('left:0')).toBe(instByRef.get('right:0'));
    expect(instByRef.get('left:0')).toBe(A.instances![0].children![0].instances![0]);
    expect(instByRef.get('left:3')).toBe(A.instances![3].children![0].instances![0]);
  });

  it('多实例叶子：实例层直接挂在叶子 BOM 行下（保持现状）', () => {
    const map = new Map<string, CompareNode>();
    const P = node('/P');
    map.set('/P', P);

    const leaves: CompareLeafInput[] = [];
    const matchByRef = new Map<string, InstanceMatch>();
    for (let i = 0; i < 2; i++) {
      leaves.push(leaf('left', i, ['/P'], [i]));
      leaves.push(leaf('right', i, ['/P'], [i]));
      addPair(matchByRef, i, i);
    }

    buildCompareInstances(leaves, map, matchByRef);

    expect(P.instances).toHaveLength(2);
    expect(P.instances![0].children).toHaveLength(0);
    expect(P.instances![1].seq).toBe(2);
  });

  it('版本变更（modify）：叶子实例 modify，中间装配实例聚合为 internal', () => {
    const map = new Map<string, CompareNode>();
    const A = node('/A');
    const B = node('/A/B', 1);
    map.set('/A', A);
    map.set('/A/B', B);

    const leaves: CompareLeafInput[] = [];
    const matchByRef = new Map<string, InstanceMatch>();
    leaves.push(leaf('left', 0, ['/A', '/A/B'], [0, null]));
    leaves.push(leaf('right', 0, ['/A', '/A/B'], [0, null]));
    addPair(matchByRef, 0, 0, 'modify');

    buildCompareInstances(leaves, map, matchByRef);

    // 叶子实例挂在装配实例的子项行下
    expect(B.instances).toHaveLength(0);
    const leafInst = A.instances![0].children![0].instances![0];
    expect(leafInst.changeType).toBe('modify');
    // 中间装配实例：子孙有变更 → internal（分组行黄底）
    expect(A.instances).toHaveLength(1);
    expect(A.instances![0].changeType).toBe('internal');
  });

  it('未配对实例：delete/add 各自独立节点，不按 seq 与对侧聚合', () => {
    const map = new Map<string, CompareNode>();
    const A = node('/A');
    map.set('/A', A);

    const leaves: CompareLeafInput[] = [
      leaf('left', 0, ['/A'], [0]),
      leaf('left', 1, ['/A'], [1]),
      leaf('right', 0, ['/A'], [0]),
    ];
    const matchByRef = new Map<string, InstanceMatch>(); // 空：全部未配对

    buildCompareInstances(leaves, map, matchByRef);

    // 左 2 个 delete + 右 1 个 add → 3 个独立节点
    expect(A.instances).toHaveLength(3);
    const types = A.instances!.map((i) => i.changeType).sort();
    expect(types).toEqual(['add', 'delete', 'delete']);
    // delete 实例只有左引用，add 实例只有右引用
    expect(A.instances!.every((i) => i.children!.length === 0)).toBe(true);
  });

  it('顶层单实例穿透：单实例装配不产生实例层，直接进入其多实例子装配', () => {
    const map = new Map<string, CompareNode>();
    const R = node('/R');
    const A = node('/R/A', 1);
    const B = node('/R/A/B', 2);
    map.set('/R', R);
    map.set('/R/A', A);
    map.set('/R/A/B', B);

    const leaves: CompareLeafInput[] = [
      leaf('left', 0, ['/R', '/R/A', '/R/A/B'], [null, 0, null]),
      leaf('right', 0, ['/R', '/R/A', '/R/A/B'], [null, 0, null]),
    ];
    const matchByRef = new Map<string, InstanceMatch>();
    addPair(matchByRef, 0, 0);

    buildCompareInstances(leaves, map, matchByRef);

    // /R 顶层单实例：无实例层
    expect(R.instances).toHaveLength(0);
    // /R/A 多实例装配：1 个实例
    expect(A.instances).toHaveLength(1);
    expect(A.instances![0].seq).toBe(1);
    // 该实例下子项行 /R/A/B 挂 1 个叶子实例
    const row = A.instances![0].children![0];
    expect(row.node.key).toBe('/R/A/B');
    expect(row.instances).toHaveLength(1);
  });

  it('叶子单实例（单段无 idx）：叶子行下挂 seq=1 的实例节点', () => {
    const map = new Map<string, CompareNode>();
    const P = node('/P');
    map.set('/P', P);

    const leaves: CompareLeafInput[] = [
      leaf('left', 0, ['/P'], [null]),
      leaf('right', 0, ['/P'], [null]),
    ];
    const matchByRef = new Map<string, InstanceMatch>();
    addPair(matchByRef, 0, 0);

    const instByRef = buildCompareInstances(leaves, map, matchByRef);

    expect(P.instances).toHaveLength(1);
    expect(P.instances![0].seq).toBe(1);
    expect(instByRef.get('left:0')).toBe(P.instances![0]);
    expect(instByRef.get('right:0')).toBe(P.instances![0]);
  });
});
