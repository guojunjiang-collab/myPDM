import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { documentsApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { DocumentRevision } from '../../types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

export default function DocumentsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  const [items, setItems] = useState<DocumentRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // documentsApi.list 返回原始 axios response（响应体在 .data：{ items, total, page, page_size }）
    documentsApi
      .list({
        search: debounced || undefined,
        page_size: 100,
      })
      .then((res) => {
        const data = (res.data ?? {}) as { items?: DocumentRevision[] };
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
  }, [debounced]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="未找到图文档" />}
      <MobileCardList
        items={items}
        keyOf={(d) => d.id}
        renderMain={(d) => `${d.code} ${d.name}`}
        renderMeta={(d) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} map={STATUS_MAP} />
            <span>
              {formatMeta([
                ['版本', d.version],
                ['更新时间', d.updated_at ? new Date(d.updated_at).toLocaleDateString('zh-CN') : ''],
              ])}
            </span>
          </span>
        )}
        onClick={(d) => navigate(`/documents/${d.id}`)}
      />
    </div>
  );
}
