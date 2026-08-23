import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import type { BadgeTone } from '../constants/badges';
import { partsApi, documentsApi, configurationApi } from '../services/api';
import { useDataStore } from '../stores/data';

/* ================================================================
   关联项目选择器（用户看板「+ 关联项目」弹窗，项目任务等复用）
   类型筛选：全部 / 零件 / 部件 / 图文档 / 构型项
   ================================================================ */

export type FilterTab = 'all' | 'part' | 'assembly' | 'document' | 'configuration';

/** 类型徽标（胶囊式，符合约定配色） */
export const TYPE_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  part: { label: '零件', tone: 'blue' },
  assembly: { label: '部件', tone: 'purple' },
  document: { label: '图文档', tone: 'gray' },
  configuration: { label: '构型项', tone: 'green' },
  component: { label: '零部件', tone: 'blue' },
};
export const typeBadge = (t: string): { label: string; tone: BadgeTone } => TYPE_BADGE[t] ?? { label: t, tone: 'gray' };

export const STATUS_TAG: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'blue' },
  active: { label: '有效', tone: 'green' },
  frozen: { label: '冻结', tone: 'orange' },
  released: { label: '发布', tone: 'green' },
  obsolete: { label: '作废', tone: 'red' },
};

export const StatusTag = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TAG[status]?.tone ?? 'gray'} label={STATUS_TAG[status]?.label ?? status} />
);

export interface ItemPickerProps {
  open: boolean;
  onClose: () => void;
  /** entity_type: component(零部件, sub 细分零件/部件) | document | configuration */
  onConfirm: (items: { entity_type: string; entity_id: string; sub?: 'part' | 'assembly' }[]) => void;
  existingIds: Set<string>;
}

export default function ItemPicker({ open, onClose, onConfirm, existingIds }: ItemPickerProps) {
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, any>>(new Map());

  /* 服务器数据（弹窗打开时实时拉取，失败时回退到本地缓存） */
  const [srcComponents, setSrcComponents] = useState<any[]>([]);
  const [srcDocuments, setSrcDocuments] = useState<any[]>([]);
  const [srcConfigItems, setSrcConfigItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataWarning, setDataWarning] = useState<string | null>(null);

  const extract = (res: any): any[] => {
    const d = res?.data;
    return Array.isArray(d) ? d : (d?.items || []);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDataLoading(true);
    setDataWarning(null);
    (async () => {
      const [comp, d, c] = await Promise.allSettled([
        partsApi.list({ page_size: 10000, show_all_versions: true }),  // 零部件：所有版本
        documentsApi.list({ page_size: 10000, show_all_versions: true }),
        configurationApi.listItems({ page_size: 10000 }),  // 非brief模式，返回version/status
      ]);
      if (cancelled) return;
      // 每类独立处理：成功用服务器数据，失败回退到本地缓存，互不影响
      const cache = useDataStore.getState();
      const pick = (r: PromiseSettledResult<any>, fallback: any[], label: string): any[] => {
        if (r.status === 'fulfilled') return extract(r.value);
        console.error(`[ItemPicker] 加载${label}失败：`, r.reason);
        return fallback;
      };
      // partsApi.list 直接返回 data（{items,total}），非 axios 响应，需单独解构
      const comps = comp.status === 'fulfilled'
        ? (Array.isArray(comp.value) ? comp.value : (comp.value?.items || []))
        : (console.error('[ItemPicker] 加载零部件失败：', comp.reason), cache.parts);
      setSrcComponents(comps);
      setSrcDocuments(pick(d, cache.documents, '图文档'));
      setSrcConfigItems(pick(c, cache.configItems, '构型项'));
      const failed = [comp, d, c].some((r) => r.status === 'rejected');
      setDataWarning(failed ? '部分数据从服务器加载失败，已使用本地缓存' : null);
      setDataLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const candidates = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const all: any[] = [];
    const seen = new Set<string>();
    // 零部件：按 零件(part)/部件(assembly) 细分（id 取 revision_id，看板存储 revision_id，显示时按关联版本展示；同时检查 master_id 兼容旧数据）
    if (tab === 'all' || tab === 'part' || tab === 'assembly') srcComponents.forEach((p: any) => {
      const sub = p.type === 'assembly' ? 'assembly' : 'part';
      if (tab !== 'all' && tab !== sub) return;
      const id = p.revision_id || p.id; const mid = p.master_id || p.id;
      if (!existingIds.has(id) && !existingIds.has(mid) && !seen.has(id)) { seen.add(id); all.push({ t: 'component', sub, id, code: p.code, name: p.name, version: p.version || '', status: p.status || '' }); }
    });
    if (tab === 'all' || tab === 'document') srcDocuments.forEach((d: any) => { const id = d.id || d.revision_id; if (!existingIds.has(id) && !seen.has(id)) { seen.add(id); all.push({ t: 'document', id, code: d.code, name: d.name, version: d.version || '', status: d.status || '' }); } });
    if (tab === 'all' || tab === 'configuration') srcConfigItems.forEach((c: any) => { const id = c.id || c.revision_id; if (!existingIds.has(id) && !seen.has(id)) { seen.add(id); all.push({ t: 'configuration', id, code: c.code, name: c.name, version: c.version || '', status: c.status || '' }); } });
    return kw ? all.filter((i) => i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw)) : all;
  }, [tab, search, srcComponents, srcDocuments, srcConfigItems, existingIds]);

  const handleConfirm = () => {
    onConfirm(Array.from(selected.values()).map((v) => ({ entity_type: v.t, entity_id: v.id, sub: v.sub })));
    setSelected(new Map()); setSearch(''); setTab('all');
  };

  const selectedList = Array.from(selected.values());

  return (
    <Modal open={open} title="关联项目" onClose={onClose} width="full">
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* Already selected */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-[var(--ui-bg-subtle)] border-b px-4 py-2 text-sm font-medium text-gray-700">已选 ({selectedList.length})</div>
          {selectedList.length === 0 ? (
            <div className="px-4 py-3 text-center text-sm text-[var(--ui-text-tertiary)]">请在下方选择</div>
          ) : (
            <div className="max-h-32 overflow-y-auto">
              <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
                {selectedList.map((item) => (
                  <tr key={item.id}><td className="px-3 py-1.5"><Badge size="xs" tone={typeBadge(item.sub || item.t).tone} label={typeBadge(item.sub || item.t).label} /></td><td className="px-3 py-1.5">{item.code}</td><td className="px-3 py-1.5 text-[var(--ui-text-secondary)]">{item.version || '-'}</td><td className="px-3 py-1.5 text-[var(--ui-text-secondary)]">{item.name}</td><td className="px-3 py-1.5 text-right"><Button type="button" variant="danger" size="xs" onClick={() => { const n = new Map(selected); n.delete(item.id); setSelected(n); }}>✕</Button></td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
        {/* Search + filter */}
        <div className="flex gap-2">
          <Input type="text" placeholder="搜索编号/名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          <div className="flex gap-2">{(['all', 'part', 'assembly', 'document', 'configuration'] as FilterTab[]).map((t) => (
            <Button key={t} size="sm" active={tab === t} onClick={() => setTab(t)}>
              {t === 'all' ? '全部' : typeBadge(t).label}
            </Button>
          ))}</div>
        </div>
        {/* Candidates */}
        {dataWarning && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">{dataWarning}</p>}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0"><div className="max-h-64 overflow-y-auto">
          {dataLoading ? (
            <p className="p-4 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</p>
          ) : candidates.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--ui-text-tertiary)]">无匹配结果</p>
          ) : (
            <table className="w-full text-sm table-fixed"><thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0"><tr>
              <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-24">类型</th>
              <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-48">编号</th>
              <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
              <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">名称</th>
              <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">操作</th>
            </tr></thead><tbody className="divide-y divide-gray-100">
              {candidates.map((item) => (
                <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                  <td className="px-3 py-2"><Badge size="xs" tone={typeBadge(item.sub || item.t).tone} label={typeBadge(item.sub || item.t).label} /></td>
                  <td className="px-3 py-2 font-medium">{item.code}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version || '-'}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2"><StatusTag status={item.status} /></td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">{selected.has(item.id) ? <span className="text-xs text-green-600">已选</span> : <Button type="button" size="xs" onClick={() => setSelected(new Map(selected).set(item.id, item))}>添加</Button>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div></div>
        {/* Bottom */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
          <Button type="button" onClick={handleConfirm} disabled={selectedList.length === 0}>确认关联 ({selectedList.length})</Button>
        </div>
      </div>
    </Modal>
  );
}
