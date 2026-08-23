interface Props<T> {
  items: T[];
  renderMain: (item: T) => React.ReactNode;
  renderMeta: (item: T) => React.ReactNode;
  onClick?: (item: T, e: React.MouseEvent<HTMLButtonElement>) => void;
  keyOf: (item: T) => string;
}
export default function MobileCardList<T>({ items, renderMain, renderMeta, onClick, keyOf }: Props<T>) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 p-3">
      {items.map((item) => (
        <button
          key={keyOf(item)}
          data-anchor={keyOf(item)}
          onClick={(e) => onClick?.(item, e)}
          className="text-left bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 min-h-14 flex flex-col gap-1 shadow-sm"
        >
          <div className="text-sm font-medium text-[var(--ui-text-primary)] break-all">{renderMain(item)}</div>
          <div className="text-xs text-[var(--ui-text-secondary)] break-all">{renderMeta(item)}</div>
        </button>
      ))}
    </div>
  );
}
