import { useEffect, useState } from 'react';
import { partsApi } from '../../services/api';
import BomWhereUsedTree from '../../pages/BOM/BomWhereUsedTree';
import { getStatusLabel } from '../../pages/BOM/helpers';
import { formatDateTime } from '../../utils/date';

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
      <span className="text-sm font-semibold text-gray-700">{title}</span>
      <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{count}</span>
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
        {cfg.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : cfg.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : cfg.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">构型项件号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
              <th className="px-3 py-2 text-center text-gray-500 font-medium w-24 whitespace-nowrap">可选/必选</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {cfg.data.map((r: any) => (
                <tr key={r.config_item_revision_id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenConfig(r.config_item_revision_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.version || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${r.is_required ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{r.is_required ? '必选' : '可选'}</span>
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
        {tsk.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : tsk.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : tsk.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-32">项目</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-28">任务编号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">任务</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">负责人</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-28">计划开始</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-28">计划完成</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {tsk.data.map((r: any) => (
                <tr key={r.task.id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenTask(r.project_id, r.task)}>
                  <td className="px-3 py-2">{r.project_name}</td>
                  <td className="px-3 py-2 font-medium">{r.task.code || '-'}</td>
                  <td className="px-3 py-2 font-medium">{r.task.name}</td>
                  <td className="px-3 py-2 text-gray-500">{r.task.assignee_name || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{formatDateTime(r.task.planned_start, 'date') || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{formatDateTime(r.task.planned_end, 'date') || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 4) 被构型配置引用 */}
      <Section title="被构型配置引用" count={prof.loading ? '…' : prof.data.length}>
        {prof.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
          : prof.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
          : prof.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
          : (
          <table className="w-full text-sm border rounded">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">配置编号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {prof.data.map((r: any) => (
                <tr key={r.profile_id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => props.onOpenProfile(r.profile_id)}>
                  <td className="px-3 py-2 font-medium">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status)}</td>
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
