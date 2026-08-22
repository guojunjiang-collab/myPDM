import type { ButtonHTMLAttributes } from 'react';
import { BTN_BASE_CLASS, BTN_SIZE_CLASS, BTN_VARIANT_CLASS, type ButtonSize, type ButtonVariant } from './buttonMeta';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = `${BTN_BASE_CLASS} ${BTN_VARIANT_CLASS[variant]} ${BTN_SIZE_CLASS[size]} ${className}`.trim();
  return <button type={type} className={cls} {...rest} />;
}
