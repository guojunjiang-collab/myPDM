import { useEffect, useState } from 'react';
import { configurationApi } from '../../services/api';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { ConfigurationItemDetail } from '../../types';

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

/* ================================================================
   构型项详情覆盖层（移动端，只读，多 Tab，参照零部件详情 PartDetailPage）：
   - Tab：概览 / 零部件 / 子构型项 / 图文档 / 版本
   - 零部件/图文档 → onNavigate 栈内跳转；子构型项 → 详情栈 push（逐级下钻）
   - 覆盖层模式 Props（onBack/onNavigate）与独立路由模式共用
   ================================================================ */

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

interface Props {
  /** 构型项版本 revision id */
  revisionId?: string;
  onBack?: () => void;
  onNavigate?: (to: string) => void;
}

type TabKey = 'overview' | 'parts' | 'children' | 'documents' | 'versions';

export default function ConfigItemDetailPage({ revisionId, onBack, onNavigate }: Props) {
  const [detail, setDetail] = useState<ConfigurationItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const overlayPush = useDetailOverlayPush();

  useEffect(() => {
    let alive = true;
    if (!revisionId) {
      setError('缺少构型项 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    configurationApi
      .detail(revisionId)
      .then((data) => {
        if (alive) {
          setDetail(data ?? null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setDetail(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revisionId]);

  const code = detail?.revision.code || detail?.master.code || revisionId || '';
  const name = detail?.revision.name || detail?.master.name || '';

  const openPart = (revision_id?: string) => {
    if (revision_id && onNavigate) onNavigate(`/parts/${revision_id}`);
  };
  const openChild = (childId?: string) => {
    if (childId && overlayPush) overlayPush.push({ kind: 'config-item', id: childId });
  };
  const openDocument = (documentId?: string) => {
    if (documentId && onNavigate) onNavigate(`/documents/${documentId}`);
  };

  const TABS: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: '概览' },
    { key: 'parts', label: `零部件${detail?.parts.length ? ` (${detail.parts.length})` : ''}` },
    { key: 'children', label: `子构型项${detail?.children.length ? ` (${detail.children.length})` : ''}` },
    { key: 'documents', label: `图文档${detail?.documents.length ? ` (${detail.documents.length})` : ''}` },
    { key: 'versions', label: `版本${detail?.versions.length ? ` (${detail.versions.length})` : ''}` },
  ];

  return (
    <div className="flex flex-col">
      {/* 顶部：返回 + 标题 + Tab */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{code}</div>
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                tab === t.key ? 'bg-primary-600 text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
        {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
        {!loading && !error && !detail && <EmptyState text="未找到构型项" />}

        {!loading && !error && detail && tab === 'overview' && (
          <div className="flex flex-col gap-2">
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <StatusBadge status={detail.revision.status} map={STATUS_MAP} />
                <span className="text-xs text-gray-500">版本 {detail.revision.version}</span>
              </div>
              <div className="mt-2 text-sm font-medium text-gray-900 break-all">{code} {name}</div>
              <div className="mt-1 text-xs text-gray-500">
                {formatMeta([
                  ['签出', detail.revision.check_out_user_name || detail.revision.check_out_user_id || undefined],
                  ['迭代', detail.revision.latest_iteration != null ? String(detail.revision.latest_iteration) : undefined],
                  ['创建时间', fmtDate(detail.revision.created_at)],
                ])}
              </div>
              {detail.revision.remark && (
                <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">{detail.revision.remark}</div>
              )}
            </div>
          </div>
        )}

        {!loading && !error && detail && tab === 'parts' && (
          <div className="flex flex-col gap-1.5">
            {detail.parts.length === 0 ? (
              <EmptyState text="暂无关联零部件" />
            ) : (
              detail.parts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openPart(p.part_detail?.revision_id)}
                  className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                >
                  <div className="text-sm text-gray-900 break-all">
                    {p.part_detail ? `${p.part_detail.code} ${p.part_detail.name}` : p.part_id}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatMeta([
                      ['类型', p.part_type === 'assembly' ? '部件' : '零件'],
                      ['要求', p.is_required ? '必装' : '选装'],
                      ['数量', p.quantity != null ? String(p.quantity) : undefined],
                      ['版本', p.part_detail?.version || undefined],
                    ])}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && !error && detail && tab === 'children' && (
          <div className="flex flex-col gap-1.5">
            {detail.children.length === 0 ? (
              <EmptyState text="暂无子构型项" />
            ) : (
              detail.children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openChild(c.child_detail?.id ?? c.child_id)}
                  className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                >
                  <div className="text-sm text-gray-900 break-all">
                    {c.child_detail ? `${c.child_detail.code} ${c.child_detail.name}` : c.child_id}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatMeta([
                      ['要求', c.is_required ? '必装' : '选装'],
                      ['数量', c.quantity != null ? String(c.quantity) : undefined],
                    ])}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && !error && detail && tab === 'documents' && (
          <div className="flex flex-col gap-1.5">
            {detail.documents.length === 0 ? (
              <EmptyState text="暂无关联图文档" />
            ) : (
              detail.documents.map((link) => {
                const doc = (link as { document?: { id?: string; code?: string; name?: string; version?: string; status?: string; file_name?: string } }).document;
                return (
                  <button
                    key={(link as { id?: string }).id ?? (doc?.id ?? 'd')}
                    onClick={() => openDocument((link as { document_id?: string }).document_id)}
                    className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                  >
                    <div className="text-sm text-gray-900 break-all">
                      {doc?.code ? `${doc.code} ${doc.name ?? ''}` : '图文档'}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {formatMeta([
                        ['版本', doc?.version || undefined],
                        ['文件', doc?.file_name || undefined],
                      ])}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        {!loading && !error && detail && tab === 'versions' && (
          <div className="flex flex-col gap-1.5">
            {detail.versions.length === 0 ? (
              <EmptyState text="暂无版本历史" />
            ) : (
              detail.versions.map((v) => (
                <div key={v.id} className="bg-white rounded-lg px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-gray-900">{v.version}</span>
                    <StatusBadge status={v.status} map={STATUS_MAP} />
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatMeta([
                      ['签出', v.check_out_user_name || undefined],
                      ['创建时间', fmtDate(v.created_at)],
                    ])}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
