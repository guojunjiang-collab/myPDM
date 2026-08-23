import { ReactNode } from 'react';
import { InlineError } from './Alert';

interface FormFieldProps {
  label?: ReactNode;
  /** 必填标记：label 尾部红色星号 */
  required?: boolean;
  /** 表单内联错误（红色小字） */
  error?: string;
  /** 辅助说明（次级小字） */
  hint?: string;
  /** 卡片容器模式（灰底圆角+主题边框） */
  card?: boolean;
  className?: string;
  children: ReactNode;
}

/** 表单字段容器：统一 label/必填星号/错误/提示 四件套，消灭两代 label 写法 */
export default function FormField({ label, required, error, hint, card, className = '', children }: FormFieldProps) {
  return (
    <div className={card ? `bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)] ${className}` : className}>
      {label !== undefined && (
        <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <InlineError>{error}</InlineError>
      ) : hint ? (
        <p className="text-xs text-[var(--ui-text-tertiary)] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
