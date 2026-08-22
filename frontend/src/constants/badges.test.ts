import { describe, it, expect } from 'vitest';
import { BADGE_DOMAINS, resolveBadge, BADGE_TONES } from './badges';

describe('badges 映射表', () => {
  it('数据生命周期 part domain 四态齐全且色值正确', () => {
    const d = BADGE_DOMAINS.part;
    expect(d.draft).toEqual({ label: '草稿', tone: 'blue' });
    expect(d.frozen).toEqual({ label: '冻结', tone: 'orange' });
    expect(d.released).toEqual({ label: '发布', tone: 'green' });
    expect(d.obsolete).toEqual({ label: '作废', tone: 'red' });
  });

  it('role domain 含 unverified', () => {
    expect(BADGE_DOMAINS.role.unverified).toEqual({ label: '未验证', tone: 'amber' });
  });

  it('resolveBadge 未知状态灰底兜底并保留原值', () => {
    expect(resolveBadge('weird', 'part')).toEqual({ label: 'weird', tone: 'gray' });
  });

  it('resolveBadge 空状态回退 fallback', () => {
    expect(resolveBadge(undefined, 'part', { label: '—', tone: 'gray' })).toEqual({ label: '—', tone: 'gray' });
  });

  it('所有 domain 的 tone 值都在 BADGE_TONES 内', () => {
    for (const [domain, map] of Object.entries(BADGE_DOMAINS)) {
      for (const [status, def] of Object.entries(map)) {
        expect(BADGE_TONES.includes(def.tone), `${domain}.${status} tone=${def.tone}`).toBe(true);
      }
    }
  });
});
