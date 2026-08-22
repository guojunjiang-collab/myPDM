import { useEffect, useRef, useState } from 'react';
import { configurationApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import Badge from '../../components/ui/Badge';
import EmptyState from '../components/EmptyState';
import DetailOverlayStack from '../components/DetailOverlayStack';
import { useDetailOverlay } from '../hooks/useDetailOverlay';
import { formatMeta } from '../components/formatMeta';

/* ================================================================
   构型项管理移动页（只读，参照零部件列表 PartsListPage 模式）
   - 搜索 + 卡片列表；点击 → 覆盖层详情栈（ConfigItemDetailPage 多 Tab）
   - 详情内跳转（零部件/图文档/子构型项）全部栈内，滚动位置保留、全面屏手势逐级返回
   ================================================================ */

/** 桌面 ConfigurationList 的列表行（listItems 响应映射） */
interface ConfigItemRow {
  revision_id: string;
  master_id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration?: number;
  created_at?: string;
  version_count?: number;
}

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

export default function ConfigurationItemsPage() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  // 全部版本：显示每个构型项的所有版本行（对齐桌面 show_all_versions 开关）
  const [showAllVersions, setShowAllVersions] = useState(false);
  // 仅顶层：只显示没有父构型项的最顶层（对齐桌面 top_level 参数）
  const [topLevel, setTopLevel] = useState(false);
  const [items, setItems] = useState<ConfigItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 详情覆盖层栈：点卡片打开第一层，详情内子构型项下钻/零部件图文档跳转逐级入栈，返回逐级弹出；
  // 列表不卸载、滚动位置天然保留
  const { stack, openDetail, pushTarget, handleDetailNavigate } = useDetailOverlay();

  // 兜底：详情内路由跳转（onNavigate 到 /parts 等）离开本路由导致列表重挂载 → 卸载时保存滚动位置，重挂载恢复
  const restoredRef = useRef(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (!loadedOnce) setLoadedOnce(true);
  }, [loading, loadedOnce]);
  useEffect(() => {
    if (!loadedOnce || restoredRef.current) return;
    restoredRef.current = true;
    const saved = Number(sessionStorage.getItem('mobile.config-items.scroll') || '0');
    if (saved > 0) document.querySelector('main')?.scrollTo(0, saved);
  }, [loadedOnce]);
  useEffect(() => {
    return () => {
      const main = document.querySelector('main');
      if (main) sessionStorage.setItem('mobile.config-items.scroll', String(main.scrollTop));
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    configurationApi
      .listItems({
        page: 1,
        page_size: 100,
        include_custom_fields: true,
        show_all_versions: showAllVersions || undefined,
        top_level: topLevel || undefined,
      })
      .then((r) => {
        if (!alive) return;
        const data = (r.data ?? {}) as { items?: any[] };
        const rows: ConfigItemRow[] = (data.items || []).map((item: any) => ({
          revision_id: item.revision_id || item.id,
          master_id: item.master_id,
          code: item.code || '',
          name: item.name || '',
          version: item.version || '',
          status: item.status || 'draft',
          check_out_user_name: item.check_out_user_name,
          check_out_date: item.check_out_date,
          latest_iteration: item.latest_iteration || 1,
          created_at: item.created_at,
          version_count: item.version_count,
        }));
        setItems(rows);
        setError(null);
      })
      .catch(() => {
        if (alive) {
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
  }, [showAllVersions, topLevel]);

  // 客户端即时过滤（搜索构型号/名称）
  const kw = debounced.trim().toLowerCase();
  const filtered = kw ? items.filter((i) => i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw)) : items;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        {/* 搜索框 + 工具栏（顶层/全部版本）同一行 */}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 min-w-0 h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
            placeholder="搜索构型号/名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => setTopLevel((v) => !v)}
            className={`shrink-0 min-h-11 px-3 rounded-lg text-xs ${topLevel ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            顶层
          </button>
          <button
            onClick={() => setShowAllVersions((v) => !v)}
            className={`shrink-0 min-h-11 px-3 rounded-lg text-xs ${showAllVersions ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
          >
            全部版本
          </button>
        </div>
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && filtered.length === 0 && <EmptyState text="暂无构型项" />}
      <MobileCardList
        items={filtered}
        keyOf={(i) => i.revision_id}
        renderMain={(i) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{i.code}</span>
            {!showAllVersions && i.version_count && i.version_count > 1 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-lg text-xs bg-primary-50 text-primary-600">
                {i.version_count} 个版本
              </span>
            )}
            <span className="shrink-0 text-xs text-gray-500">{i.version}</span>
            <span className="shrink-0 w-12 flex justify-end">
              <Badge status={i.status} />
            </span>
          </div>
        )}
        renderMeta={(i) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{i.name}</span>
            {i.check_out_user_name && (
              <span className="shrink-0 text-xs text-gray-500">{i.check_out_user_name}</span>
            )}
          </div>
        )}
        onClick={(i) => openDetail({ kind: 'config-item', id: i.revision_id })}
      />
      {/* 详情覆盖层栈：全部渲染保留状态，只显示栈顶；逐级返回 */}
      <DetailOverlayStack stack={stack} onNavigate={handleDetailNavigate} pushTarget={pushTarget} />
    </div>
  );
}
