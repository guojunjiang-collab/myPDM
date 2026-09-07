import { describe, it, expect } from 'vitest';
import { BADGE_TONE_CLASS } from './badgeMeta';
import { BADGE_TONES } from '../../constants/badges';

describe('BADGE_TONE_CLASS', () => {
  it('每个 tone 都有 bg 与 text 且为 CSS 变量任意值类', () => {
    for (const tone of BADGE_TONES) {
      const c = BADGE_TONE_CLASS[tone];
      expect(c.bg).toMatch(/^bg-\[var\(--ui-.*-bg\)\]$/);
      expect(c.text).toMatch(/^text-\[var\(--ui-.*-text\)\]$/);
    }
  });
});
