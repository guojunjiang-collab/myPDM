import type { InputHTMLAttributes } from 'react';

export const INPUT_BASE_CLASS =
  'w-full rounded-lg border border-[var(--ui-input-border)] bg-[var(--ui-input-bg)] px-3 py-2 text-sm text-[var(--ui-input-text)] placeholder:text-[var(--ui-input-placeholder)] focus:outline-none focus:ring-2 focus:ring-[var(--ui-input-focus-ring)] focus:border-[var(--ui-input-focus-border)] disabled:bg-[var(--ui-input-disabled-bg)] disabled:text-[var(--ui-input-disabled-text)]';
const INPUT_SIZE_CLASS = { md: '', xs: '!px-2 !py-1 !text-xs' } as const;

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'md' | 'xs';
}

export default function Input({ size = 'md', className = '', ...rest }: InputProps) {
  return <input className={`${INPUT_BASE_CLASS} ${INPUT_SIZE_CLASS[size]} ${className}`.trim()} {...rest} />;
}
