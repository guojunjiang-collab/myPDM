import { describe, it, expect } from 'vitest';
import { buildInstanceIndex } from './buildInstanceIndex';
import type { AssemblyInstance } from '../../services/api';

const inst = (path: string, bom: string[]): AssemblyInstance => ({
  path, bom_path: bom, part_code: 'X', revision_id: 'r',
  glb_urls: { coarse: 'c', normal: 'n', fine: 'f' },
  matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], bbox: null,
});

describe('buildInstanceIndex', () => {
  const idx = buildInstanceIndex([
    inst('p1', ['A', 'B']),
    inst('p2', ['A', 'C']),
    inst('p3', ['A']),
  ]);

  it('maps a bom node to all instance paths under it', () => {
    expect(idx.pathsByBomItem.get('A')?.size).toBe(3);
    expect(idx.pathsByBomItem.get('B')?.has('p1')).toBe(true);
  });

  it('maps an instance path to its leaf bom item', () => {
    expect(idx.leafBomItemByPath.get('p1')).toBe('B');
    expect(idx.leafBomItemByPath.get('p3')).toBe('A');
  });
});
