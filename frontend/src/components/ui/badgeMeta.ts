import type { BadgeTone } from '../../constants/badges';

/** tone → CSS 变量类名（颜色唯一真源之一；多风格切换只改 index.css 变量） */
export const BADGE_TONE_CLASS: Record<BadgeTone, { bg: string; text: string }> = {
  blue:   { bg: 'bg-[var(--ui-blue-bg)]',   text: 'text-[var(--ui-blue-text)]' },
  orange: { bg: 'bg-[var(--ui-orange-bg)]', text: 'text-[var(--ui-orange-text)]' },
  green:  { bg: 'bg-[var(--ui-green-bg)]',  text: 'text-[var(--ui-green-text)]' },
  red:    { bg: 'bg-[var(--ui-red-bg)]',    text: 'text-[var(--ui-red-text)]' },
  gray:   { bg: 'bg-[var(--ui-gray-bg)]',   text: 'text-[var(--ui-gray-text)]' },
  amber:  { bg: 'bg-[var(--ui-amber-bg)]',  text: 'text-[var(--ui-amber-text)]' },
  teal:   { bg: 'bg-[var(--ui-teal-bg)]',   text: 'text-[var(--ui-teal-text)]' },
  purple: { bg: 'bg-[var(--ui-purple-bg)]', text: 'text-[var(--ui-purple-text)]' },
  indigo: { bg: 'bg-[var(--ui-indigo-bg)]', text: 'text-[var(--ui-indigo-text)]' },
};

export const BADGE_BASE_CLASS = 'inline-flex items-center whitespace-nowrap rounded-full font-medium';
export const BADGE_SIZE_CLASS = {
  sm: 'px-2 py-0.5 text-xs',
  xs: 'px-1.5 py-0.5 text-[11px]',
} as const;
