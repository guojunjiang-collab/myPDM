import { describe, it, expect } from 'vitest';
import { buildColorMap } from './autoColor';

describe('buildColorMap', () => {
  it('空数组返回空 Map', () => {
    expect(buildColorMap([]).size).toBe(0);
  });

  it('同名得同色、不同名得不同色', () => {
    const m = buildColorMap(['螺栓', '法兰', '螺栓', '端盖']);
    expect(m.size).toBe(3);
    expect(m.get('螺栓')).toBe(m.get('螺栓'));
    const colors = new Set([m.get('螺栓'), m.get('法兰'), m.get('端盖')]);
    expect(colors.size).toBe(3);
  });

  it('返回合法 packed hex (0..0xffffff)', () => {
    const m = buildColorMap(['a', 'b', 'c', 'd', 'e']);
    for (const v of m.values()) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('确定性：同输入多次调用结果一致', () => {
    const a = buildColorMap(['x', 'y', 'z']);
    const b = buildColorMap(['z', 'y', 'x']);
    expect(a.get('x')).toBe(b.get('x'));
    expect(a.get('y')).toBe(b.get('y'));
    expect(a.get('z')).toBe(b.get('z'));
  });
});
