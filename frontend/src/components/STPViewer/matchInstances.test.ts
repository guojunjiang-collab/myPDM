import { describe, it, expect } from 'vitest';
import { isSamePlacement, matchInstancePairs, POSITION_TOLERANCE, ROTATION_TOLERANCE } from './matchInstances';
import type { InstanceRef } from './matchInstances';

/** 行主序 4×4：单位旋转 + 指定平移。平移在下标 3/7/11。 */
const at = (x: number, y: number, z: number): number[] => [
  1, 0, 0, x,
  0, 1, 0, y,
  0, 0, 1, z,
  0, 0, 0, 1,
];

/** 在单位矩阵的某个旋转分量上加扰动 */
const rotPerturbed = (delta: number): number[] => {
  const m = at(0, 0, 0);
  m[1] = delta; // 旋转 3×3 的一个分量
  return m;
};

const ref = (index: number, matrix: number[], revisionId = 'rev-A', code = 'CODE'): InstanceRef => ({ index, matrix, revisionId, code });

describe('isSamePlacement', () => {
  it('完全相同的矩阵视为同一位置', () => {
    expect(isSamePlacement(at(10, 20, 30), at(10, 20, 30))).toBe(true);
  });

  it('平移差在容差内（0.005mm）视为同一位置', () => {
    expect(isSamePlacement(at(0, 0, 0), at(0.005, 0, 0))).toBe(true);
  });

  it('平移差超容差（0.05mm）视为不同位置', () => {
    expect(isSamePlacement(at(0, 0, 0), at(0.05, 0, 0))).toBe(false);
  });

  it('平移按欧氏距离而非分量各自比较', () => {
    // 三个分量各 0.008，单看分量都在 0.01 内，但合成距离 ≈0.0139 超容差
    expect(isSamePlacement(at(0, 0, 0), at(0.008, 0.008, 0.008))).toBe(false);
  });

  it('旋转分量差 1e-5 视为同一姿态', () => {
    expect(isSamePlacement(at(0, 0, 0), rotPerturbed(1e-5))).toBe(true);
  });

  it('旋转分量差 1e-3 视为不同姿态', () => {
    expect(isSamePlacement(at(0, 0, 0), rotPerturbed(1e-3))).toBe(false);
  });

  it('容差常量为约定值', () => {
    expect(POSITION_TOLERANCE).toBe(0.01);
    expect(ROTATION_TOLERANCE).toBe(1e-4);
  });
});

describe('matchInstancePairs', () => {
  it('同 revision 同位置 → none，并带上左右两侧下标', () => {
    const out = matchInstancePairs([ref(0, at(1, 2, 3))], [ref(0, at(1, 2, 3))]);
    expect(out).toEqual([
      { changeType: 'none', side: 'both', leftIndex: 0, rightIndex: 0 },
    ]);
  });

  it('位置在容差内仍配对为 none（吸收重导出的浮点噪声）', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], [ref(0, at(0.005, 0, 0))]);
    expect(out[0].changeType).toBe('none');
  });

  it('位置超容差 → 左删右增', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], [ref(0, at(0.05, 0, 0))]);
    expect(out.map((m) => m.changeType)).toEqual(['delete', 'add']);
  });

  it('revision 不同但件号相同、位置相同 → modify（版本变更，非删除+新增）', () => {
    const out = matchInstancePairs(
      [ref(0, at(1, 1, 1), 'rev-V1', 'P-001')],
      [ref(0, at(1, 1, 1), 'rev-V2', 'P-001')],
    );
    expect(out).toEqual([
      { changeType: 'modify', side: 'both', leftIndex: 0, rightIndex: 0 },
    ]);
  });

  it('revision 与件号都不同但位置相同 → 仍是左删右增', () => {
    const out = matchInstancePairs(
      [ref(0, at(1, 1, 1), 'rev-V1', 'P-001')],
      [ref(0, at(1, 1, 1), 'rev-V2', 'P-002')],
    );
    expect(out.map((m) => m.changeType)).toEqual(['delete', 'add']);
  });

  it('同位置优先配对同版本（none），不同版本再配 modify', () => {
    // 左：P-001@V1、P-001@V2；右：P-001@V2、P-001@V1（顺序打乱，位置都相同）
    const left = [ref(0, at(0, 0, 0), 'V1', 'P-001'), ref(1, at(10, 0, 0), 'V2', 'P-001')];
    const right = [ref(0, at(10, 0, 0), 'V2', 'P-001'), ref(1, at(0, 0, 0), 'V1', 'P-001')];
    const out = matchInstancePairs(left, right);
    expect(out.map((m) => m.changeType)).toEqual(['none', 'none']);
    expect(out[0].rightIndex).toBe(1);
    expect(out[1].rightIndex).toBe(0);
  });

  it('同件号异版本 + 位置不同 → 仍左删右增（位置参与匹配）', () => {
    const out = matchInstancePairs(
      [ref(0, at(0, 0, 0), 'V1', 'P-001')],
      [ref(0, at(50, 0, 0), 'V2', 'P-001')],
    );
    expect(out.map((m) => m.changeType)).toEqual(['delete', 'add']);
  });

  it('原始实例下标与分组数组下标不同时，版本变更仍正确配对（回归）', () => {
    // left/right 是某节点分组后的子集，元素 index 是完整 instances 数组的下标
    // （可能远大于分组数组长度）。曾因用 left[m.leftIndex] 索引分组数组而越界崩溃。
    const left = [ref(5, at(0, 0, 0), 'V1', 'P-001'), ref(8, at(10, 0, 0), 'V1', 'P-002')];
    const right = [ref(2, at(0, 0, 0), 'V2', 'P-001'), ref(9, at(10, 0, 0), 'V2', 'P-002')];
    const out = matchInstancePairs(left, right);
    expect(out.map((m) => m.changeType)).toEqual(['modify', 'modify']);
    expect(out[0]).toEqual({ changeType: 'modify', side: 'both', leftIndex: 5, rightIndex: 2 });
    expect(out[1]).toEqual({ changeType: 'modify', side: 'both', leftIndex: 8, rightIndex: 9 });
  });

  it('混合场景：同版本未变 + 版本变更 + 真删除，右剩余为新增', () => {
    const left = [
      ref(0, at(0, 0, 0), 'V1', 'P-001'),   // 右有 V1@同位置 → none
      ref(1, at(10, 0, 0), 'V1', 'P-002'),  // 右有 V2@同位置 → modify
      ref(2, at(20, 0, 0), 'V1', 'P-003'),  // 右无 → delete
    ];
    const right = [
      ref(0, at(0, 0, 0), 'V1', 'P-001'),
      ref(1, at(10, 0, 0), 'V2', 'P-002'),
      ref(2, at(30, 0, 0), 'V1', 'P-004'),  // 新增
    ];
    const out = matchInstancePairs(left, right);
    expect(out.map((m) => m.changeType)).toEqual(['none', 'modify', 'delete', 'add']);
    expect(out[1]).toEqual({ changeType: 'modify', side: 'both', leftIndex: 1, rightIndex: 1 });
    expect(out[3]).toEqual({ changeType: 'add', side: 'right', rightIndex: 2 });
  });

  it('数量 3→5 且其中 2 个位置匹配 → 2 none + 1 delete + 3 add', () => {
    const left = [ref(0, at(0, 0, 0)), ref(1, at(10, 0, 0)), ref(2, at(20, 0, 0))];
    const right = [
      ref(0, at(0, 0, 0)),    // 配 left#0
      ref(1, at(20, 0, 0)),   // 配 left#2
      ref(2, at(30, 0, 0)),   // 新增
      ref(3, at(40, 0, 0)),   // 新增
      ref(4, at(50, 0, 0)),   // 新增
    ];
    const out = matchInstancePairs(left, right);
    expect(out.map((m) => m.changeType)).toEqual(['none', 'delete', 'none', 'add', 'add', 'add']);
    // 左侧原序在前，右侧未匹配追加在后
    expect(out[0]).toEqual({ changeType: 'none', side: 'both', leftIndex: 0, rightIndex: 0 });
    expect(out[1]).toEqual({ changeType: 'delete', side: 'left', leftIndex: 1 });
    expect(out[2]).toEqual({ changeType: 'none', side: 'both', leftIndex: 2, rightIndex: 1 });
    expect(out[3]).toEqual({ changeType: 'add', side: 'right', rightIndex: 2 });
  });

  it('同一右实例不会被两个左实例重复占用', () => {
    // 两个左实例在同一位置（异常数据），右侧只有一个
    const out = matchInstancePairs(
      [ref(0, at(5, 5, 5)), ref(1, at(5, 5, 5))],
      [ref(0, at(5, 5, 5))],
    );
    expect(out.map((m) => m.changeType)).toEqual(['none', 'delete']);
    expect(out.filter((m) => m.rightIndex === 0)).toHaveLength(1);
  });

  it('左空右非空 → 全 add', () => {
    const out = matchInstancePairs([], [ref(0, at(0, 0, 0)), ref(1, at(1, 0, 0))]);
    expect(out.map((m) => m.changeType)).toEqual(['add', 'add']);
    expect(out.every((m) => m.side === 'right')).toBe(true);
  });

  it('左非空右空 → 全 delete', () => {
    const out = matchInstancePairs([ref(0, at(0, 0, 0))], []);
    expect(out).toEqual([{ changeType: 'delete', side: 'left', leftIndex: 0 }]);
  });

  it('两侧皆空 → 空数组', () => {
    expect(matchInstancePairs([], [])).toEqual([]);
  });
});
