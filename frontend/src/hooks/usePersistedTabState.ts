import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 与 useState 用法一致的 Tab 状态 hook，但会按当前页面路径把选中值持久化到 sessionStorage。
 * F5 刷新后自动恢复到刷新前的 Tab；关闭标签页后清除。
 */
export function usePersistedTabState<T extends string>(
  defaultTab: T,
): [T, (tab: T) => void] {
  const { pathname } = useLocation();
  const storageKey = `tab:${pathname}`;

  const [tab, setTabState] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return (saved as T) || defaultTab;
    } catch {
      return defaultTab;
    }
  });

  const setTab = useCallback((next: T) => {
    setTabState(next);
    try {
      sessionStorage.setItem(storageKey, next);
    } catch {
      /* 忽略存储异常（隐私模式等） */
    }
  }, [storageKey]);

  return [tab, setTab];
}
