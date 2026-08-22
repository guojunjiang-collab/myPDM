import type { SelectHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'xs';
}

export default function Select({ size = 'md', className = '', children, ...rest }: SelectProps) {
  return (
    <select className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!px-2 !py-1 !text-xs' : ''} ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}
