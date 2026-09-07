import { ReactNode } from 'react';
import Button from './Button';

interface ModalFooterProps {
  onCancel: () => void;
  cancelText?: string;
  onConfirm?: () => void | Promise<void>;
  confirmText?: string;
  confirmVariant?: 'primary' | 'danger' | 'secondary';
  saving?: boolean;
  /** saving 时确认按钮文案，默认「保存中...」 */
  savingText?: string;
  /** 左侧插槽（如「已选 N 项」），提供时 footer 变为 justify-between */
  left?: ReactNode;
}

/** 弹窗底部操作区统一组件：取消 + 确认 + saving 状态 + 可选左侧插槽 */
export default function ModalFooter({
  onCancel,
  cancelText = '取消',
  onConfirm,
  confirmText = '确认',
  confirmVariant = 'primary',
  saving = false,
  savingText = '保存中...',
  left,
}: ModalFooterProps) {
  return (
    <div className={`flex items-center gap-2 ${left ? 'justify-between' : 'justify-end'}`}>
      {left && <div>{left}</div>}
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {cancelText}
        </Button>
        {onConfirm && (
          <Button variant={confirmVariant} onClick={onConfirm} disabled={saving}>
            {saving ? savingText : confirmText}
          </Button>
        )}
      </div>
    </div>
  );
}
