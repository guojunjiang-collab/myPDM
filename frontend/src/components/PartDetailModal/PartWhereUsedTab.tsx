import { useEffect, useState } from 'react';
import { partsApi } from '../../services/api';
import BomWhereUsedTree from '../../pages/BOM/BomWhereUsedTree';
import { getStatusLabel } from '../../pages/BOM/helpers';
import { formatDateTime } from '../../utils/date';
import Badge from '../ui/Badge';
import SortableTh from '../ui/SortableTh';
import { useTableSort } from '../../hooks/useTableSort';
import { compareVersions } from '../../constants';

interface Props {
  revisionId: string;
  masterId: string;
  code: string;
  name: string;
  version?: string;
  status?: string;
  onOpenPart: (masterId: string, revisionId?: string) => void;
  onOpenConfig: (configItemRevisionId: string) => void;
  onOpenTask: (projectId: string, task: any) => void;
  onOpenProfile: (profileId: string) => void;
}

function useLazy<T>(fetcher: () => Promise<T[]>, dep: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let c = false; setLoading(true); setError(false);
    fetcher().then(d => { if (!c) setData(d || []); })
      .catch(() => { if (!c) setError(true); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [dep]);
  return { data, loading, error };
}

const Section = ({ title, count, children }: any) => (
  <div className="mb-4">
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[var(--ui-text-secondary)] font-semibold text-sm">{title}</span>
      <Badge tone="gray" label={count} size="xs" />
    </div>
    {children}
  </div>
);

export default function PartWhereUsedTab(props: Props) {
  const { revisionId, masterId, code, name, version, status } = props;
  const [bomState, setBomState] = useState({ loading: true, error: false, empty: false });
  const cfg = useLazy(() => partsApi.whereUsedConfigurations(revisionId), revisionId);
  const tsk = useLazy(() => partsApi.whereUsedTasks(revisionId), revisionId);
  const prof = useLazy(() => partsApi.whereUsedProfiles(revisionId), revisionId);

  // 三个反查表客户端排序
  const cfgSort = useTableSort<any>(cfg.data);
  const tskSort = useTableSort<any>(tsk.data);
  const profSort = useTableSort<any>(prof.data);

  return (
    <div className="space-y-2 overflow-y-auto max-h-full">
      {/* 1) 父项零部件 */}
      <Section title="父项零部件" count={''}>
        <BomWhereUsedTree
          revisionId={revisionId}
          root={{ masterId, revisionId, code, name, version, status }}
          onViewEntity={props.onOpenPart}
          onStateChange={setBomState}
        />
      </Section>

      {/* 2) 被构型项引用 */}
      <Section title="被构型项引用" count={cfg.loading ? '…' : cfg.data.length}>
        {cfg.loading ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">加载中...</div>
          : cfg.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : cfg.data.length === 0 ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
              <SortableTh sortKey="code" active={cfgSort.sortField === 'code'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-left">构型项件号</SortableTh>
              <SortableTh sortKey="name" active={cfgSort.sortField === 'name'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-left">名称</SortableTh>
              <SortableTh sortKey="version" active={cfgSort.sortField === 'version'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-left w-16">版本</SortableTh>
              <SortableTh sortKey="status" active={cfgSort.sortField === 'status'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-left w-20">状态</SortableTh>
              <SortableTh sortKey="is_required" active={cfgSort.sortField === 'is_required'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-center w-24 whitespace-nowrap">可选/必选</SortableTh>
              <SortableTh sortKey="quantity" active={cfgSort.sortField === 'quantity'} direction={cfgSort.sortDirection} onSort={(k) => cfgSort.handleSort(k)} className="text-left w-16">用量</SortableTh>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {cfgSort.sortedData.map((r: any) => (
                <tr key={r.config_item_revision_id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                    onClick={() => props.onOpenConfig(r.config_item_revision_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{r.version || '-'}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{getStatusLabel(r.status)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge tone={r.is_required ? 'blue' : 'gray'} label={r.is_required ? '必选' : '可选'} />
                  </td>
                  <td className="px-3 py-2">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 3) 被项目任务引用 */}
      <Section title="被项目任务引用" count={tsk.loading ? '…' : tsk.data.length}>
        {tsk.loading ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">加载中...</div>
          : tsk.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : tsk.data.length === 0 ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
              <SortableTh sortKey="project_name" active={tskSort.sortField === 'project_name'} direction={tskSort.sortDirection} onSort={(k) => tskSort.handleSort(k)} className="text-left w-32">项目</SortableTh>
              <SortableTh className="text-left w-28">任务编号</SortableTh>
              <SortableTh className="text-left">任务</SortableTh>
              <SortableTh className="text-left w-20">负责人</SortableTh>
              <SortableTh className="text-left w-28">计划开始</SortableTh>
              <SortableTh className="text-left w-28">计划完成</SortableTh>
              <SortableTh className="text-left w-20">状态</SortableTh>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {tskSort.sortedData.map((r: any) => (
                <tr key={r.task.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                    onClick={() => props.onOpenTask(r.project_id, r.task)}>
                  <td className="px-3 py-2">{r.project_name}</td>
                  <td className="px-3 py-2 font-medium">{r.task.code || '-'}</td>
                  <td className="px-3 py-2 font-medium">{r.task.name}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{r.task.assignee_name || '-'}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{formatDateTime(r.task.planned_start, 'date') || '-'}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{formatDateTime(r.task.planned_end, 'date') || '-'}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{r.task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 4) 被构型配置引用 */}
      <Section title="被构型配置引用" count={prof.loading ? '…' : prof.data.length}>
        {prof.loading ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">加载中...</div>
          : prof.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : prof.data.length === 0 ? <div className="text-[var(--ui-text-tertiary)] text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
              <SortableTh sortKey="code" active={profSort.sortField === 'code'} direction={profSort.sortDirection} onSort={(k) => profSort.handleSort(k)} className="text-left">配置编号</SortableTh>
              <SortableTh sortKey="name" active={profSort.sortField === 'name'} direction={profSort.sortDirection} onSort={(k) => profSort.handleSort(k)} className="text-left">名称</SortableTh>
              <SortableTh sortKey="status" active={profSort.sortField === 'status'} direction={profSort.sortDirection} onSort={(k) => profSort.handleSort(k)} className="text-left w-20">状态</SortableTh>
              <SortableTh sortKey="quantity" active={profSort.sortField === 'quantity'} direction={profSort.sortDirection} onSort={(k) => profSort.handleSort(k)} className="text-left w-16">用量</SortableTh>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {profSort.sortedData.map((r: any) => (
                <tr key={r.profile_id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                    onClick={() => props.onOpenProfile(r.profile_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{getStatusLabel(r.status)}</td>
                  <td className="px-3 py-2">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
