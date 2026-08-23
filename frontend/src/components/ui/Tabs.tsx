import { ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** 字号档位，默认 md */
  size?: 'sm' | 'md';
}

/** 受控 Tab 组件，样式对齐现有手写 border-b-2 Tab（PartDetailModal 等） */
export default function Tabs({ items, activeKey, onChange, size = 'md' }: TabsProps) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--ui-border)]">
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`${
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
            } font-medium border-b-2 transition-colors ${
              active
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
