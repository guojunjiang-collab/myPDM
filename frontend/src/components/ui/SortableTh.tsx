import type { CSSProperties, ReactNode } from 'react';
import type { SortDirection } from '../../hooks/useTableSort';

interface SortableThProps {
  /** 排序键：点击时传给 onSort；不传或传 undefined 则该列不可排序 */
  sortKey?: string;
  /** 当前激活的排序字段 */
  active?: boolean;
  /** 当前排序方向 */
  direction?: SortDirection;
  /** 点击表头回调 */
  onSort?: (key: string) => void;
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** 内联样式（如列宽） */
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * 可排序表头：点击切换 asc/desc（第三次回到 null 由调用方决定，服务端排序为两态）。
 * 不可排序列（不传 sortKey）渲染普通 th，无点击与图标。
 */
export default function SortableTh({
  sortKey,
  active = false,
  direction = null,
  onSort,
  align = 'left',
  className = '',
  style,
  children,
}: SortableThProps) {
  const alignCls = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
  if (!sortKey) {
    return (
      <th className={`px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)] ${alignCls} select-none whitespace-nowrap ${className}`} style={style}>
        {children}
      </th>
    );
  }
  const icon = active ? (direction === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
  return (
    <th
      onClick={() => onSort?.(sortKey)}
      className={`px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)] ${alignCls} cursor-pointer select-none whitespace-nowrap ${className}`}
      style={style}
      title={active ? (direction === 'asc' ? '降序排列' : '升序排列') : '点击排序'}
    >
      {children}{icon}
    </th>
  );
}
