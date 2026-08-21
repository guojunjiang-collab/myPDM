import { describe, it, expect } from 'vitest';
import { formatMeta } from './formatMeta';

describe('formatMeta', () => {
  it('拼接 label: value', () => {
    expect(formatMeta([['版本', 'B'], ['状态', '已发布']])).toBe('版本: B · 状态: 已发布');
  });
  it('空值跳过', () => {
    expect(formatMeta([['版本', ''], ['状态', '已发布']])).toBe('状态: 已发布');
  });
});
