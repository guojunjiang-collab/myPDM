import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ecrApi, ecoApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type {
  ECRRequest,
  ECORequest,
  ECRReviewRecord,
  ECOReviewRecord,
  ECRStatusLog,
  ECOStatusLog,
  ECRAffectedItem,
} from '../../types';

/* ================================================================
   变更管理移动页（只读）
   - 两段列表：ECR（工程变更请求）/ ECO（工程变更指令），对应桌面 EC.tsx 两个 tab
   - 详情为独立子路由（ec/ecr/:id、ec/eco/:id，浏览器返回/深链可用）：
     · ECR 详情：基础信息 + 影响项 + 审批记录 + 状态流转
     · ECO 详情：基础信息 + 执行项 + 审批记录 + 状态流转
   - 纯只读：无新建/编辑/提交/审批/执行/关闭/删除等任何状态流转入口
   - API 核验（对应桌面 ECRList/ECOList/ECRDetailModal/ECODetailModal）：
     · ecrApi.list({page:1,page_size:100}) → GET /api/ecrs/ → res.data.{items,total}
     · ecrApi.get(id)                      → GET /api/ecrs/{id} → res.data（含 review_records/affected_items）
     · ecrApi.getStatusLogs(id)            → GET /api/ecrs/{id}/status-logs → res.data.items
     · ecoApi.list({page:1,page_size:100}) → GET /api/ecos/ → res.data.{items,total}
     · ecoApi.detail(id)                   → GET /api/ecos/{id} → res.data（含 execution_items/review_records/status_logs）
     · ecoApi.getStatusLogs(id)            → GET /api/ecos/{id}/status-logs → res.data.items
   ================================================================ */

type Tab = 'ecr' | 'eco';

const ECR_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-700' },
  reviewing: { label: '审核中', cls: 'bg-blue-100 text-blue-800' },
  approved: { label: '已批准', cls: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', cls: 'bg-red-100 text-red-800' },
  closed: { label: '已关闭', cls: 'bg-gray-200 text-gray-600' },
};

const ECO_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-700' },
  reviewing: { label: '审核中', cls: 'bg-blue-100 text-blue-800' },
  approved: { label: '已批准', cls: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', cls: 'bg-red-100 text-red-800' },
  executing: { label: '执行中', cls: 'bg-amber-100 text-amber-800' },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-800' },
  closed: { label: '已关闭', cls: 'bg-gray-200 text-gray-600' },
};

const PRIORITY_MAP: Record<string, { label: string; cls: string }> = {
  urgent: { label: '紧急', cls: 'bg-red-100 text-red-800' },
  high: { label: '高', cls: 'bg-orange-100 text-orange-800' },
  normal: { label: '普通', cls: 'bg-blue-100 text-blue-800' },
  low: { label: '低', cls: 'bg-gray-100 text-gray-600' },
};

const CATEGORY_LABEL: Record<string, string> = {
  design_change: '设计变更',
  process_change: '工艺变更',
  material_change: '物料变更',
  other: '其他',
};

const EXEC_ACTION_LABEL: Record<string, string> = {
  create: '新建',
  upgrade: '升级',
  qty_change: '数量变更',
  delete: '删除',
  no_change: '不变',
};

const EXEC_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: '待执行', cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '执行中', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-700' },
  failed: { label: '失败', cls: 'bg-red-100 text-red-700' },
  skipped: { label: '跳过', cls: 'bg-gray-100 text-gray-500' },
};

/** ecrApi.get 响应在基础 ECRRequest 上额外携带 review_records（桌面 ECRDetailModal 同款扩展） */
interface EcrDetail extends ECRRequest {
  review_records?: ECRReviewRecord[];
}

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN');
}

function ReviewRecords({ records }: { records: Array<{ id?: string; reviewer_name?: string; reviewer_id?: string; decision?: string; comment?: string; created_at?: string }> }) {
  if (records.length === 0) return <div className="text-xs text-gray-400 py-2 text-center">暂无审批记录</div>;
  return (
    <div className="flex flex-col gap-2">
      {records.map((r) => (
        <div key={r.id ?? r.reviewer_id ?? r.created_at ?? 'r'} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">{r.reviewer_name || r.reviewer_id || '-'}</span>
            <span className={`px-2 py-0.5 rounded text-xs ${r.decision === 'approved' ? 'bg-green-100 text-green-700' : r.decision === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
              {r.decision === 'approved' ? '通过' : r.decision === 'rejected' ? '拒绝' : r.decision === 'returned' ? '退回' : r.decision || '-'}
            </span>
          </div>
          {r.comment && <div className="text-xs text-gray-500 mt-1">{r.comment}</div>}
          {r.created_at && <div className="text-xs text-gray-400 mt-1">{fmtDateTime(r.created_at)}</div>}
        </div>
      ))}
    </div>
  );
}

function StatusLogs({ logs, map }: { logs: Array<{ id?: string; to_status?: string; operator_name?: string; comment?: string; created_at?: string }>; map: Record<string, { label: string; cls: string }> }) {
  return (
    <div className="flex flex-col gap-2">
      {logs.map((log) => (
        <div key={log.id ?? log.created_at ?? 'l'} className="flex gap-3">
          <div className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 bg-primary-500" />
          <div className="flex-1 pb-1">
            <div className="text-sm text-gray-900 break-all">
              <span className="font-medium">{log.operator_name || '-'}</span>
              <span className="text-gray-400 mx-1">·</span>
              <span>{map[log.to_status || '']?.label || log.to_status || '-'}</span>
            </div>
            {log.comment && <div className="text-xs text-gray-500 mt-0.5">{log.comment}</div>}
            {log.created_at && <div className="text-xs text-gray-400 mt-0.5">{fmtDateTime(log.created_at)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EcPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  // 详情路由区分：/ec/ecr/:id 与 /ec/eco/:id
  const isEco = location.pathname.includes('/eco/');

  const [tab, setTab] = useState<Tab>('ecr');

  /* ---- ECR 列表 ---- */
  const [ecrs, setEcrs] = useState<ECRRequest[]>([]);
  const [ecrsLoading, setEcrsLoading] = useState(false);
  const [ecrsError, setEcrsError] = useState<string | null>(null);
  const [ecrSearch, setEcrSearch] = useState('');
  const debouncedEcr = useDebounced(ecrSearch, 400);

  /* ---- ECO 列表 ---- */
  const [ecos, setEcos] = useState<ECORequest[]>([]);
  const [ecosLoading, setEcosLoading] = useState(false);
  const [ecosError, setEcosError] = useState<string | null>(null);
  const [ecoSearch, setEcoSearch] = useState('');
  const debouncedEco = useDebounced(ecoSearch, 400);

  useEffect(() => {
    let alive = true;
    setEcrsLoading(true);
    ecrApi
      .list({ page: 1, page_size: 100 })
      .then((res) => {
        if (alive) {
          setEcrs(((res.data ?? {}) as { items?: ECRRequest[] }).items ?? []);
          setEcrsError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setEcrs([]);
          setEcrsError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setEcrsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setEcosLoading(true);
    ecoApi
      .list({ page: 1, page_size: 100 })
      .then((res) => {
        if (alive) {
          setEcos(((res.data ?? {}) as { items?: ECORequest[] }).items ?? []);
          setEcosError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setEcos([]);
          setEcosError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setEcosLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filteredEcrs = useMemo(() => {
    const kw = debouncedEcr.trim().toLowerCase();
    if (!kw) return ecrs;
    return ecrs.filter((e) => e.ecr_number.toLowerCase().includes(kw) || e.title.toLowerCase().includes(kw));
  }, [ecrs, debouncedEcr]);

  const filteredEcos = useMemo(() => {
    const kw = debouncedEco.trim().toLowerCase();
    if (!kw) return ecos;
    return ecos.filter((e) => e.eco_number.toLowerCase().includes(kw) || e.title.toLowerCase().includes(kw));
  }, [ecos, debouncedEco]);

  /* ---------------- 详情视图（子路由 /ec/ecr/:id 或 /ec/eco/:id） ---------------- */
  if (id) {
    return isEco ? (
      <EcoDetailView ecoId={id} onBack={() => navigate(-1)} />
    ) : (
      <EcrDetailView ecrId={id} onBack={() => navigate(-1)} />
    );
  }

  /* ---------------- 列表视图（两段：ECR / ECO） ---------------- */
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索编号/标题..."
          value={tab === 'ecr' ? ecrSearch : ecoSearch}
          onChange={(e) => (tab === 'ecr' ? setEcrSearch(e.target.value) : setEcoSearch(e.target.value))}
        />
        <div className="flex gap-1 mt-2">
          {([
            { key: 'ecr', label: 'ECR' },
            { key: 'eco', label: 'ECO' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'ecr' && (
        <>
          {ecrsLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!ecrsLoading && ecrsError && <p className="text-center text-xs text-red-400 py-3">{ecrsError}</p>}
          {!ecrsLoading && !ecrsError && filteredEcrs.length === 0 && <EmptyState text="暂无 ECR" />}
          <MobileCardList
            items={filteredEcrs}
            keyOf={(e) => e.id}
            renderMain={(e) => e.ecr_number}
            renderMeta={(e) => (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.status} map={ECR_STATUS_MAP} />
                <StatusBadge status={e.priority} map={PRIORITY_MAP} />
                <span>
                  {formatMeta([
                    ['标题', e.title],
                    ['创建人', e.creator_name || undefined],
                    ['创建时间', fmtDate(e.created_at)],
                  ])}
                </span>
              </span>
            )}
            onClick={(e) => navigate(`/ec/ecr/${e.id}`)}
          />
        </>
      )}

      {tab === 'eco' && (
        <>
          {ecosLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!ecosLoading && ecosError && <p className="text-center text-xs text-red-400 py-3">{ecosError}</p>}
          {!ecosLoading && !ecosError && filteredEcos.length === 0 && <EmptyState text="暂无 ECO" />}
          <MobileCardList
            items={filteredEcos}
            keyOf={(e) => e.id}
            renderMain={(e) => e.eco_number}
            renderMeta={(e) => (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={e.status} map={ECO_STATUS_MAP} />
                <StatusBadge status={e.priority} map={PRIORITY_MAP} />
                <span>
                  {formatMeta([
                    ['标题', e.title],
                    ['创建人', e.creator_name || undefined],
                    ['创建时间', fmtDate(e.created_at)],
                  ])}
                </span>
              </span>
            )}
            onClick={(e) => navigate(`/ec/eco/${e.id}`)}
          />
        </>
      )}
    </div>
  );
}

/* ==================== ECR 详情（/ec/ecr/:id） ==================== */

function EcrDetailView({ ecrId, onBack }: { ecrId: string; onBack: () => void }) {
  const [ecr, setEcr] = useState<EcrDetail | null>(null);
  const [statusLogs, setStatusLogs] = useState<ECRStatusLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ecrApi
      .get(ecrId)
      .then((res) => {
        if (alive) {
          setEcr((res.data ?? null) as EcrDetail | null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setEcr(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    // 状态流转非关键数据，失败静默（桌面 ECRDetailModal 同款处理）
    ecrApi
      .getStatusLogs(ecrId)
      .then((res) => {
        if (!alive) return;
        const data = (res.data ?? {}) as { items?: ECRStatusLog[] };
        const list = Array.isArray(res.data) ? (res.data as ECRStatusLog[]) : data.items || [];
        setStatusLogs(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ecrId]);

  const title = ecr ? `${ecr.ecr_number} ${ecr.title}` : ecrId;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={onBack}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !ecr && <EmptyState text="未找到 ECR" />}

      {!loading && !error && ecr && (
        <div className="p-3 flex flex-col gap-3">
          {/* 基础信息 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={ecr.status} map={ECR_STATUS_MAP} />
              <StatusBadge status={ecr.priority} map={PRIORITY_MAP} />
            </div>
            <div className="mt-2 text-sm text-gray-900 break-all">{ecr.ecr_number} {ecr.title}</div>
            <div className="mt-1 text-xs text-gray-500">
              {formatMeta([
                ['类别', CATEGORY_LABEL[ecr.category || ''] || ecr.category || undefined],
                ['审批模式', ecr.review_mode === 'any' ? '或签' : '会签'],
                ['创建人', ecr.creator_name || undefined],
                ['创建时间', fmtDateTime(ecr.created_at)],
                ['审批进度', ecr.reviewers_count ? `${ecr.approved_count}/${ecr.reviewers_count}` : undefined],
                ['关联 ECO', ecr.eco_id || undefined],
              ])}
            </div>
            {ecr.reason && <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">原因：{ecr.reason}</div>}
          </div>

          {/* 影响项 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">影响项（{(ecr.affected_items || []).length}）</div>
            {(ecr.affected_items || []).length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无影响项</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(ecr.affected_items || []).map((it: ECRAffectedItem) => (
                  <div key={it.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="text-sm text-gray-900 break-all">
                      {it.entity_code ? `${it.entity_code} ${it.entity_name}` : it.entity_name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatMeta([
                        ['类型', it.entity_type === 'assembly' ? '部件' : it.entity_type === 'part' ? '零件' : it.entity_type],
                        ['版本', it.entity_version || undefined],
                        ['变更', it.change_type || undefined],
                      ])}
                    </div>
                    {it.change_description && <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{it.change_description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 审批记录 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">审批记录</div>
            <ReviewRecords records={ecr.review_records || []} />
          </div>

          {/* 状态流转 */}
          {statusLogs.length > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">状态流转</div>
              <StatusLogs logs={statusLogs} map={ECR_STATUS_MAP} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== ECO 详情（/ec/eco/:id） ==================== */

function EcoDetailView({ ecoId, onBack }: { ecoId: string; onBack: () => void }) {
  const [eco, setEco] = useState<ECORequest | null>(null);
  const [statusLogs, setStatusLogs] = useState<ECOStatusLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ecoApi
      .detail(ecoId)
      .then((res) => {
        if (alive) {
          setEco((res.data ?? null) as ECORequest | null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setEco(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    ecoApi
      .getStatusLogs(ecoId)
      .then((res) => {
        if (!alive) return;
        const data = (res.data ?? {}) as { items?: ECOStatusLog[] };
        const list = Array.isArray(res.data) ? (res.data as ECOStatusLog[]) : data.items || [];
        setStatusLogs(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ecoId]);

  const title = eco ? `${eco.eco_number} ${eco.title}` : ecoId;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={onBack}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !eco && <EmptyState text="未找到 ECO" />}

      {!loading && !error && eco && (
        <div className="p-3 flex flex-col gap-3">
          {/* 基础信息 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={eco.status} map={ECO_STATUS_MAP} />
              <StatusBadge status={eco.priority} map={PRIORITY_MAP} />
            </div>
            <div className="mt-2 text-sm text-gray-900 break-all">{eco.eco_number} {eco.title}</div>
            <div className="mt-1 text-xs text-gray-500">
              {formatMeta([
                ['类别', CATEGORY_LABEL[eco.category || ''] || eco.category || undefined],
                ['审批模式', eco.review_mode === 'any' ? '或签' : '会签'],
                ['创建人', eco.creator_name || undefined],
                ['创建时间', fmtDateTime(eco.created_at)],
                ['审批进度', eco.reviewers_count ? `${eco.approved_count}/${eco.reviewers_count}` : undefined],
                ['执行进度', eco.execution_count ? `${eco.execution_completed_count}/${eco.execution_count}` : undefined],
                ['关联 ECR', eco.ecr_number || undefined],
              ])}
            </div>
            {eco.reason && <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">原因：{eco.reason}</div>}
          </div>

          {/* 执行项 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">执行项（{(eco.execution_items || []).length}）</div>
            {(eco.execution_items || []).length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无执行项</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(eco.execution_items || []).map((it) => (
                  <div key={it.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="text-sm text-gray-900 break-all">
                      {it.entity_code ? `${it.entity_code} ${it.entity_name}` : it.entity_name}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
                      <StatusBadge status={it.status} map={EXEC_STATUS_MAP} />
                      <span>
                        {formatMeta([
                          ['动作', EXEC_ACTION_LABEL[it.action] || it.action],
                          ['类型', it.entity_type === 'assembly' ? '部件' : it.entity_type === 'part' ? '零件' : it.entity_type],
                          ['版本', it.new_version || it.entity_version || undefined],
                        ])}
                      </span>
                    </div>
                    {it.error_message && <div className="text-xs text-red-500 mt-0.5 whitespace-pre-wrap">{it.error_message}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 审批记录 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">审批记录</div>
            <ReviewRecords records={eco.review_records || []} />
          </div>

          {/* 状态流转 */}
          {statusLogs.length > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">状态流转</div>
              <StatusLogs logs={statusLogs} map={ECO_STATUS_MAP} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
