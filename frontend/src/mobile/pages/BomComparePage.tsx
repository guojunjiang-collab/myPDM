import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { bomApi, partsApi } from '../../services/api';
import type { BOMCompareNode, BOMCompareResponse } from '../../types';
import type { PartListItem } from '../../types';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import TreeToggle from '../../components/ui/TreeToggle';
import type { BadgeTone } from '../../constants/badges';
import { StpViewerCore } from './StpViewerPage';

/**
 * 移动端 BOM 对比页（/parts/compare）。
 * - 左/右各选一个零部件（服务端搜索，点选版本），开始对比
 * - POST /api/bom/compare 返回差异树，按 path 展开/折叠，变更类型着色
 * - 汇总条：新增/删除/修改/内部变更；可"仅显示差异"
 */

const CHANGE_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  add: { label: '新增', tone: 'green' },
  delete: { label: '删除', tone: 'red' },
  modify: { label: '修改', tone: 'amber' },
  internal: { label: '内部', tone: 'orange' },
  none: { label: '无变化', tone: 'gray' },
};

const ROW_BG: Record<string, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-orange-50',
  none: 'bg-white',
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  frozen: '冻结',
  released: '发布',
  obsolete: '作废',
};

/** 属性对比表：左右装配的系统字段 + 自定义字段并排对比（对齐桌面 PropertyCompareTable） */
function PropertyTable({ left, right, onlyDiff }: { left: any; right: any; onlyDiff: boolean }) {
  const statusLabel = (s?: string) => (s ? STATUS_LABEL[s] ?? s : '');
  const systemFields = [
    { label: '件号', lv: left?.code, rv: right?.code },
    { label: '名称', lv: left?.name, rv: right?.name },
    { label: '版本', lv: left?.version, rv: right?.version },
    {
      label: '状态',
      lv: left?.status ? statusLabel(left.status) : '',
      rv: right?.status ? statusLabel(right.status) : '',
    },
  ];
  const lcf: Record<string, { label: string; value: unknown }> = left?.custom_fields ?? {};
  const rcf: Record<string, { label: string; value: unknown }> = right?.custom_fields ?? {};
  const cfKeys = [...new Set([...Object.keys(lcf), ...Object.keys(rcf)])].sort();
  const customRows = cfKeys.map((k) => ({
    label: lcf[k]?.label ?? rcf[k]?.label ?? k,
    lv: lcf[k]?.value ?? '',
    rv: rcf[k]?.value ?? '',
  }));
  let rows = [...systemFields, ...customRows];
  if (onlyDiff) rows = rows.filter((r) => String(r.lv) !== String(r.rv));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="flex bg-gray-50 text-xs font-medium text-gray-600 border-b border-gray-200">
          <span className="w-20 shrink-0 px-3 py-2">字段</span>
          <span className="flex-1 min-w-0 px-3 py-2">左值</span>
          <span className="flex-1 min-w-0 px-3 py-2">右值</span>
        </div>
        {rows.map((r, i) => {
          const lvs = String(r.lv ?? '');
          const rvs = String(r.rv ?? '');
          const changed = lvs !== rvs;
          return (
            <div
              key={i}
              className={`flex border-b border-gray-50 last:border-b-0 ${changed ? 'bg-yellow-50' : ''}`}
            >
              <span className="w-20 shrink-0 px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{r.label}</span>
              <span className="flex-1 min-w-0 px-3 py-2 text-sm break-all">{lvs || '-'}</span>
              <span className={`flex-1 min-w-0 px-3 py-2 text-sm break-all ${changed ? 'font-semibold text-red-600' : ''}`}>
                {rvs || '-'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 可搜索零部件选择器（服务端搜索，点选版本） */
function PartPicker({
  label,
  onPick,
}: {
  label: string;
  onPick: (revisionId: string, item: PartListItem) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PartListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PartListItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = (query: string) => {
    setQ(query);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        // show_all_versions：返回所有版本行，可对比同一零部件的不同版本（与桌面选择器一致）
        const res = await partsApi.list({ search: query.trim(), page_size: 20, show_all_versions: true });
        setResults(res.items ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  return (
    <div className="relative">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input
        type="text"
        value={selected ? `${selected.code} ${selected.name}（${selected.version}）` : q}
        placeholder="输入件号或名称搜索..."
        onChange={(e) => {
          setSelected(null);
          doSearch(e.target.value);
        }}
        className="w-full h-11 px-3 rounded-lg bg-white border border-gray-200 text-sm"
      />
      {!selected && q.trim() && (
        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {searching && <div className="px-3 py-2 text-sm text-gray-400">搜索中...</div>}
          {!searching && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-gray-400">无匹配结果</div>
          )}
          {!searching &&
            results.map((o) => (
              <button
                key={o.revision_id}
                type="button"
                onClick={() => {
                  onPick(o.revision_id, o);
                  setSelected(o);
                  setQ('');
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="font-medium">{o.code}</span>
                <span className="text-gray-500 truncate">{o.name}</span>
                <span className="ml-auto text-gray-400 text-xs">{o.version}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** 节点变化描述（版本/数量变化、内部变更） */
function buildDesc(n: BOMCompareNode): string {
  const l = n.left;
  const r = n.right;
  if (n.change_type === 'add') return '新增';
  if (n.change_type === 'delete') return '删除';
  const segs: string[] = [];
  if ((l?.detail.version ?? '') !== (r?.detail.version ?? '')) {
    segs.push(`版本 ${l?.detail.version ?? '-'}→${r?.detail.version ?? '-'}`);
  }
  if (n.change_type === 'internal') segs.push('子项变化');
  // 数量变化已在行1 用量标签展示（×L→×R），此处不再重复
  return segs.join('；') || (n.change_type === 'modify' ? '修改' : '');
}

export default function BomComparePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 深链支持：?left=<revisionId>&right=<revisionId>（零部件详情"版本对比"跳转）预选并自动对比
  const [leftId, setLeftId] = useState<string | null>(() => searchParams.get('left'));
  const [rightId, setRightId] = useState<string | null>(() => searchParams.get('right'));
  const autoStartedRef = useRef(false);
  const [result, setResult] = useState<BOMCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [activeTab, setActiveTab] = useState<'tree' | 'property'>('tree');
  // 3D 对比：内嵌全屏浮层（不离开当前页），关闭后左侧/右侧/结果全部保留
  const [show3D, setShow3D] = useState(false);
  const show3DRef = useRef(show3D);
  useEffect(() => {
    show3DRef.current = show3D;
  }, [show3D]);

  // URL 深链：left+right 就绪时自动开始对比（仅一次）
  useEffect(() => {
    if (autoStartedRef.current || !leftId || !rightId) return;
    autoStartedRef.current = true;
    setLoading(true);
    setError(null);
    bomApi
      .compare(leftId, rightId)
      .then((res) => {
        setResult(res.data as BOMCompareResponse);
        setExpanded(new Set(['ROOT']));
      })
      .catch((e) => {
        setResult(null);
        const detail = (e as any)?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : '对比失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, [leftId, rightId]);

  // 打开 3D 浮层时压入哨兵；系统返回（popstate）弹哨兵 → 仅关闭浮层，不离开对比页
  // 抽屉哨兵在 overlay3d 之上：关抽屉 back() 弹掉 drawer 后栈顶仍是 overlay3d（popstate 的
  // history.state 是弹出后的当前项），此时不能关浮层；只有 overlay3d 本身被弹出
  // （栈顶不再是 overlay3d）才关闭浮层。
  useEffect(() => {
    const onPop = () => {
      const cur = window.history.state as { drawer?: string; overlay3d?: boolean } | null;
      if (!cur?.overlay3d && show3DRef.current) {
        setShow3D(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open3D = () => {
    if (!leftId || !rightId) return;
    setShow3D(true);
    window.history.pushState({ overlay3d: true }, '');
  };
  const close3D = () => {
    setShow3D(false);
    // 用户主动关闭：弹出哨兵，保持 history 栈一致（popstate 关闭路径由 onPop 处理）
    window.history.back();
  };

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bomApi.compare(leftId, rightId);
      setResult(res.data as BOMCompareResponse);
      setExpanded(new Set(['ROOT']));
    } catch (e) {
      setResult(null);
      const detail = (e as any)?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : '对比失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  /** 可见节点：ROOT + 按 path 递归（与桌面 PartCompareModal 一致） */
  const visibleNodes = useMemo(() => {
    if (!result) return [];
    const allNodes = onlyDiff
      ? result.comparison.filter((n) => n.change_type !== 'none')
      : result.comparison;
    const out: BOMCompareNode[] = [];
    const la = result.left_assembly;
    const ra = result.right_assembly;
    const rootChanged =
      (la?.version || '') !== (ra?.version || '') || (la?.status || '') !== (ra?.status || '');
    const rootNode: BOMCompareNode = {
      key: 'ROOT',
      level: -1,
      sort: '-1',
      path: '',
      change_type: rootChanged
        ? 'modify'
        : result.summary.added > 0 || result.summary.deleted > 0 || result.summary.modified > 0
          ? 'internal'
          : 'none',
      left: la
        ? {
            id: '',
            child_type: 'assembly',
            child_id: (la as any).master_id || la.id,
            child_master_id: (la as any).master_id || la.id,
            child_revision_id: la.id,
            quantity: 1,
            detail: { code: la.code, name: la.name, spec: '', version: la.version, status: la.status },
          }
        : null,
      right: ra
        ? {
            id: '',
            child_type: 'assembly',
            child_id: (ra as any).master_id || ra.id,
            child_master_id: (ra as any).master_id || ra.id,
            child_revision_id: ra.id,
            quantity: 1,
            detail: { code: ra.code, name: ra.name, spec: '', version: ra.version, status: ra.status },
          }
        : null,
    };
    out.push(rootNode);
    const collect = (parent: BOMCompareNode) => {
      if (!expanded.has(parent.key)) return;
      const children =
        parent.key === 'ROOT'
          ? allNodes.filter((n) => n.level === 0)
          : allNodes.filter(
              (n) =>
                n.path.startsWith(parent.key + '/') &&
                n.path.split('/').length === parent.key.split('/').length + 1
            );
      for (const c of children) {
        out.push(c);
        collect(c);
      }
    };
    collect(rootNode);
    return out;
  }, [result, onlyDiff, expanded]);

  const s = result?.summary;
  const identical =
    result && s && s.added === 0 && s.deleted === 0 && s.modified === 0 && s.internal_changes === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">BOM 对比</div>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2 bg-gray-50">
        <PartPicker
          label="左零部件"
          onPick={(revId) => {
            setLeftId(revId);
            setResult(null);
            setError(null);
          }}
        />
        <PartPicker
          label="右零部件"
          onPick={(revId) => {
            setRightId(revId);
            setResult(null);
            setError(null);
          }}
        />
        <div className="flex gap-2">
          <Button
            onClick={handleCompare}
            disabled={!leftId || !rightId || loading}
            size="touch"
            className="flex-1"
          >
            {loading ? '对比中...' : '开始对比'}
          </Button>
          <Button
            onClick={open3D}
            disabled={!leftId || !rightId}
            size="touch"
            className="flex-1"
          >
            🧊 3D 对比
          </Button>
        </div>
        {error && <p className="text-center text-xs text-red-500 py-1">{error}</p>}
      </div>

      {result && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab：BOM树对比 | 属性对比（仅差异两 Tab 共享） */}
          <div className="flex items-center gap-2 px-3 pt-2">
            <button
              onClick={() => setActiveTab('tree')}
              className={`min-h-9 px-3 rounded-full text-xs ${activeTab === 'tree' ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              BOM树对比
            </button>
            <button
              onClick={() => setActiveTab('property')}
              className={`min-h-9 px-3 rounded-full text-xs ${activeTab === 'property' ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              属性对比
            </button>
            <label className="ml-auto flex items-center gap-1 text-xs text-gray-600 select-none">
              <input
                type="checkbox"
                checked={onlyDiff}
                onChange={(e) => setOnlyDiff(e.target.checked)}
                className="h-4 w-4"
              />
              仅差异
            </label>
          </div>

          {activeTab === 'property' ? (
            <div className="flex-1 min-h-0 flex flex-col pt-2">
              <PropertyTable left={result.left_assembly} right={result.right_assembly} onlyDiff={onlyDiff} />
            </div>
          ) : (
            <>
              {/* 汇总条 */}
              <div className="px-3 pt-2 pb-1 flex items-center gap-3 text-xs">
                <span>
                  新增 <span className="text-green-600 font-medium">{s?.added ?? 0}</span>
                </span>
                <span>
                  删除 <span className="text-red-600 font-medium">{s?.deleted ?? 0}</span>
                </span>
                <span>
                  修改 <span className="text-yellow-600 font-medium">{s?.modified ?? 0}</span>
                </span>
                {(s?.internal_changes ?? 0) > 0 && (
                  <span>
                    内部变更 <span className="text-orange-600 font-medium">{s?.internal_changes}</span>
                  </span>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                {identical ? (
                  <div className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-3 text-center">
                    两侧 BOM 一致
                  </div>
                ) : visibleNodes.length === 0 ? (
                  <div className="text-sm text-gray-500 text-center py-6">无差异节点</div>
                ) : (
                  <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    {visibleNodes.map((n) => {
                      const l = n.left;
                      const r = n.right;
                      const side = l ?? r;
                      const code = side?.detail.code ?? '';
                      const name = side?.detail.name ?? '';
                      const hasChildren = result.comparison.some(
                        (c) =>
                          c.path.startsWith(n.path + '/') &&
                          c.path.split('/').length === n.path.split('/').length + 1
                      );
                      const isOpen = expanded.has(n.key);
                      const depth = n.level + 1;
                      const desc = buildDesc(n);
                      const cm = CHANGE_MAP[n.change_type] ?? CHANGE_MAP.none;
                      // 用量：两侧都存在 → ×L（相同）/ ×L→×R（不同）；单侧 → ×N
                      const lq = l?.quantity;
                      const rq = r?.quantity;
                      const qtyChanged = lq != null && rq != null && lq !== rq;
                      const qtyLabel =
                        lq != null && rq != null
                          ? lq === rq
                            ? `×${lq}`
                            : `×${lq}→×${rq}`
                          : lq != null
                            ? `×${lq}`
                            : rq != null
                              ? `×${rq}`
                              : '';
                      return (
                        <div
                          key={n.key}
                          className={`flex items-stretch min-h-10 border-b border-gray-100 last:border-b-0 ${ROW_BG[n.change_type] ?? ''}`}
                        >
                          {/* 缩进 + 竖线 */}
                          <span className="relative shrink-0" style={{ width: `calc(4px + ${depth} * var(--ui-tree-indent))` }}>
                            {depth > 0 && (
                              <span
                                className="absolute top-0 bottom-0 border-l border-gray-200"
                                style={{ left: `calc(2px + ${depth} * var(--ui-tree-indent))` }}
                              />
                            )}
                          </span>
                          {hasChildren ? (
                            <span className="shrink-0 w-9 flex items-center justify-center">
                              <TreeToggle expanded={isOpen} onClick={() => toggle(n.key)} size="sm" title={isOpen ? '折叠' : '展开'} />
                            </span>
                          ) : (
                            <span className="shrink-0 w-9 flex items-center justify-center">
                              <TreeToggle leaf size="sm" />
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const m = side?.child_master_id;
                              if (m) navigate(`/parts/${m}`);
                            }}
                            className="flex-1 min-w-0 flex flex-col justify-center py-1.5 pl-1 text-left"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                                {code}
                              </span>
                              {qtyLabel && (
                                <span
                                  className={`shrink-0 text-xs ${qtyChanged ? 'text-orange-600 font-medium' : 'text-gray-500'}`}
                                >
                                  {qtyLabel}
                                </span>
                              )}
                              <Badge tone={cm.tone} label={cm.label} size="xs" />
                            </span>
                            <span className="text-xs text-gray-500 mt-0.5 truncate">
                              {name}
                              {desc ? ` · ${desc}` : ''}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 3D 对比浮层：内嵌查看器，返回仅关闭浮层（对比信息保留） */}
      {show3D && leftId && rightId && (
        <div className="fixed inset-0 z-50 bg-gray-100">
          <StpViewerCore
            params={{ compareLeft: leftId, compareRight: rightId }}
            onBack={close3D}
          />
        </div>
      )}
    </div>
  );
}
