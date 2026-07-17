import { describe, it, expect } from 'vitest';
import { syncRowsByPartNumber } from './syncRows';
import type { BOMRow } from './CADBOMMatchTable';

function makeRow(overrides: Partial<BOMRow>): BOMRow {
  return {
    instance_name: '',
    part_number: '',
    path: '',
    level: 0,
    is_assembly: false,
    quantity: 1,
    instances: [],
    builtin: {},
    user_properties: {},
    pdm_match: null,
    match_status: 'unknown',
    checkout_status: null,
    ...overrides,
  };
}

describe('syncRowsByPartNumber', () => {
  it('同 PartNumber 的所有实例行同步更新，其他 PartNumber 不受影响', () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', user_properties: { 规格型号: 'old' } }),
      makeRow({ part_number: 'P-001', path: '0.2', user_properties: { 规格型号: 'old' } }),
      makeRow({ part_number: 'P-002', path: '0.3', user_properties: { 规格型号: 'keep' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'new');
    expect(result[0].user_properties['规格型号']).toBe('new');
    expect(result[1].user_properties['规格型号']).toBe('new');
    expect(result[2].user_properties['规格型号']).toBe('keep');
  });

  it('PartNumber 为空时回退为仅按 path 更新当前行', () => {
    const rows = [
      makeRow({ part_number: '', path: '0.1', user_properties: { 备注: 'a' } }),
      makeRow({ part_number: '', path: '0.2', user_properties: { 备注: 'a' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '备注', 'b');
    expect(result[0].user_properties['备注']).toBe('b');
    expect(result[1].user_properties['备注']).toBe('a');
  });

  it('仅更新目标属性键，其他键与字段不变，且不修改原数组', () => {
    const rows = [
      makeRow({
        part_number: 'P-001',
        path: '0.1',
        match_status: 'matched',
        user_properties: { 规格型号: 'old', 材料: '45钢' },
      }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'new');
    expect(result[0].user_properties['材料']).toBe('45钢');
    expect(result[0].match_status).toBe('matched');
    expect(rows[0].user_properties['规格型号']).toBe('old');
    expect(result[0]).not.toBe(rows[0]);
  });

  it('空 rows 返回空数组', () => {
    expect(syncRowsByPartNumber([], makeRow({ part_number: 'P-001' }), '规格型号', 'v')).toEqual([]);
  });

  it('匹配不到任何行时所有行保持原引用不变', () => {
    const rows = [makeRow({ part_number: 'P-002', path: '0.1', user_properties: { 规格型号: 'a' } })];
    const result = syncRowsByPartNumber(rows, makeRow({ part_number: 'P-001', path: '0.9' }), '规格型号', 'v');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(rows[0]);
  });

  it('target 为 builtin 时同步更新 builtin 属性，user_properties 不受影响', () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
      makeRow({ part_number: 'P-001', path: '0.2', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
      makeRow({ part_number: 'P-002', path: '0.3', builtin: { Revision: 'A' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], 'Revision', 'B', 'builtin');
    expect(result[0].builtin['Revision']).toBe('B');
    expect(result[1].builtin['Revision']).toBe('B');
    expect(result[2].builtin['Revision']).toBe('A');
    expect(result[0].user_properties['规格型号']).toBe('x');
  });

  it('省略 target 时行为不变：更新 user_properties，builtin 不变', () => {
    const rows = [
      makeRow({ part_number: 'P-001', path: '0.1', builtin: { Revision: 'A' }, user_properties: { 规格型号: 'x' } }),
    ];
    const result = syncRowsByPartNumber(rows, rows[0], '规格型号', 'y');
    expect(result[0].user_properties['规格型号']).toBe('y');
    expect(result[0].builtin['Revision']).toBe('A');
  });
});
