import { useState, useCallback } from 'react';
import type { SortDirection } from './useTableSort';

interface UseServerSortReturn {
  sortField: string | null;
  sortOrder: 'asc' | 'desc';
  handleSort: (field: string) => void;
  /** 供 SortableTh 判断当前列是否激活 */
  isActive: (field: string) => boolean;
  /** 当前列方向 */
  direction: SortDirection;
  /** 重置排序（如切换筛选条件时可选调用） */
  resetSort: () => void;
}

/**
 * 服务端分页列表的排序状态管理（两态：asc ↔ desc，不提供取消态）。
 * 排序变化后由调用方触发重新拉取（通常搭配 useEffect 依赖 sortField/sortOrder 并重置页码）。
 *
 * 用法：
 *   const sort = useServerSort('created_at', 'desc');
 *   useEffect(() => { load({ sort_field: sort.sortField, sort_order: sort.sortOrder }); }, [sort.sortField, sort.sortOrder]);
 *   <SortableTh sortKey="code" active={sort.isActive('code')} direction={sort.direction} onSort={sort.handleSort}>件号</SortableTh>
 */
export function useServerSort(
  defaultField: string = 'created_at',
  defaultOrder: 'asc' | 'desc' = 'desc'
): UseServerSortReturn {
  const [sortField, setSortField] = useState<string | null>(defaultField);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultOrder);

  const handleSort = useCallback((field: string) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortOrder('asc');
      return field;
    });
  }, []);

  const isActive = useCallback((field: string) => sortField === field, [sortField]);

  const resetSort = useCallback(() => {
    setSortField(defaultField);
    setSortOrder(defaultOrder);
  }, [defaultField, defaultOrder]);

  return {
    sortField,
    sortOrder,
    handleSort,
    isActive,
    direction: sortField && sortOrder ? sortOrder : null,
    resetSort,
  };
}
