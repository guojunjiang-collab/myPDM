import { useState, useCallback } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface UseTableSortOptions<T> {
  /** 默认排序字段 */
  defaultSortField?: keyof T;
  /** 默认排序方向 */
  defaultSortDirection?: 'asc' | 'desc';
  /** 自定义比较器：覆盖默认的 localeCompare/数值比较（对所有字段生效） */
  comparator?: (aVal: unknown, bVal: unknown) => number;
  /**
   * 按字段指定比较器：仅对对应字段生效（如版本号 A→B→ZZ 序列）。
   * 优先级高于 comparator。注意 comparator 是全字段生效的，若提供它会覆盖默认行为，
   * 因此版本列应优先用 fieldComparators 而非全局 comparator。
   */
  fieldComparators?: Partial<Record<keyof T, (aVal: unknown, bVal: unknown) => number>>;
  /**
   * 自定义取值函数：缺省取 item[field]。用于值嵌套在子对象或列 key 与字段名不一致的
   * 动态列场景（如 EntityPickerModal 的 columns 定义）。
   */
  getValue?: (item: T, field: keyof T) => unknown;
}

interface UseTableSortReturn<T> {
  sortField: keyof T | null;
  sortDirection: SortDirection;
  sortedData: T[];
  handleSort: (field: keyof T) => void;
  getSortIcon: (field: keyof T) => string;
}

export function useTableSort<T extends Record<string, any>>(
  data: T[],
  options?: UseTableSortOptions<T>
): UseTableSortReturn<T>;
export function useTableSort<T extends Record<string, any>>(
  data: T[],
  defaultSortField?: keyof T,
  defaultSortDirection?: 'asc' | 'desc',
  comparator?: (aVal: unknown, bVal: unknown) => number
): UseTableSortReturn<T>;
export function useTableSort<T extends Record<string, any>>(
  data: T[],
  optionsOrField?: UseTableSortOptions<T> | keyof T,
  maybeDirection?: 'asc' | 'desc',
  maybeComparator?: (aVal: unknown, bVal: unknown) => number
): UseTableSortReturn<T> {
  const opts: UseTableSortOptions<T> =
    optionsOrField && typeof optionsOrField === 'object'
      ? optionsOrField
      : { defaultSortField: optionsOrField as keyof T | undefined, defaultSortDirection: maybeDirection, comparator: maybeComparator };
  const { defaultSortField, defaultSortDirection, comparator, fieldComparators, getValue } = opts;
  const [sortField, setSortField] = useState<keyof T | null>(defaultSortField ?? null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortDirection ?? null);

  const handleSort = useCallback((field: keyof T) => {
    if (sortField === field) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') {
        setSortField(null);
        setSortDirection(null);
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField, sortDirection]);

  const sortedData = (() => {
    if (!sortField || !sortDirection) return data;
    return [...data].sort((a, b) => {
      const aVal = getValue ? getValue(a, sortField) : a[sortField];
      const bVal = getValue ? getValue(b, sortField) : b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      const fieldCmp = fieldComparators?.[sortField];
      if (fieldCmp) {
        cmp = fieldCmp(aVal, bVal);
      } else if (comparator) {
        cmp = comparator(aVal, bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal), 'zh-CN');
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  })();

  const getSortIcon = useCallback((field: keyof T): string => {
    if (sortField !== field) return '↕';
    if (sortDirection === 'asc') return '↑';
    return '↓';
  }, [sortField, sortDirection]);

  return { sortField, sortDirection, sortedData, handleSort, getSortIcon };
}
