import { useRef, useEffect, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Button from './ui/Button';

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
}

export function Modal({ open, title, onClose, children, width = 'md', zIndex = 50, headerAction, height }: ModalProps) {
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
    max: 'max-w-[95vw]',
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
        } ${height ? 'flex flex-col' : ''}`}
        style={height ? { height } : undefined}
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
        <div className={`px-6 py-4 ${height ? 'flex-1 overflow-auto' : ''}`}>{children}</div>
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
  // 确认按钮语义 → Button variant：danger=危险 / warning=警示（Button 无 warning 变体，就近归入 danger）/ info=主操作
  const confirmVariantMap: Record<'danger' | 'warning' | 'info', 'danger' | 'primary'> = {
    danger: 'danger',
    warning: 'danger',
    info: 'primary',
  };

  return (
    <Modal open={open} title={title} onClose={onCancel} width="sm">
      <p className="text-gray-600 mb-4">{content}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {cancelText}
        </Button>
        <Button variant={confirmVariantMap[type]} onClick={onConfirm}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}