import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { documentsApi } from '../../services/api';
import Badge from '../../components/ui/Badge';
import type { BadgeDomain } from '../../constants/badges';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';

/**
 * 移动端"Where-Used"Tab（只读，对齐零部件反查 Tab 的分区 + 卡片风格）：
 * - 被构型项引用（documentsApi.whereUsedConfigurations）
 * - 被零部件引用（documentsApi.whereUsedParts）
 * - 被项目任务引用（documentsApi.whereUsedTasks）
 * - 被 ECO 引用（documentsApi.whereUsedEcos）
 * - 被 ECR 引用（documentsApi.whereUsedEcrs）
 * 零部件/任务/ECO/ECR 可跳转对应移动路由；构型项暂无可跳深链，仅只读展示。
 */

function fmtDate(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function useLazy<T>(fetcher: () => Promise<T[]>, dep: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetcher()
      .then((d) => {
        if (alive) setData(d || []);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dep]);
  return { data, loading, error };
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-[var(--ui-text-primary)]">{title}</span>
        <Badge tone="gray" label={count} size="xs" />
      </div>
      {children}
    </div>
  );
}

function State({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  children: ReactNode;
}) {
  if (loading) return <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>;
  if (error) return <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>;
  if (empty) return <EmptyState text="暂无引用" />;
  return <div className="flex flex-col gap-2">{children}</div>;
}

/** 两行卡片：行1 编号+版本+状态；行2 名称+附加徽标（参考零部件反查排版） */
function RowCard({
  code,
  name,
  version,
  status,
  domain = 'part',
  badge,
  onClick,
}: {
  code: string;
  name?: string;
  version?: string;
  status?: string;
  domain?: BadgeDomain;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 min-h-14 shadow-sm ${
        onClick ? '' : 'cursor-default'
      }`}
    >
      <span className="flex items-center min-w-0">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--ui-text-primary)]">{code}</span>
        <span className="shrink-0 w-7 truncate text-center text-xs text-[var(--ui-text-secondary)]">{version}</span>
        <span className="shrink-0 w-12 flex justify-end">
          {status && <Badge status={status} domain={domain} />}
        </span>
      </span>
      <span className="flex items-center min-w-0 mt-0.5">
        <span className="flex-1 min-w-0 truncate text-xs text-[var(--ui-text-secondary)]">{name}</span>
        {badge}
      </span>
    </button>
  );
}

interface Props {
  revisionId: string;
  /** 覆盖层模式跳转回调（详情栈内导航）；缺省时走路由 navigate */
  onNavigate?: (to: string) => void;
}

export default function DocWhereUsedTab({ revisionId, onNavigate }: Props) {
  const navigate = useNavigate();
  const cfg = useLazy<any>(() => documentsApi.whereUsedConfigurations(revisionId), revisionId);
  const prt = useLazy<any>(() => documentsApi.whereUsedParts(revisionId), revisionId);
  const tsk = useLazy<any>(() => documentsApi.whereUsedTasks(revisionId), revisionId);
  const eco = useLazy<any>(() => documentsApi.whereUsedEcos(revisionId), revisionId);
  const ecr = useLazy<any>(() => documentsApi.whereUsedEcrs(revisionId), revisionId);

  return (
    <div>
      <Section title="被构型项引用" count={cfg.loading ? 0 : cfg.data.length}>
        <State loading={cfg.loading} error={cfg.error} empty={cfg.data.length === 0}>
          {cfg.data.map((r: any) => (
            <RowCard
              key={r.config_item_revision_id}
              code={r.code}
              name={r.name}
              version={r.version}
              status={r.status}
            />
          ))}
        </State>
      </Section>

      <Section title="被零部件引用" count={prt.loading ? 0 : prt.data.length}>
        <State loading={prt.loading} error={prt.error} empty={prt.data.length === 0}>
          {prt.data.map((r: any) => (
            <RowCard
              key={r.master_id}
              code={r.code}
              name={r.name}
              version={r.version}
              status={r.status}
              onClick={() =>
                r.master_id &&
                (onNavigate ? onNavigate(`/parts/${r.master_id}`) : navigate(`/parts/${r.master_id}`))
              }
            />
          ))}
        </State>
      </Section>

      <Section title="被项目任务引用" count={tsk.loading ? 0 : tsk.data.length}>
        <State loading={tsk.loading} error={tsk.error} empty={tsk.data.length === 0}>
          {tsk.data.map((r: any) => (
            <RowCard
              key={r.task.id}
              code={r.task.name}
              name={formatMeta([
                ['项目', r.project_name],
                ['编号', r.task.code],
                ['负责人', r.task.assignee_name],
                ['开始', fmtDate(r.task.planned_start)],
                ['完成', fmtDate(r.task.planned_end)],
              ])}
              status={r.task.status}
              domain="task"
              onClick={() =>
                onNavigate
                  ? onNavigate(`/projects/${r.project_id}`)
                  : navigate(`/projects/${r.project_id}`)
              }
            />
          ))}
        </State>
      </Section>

      <Section title="被 ECO 引用" count={eco.loading ? 0 : eco.data.length}>
        <State loading={eco.loading} error={eco.error} empty={eco.data.length === 0}>
          {eco.data.map((r: any) => (
            <RowCard
              key={r.eco_id}
              code={r.eco_number}
              name={r.title}
              status={r.status}
              domain="eco"
              onClick={() =>
                onNavigate ? onNavigate(`/ec/eco/${r.eco_id}`) : navigate(`/ec/eco/${r.eco_id}`)
              }
            />
          ))}
        </State>
      </Section>

      <Section title="被 ECR 引用" count={ecr.loading ? 0 : ecr.data.length}>
        <State loading={ecr.loading} error={ecr.error} empty={ecr.data.length === 0}>
          {ecr.data.map((r: any) => (
            <RowCard
              key={r.ecr_id}
              code={r.ecr_number}
              name={r.title}
              status={r.status}
              domain="ecr"
              onClick={() =>
                onNavigate ? onNavigate(`/ec/ecr/${r.ecr_id}`) : navigate(`/ec/ecr/${r.ecr_id}`)
              }
            />
          ))}
        </State>
      </Section>
    </div>
  );
}
