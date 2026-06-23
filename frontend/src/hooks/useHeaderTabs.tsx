import { useEffect } from 'react';
import { usePageHeader } from '../stores/pageHeader';

export interface HeaderTab<T extends string> {
  key: T;
  label: string;
  enabled?: boolean;
}

/**
 * 将一组 Tab 注入 Layout 顶栏左侧（替代默认导航标题），省去页面内 Tab 行、扩大内容区。
 * 样式：未选中沿用标题字色(gray-800)，选中蓝字+浅底胶囊；离开页面自动清空插槽。
 */
export function useHeaderTabs<T extends string>(
  tabs: HeaderTab<T>[],
  active: T,
  onChange: (key: T) => void,
): void {
  const setHeader = usePageHeader((s) => s.setContent);
  useEffect(() => {
    setHeader(
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const enabled = tab.enabled !== false;
          return (
            <button
              key={tab.key}
              onClick={() => enabled && onChange(tab.key)}
              disabled={!enabled}
              className={`px-3 py-1 text-lg font-semibold rounded-md transition-colors ${
                active === tab.key
                  ? 'text-primary-600 bg-primary-50'
                  : 'text-gray-800 hover:bg-gray-50'
              } ${enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>,
    );
    return () => setHeader(null);
  }, [tabs, active, onChange, setHeader]);
}
