import { describe, it, expect, vi, afterEach } from 'vitest';
import { interruptArcballInertia } from './arcballInterrupt';

afterEach(() => {
  // 清理测试中注入的 window stub
  delete (globalThis as any).window;
});

describe('interruptArcballInertia', () => {
  it('取消 pending rAF 并复位内部书签', () => {
    const cancel = vi.fn();
    (globalThis as any).window = { cancelAnimationFrame: cancel };
    const controls = { _animationId: 42, _timeStart: 12345 };
    interruptArcballInertia(controls);
    expect(cancel).toHaveBeenCalledWith(42);
    expect(controls._animationId).toBe(-1);
    expect(controls._timeStart).toBe(-1);
  });

  it('_animationId 为 -1（无惯性）时不调用 cancel，仍保持书签复位', () => {
    const cancel = vi.fn();
    (globalThis as any).window = { cancelAnimationFrame: cancel };
    const controls = { _animationId: -1, _timeStart: 7 };
    interruptArcballInertia(controls);
    expect(cancel).not.toHaveBeenCalled();
    expect(controls._timeStart).toBe(-1);
  });

  it('无 window（SSR/测试）时安全跳过 cancel，仅复位书签', () => {
    const controls = { _animationId: 42, _timeStart: 1 };
    expect(() => interruptArcballInertia(controls)).not.toThrow();
    expect(controls._animationId).toBe(-1);
    expect(controls._timeStart).toBe(-1);
  });

  it('controls 为空时安全返回', () => {
    expect(() => interruptArcballInertia(null)).not.toThrow();
    expect(() => interruptArcballInertia(undefined)).not.toThrow();
  });
});
