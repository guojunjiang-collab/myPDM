import { describe, it, expect } from 'vitest';
import { backInterceptReducer, type BackLayer } from './backIntercept';

describe('backInterceptReducer', () => {
  it('打开抽屉', () => {
    const s: BackLayer = { kind: 'page' };
    expect(backInterceptReducer(s, { type: 'open-drawer', drawerId: 'tree' }))
      .toEqual({ kind: 'drawer', drawerId: 'tree' });
  });

  it('pop 时优先关闭抽屉', () => {
    const s: BackLayer = { kind: 'drawer', drawerId: 'tree' };
    expect(backInterceptReducer(s, { type: 'pop' })).toEqual({ kind: 'page' });
  });

  it('page 状态下的 pop 不吞掉路由后退', () => {
    const s: BackLayer = { kind: 'page' };
    expect(backInterceptReducer(s, { type: 'pop' })).toEqual({ kind: 'page' });
  });

  it('close-drawer 回到 page', () => {
    const s: BackLayer = { kind: 'drawer', drawerId: 'tools' };
    expect(backInterceptReducer(s, { type: 'close-drawer' })).toEqual({ kind: 'page' });
  });
});
