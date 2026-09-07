import { ReactNode } from 'react';
import Input from './Input';

interface FilterBarProps {
  /** 搜索框（受控） */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** 中间筛选区（Select/按钮组等插槽） */
  filters?: ReactNode;
  /** 右侧操作区（新增/导出等按钮插槽） */
  actions?: ReactNode;
  className?: string;
}

/** 页面筛选工具栏统一布局：搜索 + 筛选 + 操作三区（flex-wrap，操作区右对齐） */
export default function FilterBar({ search, filters, actions, className = '' }: FilterBarProps) {
  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {search && (
        <Input
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder ?? '搜索...'}
          className="!w-60"
        />
      )}
      {filters}
      <div className="flex-1" />
      {actions}
    </div>
  );
}
