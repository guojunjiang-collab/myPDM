import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import ProfileStatusBadge from './ProfileStatusBadge';
import PartDetailModal from '../PartDetailModal';
import ConfigurationDetailModal from './ConfigurationDetailModal';
import { configurationProfileApi } from '../../services/api';
import { diffProfileTrees } from '../../lib/profileCompare';
import type { ProfileCompareNode, ProfileComparePart, ProfileCompareResult } from '../../lib/profileCompare';
import type { ConfigurationProfile } from '../../types';

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
  none: '',
};

function partChangeText(p: ProfileComparePart): string {
  if (p.change_type === 'add') return '新增';
  if (p.change_type === 'delete') return '删除';
  if (p.change_type === 'modify') {
    const f = p.changed_fields || [];
    const segs: string[] = [];
    if (f.includes('version')) segs.push(`版本 ${p.left?.item_version || '-'}→${p.right?.item_version || '-'}`);
    if (f.includes('quantity')) segs.push(`数量 ${p.left?.quantity ?? '-'}→${p.right?.quantity ?? '-'}`);
    if (f.includes('status')) segs.push(`状态 ${statusLabel(p.left?.item_status)}→${statusLabel(p.right?.item_status)}`);
    return segs.join('、');
  }
  return '';
}
function nodeChangeText(n: ProfileCompareNode): string {
  if (n.change_type === 'add') return '新增';
  if (n.change_type === 'delete') return '删除';
  if (n.change_type === 'modify') {
    if (n.changed_fields?.includes('quantity')) return `数量 ${n.left?.quantity ?? '-'}→${n.right?.quantity ?? '-'}`;
    return '子项变化';
  }
  return '';
}

/** 可搜索的配置选择器 */
function ProfilePicker({ label, options, valueId, onPick }: {
  label: string;
  options: ConfigurationProfile[];
  valueId: string | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === valueId) || null;
  const filtered = options
    .filter((o) => !q.trim() || `${o.code} ${o.name}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 50);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={open ? q : selected ? `${selected.code} - ${selected.name}` : ''}
          placeholder="搜索配置编号或名称..."
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
            {filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onMouseDown={() => { onPick(o.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0 flex items-center gap-2"
              >
                <span className="font-medium">{o.code}</span>
                <span className="text-gray-500">{o.name}</span>
                <span className="ml-auto"><ProfileStatusBadge status={o.status} /></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfileCompareModal({ open, onClose }: Props) {
  const [options, setOptions] = useState<ConfigurationProfile[]>([]);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [result, setResult] = useState<ProfileCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [partMasterId, setPartMasterId] = useState<string | null>(null);
  const [configItemId, setConfigItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(null); setRightId(null); setResult(null); setError(''); setOnlyDiff(false);
    configurationProfileApi.list({ page_size: 100 })
      .then((res) => setOptions(res.data.items || []))
      .catch(() => setOptions([]));
  }, [open]);

  const leftProfile = options.find((o) => o.id === leftId) || null;
  const rightProfile = options.find((o) => o.id === rightId) || null;

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setLoading(true); setError('');
    try {
      const [lr, rr] = await Promise.all([
        configurationProfileApi.get(leftId),
        configurationProfileApi.get(rightId),
      ]);
      const res = diffProfileTrees(lr.data.config_tree || null, rr.data.config_tree || null);
      setResult(res);
      setExpanded(res.root ? new Set([res.root.key]) : new Set());
    } catch {
      setError('对比失败，请重试');
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

  const openDetail = (rowType: 'part' | 'config_item', node: ProfileCompareNode | ProfileComparePart) => {
    if (rowType === 'part') {
      const side = (node as ProfileComparePart).right || (node as ProfileComparePart).left;
      if (side) setPartMasterId(side.item_id);
    } else {
      const side = (node as ProfileCompareNode).right || (node as ProfileCompareNode).left;
      if (side) setConfigItemId(side.id);
    }
  };

  const renderNode = (n: ProfileCompareNode, level: number): React.ReactNode[] => {
    if (onlyDiff && n.change_type === 'none') return [];
    const rows: React.ReactNode[] = [];
    const hasChildren = n.parts.length > 0 || n.children.length > 0;
    const isExpanded = expanded.has(n.key);
    const l = n.left, r = n.right;
    rows.push(
      <tr key={n.key} className={`${rowBg[n.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
        onClick={() => openDetail('config_item', n)}>
        <td className="px-2 py-1 text-xs text-gray-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {'-'.repeat(level)}{level}
          {hasChildren && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(n.key); }}
              className="ml-1 text-gray-400 hover:text-gray-600">{isExpanded ? '▼' : '▶'}</button>
          )}
        </td>
        <td className="px-2 py-1 text-xs font-medium">{l?.code || '-'}</td>
        <td className="px-2 py-1 text-xs text-gray-600">{l?.name || '-'}</td>
        <td className="px-2 py-1 text-xs text-center text-gray-500">{l?.quantity ?? '-'}</td>
        <td className="w-px bg-gray-200 p-0" />
        <td className="px-2 py-1 text-xs font-medium">{r?.code || '-'}</td>
        <td className="px-2 py-1 text-xs text-gray-600">{r?.name || '-'}</td>
        <td className={`px-2 py-1 text-xs text-center ${n.changed_fields?.includes('quantity') ? 'bg-yellow-100' : 'text-gray-500'}`}>{r?.quantity ?? '-'}</td>
        <td className="w-px bg-gray-200 p-0" />
        <td className="px-2 py-1 text-xs text-gray-700">{nodeChangeText(n)}</td>
      </tr>
    );
    if (isExpanded) {
      for (const p of n.parts) {
        if (onlyDiff && p.change_type === 'none') continue;
        const pl = p.left, pr = p.right;
        const chg = new Set(p.changed_fields || []);
        rows.push(
          <tr key={p.key} className={`${rowBg[p.change_type]} border-b border-gray-100 cursor-pointer hover:brightness-95`}
            onClick={() => openDetail('part', p)}>
            <td className="px-2 py-1 text-xs text-gray-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{'-'.repeat(level + 1)}</td>
            <td className="px-2 py-1 text-xs font-mono text-gray-600">{pl?.item_code || '-'}</td>
            <td className="px-2 py-1 text-xs text-gray-600">{pl?.item_name || '-'}</td>
            <td className="px-2 py-1 text-xs text-center text-gray-500">{pl?.quantity ?? '-'}</td>
            <td className="w-px bg-gray-200 p-0" />
            <td className={`px-2 py-1 text-xs font-mono ${chg.has('version') ? 'bg-yellow-100' : 'text-gray-600'}`}>
              {pr?.item_code || '-'}{pr?.item_version ? ` (${pr.item_version})` : ''}
            </td>
            <td className="px-2 py-1 text-xs text-gray-600">{pr?.item_name || '-'}</td>
            <td className={`px-2 py-1 text-xs text-center ${chg.has('quantity') ? 'bg-yellow-100' : 'text-gray-500'}`}>{pr?.quantity ?? '-'}</td>
            <td className="w-px bg-gray-200 p-0" />
            <td className="px-2 py-1 text-xs text-gray-700">{partChangeText(p)}</td>
          </tr>
        );
      }
      for (const c of n.children) rows.push(...renderNode(c, level + 1));
    }
    return rows;
  };

  const summaryBar = useMemo(() => {
    if (!result) return null;
    const { config_item: ci, part: pt } = result.summary;
    return (
      <div className="flex flex-wrap gap-4 mb-3 p-3 bg-gray-50 rounded-lg border text-sm">
        <span>构型项：<span className="text-green-600">新增 {ci.add}</span>　<span className="text-red-600">删除 {ci.delete}</span>　<span className="text-yellow-600">修改 {ci.modify}</span></span>
        <span>零部件：<span className="text-green-600">新增 {pt.add}</span>　<span className="text-red-600">删除 {pt.delete}</span>　<span className="text-yellow-600">修改 {pt.modify}</span></span>
      </div>
    );
  }, [result]);

  const identical = result && result.root &&
    result.summary.config_item.add === 0 && result.summary.config_item.delete === 0 && result.summary.config_item.modify === 0 &&
    result.summary.part.add === 0 && result.summary.part.delete === 0 && result.summary.part.modify === 0;

  return (
    <>
      <Modal open={open} onClose={onClose} title="构型配置对比" width="3xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <ProfilePicker label="左配置" options={options} valueId={leftId} onPick={setLeftId} />
            <ProfilePicker label="右配置" options={options} valueId={rightId} onPick={setRightId} />
          </div>
          {(leftProfile || rightProfile) && (
            <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
              <div>{leftProfile ? <>状态 <ProfileStatusBadge status={leftProfile.status} /> · 架次 {leftProfile.effectivity_start || '-'} ~ {leftProfile.effectivity_end || '-'}</> : ''}</div>
              <div>{rightProfile ? <>状态 <ProfileStatusBadge status={rightProfile.status} /> · 架次 {rightProfile.effectivity_start || '-'} ~ {rightProfile.effectivity_end || '-'}</> : ''}</div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button onClick={handleCompare} disabled={!leftId || !rightId || loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {loading ? '对比中...' : '开始对比'}
            </button>
            {result && (
              <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
                仅显示差异
              </label>
            )}
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

          {result && !result.root && (
            <div className="text-sm text-gray-500 text-center py-6">两侧均无正式配置清单</div>
          )}
          {identical && (
            <div className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">两配置正式清单一致</div>
          )}
          {result && result.root && (
            <>
              {summaryBar}
              <div className="border rounded-lg overflow-auto max-h-[60vh]">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-xs font-medium text-gray-600 border-b">
                      <th className="px-2 py-2 text-left w-14">层级</th>
                      <th colSpan={3} className="px-2 py-2 text-left border-r border-gray-200">左配置</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th colSpan={3} className="px-2 py-2 text-left">右配置</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-2 text-left w-40">变更</th>
                    </tr>
                    <tr className="text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1" />
                      <th className="px-2 py-1 text-left">构型号/件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">构型号/件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-center">数量</th>
                      <th className="w-px bg-gray-200 p-0" />
                      <th className="px-2 py-1 text-left">说明</th>
                    </tr>
                  </thead>
                  <tbody>{renderNode(result.root, 0)}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>

      {partMasterId && (
        <PartDetailModal masterId={partMasterId} open={!!partMasterId} onClose={() => setPartMasterId(null)} />
      )}
      {configItemId && (
        <ConfigurationDetailModal itemId={configItemId} onClose={() => setConfigItemId(null)} />
      )}
    </>
  );
}
