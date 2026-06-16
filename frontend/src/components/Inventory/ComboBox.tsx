import { useState, useMemo, useRef, useEffect } from 'react';

export interface ComboOption {
  value: string;
  label: string;
  search?: string; // 用于过滤的关键词，缺省用 label
}

interface Props {
  value: string;
  options: ComboOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}

/** 可输入搜索的下拉选择（适合从大量选项中快速定位）。 */
export default function ComboBox({ value, options, placeholder = '选择...', onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const list = kw ? options.filter((o) => (o.search || o.label).toLowerCase().includes(kw)) : options;
    return list.slice(0, 100);
  }, [options, query]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-primary-500 truncate">
        {selected ? selected.label : <span className="text-gray-400">{placeholder}</span>}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[18rem] bg-white border border-gray-200 rounded-lg shadow-lg">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="输入编号/名称搜索..."
            className="w-full px-2 py-1.5 border-b border-gray-200 text-sm focus:outline-none" />
          <div className="max-h-56 overflow-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">无匹配</div>
            ) : filtered.map((o) => (
              <button key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false); setQuery(''); }}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${o.value === value ? 'bg-primary-50 text-primary-700' : ''}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
