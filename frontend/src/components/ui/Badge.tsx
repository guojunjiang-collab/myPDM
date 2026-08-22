import type { ReactNode } from 'react';
import { resolveBadge, type BadgeDomain, type BadgeTone } from '../../constants/badges';
import { BADGE_BASE_CLASS, BADGE_SIZE_CLASS, BADGE_TONE_CLASS } from './badgeMeta';

interface BadgeProps {
  /** 语义状态值；与 tone+label 二选一 */
  status?: string;
  /** status 的语义域，默认 'part' */
  domain?: BadgeDomain;
  /** 直接指定颜色（与 status 二选一） */
  tone?: BadgeTone;
  /** 直接指定文案（与 status 二选一） */
  label?: ReactNode;
  size?: 'sm' | 'xs';
  className?: string;
}

export default function Badge({ status, domain = 'part', tone, label, size = 'sm', className }: BadgeProps) {
  const def = status !== undefined ? resolveBadge(status, domain) : { label, tone: tone ?? ('gray' as BadgeTone) };
  const c = BADGE_TONE_CLASS[def.tone ?? 'gray'];
  return (
    <span className={`${BADGE_BASE_CLASS} ${BADGE_SIZE_CLASS[size]} ${c.bg} ${c.text} ${className ?? ''}`}>
      {def.label}
    </span>
  );
}
