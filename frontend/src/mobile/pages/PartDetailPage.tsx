import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customFieldsApi, partsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import MobileCardList from '../components/MobileCardList';
import AttachmentPreview from '../components/AttachmentPreview';
import { formatMeta } from '../components/formatMeta';
import { bomPath } from './bomPath';
import PartWhereUsedTab from './PartWhereUsedTab';
import type { BomChild } from './PartBomPage';
import type { PartMaster, PartRevisionBrief, PartRevision, PartAttachment } from '../../types';

/**
 * GET /api/parts/{master_id} 实际返回后端 PartMasterResponse：
 * { id, code, name, type, created_at, updated_at, latest_revision: PartRevisionBrief | null }
 * 前端 PartMaster 类型缺少 latest_revision 字段，此处本地扩展（不改动 types/）。
 */
interface PartDetail extends PartMaster {
  latest_revision?: PartRevisionBrief | null;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const TYPE_LABEL: Record<string, string> = { part: '零件', assembly: '部件' };

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'bom', label: 'BOM' },
  { key: 'attachments', label: '附件' },
  { key: 'versions', label: '版本' },
  { key: 'whereused', label: '反查' },
];

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

function isPermissionError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'response' in e) {
    return (e as any).response?.status === 403;
  }
  return false;
}

function sortedByOrder(list: BomChild[]): BomChild[] {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** 自定义字段定义（component 适用） */
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

export default function PartDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // BOM 段（激活时按最新版本加载首层）
  const [bomItems, setBomItems] = useState<BomChild[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState<string | null>(null);

  // 附件段（激活时按最新版本加载）
  const [attachments, setAttachments] = useState<PartAttachment[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);

  // 版本段（激活时加载全部版本历史）
  const [versions, setVersions] = useState<PartRevision[]>([]);
  const [verLoading, setVerLoading] = useState(false);
  const [verError, setVerError] = useState<string | null>(null);

  // 自定义字段（component 定义 + 最新版本的值）
  const [cfDefs, setCfDefs] = useState<CfDef[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>({});
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!id) {
      setError('缺少零部件 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    partsApi
      .get(id)
      .then((data: PartDetail) => {
        if (alive) setDetail(data);
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

  const revisionId = detail?.latest_revision?.id;

  // BOM：切到 BOM 段且详情就绪时加载首层（latest_revision 的 BOM）
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'bom' || !revisionId) return;
    setBomLoading(true);
    setBomError(null);
    partsApi
      .getBOM(revisionId)
      .then((list) => {
        if (alive) setBomItems(sortedByOrder((list ?? []) as BomChild[]));
      })
      .catch((e) => {
        if (alive) {
          setBomItems([]);
          setBomError(isPermissionError(e) ? '无权限查看 BOM 结构' : 'BOM 加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setBomLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, activeTab, revisionId]);

  // 附件：切到附件段且详情就绪时加载
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'attachments' || !revisionId) return;
    setAttLoading(true);
    setAttError(null);
    partsApi
      .listAttachments(revisionId)
      .then((list) => {
        if (alive) setAttachments((list ?? []) as PartAttachment[]);
      })
      .catch((e) => {
        if (alive) {
          setAttachments([]);
          setAttError(isPermissionError(e) ? '无权限访问该附件' : '附件加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setAttLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, activeTab, revisionId]);

  // 版本：切到版本段时加载全部版本历史
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'versions') return;
    setVerLoading(true);
    setVerError(null);
    partsApi
      .revisions(id)
      .then((list) => {
        if (alive) setVersions((list ?? []) as PartRevision[]);
      })
      .catch((e) => {
        if (alive) {
          setVersions([]);
          setVerError(isPermissionError(e) ? '无权限查看版本历史' : '版本加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setVerLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, activeTab]);

  // 自定义字段：详情就绪后加载 component 定义与最新版本值
  useEffect(() => {
    let alive = true;
    if (!revisionId) return;
    setCfLoading(true);
    setCfError(false);
    customFieldsApi
      .listDefinitions()
      .then((res: any) => {
        const defs = ((res?.data ?? res ?? []) as CfDef[]).filter((d) =>
          (d.applies_to || []).includes('component')
        );
        if (alive) setCfDefs(defs);
      })
      .catch(() => {
        if (alive) setCfError(true);
      });
    customFieldsApi
      .getValues('component', revisionId)
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

  const title = detail ? `${detail.code} ${detail.name}` : id ?? '零部件详情';

  // 概览标准字段（空值渲染为 "-"；字段以后端 PartMasterResponse 实际返回字段为准）
  const overviewRows: Array<{ label: string; value?: ReactNode }> = [
    { label: '件号', value: detail?.code },
    { label: '名称', value: detail?.name },
    { label: '类型', value: detail?.type ? TYPE_LABEL[detail.type] ?? detail.type : undefined },
    {
      label: '状态',
      value: detail?.latest_revision?.status ? (
        <StatusBadge status={detail.latest_revision.status} map={STATUS_MAP} />
      ) : undefined,
    },
    { label: '最新版本', value: detail?.latest_revision?.version },
    {
      label: '最新迭代',
      value:
        detail?.latest_revision?.latest_iteration != null
          ? String(detail.latest_revision.latest_iteration)
          : undefined,
    },
    { label: '检出人', value: detail?.latest_revision?.check_out_user_name },
    { label: '检出时间', value: fmtDateTime(detail?.latest_revision?.check_out_date) },
    { label: '创建时间', value: fmtDateTime(detail?.created_at) },
    { label: '更新时间', value: fmtDateTime(detail?.updated_at) },
  ];

  // 自定义字段（component 定义 + 值，空值 "-"）
  const cfRows: Array<{ label: string; value?: ReactNode }> = cfDefs.map((d) => ({
    label: d.name,
    value: cfDisplay(cfValues[d.id]) ?? undefined,
  }));

  const allRows = [...overviewRows, ...cfRows];

  return (
    <div className="flex flex-col">
      {/* 顶部：返回按钮 + 标题（编号/名称）+ 分段 Tab（sticky 跟随列表页模式） */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
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
      {!loading && !error && !detail && <EmptyState text="未找到零部件" />}

      {!loading && !error && detail && (
        <div className="p-3">
          {activeTab === 'overview' && (
            <div>
              {/* 装配体 3D 预览入口（加载全部叶项并摆放，/stp-viewer 装配模式） */}
              {detail?.type === 'assembly' && revisionId && (
                <button
                  onClick={() =>
                    navigate(
                      `/stp-viewer?assembly=${revisionId}&code=${encodeURIComponent(detail.code ?? '')}&name=${encodeURIComponent(detail.name ?? '')}`
                    )
                  }
                  className="w-full mb-2 bg-primary-600 text-white rounded-lg px-4 py-3 min-h-11 text-sm font-medium flex items-center justify-between shadow-sm"
                >
                  <span>3D 预览（装配体）</span>
                  <span>›</span>
                </button>
              )}
              {cfLoading && <p className="text-center text-xs text-gray-400 py-2">自定义字段加载中...</p>}
              {!cfLoading && cfError && (
                <p className="text-center text-xs text-red-400 py-2">自定义字段加载失败</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                {allRows.map((r) => (
                  <div key={r.label} className="bg-white rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                    <div className="text-xs text-gray-500 mb-0.5 truncate">{r.label}</div>
                    <div className="text-sm text-gray-900 break-all">{r.value ?? '-'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'bom' &&
            (!revisionId ? (
              <EmptyState text="该零部件暂无版本，无 BOM 结构" />
            ) : (
              <div className="flex flex-col gap-2">
                {bomLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
                {!bomLoading && bomError && (
                  <p className="text-center text-xs text-red-400 py-3">{bomError}</p>
                )}
                {!bomLoading && !bomError && bomItems.length === 0 && (
                  <EmptyState text="该零部件暂无 BOM 子项" />
                )}
                {!bomLoading && !bomError && bomItems.length > 0 && (
                  <MobileCardList
                    items={bomItems}
                    keyOf={(b) => b.id}
                    renderMain={(b) => `${b.child_code} ${b.child_name}`}
                    renderMeta={(b) => (
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={b.child_status} map={STATUS_MAP} />
                        <span className="text-gray-500">数量 ×{b.quantity}</span>
                        <span className="text-gray-500">{formatMeta([['版本', b.child_version]])}</span>
                        {b.has_children && <span className="text-primary-600">可下钻 ›</span>}
                      </span>
                    )}
                    onClick={(b) => {
                      // 仅装配（has_children）可继续下钻；零件无子 BOM，点击无操作
                      if (!b.has_children) return;
                      navigate(bomPath(`/parts/${id}`, b.child_revision_id));
                    }}
                  />
                )}
              </div>
            ))}

          {activeTab === 'attachments' &&
            (!revisionId ? (
              <EmptyState text="该零部件暂无版本，无附件" />
            ) : (
              <div className="flex flex-col gap-2">
                {attLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
                {!attLoading && attError && (
                  <p className="text-center text-xs text-red-400 py-3">{attError}</p>
                )}
                {!attLoading && !attError && attachments.length === 0 && (
                  <EmptyState text="暂无附件" />
                )}
                {!attLoading &&
                  !attError &&
                  attachments.map((att) => <AttachmentPreview key={att.id} attachment={att} />)}
              </div>
            ))}

          {activeTab === 'versions' && (
            <div className="flex flex-col gap-2">
              {verLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
              {!verLoading && verError && (
                <p className="text-center text-xs text-red-400 py-3">{verError}</p>
              )}
              {!verLoading && !verError && versions.length === 0 && (
                <EmptyState text="暂无版本记录" />
              )}
              {!verLoading &&
                !verError &&
                versions.map((v) => (
                  <div key={v.id} className="bg-white rounded-lg px-4 py-3 shadow-sm">
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

          {activeTab === 'whereused' &&
            (!revisionId ? (
              <EmptyState text="该零部件暂无版本，无法反查" />
            ) : (
              <PartWhereUsedTab revisionId={revisionId} />
            ))}
        </div>
      )}
    </div>
  );
}
