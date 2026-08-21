import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { PartListItem } from '../../types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};
// 后端 GET /api/parts/ 原生支持 type 参数（Literal['part','assembly']），
// 空串 '' 表示全部，undefined 时不传该参数
const TYPE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'part', label: '零件' },
  { key: 'assembly', label: '部件' },
];

export default function PartsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  const [typeFilter, setTypeFilter] = useState('');
  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // partsApi.list 直接返回响应体 { items, total, page, page_size }（.then((r) => r.data)）
    partsApi
      .list({
        search: debounced || undefined,
        type: typeFilter || undefined,
        page_size: 50,
      })
      .then((data: { items?: PartListItem[] }) => {
        if (alive) {
          setItems(data.items ?? []);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) setError('加载失败，请稍后重试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debounced, typeFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索件号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 mt-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`min-h-9 px-3 rounded-full text-xs ${typeFilter === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="未找到零部件" />}
      <MobileCardList
        items={items}
        keyOf={(p) => p.master_id}
        renderMain={(p) => `${p.code} ${p.name}`}
        renderMeta={(p) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} map={STATUS_MAP} />
            <span>{formatMeta([['版本', p.version], ['更新时间', p.updated_at ? new Date(p.updated_at).toLocaleDateString('zh-CN') : '']])}</span>
          </span>
        )}
        onClick={(p) => navigate(`/parts/${p.master_id}`)}
      />
    </div>
  );
}
