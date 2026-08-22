import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bomApi, partsApi } from '../../services/api';
import type { BOMCompareNode, BOMCompareResponse } from '../../types';
import type { PartListItem } from '../../types';

/**
 * 移动端 BOM 对比页（/parts/compare）。
 * - 左/右各选一个零部件（服务端搜索，点选版本），开始对比
 * - POST /api/bom/compare 返回差异树，按 path 展开/折叠，变更类型着色
 * - 汇总条：新增/删除/修改/内部变更；可"仅显示差异"
 */

const CHANGE_MAP: Record<string, { label: string; cls: string }> = {
  add: { label: '新增', cls: 'bg-green-100 text-green-700' },
  delete: { label: '删除', cls: 'bg-red-100 text-red-700' },
  modify: { label: '修改', cls: 'bg-yellow-100 text-yellow-700' },
  internal: { label: '内部', cls: 'bg-orange-100 text-orange-700' },
  none: { label: '无变化', cls: 'bg-gray-100 text-gray-600' },
};

const ROW_BG: Record<string, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-orange-50',
  none: 'bg-white',
};

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
  if ((l?.quantity ?? null) !== (r?.quantity ?? null)) {
    segs.push(`数量 ${l?.quantity ?? '-'}→${r?.quantity ?? '-'}`);
  }
  if (n.change_type === 'internal') segs.push('子项变化');
  return segs.join('；') || (n.change_type === 'modify' ? '修改' : '');
}

export default function BomComparePage() {
  const navigate = useNavigate();
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<BOMCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);

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
        <button
          onClick={handleCompare}
          disabled={!leftId || !rightId || loading}
          className="w-full min-h-11 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? '对比中...' : '开始对比'}
        </button>
        {error && <p className="text-center text-xs text-red-500 py-1">{error}</p>}
      </div>

      {result && (
        <div className="flex-1 min-h-0 flex flex-col">
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
            <label className="ml-auto flex items-center gap-1 text-gray-600 select-none">
              <input
                type="checkbox"
                checked={onlyDiff}
                onChange={(e) => setOnlyDiff(e.target.checked)}
                className="h-4 w-4"
              />
              仅差异
            </label>
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
                  return (
                    <div
                      key={n.key}
                      className={`flex items-stretch min-h-10 border-b border-gray-100 last:border-b-0 ${ROW_BG[n.change_type] ?? ''}`}
                    >
                      {/* 缩进 + 竖线 */}
                      <span className="relative shrink-0" style={{ width: depth * 16 + 4 }}>
                        {depth > 0 && (
                          <span
                            className="absolute top-0 bottom-0 border-l border-gray-200"
                            style={{ left: depth * 16 + 2 }}
                          />
                        )}
                      </span>
                      {hasChildren ? (
                        <button
                          type="button"
                          aria-label={isOpen ? '折叠' : '展开'}
                          onClick={() => toggle(n.key)}
                          className="shrink-0 w-9 flex items-center justify-center text-gray-500 text-sm"
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      ) : (
                        <span className="shrink-0 w-9 flex items-center justify-center text-gray-300 text-xs">
                          •
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
                          <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-xs ${cm.cls}`}>
                            {cm.label}
                          </span>
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
        </div>
      )}
    </div>
  );
}
