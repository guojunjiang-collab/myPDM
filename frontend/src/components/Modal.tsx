import { useRef, useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Button from './ui/Button';

/** 弹窗层级常量：base=普通弹窗 / picker=选择器 / overlay=内嵌浮层（Dropdown 等） */
export const MODAL_Z = { base: 50, picker: 60, overlay: 70 } as const;

interface ModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | '3xl' | 'max';
  zIndex?: number;
  /** 标题栏右侧、关闭按钮左侧的操作区（如导出按钮） */
  headerAction?: ReactNode;
  /** 弹窗固定高度（如 '75vh'），设置后内容区自动滚动 */
  height?: string;
  /** 底部操作区插槽（ModalFooter 落点） */
  footer?: ReactNode;
  /** body 滚动锁（多弹窗叠加用计数器），默认 true */
  scrollLock?: boolean;
  /** Esc 键关闭，默认 true（3D 全屏类弹窗可关闭） */
  closeOnEsc?: boolean;
}

// 模块级滚动锁计数器：多弹窗叠加时，最后一个关闭才恢复 body 滚动
let scrollLockCount = 0;
let previousBodyOverflow = '';
// 模块级弹窗打开栈：仅栈顶弹窗响应 Esc，避免一次 Esc 连关所有叠层弹窗
let modalStack: symbol[] = [];

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'md',
  zIndex = MODAL_Z.base,
  headerAction,
  height,
  footer,
  scrollLock = true,
  closeOnEsc = true,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<Element | null>(null);
  const escTokenRef = useRef<symbol>(Symbol('modal'));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
    } else {
      setTimeout(() => setVisible(false), 300);
    }
  }, [open]);

  // Esc 关闭：仅栈顶弹窗响应（叠层时按 Esc 只关最上层）
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    modalStack.push(escTokenRef.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === escTokenRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      modalStack = modalStack.filter((t) => t !== escTokenRef.current);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeOnEsc, onClose]);

  // body 滚动锁（计数器：open++ / cleanup--，归零恢复）
  useEffect(() => {
    if (!open || !scrollLock) return;
    if (scrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
    }
    scrollLockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount <= 0) {
        scrollLockCount = 0;
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [open, scrollLock]);

  // 焦点管理：打开后聚焦面板，关闭或卸载时还原触发元素焦点
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement;
      const raf = requestAnimationFrame(() => panelRef.current?.focus());
      return () => {
        cancelAnimationFrame(raf);
        const el = lastFocusedRef.current;
        if (el instanceof HTMLElement && document.contains(el)) {
          el.focus();
        }
      };
    }
    const el = lastFocusedRef.current;
    if (el instanceof HTMLElement && document.contains(el)) {
      el.focus();
    }
    lastFocusedRef.current = null;
  }, [open]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const widthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-4xl',
    '3xl': 'max-w-6xl',
    max: 'max-w-[95vw]',
  };

  if (!visible && !open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-300 ${
        open ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ zIndex }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`outline-none bg-[var(--ui-bg-surface)] rounded-lg shadow-xl w-full mx-4 ${widthMap[width]} transform transition-transform duration-300 ${
          open ? 'scale-100' : 'scale-95'
        } ${height ? 'flex flex-col' : ''}`}
        style={height ? { height } : undefined}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ui-border)]">
            <h3 className="text-lg font-semibold">{title}</h3>
            <div className="flex items-center gap-3">
              {headerAction}
              <button
                onClick={onClose}
                className="text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] text-xl"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div className={`px-6 py-4 ${height ? 'flex-1 overflow-auto' : ''}`}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 pt-4 px-6 pb-4 border-t border-[var(--ui-border)]">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
  /** 自定义内容（渲染在 content 下方，如密码输入框） */
  children?: ReactNode;
  /** 确认按钮 loading（异步确认期间禁用） */
  confirmLoading?: boolean;
}

export function ConfirmModal({
  open,
  title = '确认操作',
  content,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  type = 'danger',
  children,
  confirmLoading = false,
}: ConfirmModalProps) {
  // 确认按钮语义 → Button variant：danger=危险 / warning=警示（Button 无 warning 变体，就近归入 danger）/ info=主操作
  const confirmVariantMap: Record<'danger' | 'warning' | 'info', 'danger' | 'primary'> = {
    danger: 'danger',
    warning: 'danger',
    info: 'primary',
  };

  return (
    <Modal open={open} title={title} onClose={onCancel} width="sm">
      <p className="text-[var(--ui-text-secondary)] mb-4">{content}</p>
      {children}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={confirmLoading}>
          {cancelText}
        </Button>
        <Button variant={confirmVariantMap[type]} onClick={onConfirm} disabled={confirmLoading}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
