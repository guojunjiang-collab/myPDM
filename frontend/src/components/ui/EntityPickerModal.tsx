import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, MODAL_Z } from '../Modal';
import Button from './Button';
import Input from './Input';

export interface EntityPickerColumn<T> {
  key: string;
  title: string;
  width?: string;
  render: (item: T) => ReactNode;
}

interface EntityPickerModalProps<T> {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: 'lg' | 'xl' | 'full';
  /** 候选数据拉取（open / 搜索 / 类型切换时触发） */
  fetchData: (params: { search: string; type?: string }) => Promise<T[]>;
  /** 条目唯一键（已选去重与「已添加」判定依据） */
  getKey: (item: T) => string;
  /** 候选表格列（多类型模式可自行在 columns 中渲染类型徽标，或提供 renderTypeBadge） */
  columns: EntityPickerColumn<T>[];
  /** 已选（受控） */
  selected: T[];
  /** 已选变更回调；缺省则内部维护（打开时重置为空），onConfirm 时一次性返回 */
  onSelectedChange?: (items: T[]) => void;
  onConfirm: (items: T[]) => void;
  searchPlaceholder?: string;
  /** 搜索行右侧筛选插槽（如状态 Select） */
  filters?: ReactNode;
  /** 多类型模式：提供则渲染类型筛选 Tab 行 */
  typeTabs?: { key: string; label: string }[];
  activeType?: string;
  onTypeChange?: (key: string) => void;
  /** 快速新建插槽（折叠区，渲染在搜索区上侧；内容由调用方提供） */
  quickCreate?: ReactNode;
  /** 多类型模式下自动前置「类型」列（类型徽标渲染） */
  renderTypeBadge?: (item: T) => ReactNode;
  confirmText?: string;
  /** 确认按钮是否显示已选数量，默认 true（单选场景调用方传 false） */
  showCount?: boolean;
  /** 初始数据加载中（区别于 fetchData 过程） */
  loading?: boolean;
}

/**
 * 选择器弹窗骨架：已选面板（顶部常驻）+ 搜索/筛选 + 快速新建（搜索区上侧）+ 候选表格
 * （操作列「添加」按钮、无多选框、已添加行提示「已添加」）+ footer（已选 N 项 / 取消 / 确认）。
 * 多类型模式以用户看板 ItemPicker 为参考基准。
 */
export default function EntityPickerModal<T>({
  open,
  title,
  onClose,
  width = 'full',
  fetchData,
  getKey,
  columns,
  selected,
  onSelectedChange,
  onConfirm,
  searchPlaceholder = '搜索...',
  filters,
  typeTabs,
  activeType,
  onTypeChange,
  quickCreate,
  renderTypeBadge,
  confirmText = '确认添加',
  showCount = true,
  loading = false,
}: EntityPickerModalProps<T>) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [internalSelected, setInternalSelected] = useState<T[]>([]);

  // 非受控模式：每次打开重置内部已选
  useEffect(() => {
    if (open && !onSelectedChange) setInternalSelected([]);
  }, [open, onSelectedChange]);

  const effectiveSelected = onSelectedChange ? selected : internalSelected;
  const setEffectiveSelected = (items: T[]) =>
    onSelectedChange ? onSelectedChange(items) : setInternalSelected(items);

  const selectedSet = useMemo(() => new Set(effectiveSelected.map(getKey)), [effectiveSelected, getKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFetchLoading(true);
    fetchData({ search, type: activeType })
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setFetchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, search, activeType, fetchData]);

  const add = (item: T) => {
    const key = getKey(item);
    if (selectedSet.has(key)) return;
    setEffectiveSelected([...effectiveSelected, item]);
  };

  const remove = (key: string) => {
    setEffectiveSelected(effectiveSelected.filter((i) => getKey(i) !== key));
  };

  const displayColumns = useMemo(() => {
    if (!renderTypeBadge) return columns;
    return [
      { key: '__type', title: '类型', width: '70px', render: renderTypeBadge },
      ...columns,
    ] as EntityPickerColumn<T>[];
  }, [columns, renderTypeBadge]);

  const footerLeft = (
    <span className="text-[var(--ui-text-secondary)] text-sm">
      已选 <b className="text-[var(--ui-text-primary)]">{effectiveSelected.length}</b> 项
    </span>
  );

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={width}
      zIndex={MODAL_Z.picker}
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          {footerLeft}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" onClick={() => onConfirm(effectiveSelected)} disabled={effectiveSelected.length === 0}>
              {confirmText}
              {showCount ? ` (${effectiveSelected.length})` : ''}
            </Button>
          </div>
        </div>
      }
    >
      {/* 已选面板（顶部常驻） */}
      <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden mb-3">
        <div className="bg-[var(--ui-bg-subtle)] px-3 py-2 text-sm font-medium flex justify-between items-center">
          <span>
            已选 <b className="text-[var(--ui-text-primary)]">({effectiveSelected.length})</b>
          </span>
        </div>
        {effectiveSelected.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-[var(--ui-text-tertiary)]">
            请从下方候选列表中选择要添加的项目
          </div>
        ) : (
          <div className="max-h-36 overflow-y-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[var(--ui-bg-subtle)] text-[var(--ui-text-secondary)]">
                  {columns.map((c) => (
                    <th key={c.key} className="text-left font-medium px-3 py-1.5 whitespace-nowrap" style={c.width ? { width: c.width } : undefined}>
                      {c.title}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {effectiveSelected.map((item) => (
                  <tr key={getKey(item)} className="border-t border-[var(--ui-border)]">
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-1.5">{c.render(item)}</td>
                    ))}
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(getKey(item))}
                        className="text-[var(--ui-btn-danger-bg)] hover:opacity-70 text-xs"
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 快速新建（搜索区上侧，slot） */}
      {quickCreate}

      {/* 类型筛选 Tab（多类型模式） */}
      {typeTabs && (
        <div className="flex items-center gap-1 mb-2">
          {typeTabs.map((t) => {
            const active = t.key === activeType;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onTypeChange?.(t.key)}
                className={`shrink-0 px-3 py-1 text-xs rounded-full border transition-colors ${
                  active
                    ? 'bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] border-transparent'
                    : 'bg-[var(--ui-btn-secondary-bg)] text-[var(--ui-btn-secondary-text)] border-[var(--ui-btn-secondary-border)] hover:bg-[var(--ui-bg-hover)]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* 搜索 + 筛选（同一行） */}
      <div className="flex items-center gap-2 mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1"
        />
        {filters}
      </div>

      {/* 候选表格 */}
      <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
        <div className="max-h-[260px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--ui-bg-subtle)] text-[var(--ui-text-secondary)]">
                {displayColumns.map((c) => (
                  <th key={c.key} className="text-left font-medium px-3 py-2 whitespace-nowrap" style={c.width ? { width: c.width } : undefined}>
                    {c.title}
                  </th>
                ))}
                <th className="w-20 text-left font-medium px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {fetchLoading || loading ? (
                <tr>
                  <td colSpan={displayColumns.length + 1} className="px-3 py-6 text-center text-xs text-[var(--ui-text-tertiary)]">
                    加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={displayColumns.length + 1} className="px-3 py-6 text-center text-xs text-[var(--ui-text-tertiary)]">
                    无匹配数据
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const added = selectedSet.has(getKey(item));
                  return (
                    <tr key={getKey(item)} className="border-t border-[var(--ui-border)]">
                      {displayColumns.map((c) => (
                        <td key={c.key} className="px-3 py-2">{c.render(item)}</td>
                      ))}
                      <td className="px-3 py-2">
                        {added ? (
                          <Button size="xs" variant="secondary" disabled>
                            已添加
                          </Button>
                        ) : (
                          <Button size="xs" variant="primary" onClick={() => add(item)}>
                            添加
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
