import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { configurationApi, customFieldsApi, mediaApi, partsApi } from '../../services/api';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../components/EmptyState';
import ConfigTree from '../components/ConfigTree';
import { openAttachmentInNewTab } from '../components/AttachmentPreview';
import type { PreviewAttachment } from '../components/AttachmentPreview';
import { formatMeta } from '../components/formatMeta';
import type { ConfigPartItem, ConfigurationItemDetail } from '../../types';

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

/* ================================================================
   构型项详情覆盖层（移动端，只读，多 Tab，参照零部件详情 PartDetailPage）：
   - Tab：概览 / 零部件 / 子构型项 / 图文档 / 版本
   - 零部件/图文档 → onNavigate 栈内跳转；子构型项 → 详情栈 push（逐级下钻）
   - 覆盖层模式 Props（onBack/onNavigate）与独立路由模式共用
   ================================================================ */

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

  // 自定义字段（configuration_item 定义 + 当前版本值，参照零部件详情-概览）
  const [cfDefs, setCfDefs] = useState<Array<{ id: string; name: string; field_type?: string }>>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!revisionId) return;
    setCfLoading(true);
    setCfError(false);
    customFieldsApi
      .listDefinitions()
      .then((res: any) => {
        const defs = ((res?.data ?? res ?? []) as Array<{ id: string; name: string; field_type?: string; applies_to?: string[] }>).filter((d) =>
          (d.applies_to || []).includes('configuration_item'),
        );
        if (alive) setCfDefs(defs);
      })
      .catch(() => {
        // 定义加载失败不阻塞字段展示
      });
    customFieldsApi
      .getValues('configuration_item', revisionId)
      .then((res: any) => {
        const vals: Record<string, unknown> = {};
        ((res?.data ?? res ?? []) as Array<{ field_id: string; value: unknown }>).forEach((v) => {
          vals[v.field_id] = v.value;
        });
        if (alive) setCfValues(vals);
      })
      .catch(() => {
        // 值加载失败不阻塞字段展示（显示 "-"）
      })
      .finally(() => {
        if (alive) setCfLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revisionId]);

  // 自定义字段值展示：null/undefined/空数组/空串 → null（渲染为 "-"）
  const cfDisplay = (v: unknown): string | null => {
    if (v == null) return null;
    if (Array.isArray(v)) return v.length ? v.join('、') : null;
    const s = String(v);
    return s.trim() ? s : null;
  };
  const cfRows: Array<{ label: string; value?: ReactNode }> = cfDefs.map((d) => ({
    label: d.name,
    value: cfDisplay(cfValues[d.id]) ?? undefined,
  }));

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

  // 图文档卡片"预览"：直接读取该图文档首个附件（参照任务详情-关联对象图文档卡片）
  const onPreviewDoc = async (link: { id?: string }, doc: { file_id?: string; file_name?: string } | undefined, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!doc?.file_id || previewingId) return;
    setPreviewingId(link.id ?? 'doc');
    try {
      await openAttachmentInNewTab({ id: doc.file_id, file_name: doc.file_name ?? '' } as PreviewAttachment);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '预览失败，请重试');
    } finally {
      setPreviewingId(null);
    }
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
      <div className="sticky top-0 z-10 bg-[var(--ui-bg-subtle)] px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-[var(--ui-text-secondary)]"
          >
            ‹
          </button>
          {/* 标题：构型号 + 版本徽标 + 名称（版本徽标主色浅底，名称过长省略不影响版本可见） */}
          <div className="min-w-0 flex-1 flex items-center gap-1.5 text-base font-medium text-[var(--ui-text-primary)] truncate">
            <span className="shrink-0">{code}</span>
            {detail?.revision.version && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">
                {detail.revision.version}
              </span>
            )}
            <span className="flex-1 min-w-0 truncate">{name}</span>
          </div>
        </div>
        <div className="flex mt-1 bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                tab === t.key ? 'bg-[var(--ui-btn-primary-bg)] text-white font-medium' : 'text-[var(--ui-text-secondary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {loading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
        {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
        {!loading && !error && !detail && <EmptyState text="未找到构型项" />}

        {!loading && !error && detail && tab === 'overview' && (
          <div>
            {/* 基本信息区：2 列网格卡片（参照零部件详情-概览） */}
            <div className="text-sm font-bold text-[var(--ui-text-primary)] mb-2">基本信息</div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { label: '构型号', value: code },
                  { label: '名称', value: name },
                  {
                    label: '状态',
                    value: detail.revision.status ? <Badge status={detail.revision.status} /> : undefined,
                  },
                  { label: '版本', value: detail.revision.version },
                  {
                    label: '迭代',
                    value: detail.revision.latest_iteration != null ? String(detail.revision.latest_iteration) : undefined,
                  },
                  { label: '检出人', value: detail.revision.check_out_user_name || detail.revision.check_out_user_id },
                  { label: '创建时间', value: fmtDate(detail.revision.created_at) },
                  { label: '更新时间', value: fmtDate(detail.revision.check_out_date) },
                ] as Array<{ label: string; value?: ReactNode }>
              ).map((r) => (
                <div key={r.label} className="bg-[var(--ui-bg-surface)] rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5 truncate">{r.label}</div>
                  <div className="text-sm text-[var(--ui-text-primary)] break-all">{r.value ?? '-'}</div>
                </div>
              ))}
            </div>
            {/* 备注（有内容时单独展示） */}
            {detail.revision.remark && (
              <div className="mt-2">
                <div className="text-sm font-bold text-[var(--ui-text-primary)] mb-2">备注</div>
                <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm text-xs text-[var(--ui-text-secondary)] whitespace-pre-wrap">
                  {detail.revision.remark}
                </div>
              </div>
            )}
            {/* 自定义字段区（无定义时不显示） */}
            {cfLoading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-2 mt-2">自定义字段加载中...</p>}
            {!cfLoading && cfError && (
              <p className="text-center text-xs text-red-400 py-2 mt-2">自定义字段加载失败</p>
            )}
            {!cfLoading && !cfError && cfRows.length > 0 && (
              <div className="mt-2">
                <div className="text-sm font-bold text-[var(--ui-text-primary)] mb-2">自定义字段</div>
                <div className="grid grid-cols-2 gap-2">
                  {cfRows.map((r) => (
                    <div key={r.label} className="bg-[var(--ui-bg-surface)] rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5 truncate">{r.label}</div>
                      <div className="text-sm text-[var(--ui-text-primary)] break-all">{r.value ?? '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                  className="w-full text-left bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 min-h-14 shadow-sm"
                >
                  {/* 行1：编号（左）+ 用量 + 版本 + 必装/选装徽标 + 状态（右）；徽标列与行2 类型徽标右对齐 */}
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--ui-text-primary)]">
                      {p.part_detail?.code ?? p.part_id}
                    </span>
                    {p.quantity != null && (
                      <span className="shrink-0 truncate text-center text-xs text-[var(--ui-text-secondary)]">x{p.quantity}</span>
                    )}
                    {p.part_detail?.version && (
                      <span className="shrink-0 text-center text-xs text-[var(--ui-text-secondary)]">{p.part_detail.version}</span>
                    )}
                    {/* 必装/选装徽标与状态徽标成组靠右，间距紧凑；状态徽标位置不动 */}
                    <span className="shrink-0 flex items-center gap-1.5">
                      <Badge
                        tone={p.is_required ? 'blue' : 'gray'}
                        label={p.is_required ? '必装' : '选装'}
                      />
                      {p.part_detail?.status && (
                        <Badge status={p.part_detail.status} />
                      )}
                    </span>
                  </span>
                  {/* 行2：名称（左）+ 类型徽标（固定位置）+ 预览按钮占位（无 3D 时留空，徽标不跳动） */}
                  <span className="mt-1 flex items-center gap-1.5 min-w-0 min-h-7">
                    <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-secondary)]">
                      {p.part_detail?.name || ''}
                    </span>
                    <Badge
                      tone={p.part_type === 'assembly' ? 'blue' : 'gray'}
                      label={p.part_type === 'assembly' ? '部件' : '零件'}
                    />
                    {/* 预览按钮固定占位（w-10 = 状态徽标内容宽度）：无 3D 时留空，类型徽标与必装徽标对齐 */}
                    <span className="shrink-0 w-10 flex justify-end">
                      {p.part_detail?.has_3d === true && (
                        <Button
                          type="button"
                          onClick={(e) => onPreviewPart(p, e)}
                          disabled={previewingId === p.id}
                          variant="primary"
                          size="xs"
                          className="shrink-0 min-h-8"
                        >
                          {previewingId === p.id ? '加载中...' : '预览'}
                        </Button>
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
                const raw = link as { id?: string; document_id?: string; document?: { id?: string; code?: string; name?: string; version?: string; status?: string; file_name?: string; file_id?: string } };
                const doc = raw.document;
                return (
                  <button
                    key={raw.id ?? doc?.id ?? 'd'}
                    onClick={() => openDocument(raw.document_id)}
                    className="w-full text-left bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 min-h-14 shadow-sm"
                  >
                    {/* 行1：编号（左）+ 版本 + 状态（右） */}
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--ui-text-primary)]">
                        {doc?.code ?? '图文档'}
                      </span>
                      {doc?.version && (
                        <span className="shrink-0 text-xs text-[var(--ui-text-tertiary)]">{doc.version}</span>
                      )}
                      {doc?.status && <Badge status={doc.status} />}
                    </span>
                    {/* 行2：名称（左）+ 预览按钮（右下角，有附件才显示；样式同任务详情关联对象） */}
                    <span className="mt-1 flex items-center gap-2 min-w-0 min-h-7">
                      <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-secondary)]">
                        {doc?.name || doc?.file_name || ''}
                      </span>
                      {doc?.file_id && (
                        <Button
                          type="button"
                          onClick={(e) => onPreviewDoc(raw, doc, e)}
                          disabled={previewingId === raw.id}
                          variant="primary"
                          size="xs"
                          className="shrink-0 min-h-8"
                        >
                          {previewingId === raw.id ? '加载中...' : '预览'}
                        </Button>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {!loading && !error && detail && tab === 'versions' && (
          <div className="flex flex-col gap-2">
            {detail.versions.length === 0 ? (
              <EmptyState text="暂无版本历史" />
            ) : (
              detail.versions.map((v) => (
                // 卡片式（参照零部件详情-版本）：当前版本高亮，行1 版本号+状态，行2 迭代/检出人/创建时间
                <div
                  key={v.id}
                  className={`rounded-lg px-4 py-3 shadow-sm ${
                    v.id === revisionId ? 'bg-primary-50 border border-primary-300' : 'bg-[var(--ui-bg-surface)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-medium text-[var(--ui-text-primary)]">版本 {v.version}</span>
                    <Badge status={v.status} />
                  </div>
                  <div className="text-xs text-[var(--ui-text-secondary)] mt-1.5 space-y-0.5">
                    <div>最新迭代：{v.latest_iteration}</div>
                    {v.check_out_user_name && <div>检出人：{v.check_out_user_name}</div>}
                    <div>创建时间：{fmtDateTime(v.created_at)}</div>
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
