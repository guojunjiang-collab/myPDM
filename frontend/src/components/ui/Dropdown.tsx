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

/** 锚定下拉：触发器 + 面板 + 外部点击/Esc 关闭 + 视口翻转（吸收 Board ⋮ 菜单、DocumentTab 新建单据菜单） */
export default function Dropdown({ trigger, open, onOpenChange, children, align = 'left' }: DropdownProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // 用 ref 稳定回调身份，避免调用方内联箭头导致 effect 反复重建
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const updatePos = () => {
      // 以 trigger 元素自身的 rect 定位（trigger 可为普通按钮，也可为 fixed 锚点元素——
      // 锚点场景下取首个元素子节点，避免外层 inline span 的 rect 落在挂载点）
      const el = triggerRef.current;
      const panel = panelRef.current;
      if (!el || !panel) return;
      const anchor = el.firstElementChild ? el.firstElementChild : el;
      const r = anchor.getBoundingClientRect();
      const panelH = panel.offsetHeight;
      const gap = 4;
      let top = r.bottom + gap;
      // 视口翻转：下方放不下则贴触发器上方
      if (top + panelH > window.innerHeight - 8) {
        top = Math.max(8, r.top - panelH - gap);
      }
      setPos({ top, left: align === 'left' ? r.left : r.right });
    };
    updatePos();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onOpenChangeRef.current(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChangeRef.current(false);
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
  }, [open, align]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <span ref={triggerRef}>{trigger}</span>
      {open && (
        <div
          ref={panelRef}
          className="fixed min-w-[160px] max-h-[calc(100vh-16px)] overflow-y-auto py-1 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-lg"
          style={
            pos
              ? { top: pos.top, left: pos.left, zIndex: MODAL_Z.overlay, transform: align === 'right' ? 'translateX(-100%)' : undefined }
              : { visibility: 'hidden', top: 0, left: 0, zIndex: MODAL_Z.overlay }
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}
