import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { customFieldsApi, entityDocumentsApi, mediaApi, partsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AttachmentPreview from '../components/AttachmentPreview';
import BomTree from '../components/BomTree';
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
  { key: 'documents', label: '图文档' },
  { key: 'attachments', label: '附件' },
  { key: 'versions', label: '版本' },
  { key: 'whereused', label: '反查' },
];

/** 零部件关联图文档（GET /parts/revisions/{revision_id}/documents） */
interface PartDocLink {
  id: string;
  document_id: string;
  category?: string;
  document: {
    id: string;
    code: string;
    name: string;
    version: string;
    status: string;
  } | null;
}

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

/** 附件分区：标题 + 计数 + 卡片列表（空区显示空态） */
function AttachmentSection({ title, items }: { title: string; items: PartAttachment[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <EmptyState text={`暂无${title}`} />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((att) => (
            <AttachmentPreview key={att.id} attachment={att} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  /** 覆盖层模式（列表页内嵌）传入；路由模式缺省时从 /parts/:id 读取 */
  masterId?: string;
  revisionId?: string;
  /** 覆盖层模式返回回调（缺省时返回按钮走 navigate(-1)） */
  onBack?: () => void;
}

export default function PartDetailPage({ masterId: propMasterId, revisionId: propRevisionId, onBack }: Props = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: paramId } = useParams<{ id: string }>();
  const id = propMasterId ?? paramId;
  // 可选深链参数 rev：指定查看某个历史版本（列表"全部版本"行进入）
  const revParam = new URLSearchParams(location.search).get('rev') ?? propRevisionId;
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [selectedRev, setSelectedRev] = useState<PartRevisionBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // BOM 段（激活时按最新版本加载首层）
  const [bomItems, setBomItems] = useState<BomChild[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState<string | null>(null);

  // 附件段（激活时按最新版本加载）
  const [attachments, setAttachments] = useState<PartAttachment[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);

  // 图文档段（激活时按最新版本加载关联文档）
  const [docLinks, setDocLinks] = useState<PartDocLink[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(false);

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
    setSelectedRev(null);
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
    // 深链指定版本：加载该版本信息（失败回退最新版本展示）
    if (revParam) {
      partsApi
        .getRevision(revParam)
        .then((rev: PartRevisionBrief) => {
          if (alive) setSelectedRev(rev);
        })
        .catch(() => {
          // 忽略：回退最新版本
        });
    }
    return () => {
      alive = false;
    };
  }, [id, revParam]);

  // 当前展示版本：深链指定版本优先，否则最新版本
  const curRev = selectedRev ?? detail?.latest_revision;
  const revisionId = revParam ?? detail?.latest_revision?.id;

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

  // 标题栏 3D 按钮可见性：装配体始终可用；零件需存在生产附件 STP（进入详情即判断）
  useEffect(() => {
    let alive = true;
    if (!revisionId || !detail) return;
    if (detail.type === 'assembly') {
      setHasStp(true);
      return () => {
        alive = false;
      };
    }
    setHasStp(null);
    partsApi
      .listAttachments(revisionId)
      .then((list) => {
        if (alive) {
          const arr = (list ?? []) as PartAttachment[];
          setHasStp(
            arr.some(
              (a) =>
                a.category === 'production' &&
                /\.(stp|step)$/i.test(a.file_name ?? ''),
            ),
          );
        }
      })
      .catch(() => {
        if (alive) setHasStp(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionId, detail?.type]);

  // 图文档：切到图文档段且详情就绪时加载关联文档
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'documents' || !revisionId) return;
    setDocLoading(true);
    setDocError(false);
    entityDocumentsApi
      .list('part', revisionId)
      .then((r: { data?: PartDocLink[] }) => {
        if (alive) setDocLinks(r.data ?? []);
      })
      .catch(() => {
        if (alive) {
          setDocLinks([]);
          setDocError(true);
        }
      })
      .finally(() => {
        if (alive) setDocLoading(false);
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

  const title = detail
    ? `${detail.code} ${detail.name}${curRev?.version ? `（${curRev.version}）` : ''}`
    : id ?? '零部件详情';

  // 概览标准字段（空值渲染为 "-"；字段以后端 PartMasterResponse 实际返回字段为准）
  const overviewRows: Array<{ label: string; value?: ReactNode }> = [
    { label: '件号', value: detail?.code },
    { label: '名称', value: detail?.name },
    { label: '类型', value: detail?.type ? TYPE_LABEL[detail.type] ?? detail.type : undefined },
    {
      label: '状态',
      value: curRev?.status ? <StatusBadge status={curRev.status} map={STATUS_MAP} /> : undefined,
    },
    { label: '最新版本', value: curRev?.version },
    {
      label: '最新迭代',
      value: curRev?.latest_iteration != null ? String(curRev.latest_iteration) : undefined,
    },
    { label: '检出人', value: curRev?.check_out_user_name },
    { label: '检出时间', value: fmtDateTime(curRev?.check_out_date) },
    { label: '创建时间', value: fmtDateTime(detail?.created_at) },
    { label: '更新时间', value: fmtDateTime(detail?.updated_at) },
  ];

  // 自定义字段（component 定义 + 值，空值 "-"）
  const cfRows: Array<{ label: string; value?: ReactNode }> = cfDefs.map((d) => ({
    label: d.name,
    value: cfDisplay(cfValues[d.id]) ?? undefined,
  }));

  /* ---------------- 工具栏：3D 预览（标题右侧）+ 版本 Tab 内对比 ---------------- */

  // 3D 预览：部件 → 装配模式（现有 /stp-viewer?assembly=）；零件 → 查 STP 附件单模型
  const [stpLoading, setStpLoading] = useState(false);
  // 标题栏 3D 按钮是否显示：装配体恒 true；零件需生产附件有 STP
  const [hasStp, setHasStp] = useState<boolean | null>(null);
  /** 覆盖层模式跳转：新标签打开（避免离开列表路由导致返回时覆盖层丢失） */
  const overlayOpen = (url: string) => {
    const w = window.open('', '_blank');
    if (w) w.location.href = url;
  };
  const on3DPreview = async () => {
    if (!revisionId || stpLoading) return;
    // 覆盖层模式：点击同步打开空白标签占位（防弹窗拦截），异步取 token 后写入地址
    const win = onBack ? window.open('', '_blank') : null;
    if (detail?.type === 'assembly') {
      const url = `/stp-viewer?assembly=${revisionId}&code=${encodeURIComponent(detail.code ?? '')}&name=${encodeURIComponent(detail.name ?? '')}`;
      if (win) {
        win.location.href = url;
        return;
      }
      navigate(url);
      return;
    }
    setStpLoading(true);
    try {
      const list = (await partsApi.listAttachments(revisionId)) as PartAttachment[];
      const stp = list.find((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
      if (!stp) {
        window.alert('该零件暂无 STP 三维模型');
        return;
      }
      const t = await mediaApi.token(stp.id, 'gltf');
      const url = `/stp-viewer?id=${encodeURIComponent(stp.id)}&token=${encodeURIComponent(t)}&code=${encodeURIComponent(detail?.code ?? '')}&version=${encodeURIComponent(curRev?.version ?? '')}&name=${encodeURIComponent(detail?.name ?? '')}`;
      if (win) {
        win.location.href = url;
        return;
      }
      navigate(url);
    } catch {
      window.alert('3D 模型加载失败，请稍后重试');
    } finally {
      setStpLoading(false);
    }
  };

  // 版本对比（版本 Tab 内多选两个版本 → BOM 对比页深链）
  const [cmpSel, setCmpSel] = useState<string[]>([]);
  const toggleCmpSel = (vid: string) => {
    setCmpSel((prev) => {
      if (prev.includes(vid)) return prev.filter((x) => x !== vid);
      if (prev.length < 2) return [...prev, vid];
      return [prev[0], vid]; // 已选满 2 个时，替换第二个
    });
  };
  const startVersionCompare = () => {
    if (cmpSel.length !== 2) return;
    const url = `/parts/compare?left=${encodeURIComponent(cmpSel[0])}&right=${encodeURIComponent(cmpSel[1])}`;
    if (onBack) {
      overlayOpen(url);
      return;
    }
    navigate(url);
  };

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
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
          {/* 标题行最右侧：3D（无生产附件 STP 的零件不显示） */}
          {revisionId && hasStp === true && (
            <button
              onClick={on3DPreview}
              disabled={stpLoading}
              className="shrink-0 min-h-8 px-3 rounded-lg bg-primary-600 text-white text-xs disabled:opacity-60"
            >
              {stpLoading ? '加载中...' : '3D'}
            </button>
          )}
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                // replace 更新 URL 的 tab 参数（保留 rev 等其他参数），供退回时恢复；
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
      {!loading && !error && !detail && <EmptyState text="未找到零部件" />}

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
                  {overviewRows.map((r) => (
                    <div key={r.label} className="bg-white rounded-lg px-3 py-2.5 min-h-14 shadow-sm">
                      <div className="text-xs text-gray-500 mb-0.5 truncate">{r.label}</div>
                      <div className="text-sm text-gray-900 break-all">{r.value ?? '-'}</div>
                    </div>
                  ))}
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
                  // 树形：箭头展开/折叠逐层查看，点击行打开子项详情
                  <BomTree rootItems={bomItems} />
                )}
              </div>
            ))}

          {activeTab === 'attachments' &&
            (!revisionId ? (
              <EmptyState text="该零部件暂无版本，无附件" />
            ) : (
              <div>
                {attLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
                {!attLoading && attError && (
                  <p className="text-center text-xs text-red-400 py-3">{attError}</p>
                )}
                {!attLoading && !attError && (
                  <div className="flex flex-col gap-3">
                    {/* CAD 附件 / 生产附件 两个区域（未知分类兜底归 CAD） */}
                    <AttachmentSection
                      title="CAD 附件"
                      items={attachments.filter((a) => a.category !== 'production')}
                    />
                    <AttachmentSection
                      title="生产附件"
                      items={attachments.filter((a) => a.category === 'production')}
                    />
                  </div>
                )}
              </div>
            ))}

          {activeTab === 'documents' &&
            (!revisionId ? (
              <EmptyState text="该零部件暂无版本，无关联图文档" />
            ) : (
              <div>
                {docLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
                {!docLoading && docError && (
                  <p className="text-center text-xs text-red-400 py-3">图文档加载失败</p>
                )}
                {!docLoading && !docError && docLinks.length === 0 && (
                  <EmptyState text="暂无关联图文档" />
                )}
                {!docLoading && !docError && docLinks.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {docLinks.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => navigate(`/documents/${l.document_id}`)}
                        className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                            {l.document?.code ?? '未知文档'}
                          </span>
                          <span className="shrink-0 text-xs text-gray-500">{l.document?.version}</span>
                          <StatusBadge status={l.document?.status ?? 'draft'} map={STATUS_MAP} />
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">{l.document?.name}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

          {activeTab === 'versions' && (
            <div>
              <p className="text-xs text-gray-400 px-1 mb-2">点击选择两个版本进行 BOM 对比</p>
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
                  versions.map((v) => {
                    const selected = cmpSel.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        onClick={() => toggleCmpSel(v.id)}
                        className={`rounded-lg px-4 py-3 shadow-sm text-left ${
                          v.id === revisionId
                            ? 'bg-primary-50 border border-primary-300'
                            : 'bg-white'
                        } ${selected ? 'ring-2 ring-primary-500' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-base font-medium text-gray-900">版本 {v.version}</span>
                          <span className="flex items-center gap-2">
                            <StatusBadge status={v.status} map={STATUS_MAP} />
                            <span
                              className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs ${
                                selected
                                  ? 'bg-primary-600 border-primary-600 text-white'
                                  : 'border-gray-300 text-transparent'
                              }`}
                            >
                              ✓
                            </span>
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
                          <div>最新迭代：{v.latest_iteration}</div>
                          {v.check_out_user_name && <div>检出人：{v.check_out_user_name}</div>}
                          <div>创建时间：{fmtDateTime(v.created_at)}</div>
                        </div>
                      </button>
                    );
                  })}
              </div>
              {/* 底部操作条：选中 ≥1 个版本时显示 */}
              {cmpSel.length > 0 && (
                <div className="sticky bottom-0 bg-white border-t border-gray-200 px-3 py-2 mt-3 flex items-center gap-2">
                  <span className="flex-1 text-xs text-gray-500 min-w-0 truncate">
                    {cmpSel.length === 2
                      ? `已选：${versions.find((v) => v.id === cmpSel[0])?.version ?? '?'} vs ${versions.find((v) => v.id === cmpSel[1])?.version ?? '?'}`
                      : '请再选择一个版本'}
                  </span>
                  <button
                    onClick={startVersionCompare}
                    disabled={cmpSel.length !== 2}
                    className="shrink-0 min-h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-40"
                  >
                    开始对比
                  </button>
                </div>
              )}
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
