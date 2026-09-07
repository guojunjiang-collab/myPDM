import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { partsApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../components/EmptyState';
import FilterDropdown from '../components/FilterDropdown';
import DetailOverlayStack from '../components/DetailOverlayStack';
import { useDetailOverlay } from '../hooks/useDetailOverlay';
import type { PartListItem } from '../../types';

// 后端 GET /api/parts/ 原生支持 type 参数（Literal['part','assembly']），
// 空串 '' 表示全部，undefined 时不传该参数
const TYPE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'part', label: '零件' },
  { key: 'assembly', label: '部件' },
];

// 状态筛选（与桌面 PartsPage 一致）：空串 = 全部状态
const STATUS_FILTERS = [
  { key: '', label: '全部状态' },
  { key: 'draft', label: '草稿' },
  { key: 'frozen', label: '冻结' },
  { key: 'released', label: '发布' },
  { key: 'obsolete', label: '作废' },
];

export default function PartsListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  const [typeFilter, setTypeFilter] = useState('');
  // 状态筛选（空串 = 全部状态）
  const [statusFilter, setStatusFilter] = useState('');
  // 全部版本：显示每个物料的所有版本行（对齐桌面 show_all_versions 开关）
  const [showAllVersions, setShowAllVersions] = useState(false);
  // 仅顶层：只显示没有父项的最顶层零部件（对齐桌面 top_level 参数）
  const [topLevel, setTopLevel] = useState(false);
  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 清理历史残留的 ?tab= 参数（旧版详情覆盖层把 Tab 写进列表 URL，会污染下次进入详情的默认 Tab）
  useEffect(() => {
    if (location.search.includes('tab=')) {
      navigate(location.pathname, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 详情覆盖层栈：点卡片打开第一层，详情内跳转（BOM 下钻/反查）逐级入栈，返回逐级弹出；
  // 列表不卸载、滚动位置天然保留
  const { stack, openDetail, pushTarget, handleDetailNavigate } = useDetailOverlay();

  // 兜底：覆盖层主路径不卸载、位置天然保留；但详情内跳转（新标签外的路由跳转）会离开
  // /parts 路由导致列表重挂载 → 卸载时保存 main 滚动位置，重挂载首次加载完成后恢复
  const restoredRef = useRef(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (!loadedOnce) setLoadedOnce(true);
  }, [loading, loadedOnce]);
  useEffect(() => {
    if (!loadedOnce || restoredRef.current) return;
    restoredRef.current = true;
    const saved = Number(sessionStorage.getItem('mobile.parts.scroll') || '0');
    if (saved > 0) document.querySelector('main')?.scrollTo(0, saved);
  }, [loadedOnce]);
  useEffect(() => {
    return () => {
      const main = document.querySelector('main');
      if (main) sessionStorage.setItem('mobile.parts.scroll', String(main.scrollTop));
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // partsApi.list 直接返回响应体 { items, total, page, page_size }（.then((r) => r.data)）
    // 默认按件号升序（后端支持 sort_field=code / sort_order=asc）
    partsApi
      .list({
        search: debounced || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
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
  }, [debounced, typeFilter, statusFilter, showAllVersions, topLevel]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-[var(--ui-bg-subtle)] px-3 pt-2 pb-1 z-10">
        {/* 行1：搜索框 + 对比按钮 */}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 min-w-0 h-11 px-4 rounded-lg bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] text-base"
            placeholder="搜索件号/名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            onClick={() => navigate('/parts/compare')}
            size="touch"
            className="shrink-0"
          >
            ⇄ 对比
          </Button>
        </div>
        {/* 行2：类型下拉（左）+ 状态下拉 + 顶层/全部版本开关（右） */}
        <div className="flex items-center gap-2 mt-2">
          <FilterDropdown value={typeFilter} options={TYPE_FILTERS} onChange={setTypeFilter} />
          <FilterDropdown value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} />
          <div className="flex-1" />
          <button
            onClick={() => setTopLevel((v) => !v)}
            className={`min-h-10 px-3 rounded-lg text-xs ${topLevel ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-[var(--ui-bg-surface)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)]'}`}
          >
            顶层
          </button>
          <button
            onClick={() => setShowAllVersions((v) => !v)}
            className={`min-h-10 px-3 rounded-lg text-xs ${showAllVersions ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-[var(--ui-bg-surface)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)]'}`}
          >
            全部版本
          </button>
        </div>
      </div>
      {loading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="未找到零部件" />}
      <MobileCardList
        items={items}
        keyOf={(p) => (showAllVersions ? p.revision_id : p.master_id)}
        renderMain={(p) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--ui-text-primary)]">{p.code}</span>
            {!showAllVersions && p.version_count && p.version_count > 1 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-lg text-xs bg-primary-50 text-primary-600">
                {p.version_count} 个版本
              </span>
            )}
            <span className="shrink-0 text-xs text-[var(--ui-text-secondary)]">{p.version}</span>
            <span className="shrink-0 w-12 flex justify-end">
              <Badge status={p.status} />
            </span>
          </div>
        )}
        renderMeta={(p) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-secondary)]">{p.name}</span>
            {p.check_out_user_name && (
              <span className="shrink-0 text-xs text-[var(--ui-text-secondary)]">{p.check_out_user_name}</span>
            )}
          </div>
        )}
        onClick={(p) =>
          openDetail({ kind: 'part', id: p.master_id, rev: showAllVersions ? p.revision_id : undefined })
        }
      />
      {/* 详情覆盖层栈：全部渲染保留状态，只显示栈顶；逐级返回 */}
      <DetailOverlayStack stack={stack} onNavigate={handleDetailNavigate} pushTarget={pushTarget} />
    </div>
  );
}
