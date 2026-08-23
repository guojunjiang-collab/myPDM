import { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_BG_TEXT: Record<AlertTone, string> = {
  info: 'bg-[var(--ui-blue-bg)] text-[var(--ui-blue-text)]',
  success: 'bg-[var(--ui-green-bg)] text-[var(--ui-green-text)]',
  warning: 'bg-[var(--ui-amber-bg)] text-[var(--ui-amber-text)]',
  danger: 'bg-[var(--ui-red-bg)] text-[var(--ui-red-text)]',
};

const TONE_BORDER: Record<AlertTone, string> = {
  info: 'border-blue-200',
  success: 'border-green-200',
  warning: 'border-amber-200',
  danger: 'border-red-200',
};

interface AlertProps {
  tone?: AlertTone;
  /** 是否带边框（默认 false） */
  bordered?: boolean;
  children: ReactNode;
  className?: string;
}

/** 语义化提示块，吸收存量 6 种错误/提示写法 */
export default function Alert({ tone = 'info', bordered = false, children, className = '' }: AlertProps) {
  return (
    <div
      className={`px-4 py-2 rounded-lg text-sm ${TONE_BG_TEXT[tone]} ${bordered ? `border ${TONE_BORDER[tone]}` : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** 表单内联错误（FormField 使用）：小字红色 */
export function InlineError({ children }: { children: ReactNode }) {
  return <p className="text-red-500 text-xs mt-1">{children}</p>;
}
