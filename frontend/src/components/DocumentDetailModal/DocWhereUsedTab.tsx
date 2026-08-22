import { useEffect, useState } from 'react';
import { documentsApi } from '../../services/api';
import { getStatusLabel } from '../../pages/BOM/helpers';
import { formatDateTime } from '../../utils/date';
import Badge from '../ui/Badge';

interface Props {
  revisionId: string;
  onOpenConfig: (cirId: string) => void;
  onOpenPart: (masterId: string, revisionId: string) => void;
  onOpenTask: (projectId: string, task: any) => void;
  onOpenEco: (ecoId: string) => void;
  onOpenEcr: (ecrId: string) => void;
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
      <Badge tone="gray" label={count} size="xs" />
    </div>
    {children}
  </div>
);

const State = ({ s, children }: any) =>
  s.loading ? <div className="text-gray-400 text-sm py-2">加载中...</div>
    : s.error ? <div className="text-red-500 text-sm py-2">加载失败</div>
    : s.data.length === 0 ? <div className="text-gray-400 text-sm py-2">暂无引用</div>
    : children;

export default function DocWhereUsedTab(props: Props) {
  const { revisionId } = props;
  const cfg = useLazy(() => documentsApi.whereUsedConfigurations(revisionId), revisionId);
  const prt = useLazy(() => documentsApi.whereUsedParts(revisionId), revisionId);
  const tsk = useLazy(() => documentsApi.whereUsedTasks(revisionId), revisionId);
  const eco = useLazy(() => documentsApi.whereUsedEcos(revisionId), revisionId);
  const ecr = useLazy(() => documentsApi.whereUsedEcrs(revisionId), revisionId);
  const th = "px-3 py-2 text-left text-gray-500 font-medium";
  const tbl = "w-full text-sm border rounded";

  return (
    <div className="space-y-2">
      <Section title="被构型项引用" count={cfg.loading ? '…' : cfg.data.length}>
        <State s={cfg}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>构型项件号</th><th className={th}>名称</th>
            <th className={`${th} w-16`}>版本</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {cfg.data.map((r: any) => (
              <tr key={r.config_item_revision_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenConfig(r.config_item_revision_id)}>
                <td className="px-3 py-2 font-medium">{r.code}</td><td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.version || '-'}</td>
                <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status) || '-'}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被零部件引用" count={prt.loading ? '…' : prt.data.length}>
        <State s={prt}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>件号</th><th className={th}>名称</th>
            <th className={`${th} w-16`}>版本</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {prt.data.map((r: any) => (
              <tr key={r.master_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenPart(r.master_id, r.revision_id)}>
                <td className="px-3 py-2 font-medium">{r.code}</td><td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-gray-500">{r.version || '-'}</td>
                <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status) || '-'}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被项目任务引用" count={tsk.loading ? '…' : tsk.data.length}>
        <State s={tsk}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={`${th} w-32`}>项目</th><th className={`${th} w-28`}>任务编号</th><th className={th}>任务</th>
            <th className={`${th} w-20`}>负责人</th>
            <th className={`${th} w-28`}>计划开始</th><th className={`${th} w-28`}>计划完成</th>
            <th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
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
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被 ECO 引用" count={eco.loading ? '…' : eco.data.length}>
        <State s={eco}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>ECO 编号</th><th className={th}>标题</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {eco.data.map((r: any) => (
              <tr key={r.eco_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenEco(r.eco_id)}>
                <td className="px-3 py-2 font-medium">{r.eco_number}</td>
                <td className="px-3 py-2">{r.title}</td>
                <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status) || r.status}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>

      <Section title="被 ECR 引用" count={ecr.loading ? '…' : ecr.data.length}>
        <State s={ecr}>
          <table className={tbl}><thead className="bg-gray-50 border-b"><tr>
            <th className={th}>ECR 编号</th><th className={th}>标题</th><th className={`${th} w-20`}>状态</th>
          </tr></thead><tbody className="divide-y divide-gray-100">
            {ecr.data.map((r: any) => (
              <tr key={r.ecr_id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => props.onOpenEcr(r.ecr_id)}>
                <td className="px-3 py-2 font-medium">{r.ecr_number}</td>
                <td className="px-3 py-2">{r.title}</td>
                <td className="px-3 py-2 text-gray-500">{getStatusLabel(r.status) || r.status}</td>
              </tr>))}
          </tbody></table>
        </State>
      </Section>
    </div>
  );
}
