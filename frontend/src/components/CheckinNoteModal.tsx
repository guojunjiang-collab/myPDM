import { Modal } from './Modal';
import Textarea from './ui/Textarea';
import Button from './ui/Button';

interface CheckinNoteModalProps {
  open: boolean;
  note: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving?: boolean;
}

/** 签入说明弹窗：吸收 PartDetailModal/DocumentDetailModal/ConfigItemDetailModal 三处同构实现 */
export default function CheckinNoteModal({ open, note, onChange, onConfirm, onCancel, saving = false }: CheckinNoteModalProps) {
  return (
    <Modal open={open} title="签入说明" onClose={onCancel} width="md">
      <Textarea
        value={note}
        onChange={(e) => onChange(e.target.value)}
        placeholder="请输入签入说明..."
        rows={5}
        className="mb-4"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button variant="primary" onClick={onConfirm} disabled={saving}>
          {saving ? '签入中...' : '确认签入'}
        </Button>
      </div>
    </Modal>
  );
}
