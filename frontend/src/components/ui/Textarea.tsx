import { forwardRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'md' | 'xs';
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ size = 'md', className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!px-2 !py-1 !text-xs' : ''} ${className}`.trim()} {...rest} />;
});

export default Textarea;
