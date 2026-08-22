import { describe, it, expect } from 'vitest';
import { bomPath, parentBomPath } from './bomPath';

describe('bomPath', () => {
  it('生成下钻路径（父路径为详情页路径）', () => {
    expect(bomPath('/parts/a1', 'b2')).toBe('/parts/a1/bom/b2');
  });
  it('父路径已以 /bom 结尾时不产生冗余段（BOM 页内下钻）', () => {
    expect(bomPath('/parts/a1/bom', 'b2')).toBe('/parts/a1/bom/b2');
    expect(bomPath('/parts/a1/bom/b2', 'b3')).toBe('/parts/a1/bom/b2/bom/b3');
  });
  it('parentBomPath 回到上级 BOM 页或列表页', () => {
    expect(parentBomPath('/parts/a1/bom/b2')).toBe('/parts/a1/bom');
    expect(parentBomPath('/parts/a1/bom/b2/bom/b3')).toBe('/parts/a1/bom/b2');
    expect(parentBomPath('/parts/a1/bom')).toBe('/parts');
  });
});
