import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { bomApi, partsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { BOMTraceItem } from '../../types';

/**
 * 移动端"反查"Tab（只读）：
 * - 父项零部件（bomApi.trace，BOM 反查链）
 * - 被构型项引用（partsApi.whereUsedConfigurations）
 * - 被项目任务引用（partsApi.whereUsedTasks）
 * - 被构型配置引用（partsApi.whereUsedProfiles）
 * 点击父项/任务跳转对应移动路由；构型项/配置暂无可跳深链，仅只读展示。
 */

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

interface ConfigRef {
  config_item_revision_id: string;
  code: string;
  name: string;
  version?: string;
  status?: string;
  is_required?: boolean;
  quantity?: number;
}

interface TaskRef {
  project_id: string;
  project_name: string;
  task: {
    id: string;
    code?: string;
    name: string;
    assignee_name?: string;
    planned_start?: string;
    planned_end?: string;
    status?: string;
  };
}

interface ProfileRef {
  profile_id: string;
  code: string;
  name: string;
  status?: string;
  quantity?: number;
}

function fmtDate(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <span className="px-1.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{count}</span>
      </div>
      {children}
    </div>
  );
}

function RowCard({
  main,
  meta,
  onClick,
}: {
  main: ReactNode;
  meta: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 flex flex-col gap-1 shadow-sm ${
        onClick ? '' : 'cursor-default'
      }`}
    >
      <div className="text-sm font-medium text-gray-900 break-all">{main}</div>
      <div className="text-xs text-gray-500 break-all">{meta}</div>
    </button>
  );
}

interface Props {
  revisionId: string;
  /** 覆盖层模式跳转回调（详情栈内导航）；缺省时走路由 navigate */
  onNavigate?: (to: string) => void;
}

export default function PartWhereUsedTab({ revisionId, onNavigate }: Props) {
  const navigate = useNavigate();

  const [trace, setTrace] = useState<BOMTraceItem[]>([]);
  const [traceLoading, setTraceLoading] = useState(true);
  const [traceError, setTraceError] = useState(false);

  const [cfgs, setCfgs] = useState<ConfigRef[]>([]);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError, setCfgError] = useState(false);

  const [tasks, setTasks] = useState<TaskRef[]>([]);
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskError, setTaskError] = useState(false);

  const [profiles, setProfiles] = useState<ProfileRef[]>([]);
  const [profLoading, setProfLoading] = useState(true);
  const [profError, setProfError] = useState(false);

  useEffect(() => {
    let alive = true;
    bomApi
      .trace('component', revisionId)
      .then((res: any) => {
        if (alive) setTrace((res?.data ?? []) as BOMTraceItem[]);
      })
      .catch(() => {
        if (alive) setTraceError(true);
      })
      .finally(() => {
        if (alive) setTraceLoading(false);
      });
    partsApi
      .whereUsedConfigurations(revisionId)
      .then((d) => {
        if (alive) setCfgs((d ?? []) as ConfigRef[]);
      })
      .catch(() => {
        if (alive) setCfgError(true);
      })
      .finally(() => {
        if (alive) setCfgLoading(false);
      });
    partsApi
      .whereUsedTasks(revisionId)
      .then((d) => {
        if (alive) setTasks((d ?? []) as TaskRef[]);
      })
      .catch(() => {
        if (alive) setTaskError(true);
      })
      .finally(() => {
        if (alive) setTaskLoading(false);
      });
    partsApi
      .whereUsedProfiles(revisionId)
      .then((d) => {
        if (alive) setProfiles((d ?? []) as ProfileRef[]);
      })
      .catch(() => {
        if (alive) setProfError(true);
      })
      .finally(() => {
        if (alive) setProfLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revisionId]);

  const parents = trace
    .map((t) => t.parent_assembly ?? t.parent_part)
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <div className="flex flex-col gap-2">
      <Section title="父项零部件" count={parents.length}>
        {traceLoading ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : traceError ? (
          <p className="text-center text-xs text-red-400 py-3">反查失败，请稍后重试</p>
        ) : parents.length === 0 ? (
          <EmptyState text="暂无父项零部件" />
        ) : (
          parents.map((p, i) => (
            <button
              key={trace[i]?.bom_item_id ?? i}
              onClick={() =>
                p.master_id &&
                (onNavigate
                  ? onNavigate(`/parts/${p.master_id}`)
                  : navigate(`/parts/${p.master_id}`))
              }
              className={`w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm ${
                p.master_id ? '' : 'cursor-default'
              }`}
            >
              {/* 行1：件号(左) + 用量(中) + 版本(中) + 状态(右)——参考 BOM Tab 排版 */}
              <span className="flex items-center min-w-0">
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{p.code}</span>
                <span className="shrink-0 w-8 truncate text-center text-xs text-gray-500">
                  x{trace[i]?.quantity ?? 1}
                </span>
                <span className="shrink-0 w-7 truncate text-center text-xs text-gray-500">{p.version}</span>
                <span className="shrink-0 w-12 flex justify-end">
                  {p.status && <StatusBadge status={p.status} map={STATUS_MAP} />}
                </span>
              </span>
              {/* 行2：名称（反查链无检出人字段，仅显示名称） */}
              <span className="flex items-center min-w-0 mt-0.5">
                <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{p.name}</span>
              </span>
            </button>
          ))
        )}
      </Section>

      <Section title="被构型项引用" count={cfgs.length}>
        {cfgLoading ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : cfgError ? (
          <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>
        ) : cfgs.length === 0 ? (
          <EmptyState text="暂无引用" />
        ) : (
          cfgs.map((r) => (
            <button
              key={r.config_item_revision_id}
              className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm cursor-default"
            >
              {/* 行1：编号 + 用量(中) + 版本(中) + 状态(右)——参考父项零部件排版 */}
              <span className="flex items-center min-w-0">
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{r.code}</span>
                <span className="shrink-0 w-8 truncate text-center text-xs text-gray-500">x{r.quantity ?? 1}</span>
                <span className="shrink-0 w-7 truncate text-center text-xs text-gray-500">{r.version}</span>
                <span className="shrink-0 w-12 flex justify-end">
                  {r.status && <StatusBadge status={r.status} map={STATUS_MAP} />}
                </span>
              </span>
              {/* 行2：名称 + 必选/可选 */}
              <span className="flex items-center min-w-0 mt-0.5">
                <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{r.name}</span>
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-xs ${
                    r.is_required ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {r.is_required ? '必选' : '可选'}
                </span>
              </span>
            </button>
          ))
        )}
      </Section>

      <Section title="被项目任务引用" count={tasks.length}>
        {taskLoading ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : taskError ? (
          <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>
        ) : tasks.length === 0 ? (
          <EmptyState text="暂无引用" />
        ) : (
          tasks.map((r) => (
            <RowCard
              key={r.task.id}
              main={`${r.task.name}${r.task.code ? `（${r.task.code}）` : ''}`}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-600">{r.project_name}</span>
                  {r.task.assignee_name && <span className="text-gray-500">负责人：{r.task.assignee_name}</span>}
                  {r.task.status && <StatusBadge status={r.task.status} map={STATUS_MAP} />}
                  <span className="text-gray-500">
                    {formatMeta([
                      ['开始', fmtDate(r.task.planned_start)],
                      ['完成', fmtDate(r.task.planned_end)],
                    ])}
                  </span>
                </span>
              }
              onClick={() =>
                onNavigate
                  ? onNavigate(`/projects/${r.project_id}`)
                  : navigate(`/projects/${r.project_id}`)
              }
            />
          ))
        )}
      </Section>

      <Section title="被构型配置引用" count={profiles.length}>
        {profLoading ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : profError ? (
          <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>
        ) : profiles.length === 0 ? (
          <EmptyState text="暂无引用" />
        ) : (
          profiles.map((r) => (
            <RowCard
              key={r.profile_id}
              main={`${r.code} ${r.name}`}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  {r.status && <StatusBadge status={r.status} map={STATUS_MAP} />}
                  <span className="text-gray-500">用量 ×{r.quantity ?? 1}</span>
                </span>
              }
            />
          ))
        )}
      </Section>
    </div>
  );
}
