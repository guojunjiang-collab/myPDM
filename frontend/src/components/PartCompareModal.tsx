import { useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { Modal } from './Modal';
import PartDetailModal from './PartDetailModal';
import { partsApi, bomApi } from '../services/api';
import type { PartListItem, BOMCompareNode, BOMCompareResponse } from '../types';
import Button from './ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 预选左右版本（PartRevision id + 展示 item），传入时打开即自动对比（PartDetailModal 版本 Tab 使用） */
  initialLeftId?: string;
  initialRightId?: string;
  initialLeftItem?: PartListItem;
  initialRightItem?: PartListItem;
}

const STATUS_LABEL: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
const statusLabel = (s?: string) => (s ? STATUS_LABEL[s] || s : '-');

/** 属性对比表：左右两侧的系统字段 + 自定义字段并排对比 */
function PropertyCompareTable({ left, right, onlyDiff }: { left: any; right: any; onlyDiff: boolean }) {
  const systemFields = [
    { key: 'code', label: '件号', lv: left?.code, rv: right?.code },
    { key: 'name', label: '名称', lv: left?.name, rv: right?.name },
    { key: 'version', label: '版本', lv: left?.version, rv: right?.version },
    { key: 'status', label: '状态', lv: left?.status ? statusLabel(left.status) : '', rv: right?.status ? statusLabel(right.status) : '' },
  ];

  const lcf: Record<string, {label: string; value: any}> = left?.custom_fields || {};
  const rcf: Record<string, {label: string; value: any}> = right?.custom_fields || {};
  const allCfKeys = [...new Set([...Object.keys(lcf), ...Object.keys(rcf)])].sort();
  const customRows = allCfKeys.map(key => {
    const lv = lcf[key]?.value ?? '';
    const rv = rcf[key]?.value ?? '';
    const label = lcf[key]?.label || rcf[key]?.label || key;
    return { key, label, lv, rv };
  });

  let rows = [...systemFields, ...customRows];
  if (onlyDiff) {
    rows = rows.filter(r => String(r.lv) !== String(r.rv));
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0 z-10">
          <tr className="text-xs font-medium text-gray-600 border-b">
            <th className="px-3 py-2 text-left w-24">字段</th>
            <th className="px-3 py-2 text-left">左值</th>
            <th className="px-3 py-2 text-left">右值</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((r, i) => {
            const lvs = String(r.lv ?? '');
            const rvs = String(r.rv ?? '');
            const changed = lvs !== rvs;
            return (
              <tr key={i} className={changed ? 'bg-yellow-50' : ''}>
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{r.label}</td>
                <td className="px-3 py-1.5">{lvs || '-'}</td>
                <td className={`px-3 py-1.5 ${changed ? 'font-semibold text-red-600' : ''}`}>{rvs || '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 展开箭头，与 BOM 对比 3D 预览的对比树(CompareTreePanel)保持同一风格 */
function CompareChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="none"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const rowBg: Record<string, string> = {
  add: 'bg-green-50',
  delete: 'bg-red-50',
  modify: 'bg-yellow-50',
  internal: 'bg-yellow-50',
  none: '',
};

function changeText(node: BOMCompareNode): string {
  if (node.change_type === 'add') return '新增';
  if (node.change_type === 'delete') return '删除';
  if (node.change_type === 'modify' || node.change_type === 'internal') {
    const l = node.left, r = node.right;
    const segs: string[] = [];
    if ((l?.detail.version || '') !== (r?.detail.version || ''))
      segs.push(`版本 ${l?.detail.version || '-'}→${r?.detail.version || '-'}`);
    if ((l?.detail.status || '') !== (r?.detail.status || ''))
      segs.push(`状态 ${statusLabel(l?.detail.status)}→${statusLabel(r?.detail.status)}`);
    if ((l?.quantity ?? null) !== (r?.quantity ?? null))
      segs.push(`数量 ${l?.quantity ?? '-'}→${r?.quantity ?? '-'}`);
    if (node.change_type === 'internal') segs.push('子项变化');
    return segs.join('；') || '内部变更';
  }
  return '';
}

/** 可搜索的零部件选择器（服务端搜索，仅显示部件） */
function PartPicker({ label, valueId, onPick, onSearch, filterType }: {
  label: string;
  valueId: string | null;
  onPick: (id: string, item: PartListItem) => void;
  onSearch: (query: string, filterType: string | null) => Promise<PartListItem[]>;
  filterType: string | null;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
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
        const items = await onSearch(query.trim(), filterType);
        setResults(items);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={open ? q : selected ? `${selected.code}_${selected.name}_${selected.version}` : ''}
          placeholder="输入件号或名称搜索..."
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => doSearch(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
        />
        {open && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
            {searching && (
              <div className="px-3 py-2 text-sm text-gray-400">搜索中...</div>
            )}
            {!searching && q.trim() && results.length === 0 && (
              <div className="px-3 py-2 text-sm text-gray-400">无匹配结果</div>
            )}
            {!searching && !q.trim() && (
              <div className="px-3 py-2 text-sm text-gray-400">输入关键词搜索</div>
            )}
            {!searching && results.map((o) => (
              <button
                key={o.revision_id}
                type="button"
                onMouseDown={() => { onPick(o.revision_id, o); setSelected(o); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="font-medium">{o.code}</span>
                <span className="text-gray-500 truncate">{o.name}</span>
                <span className="ml-auto text-gray-400 text-xs">{o.version}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PartCompareModal({
  open,
  onClose,
  initialLeftId,
  initialRightId,
  initialLeftItem,
  initialRightItem,
}: Props) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [leftItem, setLeftItem] = useState<PartListItem | null>(null);
  const [rightItem, setRightItem] = useState<PartListItem | null>(null);
  const [lockedType, setLockedType] = useState<'part' | 'assembly' | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [result, setResult] = useState<BOMCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [detail, setDetail] = useState<{ masterId: string; revisionId: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'property' | 'bom'>('property');
  const autoStartedRef = useRef(false);

  // 打开时初始化：有预选（版本 Tab BOM 对比）→ 直接设置左右并自动对比；否则重置为空
  useEffect(() => {
    if (!open) return;
    autoStartedRef.current = false;
    setResult(null); setError(''); setOnlyDiff(false); setActiveTab('property'); setResetKey(0);
    if (initialLeftId && initialRightId) {
      setLeftId(initialLeftId);
      setRightId(initialRightId);
      setLeftItem(initialLeftItem ?? null);
      setRightItem(initialRightItem ?? null);
      setLockedType(initialLeftItem?.type ?? null);
      // 自动触发对比（state 更新后执行；用 timeout 保证左右 state 已写入）
      setTimeout(() => {
        setLoading(true); setError('');
        bomApi
          .compare(initialLeftId, initialRightId)
          .then((res) => {
            setResult(res.data as BOMCompareResponse);
            setExpanded(new Set(['ROOT']));
          })
          .catch((err) => {
            const msg = (err as AxiosError<{ detail: string }>)?.response?.data?.detail || '对比失败，请重试';
            setError(msg);
            setResult(null);
          })
          .finally(() => setLoading(false));
      }, 0);
    } else {
      setLeftId(null); setRightId(null); setLeftItem(null); setRightItem(null);
      setLockedType(null);
    }
    // 预选参数变化视为新的对比请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialLeftId, initialRightId]);

  /** 服务端搜索，按 lockedType 过滤 */
  const handleSearch = async (query: string, filterType: string | null): Promise<PartListItem[]> => {
    try {
      const res = await partsApi.list({ search: query, page_size: 50, show_all_versions: true });
      let items = res.items || [];
      if (filterType) {
        items = items.filter((i: PartListItem) => i.type === filterType);
      }
      return items;
    } catch {
      return [];
    }
  };

  const pickLeft = (id: string, item: PartListItem) => {
    setLeftId(id);
    setLeftItem(item);
    setLockedType(item.type as 'part' | 'assembly');
  };

  const pickRight = (id: string, item: PartListItem) => {
    setRightId(id);
    setRightItem(item);
    setLockedType(item.type as 'part' | 'assembly');
  };

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true); setError('');
    try {
      const res = await bomApi.compare(leftId, rightId);
      setResult(res.data as BOMCompareResponse);
      setExpanded(new Set(['ROOT']));
    } catch (err) {
      const msg = (err as AxiosError<{ detail: string }>)?.response?.data?.detail || '对比失败，请重试';
      console.error('BOM对比失败', err);
      setError(msg);
      setResult(null);
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

  /** 扁平节点列表 → 树形结构 */
  const nodeTree = useMemo(() => {
    if (!result) return [];
    const list = result.comparison.filter((n) => n.change_type !== 'none' || !onlyDiff);
    if (onlyDiff) return list.filter((n: BOMCompareNode) => n.change_type !== 'none');
    return list;
  }, [result, onlyDiff]);

  /** 按 path 父子关系构建，需要知道一个节点的子节点是否展开 */
  const visibleNodes = useMemo(() => {
    if (!result) return [];
    const allNodes = onlyDiff
      ? result.comparison.filter((n: BOMCompareNode) => n.change_type !== 'none')
      : result.comparison;
    const out: BOMCompareNode[] = [];

    // 注入对比的根零部件节点
    const la = result.left_assembly;
    const ra = result.right_assembly;
    const rootChanged = (la?.version || '') !== (ra?.version || '') || (la?.status || '') !== (ra?.status || '');
    const rootNode: BOMCompareNode = {
      key: 'ROOT',
      level: -1,
      sort: '-1',
      path: '',
      change_type: rootChanged ? 'modify' : (result.summary.added > 0 || result.summary.deleted > 0 || result.summary.modified > 0 ? 'internal' : 'none'),
      left: la ? {
        id: '', child_type: 'assembly', child_id: (la as any).master_id || la.id, child_master_id: (la as any).master_id || la.id,
        child_revision_id: la.id, quantity: 1,
        detail: { code: la.code, name: la.name, spec: '', version: la.version, status: la.status },
      } : null,
      right: ra ? {
        id: '', child_type: 'assembly', child_id: (ra as any).master_id || ra.id, child_master_id: (ra as any).master_id || ra.id,
        child_revision_id: ra.id, quantity: 1,
        detail: { code: ra.code, name: ra.name, spec: '', version: ra.version, status: ra.status },
      } : null,
    };
    out.push(rootNode);

    /** 递归收集可见子节点，支持任意层级 */
    const collectChildren = (parent: BOMCompareNode) => {
      if (!expanded.has(parent.key)) return;

      const children = parent.key === 'ROOT'
        ? allNodes.filter((n: BOMCompareNode) => n.level === 0)
        : allNodes.filter((n: BOMCompareNode) =>
            n.path.startsWith(parent.key + '/') &&
            n.path.split('/').length === parent.key.split('/').length + 1
          );

      for (const child of children) {
        out.push(child);
        collectChildren(child);
      }
    };

    collectChildren(rootNode);
    return out;
  }, [result, onlyDiff, expanded]);

  const summaryBar = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    return (
      <div className="flex flex-wrap gap-4 mb-3 p-3 bg-gray-50 rounded-lg border text-sm">
        <span>
          新增 <span className="text-green-600 font-medium">{s.added}</span>　
          删除 <span className="text-red-600 font-medium">{s.deleted}</span>　
          修改 <span className="text-yellow-600 font-medium">{s.modified}</span>
          {s.internal_changes > 0 && <>　内部变更 <span className="text-yellow-600 font-medium">{s.internal_changes}</span></>}
        </span>
      </div>
    );
  }, [result]);

  const identical = result && result.summary.added === 0 && result.summary.deleted === 0 && result.summary.modified === 0 && result.summary.internal_changes === 0;

  return (
    <>
      <Modal open={open} onClose={onClose} title="BOM 对比" width="3xl" height="90vh">
        <div className="flex flex-col h-full space-y-4">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <PartPicker key={`left-${resetKey}`} label="左零部件" valueId={leftId} onPick={pickLeft} onSearch={handleSearch} filterType={lockedType} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setLeftId(null); setRightId(null); setLeftItem(null); setRightItem(null); setLockedType(null); setResetKey(k => k + 1); }}
              disabled={!leftId && !rightId}
              className="mb-1"
              title="清空两侧已选零部件"
            >
              重置
            </Button>
            <PartPicker key={`right-${resetKey}`} label="右零部件" valueId={rightId} onPick={pickRight} onSearch={handleSearch} filterType={lockedType} />
          </div>
          {lockedType && (
            <div className="text-xs text-gray-500">
              已锁定：<span className="font-medium">{lockedType === 'assembly' ? '部件' : '零件'}对比</span>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={handleCompare} disabled={!leftId || !rightId || loading}>
              {loading ? '对比中...' : '开始对比'}
            </Button>
            <Button
              onClick={() => window.open(`/stp-viewer?compare-left=${leftId}&compare-right=${rightId}`, '_blank')}
              disabled={!leftId || !rightId}
              title="在新标签页中叠加对比两个零部件的 3D 模型"
            >
              🧊 3D对比
            </Button>
            {result && (
              <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                仅显示差异
              </label>
            )}
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          {result && (
            <div className="border rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="flex items-center gap-1 border-b bg-gray-50 px-1">
                <button onClick={() => setActiveTab('property')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'property' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>属性对比</button>
                <button onClick={() => setActiveTab('bom')} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'bom' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>BOM树对比</button>
              </div>

              {activeTab === 'property' ? (
                <PropertyCompareTable left={result.left_assembly} right={result.right_assembly} onlyDiff={onlyDiff} />
              ) : (
                <>
                  {result.comparison.length === 0 && !identical && (
                    <div className="text-sm text-gray-500 text-center py-6">两侧 BOM 均为空</div>
                  )}
                  {identical && (
                    <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">两侧 BOM 一致</div>
                  )}
                  {result.comparison.length > 0 && (
                    <>
              {summaryBar}
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col className="w-40" />
                  </colgroup>
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-xs font-medium text-gray-600 border-b">
                      <th colSpan={5} className="px-2 py-2 text-left border-r border-gray-200">左 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th colSpan={5} className="px-2 py-2 text-left">右 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-2 text-left">变更</th>
                    </tr>
                    <tr className="text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">版本</th>
                      <th className="px-2 py-1 text-center">状态</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">版本</th>
                      <th className="px-2 py-1 text-center">状态</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNodes.map((n) => {
                      const l = n.left, r = n.right;
                      const versionChanged = (l?.detail.version || '') !== (r?.detail.version || '');
                      const statusChanged = (l?.detail.status || '') !== (r?.detail.status || '');
                      const qtyChanged = (l?.quantity ?? null) !== (r?.quantity ?? null);
                      const hasChildren = nodeTree.some((c: BOMCompareNode) =>
                        c.path.startsWith(n.path + '/') && c.path.split('/').length === n.path.split('/').length + 1
                      );
                      const isExpanded = expanded.has(n.key);
                      // depth = n.level + 1，ROOT 为 0，直接子项为 1，以此类推
                      // 对齐 CompareTreePanel：paddingLeft = 8 + depth*12，按钮中心 = 16 + depth*12
                      const depth = n.level + 1;
                      const indent = 8 + depth * 12;
                      return (
                        <tr key={n.key} className={`${rowBg[n.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
                          onClick={() => {
                            const side = n.right || n.left;
                            if (side?.child_master_id && side?.child_revision_id) {
                              setDetail({ masterId: side.child_master_id, revisionId: side.child_revision_id });
                            }
                          }}>
                          <td
                            className="relative px-2 py-2 text-xs font-medium whitespace-nowrap"
                            style={{ paddingLeft: indent }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {n.key !== 'ROOT' && depth > 0 && Array.from({ length: depth }, (_, k) => (
                              <span
                                key={k}
                                className="absolute -top-px bottom-0 w-px bg-gray-200 pointer-events-none"
                                style={{ left: 16 + k * 12 }}
                              />
                            ))}
                            <span className="inline-flex items-center gap-1">
                              {hasChildren ? (
                                <button type="button" onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
                                  className="w-4 h-4 inline-flex items-center justify-center shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60"
                                  title={isExpanded ? '折叠' : '展开'}>
                                  <CompareChevron expanded={isExpanded} />
                                </button>
                              ) : (
                                <span className="w-4 shrink-0" />
                              )}
                              <span>{l?.detail.code || '-'}</span>
                            </span>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-700 truncate max-w-[200px]" title={l?.detail.name || ''}>{l?.detail.name || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{l?.detail.version || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{statusLabel(l?.detail.status)}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{n.key === 'ROOT' ? '-' : (l?.quantity ?? '-')}</td>
                          <td className="w-px bg-gray-200 p-0" />
                          <td
                            className="relative px-2 py-2 text-xs font-medium whitespace-nowrap"
                            style={{ paddingLeft: indent }}
                          >
                            {n.key !== 'ROOT' && depth > 0 && Array.from({ length: depth }, (_, k) => (
                              <span
                                key={k}
                                className="absolute -top-px bottom-0 w-px bg-gray-200 pointer-events-none"
                                style={{ left: 16 + k * 12 }}
                              />
                            ))}
                            <span className="inline-flex items-center gap-1">
                              <span className="w-4 shrink-0" />
                              <span className={versionChanged ? 'font-semibold' : ''}>{r?.detail.code || '-'}</span>
                            </span>
                          </td>
                          <td className={`px-2 py-2 text-xs text-gray-700 truncate max-w-[200px] ${versionChanged ? 'font-semibold' : ''}`} title={r?.detail.name || ''}>{r?.detail.name || '-'}</td>
                          <td className={`px-2 py-2 text-xs text-center ${versionChanged ? 'font-semibold' : 'text-gray-500'}`}>{r?.detail.version || '-'}</td>
                          <td className={`px-2 py-2 text-xs text-center ${statusChanged ? 'font-semibold' : 'text-gray-500'}`}>{statusLabel(r?.detail.status)}</td>
                          <td className={`px-2 py-2 text-xs text-center ${qtyChanged ? 'font-semibold' : 'text-gray-500'}`}>{n.key === 'ROOT' ? '-' : (r?.quantity ?? '-')}</td>
                          <td className="w-px bg-gray-200 p-0" />
                          <td className="px-2 py-2 text-xs text-gray-700">{changeText(n)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
                  </>
              )}
            </div>
          )}
        </div>
      </Modal>

      {detail && (
        <PartDetailModal
          masterId={detail.masterId}
          revisionId={detail.revisionId}
          open={!!detail}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
