import { describe, it, expect } from 'vitest';
import { MOBILE_TABS, MORE_ITEMS, filterVisible } from './nav';

const allTrue = () => true;
const allFalse = () => false;

describe('filterVisible', () => {
  it('全部权限可见时返回全部', () => {
    expect(filterVisible(MOBILE_TABS, allTrue)).toHaveLength(MOBILE_TABS.length);
  });
  it('无权限时返回空', () => {
    expect(filterVisible(MOBILE_TABS, allFalse)).toHaveLength(0);
  });
  it('按 perm 过滤', () => {
    const can = (p: string) => p === 'nav.parts';
    const r = filterVisible(MOBILE_TABS, can as never);
    expect(r.map((t) => t.path)).toEqual(['/parts']);
  });
  it('更多页包含 8 个入口（ECR/ECO、构型项管理/构型配置 拆分）', () => {
    expect(MORE_ITEMS.map((t) => t.path)).toEqual([
      '/dashboard', '/ec/ecr', '/ec/eco', '/inventory', '/configuration/items', '/configuration/profiles', '/notifications', '/users',
    ]);
  });
});
