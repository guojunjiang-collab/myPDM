import { useRef, useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | '3xl';
  zIndex?: number;
  /** 标题栏右侧、关闭按钮左侧的操作区（如导出按钮） */
  headerAction?: ReactNode;
}

export function Modal({ open, title, onClose, children, width = 'md', zIndex = 50, headerAction }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
    } else {
      setTimeout(() => setVisible(false), 300);
    }
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
  };

  if (!visible && !open) return null;

  return createPortal((
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className={`fixed inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-300 ${
        open ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ zIndex }}
    >
      <div
        className={`bg-white rounded-lg shadow-xl w-full mx-4 ${widthMap[width]} transform transition-transform duration-300 ${
          open ? 'scale-100' : 'scale-95'
        }`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">{title}</h3>
            <div className="flex items-center gap-3">
              {headerAction}
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  ), document.body);
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
}: ConfirmModalProps) {
  const typeClasses = {
    danger: 'bg-red-600 hover:bg-red-700',
    warning: 'bg-orange-500 hover:bg-orange-600',
    info: 'bg-primary-600 hover:bg-primary-700',
  };

  return (
    <Modal open={open} title={title} onClose={onCancel} width="sm">
      <p className="text-gray-600 mb-4">{content}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          className={`px-4 py-2 text-white rounded-lg ${typeClasses[type]}`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}