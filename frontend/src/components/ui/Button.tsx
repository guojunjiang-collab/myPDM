import type { ButtonHTMLAttributes } from 'react';
import { BTN_BASE_CLASS, BTN_SIZE_CLASS, BTN_VARIANT_CLASS, type ButtonSize, type ButtonVariant } from './buttonMeta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 筛选开关用法：active 时为主题色，否则次级色（边框恒定不跳高） */
  active?: boolean;
}

export default function Button({ variant = 'primary', size = 'md', active, className = '', type = 'button', ...rest }: ButtonProps) {
  const effVariant = active !== undefined ? (active ? 'primary' : 'secondary') : variant;
  const cls = `${BTN_BASE_CLASS} ${BTN_VARIANT_CLASS[effVariant]} ${BTN_SIZE_CLASS[size]} ${className}`.trim();
  return <button type={type} className={cls} {...rest} />;
}
