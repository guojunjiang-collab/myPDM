import { useState, useCallback } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface UseTableSortReturn<T> {
  sortField: keyof T | null;
  sortDirection: SortDirection;
  sortedData: T[];
  handleSort: (field: keyof T) => void;
  getSortIcon: (field: keyof T) => string;
}

export function useTableSort<T extends Record<string, any>>(
  data: T[],
  defaultSortField?: keyof T,
  defaultSortDirection?: 'asc' | 'desc'
): UseTableSortReturn<T> {
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
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
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
