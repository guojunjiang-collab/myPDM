import type { CustomFieldDefinition } from '../types';
import { INPUT_BASE_CLASS } from './ui/Input';

interface Props {
  def: CustomFieldDefinition;
  value: any;
  onChange: (val: any) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export default function CustomFieldInput({ def, value, onChange, disabled, readOnly }: Props) {
  const baseClass = INPUT_BASE_CLASS;

  if (readOnly) {
    if (def.field_type === 'multiselect') {
      const selected = Array.isArray(value) ? value : [];
      if (selected.length === 0) return <span className="text-sm text-gray-400">-</span>;
      const display = selected.length > 2
        ? `${selected.slice(0, 2).join('、')} +${selected.length - 2}`
        : selected.join('、');
      return <span className="text-sm text-gray-700">{display}</span>;
    }
    return <span className="text-sm text-gray-700">{value ?? '-'}</span>;
  }

  if (def.field_type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-2 py-1">
        {(def.options || []).map(opt => {
          const checked = selected.includes(opt);
          return (
            <label key={opt} className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border cursor-pointer
              ${checked ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="checkbox" checked={checked} disabled={disabled}
                onChange={() => {
                  if (checked) onChange(selected.filter(v => v !== opt));
                  else onChange([...selected, opt]);
                }}
                className="w-3 h-3" />
              {opt}
            </label>
          );
        })}
      </div>
    );
  }

  if (def.field_type === 'select') {
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass}>
        <option value="">请选择</option>
        {(def.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (def.field_type === 'number') {
    return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass} />;
  }

  return <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className={baseClass} />;
}
