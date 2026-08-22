import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
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
  // 全部版本：显示每个物料的所有版本行（对齐桌面 show_all_versions 开关）
  const [showAllVersions, setShowAllVersions] = useState(false);
  // 仅顶层：只显示没有父项的最顶层零部件（对齐桌面 top_level 参数）
  const [topLevel, setTopLevel] = useState(false);
  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // partsApi.list 直接返回响应体 { items, total, page, page_size }（.then((r) => r.data)）
    // 默认按件号升序（后端支持 sort_field=code / sort_order=asc）
    partsApi
      .list({
        search: debounced || undefined,
        type: typeFilter || undefined,
        show_all_versions: showAllVersions || undefined,
        top_level: topLevel || undefined,
        sort_field: 'code',
        sort_order: 'asc',
        page_size: 50,
      })
      .then((data: { items?: PartListItem[] }) => {
        if (alive) {
          setItems(data.items ?? []);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          // 失败时清空旧卡片，避免错误提示下方残留上一次成功的数据
          setItems([]);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debounced, typeFilter, showAllVersions, topLevel]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        {/* 行1：搜索框 + 对比按钮 */}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 min-w-0 h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
            placeholder="搜索件号/名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => navigate('/parts/compare')}
            className="shrink-0 min-h-11 px-3 rounded-lg bg-white text-primary-600 border border-primary-600 text-sm font-medium"
          >
            ⇄ 对比
          </button>
        </div>
        {/* 行2：类型筛选（左）+ 顶层/全部版本开关（右） */}
        <div className="flex items-center gap-2 mt-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`min-h-10 px-3 rounded-lg text-xs ${typeFilter === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setTopLevel((v) => !v)}
            className={`min-h-10 px-3 rounded-lg text-xs ${topLevel ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            顶层
          </button>
          <button
            onClick={() => setShowAllVersions((v) => !v)}
            className={`min-h-10 px-3 rounded-lg text-xs ${showAllVersions ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            全部版本
          </button>
        </div>
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="未找到零部件" />}
      <MobileCardList
        items={items}
        keyOf={(p) => (showAllVersions ? p.revision_id : p.master_id)}
        renderMain={(p) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{p.code}</span>
            {!showAllVersions && p.version_count && p.version_count > 1 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-lg text-xs bg-gray-100 text-gray-600">
                {p.version_count} 个版本
              </span>
            )}
            <span className="shrink-0 text-xs text-gray-500">{p.version}</span>
            <span className="shrink-0 w-12 flex justify-end">
              <StatusBadge status={p.status} map={STATUS_MAP} />
            </span>
          </div>
        )}
        renderMeta={(p) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{p.name}</span>
            {p.check_out_user_name && (
              <span className="shrink-0 text-xs text-gray-500">{p.check_out_user_name}</span>
            )}
          </div>
        )}
        onClick={(p) =>
          navigate(
            showAllVersions ? `/parts/${p.master_id}?rev=${p.revision_id}` : `/parts/${p.master_id}`
          )
        }
      />
    </div>
  );
}
