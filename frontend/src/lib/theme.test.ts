import { describe, it, expect } from 'vitest';
import { THEMES, isThemeKey } from './theme';

describe('theme', () => {
  it('THEMES 包含 default 且至少 4 个主题', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
    expect(THEMES.some((t) => t.key === 'default')).toBe(true);
    expect(THEMES.some((t) => t.key === 'dark')).toBe(true);
    expect(THEMES.every((t) => t.label && t.swatch)).toBe(true);
  });

  it('THEMES key 无重复', () => {
    const keys = THEMES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('isThemeKey 校验合法与非法值', () => {
    expect(isThemeKey('default')).toBe(true);
    expect(isThemeKey('forest')).toBe(true);
    expect(isThemeKey('warm')).toBe(true);
    expect(isThemeKey('dark')).toBe(true);
    expect(isThemeKey('')).toBe(false);
    expect(isThemeKey(null)).toBe(false);
    expect(isThemeKey(undefined)).toBe(false);
    expect(isThemeKey(42)).toBe(false);
    expect(isThemeKey({})).toBe(false);
  });
});
