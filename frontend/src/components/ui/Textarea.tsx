import type { TextareaHTMLAttributes } from 'react';
import { INPUT_BASE_CLASS } from './Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: 'md' | 'xs';
}

export default function Textarea({ size = 'md', className = '', ...rest }: TextareaProps) {
  return <textarea className={`${INPUT_BASE_CLASS} ${size === 'xs' ? '!px-2 !py-1 !text-xs' : ''} ${className}`.trim()} {...rest} />;
}
