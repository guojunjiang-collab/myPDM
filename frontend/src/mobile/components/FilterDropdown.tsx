import { useState } from 'react';
import Button from '../../components/ui/Button';

/** 自定义下拉筛选（参考项目详情-层级下拉样式）：触发按钮 + 下拉面板，点击外部关闭 */
export default function FilterDropdown({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: Array<{ key: string; label: string }>;
  onChange: (key: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="xs"
        className={`min-h-10 px-3 rounded-lg ${className ?? ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {current?.label ?? ''}
      </Button>
      {open && (
        <>
          {/* 点击外部关闭 */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 min-w-28 bg-[var(--ui-bg-surface)] rounded-lg shadow-lg border border-[var(--ui-border)] py-1">
            {options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm ${
                  value === opt.key ? 'text-primary-600 font-medium bg-primary-50' : 'text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
