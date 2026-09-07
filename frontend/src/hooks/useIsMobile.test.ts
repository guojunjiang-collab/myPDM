import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeMediaQuery } from './useIsMobile';

interface MockMQL {
  matches: boolean;
  listeners: Array<(e: { matches: boolean }) => void>;
  addEventListener: (t: string, cb: (e: { matches: boolean }) => void) => void;
  removeEventListener: (t: string, cb: (e: { matches: boolean }) => void) => void;
}

function mockMatchMedia(initial: boolean) {
  const mql: MockMQL = {
    matches: initial,
    listeners: [],
    addEventListener(_t, cb) { this.listeners.push(cb); },
    removeEventListener(_t, cb) { this.listeners = this.listeners.filter((l) => l !== cb); },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return mql;
}

describe('subscribeMediaQuery', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('初始匹配状态立即回调', () => {
    mockMatchMedia(true);
    const cb = vi.fn();
    subscribeMediaQuery('(max-width: 767px)', cb);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('监听变化并返回取消函数', () => {
    const mql = mockMatchMedia(false);
    const cb = vi.fn();
    const unsubscribe = subscribeMediaQuery('(max-width: 767px)', cb);
    mql.listeners.forEach((l) => l({ matches: true }));
    expect(cb).toHaveBeenLastCalledWith(true);
    unsubscribe();
    mql.listeners.forEach((l) => l({ matches: false }));
    expect(cb).toHaveBeenLastCalledWith(true); // 取消后不再收到
  });

  it('无 matchMedia 时不抛错', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => subscribeMediaQuery('(max-width: 767px)', vi.fn())).not.toThrow();
  });
});
