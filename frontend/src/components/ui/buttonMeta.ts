export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'dark' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'touch';

export const BTN_BASE_CLASS =
  'inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export const BTN_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:   'bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] active:bg-[var(--ui-btn-primary-active)]',
  secondary: 'border border-[var(--ui-btn-secondary-border)] bg-[var(--ui-btn-secondary-bg)] text-[var(--ui-btn-secondary-text)] hover:bg-[var(--ui-btn-secondary-hover)]',
  danger:    'bg-[var(--ui-btn-danger-bg)] text-[var(--ui-btn-danger-text)] hover:bg-[var(--ui-btn-danger-hover)] active:bg-[var(--ui-btn-danger-active)]',
  success:   'bg-[var(--ui-btn-success-bg)] text-[var(--ui-btn-success-text)] hover:bg-[var(--ui-btn-success-hover)]',
  ghost:     'bg-[var(--ui-btn-ghost-bg)] text-[var(--ui-btn-ghost-text)] hover:bg-[var(--ui-btn-ghost-hover)]',
  dark:      'bg-[var(--ui-btn-dark-bg)] text-[var(--ui-btn-dark-text)] hover:bg-[var(--ui-btn-dark-hover)]',
  link:      'text-[var(--ui-btn-link-text)] hover:text-[var(--ui-btn-link-hover)] hover:underline',
};

export const BTN_SIZE_CLASS: Record<ButtonSize, string> = {
  xs:    'px-2.5 py-1 text-xs rounded',
  sm:    'px-3 py-1.5 text-xs rounded-lg',
  md:    'px-4 py-2 text-sm rounded-lg',
  lg:    'px-5 py-2.5 text-sm rounded-lg',
  touch: 'h-11 px-4 text-sm rounded-lg',
};
