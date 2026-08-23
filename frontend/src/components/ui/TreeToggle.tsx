import { forwardRef } from 'react';

interface TreeToggleProps {
  expanded: boolean;
  onClick?: () => void;
  loading?: boolean;
  leaf?: boolean;
  size?: 'sm' | 'md';
  title?: string;
  disabled?: boolean;
}

const TreeToggle = forwardRef<HTMLButtonElement, TreeToggleProps>(
  ({ expanded, onClick, loading, leaf, size = 'md', title, disabled }, ref) => {
    const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
    const hitSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
    if (leaf) {
      return <span className={`${hitSize} inline-flex items-center justify-center shrink-0`} aria-hidden="true" />;
    }
    return (
      <button
        ref={ref}
        type="button"
        title={title}
        disabled={disabled || loading}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        aria-expanded={expanded}
        className={`${hitSize} inline-flex items-center justify-center shrink-0 rounded text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] hover:bg-[var(--ui-bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-input-focus-ring)]`}
      >
        {loading ? (
          <span className="text-xs animate-pulse">⋯</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${iconSize} transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </button>
    );
  }
);
TreeToggle.displayName = 'TreeToggle';
export default TreeToggle;
