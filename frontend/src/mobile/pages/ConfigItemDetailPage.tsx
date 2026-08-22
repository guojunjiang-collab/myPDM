import { useEffect, useState } from 'react';
import { configurationApi, mediaApi, partsApi } from '../../services/api';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import ConfigTree from '../components/ConfigTree';
import { formatMeta } from '../components/formatMeta';
import type { ConfigPartItem, ConfigurationItemDetail } from '../../types';

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

  const openPart = (masterId?: string, revId?: string) => {
    // PartDetailPage 的 :id 是 master_id；rev 参数定位到关联版本
    if (masterId && onNavigate) {
      onNavigate(revId ? `/parts/${masterId}?rev=${revId}` : `/parts/${masterId}`);
    }
  };
  const openChild = (childId?: string) => {
    if (childId && overlayPush) overlayPush.push({ kind: 'config-item', id: childId });
  };
  const openDocument = (documentId?: string) => {
    if (documentId && onNavigate) onNavigate(`/documents/${documentId}`);
  };

  // 零部件卡片"预览"按钮：装配体 → 3D 预览入口（stp-viewer?assembly=）；零件 → 附件 STP 单模型入口
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const onPreviewPart = async (p: ConfigPartItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const pd = p.part_detail;
    if (!pd?.revision_id || previewingId) return;
    setPreviewingId(p.id);
    try {
      const win = window.open('', '_blank');
      if (p.part_type === 'assembly') {
        const url = `/stp-viewer?assembly=${pd.revision_id}&code=${encodeURIComponent(pd.code ?? '')}&name=${encodeURIComponent(pd.name ?? '')}`;
        if (win) win.location.href = url;
        return;
      }
      const list = (await partsApi.listAttachments(pd.revision_id)) as Array<{ id: string; file_name?: string }>;
      const stp = list.find((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
      if (!stp) {
        window.alert('该零件暂无 STP 三维模型');
        return;
      }
      const t = await mediaApi.token(stp.id, 'gltf');
      const url = `/stp-viewer?id=${encodeURIComponent(stp.id)}&token=${encodeURIComponent(t)}&code=${encodeURIComponent(pd.code ?? '')}&version=${encodeURIComponent(pd.version ?? '')}&name=${encodeURIComponent(pd.name ?? '')}`;
      if (win) win.location.href = url;
    } catch {
      window.alert('3D 模型加载失败，请稍后重试');
    } finally {
      setPreviewingId(null);
    }
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
                  onClick={() => openPart(p.part_detail?.id, p.part_detail?.revision_id)}
                  className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                >
                  {/* 行1：编号（左）+ 用量 + 版本 + 必装/选装徽标 + 状态（右）；徽标列与行2 类型徽标右对齐 */}
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                      {p.part_detail?.code ?? p.part_id}
                    </span>
                    {p.quantity != null && (
                      <span className="shrink-0 truncate text-center text-xs text-gray-500">x{p.quantity}</span>
                    )}
                    {p.part_detail?.version && (
                      <span className="shrink-0 text-center text-xs text-gray-500">{p.part_detail.version}</span>
                    )}
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {p.is_required ? '必装' : '选装'}
                    </span>
                    {p.part_detail?.status && (
                      <span className="shrink-0 w-14 flex justify-end">
                        <StatusBadge status={p.part_detail.status} map={STATUS_MAP} />
                      </span>
                    )}
                  </span>
                  {/* 行2：名称（左）+ 类型徽标（固定位置）+ 预览按钮占位（无 3D 时留空，徽标不跳动） */}
                  <span className="mt-1 flex items-center gap-1.5 min-w-0 min-h-7">
                    <span className="flex-1 min-w-0 truncate text-xs text-gray-500">
                      {p.part_detail?.name || ''}
                    </span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded-full text-xs ${
                        p.part_type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {p.part_type === 'assembly' ? '部件' : '零件'}
                    </span>
                    {/* 预览按钮固定占位：无 3D 模型时留空，保证类型徽标位置一致 */}
                    <span className="shrink-0 w-14 flex justify-end">
                      {p.part_detail?.has_3d === true && (
                        <button
                          type="button"
                          onClick={(e) => onPreviewPart(p, e)}
                          disabled={previewingId === p.id}
                          className="shrink-0 px-2.5 min-h-7 rounded bg-primary-50 text-primary-600 text-xs font-medium disabled:opacity-60"
                        >
                          {previewingId === p.id ? '加载中...' : '预览'}
                        </button>
                      )}
                    </span>
                  </span>
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
              // 树形：箭头展开/折叠逐层查看（懒加载子树），点击行逐级下钻子构型项详情
              <ConfigTree rootItems={detail.children} onOpenChild={openChild} />
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
