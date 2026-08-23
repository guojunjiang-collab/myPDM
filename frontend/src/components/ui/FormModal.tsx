import { ReactNode } from 'react';
import { Modal } from '../Modal';
import Alert from './Alert';
import ModalFooter from './ModalFooter';

interface FormModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | '3xl' | 'max';
  height?: string;
  onSubmit: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  /** 提交中：确认按钮禁用 + 显示「保存中...」 */
  saving?: boolean;
  /** 表单错误：内容区顶部渲染 Alert danger */
  error?: string | null;
  /** footer 左侧插槽 */
  footerLeft?: ReactNode;
}

/** 新建/编辑表单弹窗骨架：内容区 space-y-4 + 统一 footer + 错误块 + saving 状态 */
export default function FormModal({
  open,
  title,
  onClose,
  children,
  width = 'md',
  height,
  onSubmit,
  confirmText = '保存',
  cancelText = '取消',
  saving = false,
  error,
  footerLeft,
}: FormModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={width}
      height={height}
      footer={
        <ModalFooter
          onCancel={onClose}
          cancelText={cancelText}
          onConfirm={onSubmit}
          confirmText={confirmText}
          saving={saving}
          left={footerLeft}
        />
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="space-y-4">{children}</div>
    </Modal>
  );
}
