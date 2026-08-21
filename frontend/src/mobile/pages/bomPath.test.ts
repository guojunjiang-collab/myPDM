import { describe, it, expect } from 'vitest';
import { bomPath, parentBomPath } from './bomPath';

describe('bomPath', () => {
  it('生成下钻路径', () => {
    expect(bomPath('/parts/a1', 'b2')).toBe('/parts/a1/bom/b2');
  });
  it('parentBomPath 回到上级 BOM 或列表', () => {
    expect(parentBomPath('/parts/a1/bom/b2')).toBe('/parts/a1');
    expect(parentBomPath('/parts/a1/bom/b2/bom/b3')).toBe('/parts/a1/bom/b2');
  });
});
