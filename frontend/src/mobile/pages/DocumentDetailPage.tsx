import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { customFieldsApi, documentsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AttachmentPreview, { openAttachmentInNewTab } from '../components/AttachmentPreview';
import DocWhereUsedTab from './DocWhereUsedTab';
import type { DocumentRevision, DocumentAttachment } from '../../types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'attachments', label: '附件' },
  { key: 'versions', label: '版本' },
  { key: 'whereused', label: '反查' },
];

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

/** 自定义字段定义（document 适用） */
interface CfDef {
  id: string;
  name: string;
  field_key?: string;
  field_type?: string;
  applies_to?: string[];
}

/** 自定义字段值展示：null/undefined/空数组/空串 → null（渲染为 "-"） */
function cfDisplay(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? v.join('、') : null;
  const s = String(v);
  return s.trim() ? s : null;
}

function OverviewRow({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 break-all">{children}</div>
    </div>
  );
}

interface Props {
  /** 覆盖层模式（列表页内嵌）传入的文档版本 id；路由模式缺省时从 /documents/:id 读取 */
  id?: string;
  /** 覆盖层模式返回回调（缺省时返回按钮走 navigate(-1)） */
  onBack?: () => void;
  /** 覆盖层模式跳转回调（详情栈内导航：反查跳转）；缺省时走路由 navigate */
  onNavigate?: (to: string) => void;
}

export default function DocumentDetailPage({ id: propId, onBack, onNavigate }: Props = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: paramId } = useParams<{ id: string }>();
  const id = propId ?? paramId;
  const [detail, setDetail] = useState<DocumentRevision | null>(null);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  // 版本段（激活时加载全部版本历史）
  const [versions, setVersions] = useState<DocumentRevision[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  const [verError, setVerError] = useState(false);
  // Tab 状态记录在 URL（?tab=），进入新详情默认概览；退回时浏览器还原上一级 URL → 恢复对应 Tab
  const [activeTab, setActiveTab] = useState(() => {
    const t = new URLSearchParams(location.search).get('tab');
    return t && TABS.some((x) => x.key === t) ? t : 'overview';
  });

  // 路由变化（进入/退回）时按 URL tab 同步；无 tab 一律回概览
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('tab');
    setActiveTab(t && TABS.some((x) => x.key === t) ? t : 'overview');
  }, [location.search, id]);

  // 版本：切到版本段时加载全部版本历史
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'versions') return;
    setVerLoading(true);
    setVerError(false);
    documentsApi
      .versions(id)
      .then((res: { data?: DocumentRevision[] }) => {
        if (alive) setVersions(res.data ?? []);
      })
      .catch(() => {
        if (alive) {
          setVersions([]);
          setVerError(true);
        }
      })
      .finally(() => {
        if (alive) setVerLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, activeTab]);

  // 自定义字段：详情就绪后加载 document 定义与值
  const [cfDefs, setCfDefs] = useState<CfDef[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!id) return;
    setCfLoading(true);
    setCfError(false);
    customFieldsApi
      .listDefinitions()
      .then((res: any) => {
        const defs = ((res?.data ?? res ?? []) as CfDef[]).filter((d) =>
          (d.applies_to || []).includes('document')
        );
        if (alive) setCfDefs(defs);
      })
      .catch(() => {
        if (alive) setCfError(true);
      });
    customFieldsApi
      .getValues('document', id)
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
  }, [id]);

  useEffect(() => {
    let alive = true;
    if (!id) {
      setError('缺少图文档 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    documentsApi
      .detail(id)
      .then((res) => {
        if (alive) setDetail((res.data ?? res) as DocumentRevision);
      })
      .catch(() => {
        if (alive) {
          // 失败时清空详情，保证错误提示与空态互斥
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
  }, [id]);

  // 附件：进入详情即加载（概览 Tab 常驻显示"预览"入口，附件 Tab 复用同一份数据）
  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoadingAttachments(true);
    setAttachmentsError(null);
    documentsApi
      .listAttachments(id)
      .then((res) => {
        if (alive) {
          setAttachments((res.data ?? []) as DocumentAttachment[]);
          setAttachmentsError(null);
        }
      })
      .catch(() => {
        if (alive) {
          // 失败时清空附件并置错误态，与空态互斥
          setAttachments([]);
          setAttachmentsError('附件加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoadingAttachments(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const title = detail
    ? `${detail.code} | ${detail.version ?? ''} | ${detail.name ?? ''}`
    : id ?? '图文档详情';

  // 概览字段以 GET /api/documents/{revision_id} 实际返回字段为准
  const overviewRows: Array<{ label: string; value?: ReactNode }> = [
    { label: '编号', value: detail?.code },
    { label: '名称', value: detail?.name },
    { label: '版本', value: detail?.version },
    { label: '状态', value: detail?.status ? <StatusBadge status={detail.status} map={STATUS_MAP} /> : undefined },
    { label: '备注', value: detail?.remark },
    { label: '创建人', value: detail?.creator_name },
    { label: '检出人', value: detail?.check_out_user_name },
    { label: '检出时间', value: fmtDateTime(detail?.check_out_date) },
    { label: '创建时间', value: fmtDateTime(detail?.created_at) },
    { label: '更新时间', value: fmtDateTime(detail?.updated_at) },
  ].filter((r) => r.value !== undefined && r.value !== null && r.value !== '');

  // 自定义字段（document 定义 + 值，空值 "-"）
  const cfRows: Array<{ label: string; value?: ReactNode }> = cfDefs.map((d) => ({
    label: d.name,
    value: cfDisplay(cfValues[d.id]) ?? undefined,
  }));

  return (
    <div className="flex flex-col">
      {/* 顶部：返回按钮 + 标题（编号/名称）+ 分段 Tab（sticky 跟随列表页模式） */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => (onBack ? onBack() : navigate(-1))}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          {/* 标题：编号 + 版本徽标 + 名称（版本徽标主色浅底，名称过长省略不影响版本可见） */}
          <div className="min-w-0 flex-1 flex items-center gap-1.5 text-base font-medium text-gray-900 truncate">
            <span className="shrink-0">{detail?.code ?? id}</span>
            {detail?.version && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">
                {detail.version}
              </span>
            )}
            <span className="flex-1 min-w-0 truncate">{detail?.name ?? ''}</span>
          </div>
          {/* 标题栏最右侧：附件"预览"按钮（图文档只有一个附件，一直显示便于快速点击） */}
          {!attachmentsError && attachments.length > 0 && (
            <button
              onClick={async () => {
                try {
                  await openAttachmentInNewTab(attachments[0]);
                } catch {
                  /* 静默：失败不阻塞页面 */
                }
              }}
              className="shrink-0 min-h-8 px-3 rounded-lg bg-primary-600 text-white text-xs"
            >
              预览
            </button>
          )}
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                // replace 更新 URL 的 tab 参数，供退回时恢复；
                // 覆盖层模式（onBack 存在）不写 URL，避免污染列表页 URL 导致下次进入误读
                if (!onBack) {
                  const sp = new URLSearchParams(location.search);
                  sp.set('tab', t.key);
                  navigate(`?${sp.toString()}`, { replace: true });
                }
              }}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                activeTab === t.key ? 'bg-primary-600 text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !detail && <EmptyState text="未找到图文档" />}

      {!loading && !error && detail && (
        <div className="p-3">
          {activeTab === 'overview' && (
            <div>
              {cfLoading && <p className="text-center text-xs text-gray-400 py-2">自定义字段加载中...</p>}
              {!cfLoading && cfError && (
                <p className="text-center text-xs text-red-400 py-2">自定义字段加载失败</p>
              )}
              {/* 基本信息区 */}
              <div className="mb-3">
                <div className="text-sm font-bold text-gray-900 mb-2">基本信息</div>
                <div className="grid grid-cols-2 gap-2">
                  {overviewRows.length === 0 ? (
                    <div className="col-span-2">
                      <EmptyState text="暂无概览信息" />
                    </div>
                  ) : (
                    overviewRows.map((r) => (
                      <div key={r.label} className="bg-white rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                        <div className="text-xs text-gray-500 mb-0.5 truncate">{r.label}</div>
                        <div className="text-sm text-gray-900 break-all">{r.value ?? '-'}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {/* 自定义字段区（无定义时不显示） */}
              {!cfLoading && !cfError && cfRows.length > 0 && (
                <div>
                  <div className="text-sm font-bold text-gray-900 mb-2">自定义字段</div>
                  <div className="grid grid-cols-2 gap-2">
                    {cfRows.map((r) => (
                      <div key={r.label} className="bg-white rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                        <div className="text-xs text-gray-500 mb-0.5 truncate">{r.label}</div>
                        <div className="text-sm text-gray-900 break-all">{r.value ?? '-'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'attachments' && (
            <div className="flex flex-col gap-2">
              {loadingAttachments && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
              {!loadingAttachments && attachmentsError && (
                <p className="text-center text-xs text-red-400 py-3">{attachmentsError}</p>
              )}
              {!loadingAttachments && !attachmentsError && attachments.length === 0 && (
                <EmptyState text="暂无附件" />
              )}
              {!loadingAttachments &&
                !attachmentsError &&
                attachments.map((att) => (
                  <AttachmentPreview key={att.id} attachment={att} />
                ))}
            </div>
          )}
          {activeTab === 'versions' && (
            <div className="flex flex-col gap-2">
              {verLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
              {!verLoading && verError && (
                <p className="text-center text-xs text-red-400 py-3">版本加载失败，请稍后重试</p>
              )}
              {!verLoading && !verError && versions.length === 0 && (
                <EmptyState text="暂无版本记录" />
              )}
              {!verLoading &&
                !verError &&
                versions.map((v) => (
                  <div
                    key={v.id}
                    className={`rounded-lg px-4 py-3 shadow-sm ${
                      v.id === id ? 'bg-primary-50 border border-primary-300' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-medium text-gray-900">版本 {v.version}</span>
                      <StatusBadge status={v.status} map={STATUS_MAP} />
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
                      <div>最新迭代：{v.latest_iteration}</div>
                      {v.check_out_user_name && <div>检出人：{v.check_out_user_name}</div>}
                      <div>创建时间：{fmtDateTime(v.created_at)}</div>
                    </div>
                  </div>
                ))}
            </div>
          )}
          {activeTab === 'whereused' && id && <DocWhereUsedTab revisionId={id} onNavigate={onNavigate} />}
        </div>
      )}
    </div>
  );
}
