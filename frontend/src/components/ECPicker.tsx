import { useEffect, useState } from 'react';
import axios from 'axios';
import { Modal } from './Modal';
import Button from './ui/Button';
import Input from './ui/Input';
import { useAuthStore } from '../stores/auth';

interface ECPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { entity_type: 'ec'; entity_id: string }[]) => void;
}

interface ECRow {
  id: string;
  number: string;
  title: string;
  kind: 'ECR' | 'ECO';
}

export default function ECPicker({ open, onClose, onConfirm }: ECPickerProps) {
  const [rows, setRows] = useState<ECRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const token = useAuthStore.getState().token;

  useEffect(() => {
    if (!open) return;
    const headers = { Authorization: `Bearer ${token}` };
    const params = { page_size: 100 };
    Promise.all([
      axios.get('/api/ecrs/', { headers, params }).catch(() => ({ data: { items: [] } })),
      axios.get('/api/ecos/', { headers, params }).catch(() => ({ data: { items: [] } })),
    ]).then(([ecrRes, ecoRes]) => {
      const ecrs: ECRow[] = (ecrRes.data.items || []).map((e: any) => ({
        id: e.id, number: e.ecr_number, title: e.title, kind: 'ECR' as const,
      }));
      const ecos: ECRow[] = (ecoRes.data.items || []).map((e: any) => ({
        id: e.id, number: e.eco_number, title: e.title, kind: 'ECO' as const,
      }));
      setRows([...ecrs, ...ecos]);
      setSelected(new Set());
    });
  }, [open, token]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const filtered = rows.filter(
    (r) => !search || r.number?.includes(search) || r.title?.includes(search)
  );

  const handleConfirm = () => {
    onConfirm(Array.from(selected).map((id) => ({ entity_type: 'ec' as const, entity_id: id })));
    onClose();
  };

  return (
    <Modal open={open} title="选择 EC(变更单)" onClose={onClose} width="lg" zIndex={60}>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索单号/标题"
        className="mb-3"
      />
      <div className="max-h-80 overflow-y-auto divide-y">
        {filtered.map((r) => (
          <label key={r.id} className="flex items-center gap-2 py-2 cursor-pointer">
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
            <span className="text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700">{r.kind}</span>
            <span className="font-medium">{r.number}</span>
            <span className="text-[var(--ui-text-secondary)] truncate">{r.title}</span>
          </label>
        ))}
        {filtered.length === 0 && <div className="py-8 text-center text-[var(--ui-text-tertiary)]">无数据</div>}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={handleConfirm}>
          确认({selected.size})
        </Button>
      </div>
    </Modal>
  );
}
