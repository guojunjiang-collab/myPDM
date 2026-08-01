import { useEffect, useMemo, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { Modal } from './Modal';
import PartDetailModal from './PartDetailModal';
import { partsApi, bomApi } from '../services/api';
import type { PartListItem, BOMCompareNode, BOMCompareResponse } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
const statusLabel = (s?: string) => (s ? STATUS_LABEL[s] || s : '-');

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
function PartPicker({ label, valueId, onPick, onSearch }: {
  label: string;
  valueId: string | null;
  onPick: (id: string) => void;
  onSearch: (query: string) => Promise<PartListItem[]>;
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
        const items = await onSearch(query.trim());
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
          value={open ? q : selected ? `${selected.code} - ${selected.name}` : ''}
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
                onMouseDown={() => { onPick(o.revision_id); setSelected(o); setOpen(false); }}
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

export default function PartCompareModal({ open, onClose }: Props) {
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<BOMCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [detail, setDetail] = useState<{ masterId: string; revisionId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(null); setRightId(null);
    setResult(null); setError(''); setOnlyDiff(false);
  }, [open]);

  /** 服务端搜索部件（仅 assembly 类型） */
  const handleSearch = async (query: string): Promise<PartListItem[]> => {
    try {
      const res = await partsApi.list({ search: query, page_size: 50, show_all_versions: true });
      return (res.items || []).filter((i: PartListItem) => i.type === 'assembly');
    } catch {
      return [];
    }
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

    if (expanded.has('ROOT')) {
      const level0Nodes = allNodes.filter((n: BOMCompareNode) => n.level === 0);
      for (const n of level0Nodes) {
        out.push(n);
        if (allNodes.some((c: BOMCompareNode) => c.path.startsWith(n.key + '/')) && expanded.has(n.key)) {
          for (const c of allNodes) {
            if (c.path.startsWith(n.key + '/') && c.path.split('/').length === n.key.split('/').length + 1) {
              out.push(c);
              if (allNodes.some((gc: BOMCompareNode) => gc.path.startsWith(c.key + '/')) && expanded.has(c.key)) {
                for (const gc of allNodes) {
                  if (gc.path.startsWith(c.key + '/') && gc.path.split('/').length === c.key.split('/').length + 1) {
                    out.push(gc);
                    if (allNodes.some((ggc: BOMCompareNode) => ggc.path.startsWith(gc.key + '/')) && expanded.has(gc.key)) {
                      for (const ggc of allNodes) {
                        if (ggc.path.startsWith(gc.key + '/') && ggc.path.split('/').length === gc.key.split('/').length + 1) {
                          out.push(ggc);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
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
      <Modal open={open} onClose={onClose} title="BOM 对比" width="3xl" height="75vh">
        <div className="flex flex-col h-full space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <PartPicker label="左部件" valueId={leftId} onPick={setLeftId} onSearch={handleSearch} />
            <PartPicker label="右部件" valueId={rightId} onPick={setRightId} onSearch={handleSearch} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCompare} disabled={!leftId || !rightId || loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm">
              {loading ? '对比中...' : '开始对比'}
            </button>
            <button
              onClick={() => window.open(`/stp-viewer?compare-left=${leftId}&compare-right=${rightId}`, '_blank')}
              disabled={!leftId || !rightId}
              title="在新标签页中叠加对比两个部件的 3D 模型"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              🧊 3D对比
            </button>
            {result && (
              <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                仅显示差异
              </label>
            )}
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          {result && result.comparison.length === 0 && !identical && (
            <div className="text-sm text-gray-500 text-center py-6">两侧 BOM 均为空</div>
          )}
          {identical && (
            <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">两个部件 BOM 一致</div>
          )}
          {result && result.comparison.length > 0 && (
            <>
              {summaryBar}
              <div className="flex-1 min-h-0 border rounded-lg overflow-auto">
                <table className="w-full text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col />
                    <col className="w-10" />
                    <col className="w-16" />
                    <col className="w-10" />
                    <col className="w-px" />
                    <col className="w-40" />
                  </colgroup>
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-xs font-medium text-gray-600 border-b">
                      <th className="px-2 py-2 text-left">层级</th>
                      <th colSpan={4} className="px-2 py-2 text-left border-r border-gray-200">左部件 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th colSpan={4} className="px-2 py-2 text-left">右部件 BOM</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-2 text-left">变更</th>
                    </tr>
                    <tr className="text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1" />
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-center">版本</th>
                      <th className="px-2 py-1 text-center">状态</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">件号</th>
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
                      return (
                        <tr key={n.key} className={`${rowBg[n.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
                          onClick={() => {
                            const side = n.right || n.left;
                            if (side?.child_master_id && side?.child_revision_id) {
                              setDetail({ masterId: side.child_master_id, revisionId: side.child_revision_id });
                            }
                          }}>
                          <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            {n.level >= 0 ? <>{'-'.repeat(n.level + 1)} {n.level + 1}</> : '0'}
                            {hasChildren && n.key !== 'ROOT' && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
                                className="ml-1 text-gray-400 hover:text-gray-600">{isExpanded ? '▼' : '▶'}</button>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs font-medium">{l?.detail.code || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{l?.detail.version || '-'}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{statusLabel(l?.detail.status)}</td>
                          <td className="px-2 py-2 text-xs text-center text-gray-500">{n.key === 'ROOT' ? '-' : (l?.quantity ?? '-')}</td>
                          <td className="w-px bg-gray-200 p-0" />
                          <td className={`px-2 py-2 text-xs font-medium ${versionChanged ? 'font-semibold' : ''}`}>{r?.detail.code || '-'}</td>
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
