import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tile, EmptyState } from './tiles';
import { dashboardApi } from '../../services/api';
import { relativeTime } from './lib/aggregate';
import type { MyTodoItem } from '../../types';

const TYPE_TAG: Record<string, { label: string; cls: string }> = {
  ecr: { label: 'ECR', cls: 'bg-blue-50 text-blue-800' },
  eco: { label: 'ECO', cls: 'bg-amber-50 text-amber-800' },
};
const PRIO_DOT: Record<string, string> = { urgent: '#E24B4A', high: '#EF9F27', normal: '#378ADD', low: '#888780' };
const TYPE_ROUTE: Record<string, string> = { ecr: '/ec', eco: '/ec' };

export function MyTodosTile({ onCount }: { onCount?: (n: number) => void }) {
  const [items, setItems] = useState<MyTodoItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    dashboardApi.getMyTodos()
      .then((res) => { if (!cancelled) { const list = res.data?.items ?? []; setItems(list); onCount?.(list.length); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [onCount]);

  const now = Date.now();
  return (
    <Tile
      title="待我处理"
      icon={<span>📥</span>}
      right={items.length > 0 ? <span className="bg-red-50 text-red-600 text-sm px-2 py-0.5 rounded-full">{items.length}</span> : undefined}
      className="min-h-[220px]"
    >
      {loaded && items.length === 0 ? <EmptyState text="✅ 暂无待办" /> : (
        <div className="flex flex-col gap-2.5 flex-1">
          {items.slice(0, 5).map((it) => (
            <Link key={`${it.type}:${it.id}`} to={TYPE_ROUTE[it.type] || '/'} className="flex items-center gap-2 text-base hover:bg-gray-50 rounded px-1 py-0.5">
              <span className={`text-sm px-1.5 rounded ${TYPE_TAG[it.type]?.cls || 'bg-gray-100 text-gray-700'}`}>{TYPE_TAG[it.type]?.label || it.type}</span>
              <span className={`truncate flex-1 ${it.kind === 'rejected' ? 'text-red-600' : 'text-gray-700'}`}>
                {it.title}{it.kind === 'rejected' ? ' · 被驳回' : ''}
              </span>
              {it.kind === 'review' && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIO_DOT[it.priority] || '#888' }} />}
              <span className="text-sm text-gray-400 shrink-0">{relativeTime(it.updated_at || '', now)}</span>
            </Link>
          ))}
          {items.length > 5 && <Link to="/ec" className="text-sm text-blue-600 mt-auto">查看全部 {items.length} 项 →</Link>}
        </div>
      )}
    </Tile>
  );
}
