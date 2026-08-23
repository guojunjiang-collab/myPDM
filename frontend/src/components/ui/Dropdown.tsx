import { ReactNode, useEffect, useRef, useState } from 'react';
import { MODAL_Z } from '../Modal';

interface DropdownProps {
  /** 触发器（按钮等），自身 onClick 由调用方管理 open 切换 */
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** 面板与触发器对齐方式：left=左对齐，right=右对齐 */
  align?: 'left' | 'right';
}

/** 锚定下拉：触发器 + 面板 + 外部点击/Esc 关闭（吸收 Board ⋮ 菜单、DocumentTab 新建单据菜单） */
export default function Dropdown({ trigger, open, onOpenChange, children, align = 'left' }: DropdownProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const updatePos = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: align === 'left' ? r.left : r.right });
    };
    updatePos();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, align, onOpenChange]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      {trigger}
      {open && pos && (
        <div
          className="fixed min-w-[160px] py-1 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            zIndex: MODAL_Z.overlay,
            transform: align === 'right' ? 'translateX(-100%)' : undefined,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
