import { useEffect, useRef, useState } from 'react';
import { documentsApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import DocumentDetailPage from './DocumentDetailPage';
import type { DocumentRevision } from '../../types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

// 后端 GET /api/documents/ 支持 status 参数，空串 '' 表示全部
const STATUS_FILTERS = [
  { key: '', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'frozen', label: '冻结' },
  { key: 'released', label: '发布' },
  { key: 'obsolete', label: '作废' },
];

export default function DocumentsListPage() {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  const [statusFilter, setStatusFilter] = useState('');
  // 全部版本：显示每个图文档的所有版本行（对齐零部件 show_all_versions 开关）
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [items, setItems] = useState<DocumentRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 详情覆盖层模式：点卡片在列表上方打开全屏详情（列表不卸载、滚动位置天然保留）
  const [selected, setSelected] = useState<string | null>(null);
  const overlayRef = useRef(false);
  useEffect(() => {
    overlayRef.current = selected != null;
  }, [selected]);
  // 系统返回（popstate）：弹掉哨兵后关闭覆盖层
  useEffect(() => {
    const onPop = () => {
      const cur = window.history.state as { mobileDocsOverlay?: boolean } | null;
      if (!cur?.mobileDocsOverlay && overlayRef.current) {
        setSelected(null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const openDetail = (id: string) => {
    setSelected(id);
    window.history.pushState({ mobileDocsOverlay: true }, '');
  };
  const closeDetail = () => {
    setSelected(null);
    window.history.back();
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // documentsApi.list 返回原始 axios response（响应体在 .data：{ items, total, page, page_size }）
    documentsApi
      .list({
        search: debounced || undefined,
        status: statusFilter || undefined,
        show_all_versions: showAllVersions || undefined,
        // 默认按编号升序（对齐零部件列表）
        sort_field: 'code',
        sort_order: 'asc',
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
  }, [debounced, statusFilter, showAllVersions]);

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        {/* 行1：搜索框 + 全部版本开关 */}
        <div className="flex items-center gap-2">
          <input
            className="flex-1 min-w-0 h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
            placeholder="搜索编号/名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => setShowAllVersions((v) => !v)}
            className={`shrink-0 min-h-11 px-3 rounded-lg text-sm font-medium ${
              showAllVersions ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            全部版本
          </button>
        </div>
        {/* 行2：状态筛选 */}
        <div className="flex items-center gap-2 mt-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`min-h-10 px-3 rounded-lg text-xs ${statusFilter === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="未找到图文档" />}
      <MobileCardList
        items={items}
        keyOf={(d) => d.id}
        renderMain={(d) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{d.code}</span>
            {!showAllVersions && (d as any).version_count > 1 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-lg text-xs bg-gray-100 text-gray-600">
                {(d as any).version_count} 个版本
              </span>
            )}
            <span className="shrink-0 text-xs text-gray-500">{d.version}</span>
            <span className="shrink-0 w-12 flex justify-end">
              <StatusBadge status={d.status} map={STATUS_MAP} />
            </span>
          </div>
        )}
        renderMeta={(d) => (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{d.name}</span>
            {d.check_out_user_name && (
              <span className="shrink-0 text-xs text-gray-500">{d.check_out_user_name}</span>
            )}
          </div>
        )}
        onClick={(d) => openDetail(d.id)}
      />
      {/* 详情覆盖层：列表保持原状，详情叠在上方 */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-gray-50 overflow-y-auto">
          <DocumentDetailPage id={selected} onBack={closeDetail} />
        </div>
      )}
    </div>
  );
}
