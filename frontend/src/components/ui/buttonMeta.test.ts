import { describe, it, expect } from 'vitest';
import { BTN_VARIANT_CLASS, BTN_SIZE_CLASS } from './buttonMeta';

describe('按钮类名元数据', () => {
  it('7 个 variant 全部有类名', () => {
    const variants = ['primary', 'secondary', 'danger', 'success', 'ghost', 'dark', 'link'] as const;
    for (const v of variants) {
      expect(BTN_VARIANT_CLASS[v]).toBeTruthy();
    }
  });
  it('5 个 size 全部有类名', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'touch'] as const;
    for (const s of sizes) expect(BTN_SIZE_CLASS[s]).toBeTruthy();
  });
});
