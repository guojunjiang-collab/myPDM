import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'md' | 'xs';
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = 'md', className = '', children, ...rest }, ref) {
  return (
    <select ref={ref} className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!h-[var(--ui-control-h-xs)] !px-2 !text-xs' : ''} ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
});

export default Select;
