import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectApi } from '../../services/projectApi';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { Project, ProjectTask } from '../../types/project';

/* ================================================================
   项目进度移动页（只读）
   - 列表视图（/projects）：项目卡片（编号/名称 + 状态 + 计划起止 + 负责人 + 成员数）
   - 详情视图（/projects/:id）：进度摘要（完成/总数、完成率、最近计划完成）+ 任务列表
   - 甘特图移动端不渲染：任务以「层级缩进 + 日期文本」呈现（brief 要求）
   - 纯只读：无任何编辑/新增入口
   - API 核验（task-14-report §3）：
     · projectApi.listProjects() → GET /api/projects/ → { items: ProjectBrief[] }
     · projectApi.getProject(id)  → GET /api/projects/{id} → ProjectDetail
     · projectApi.listTasks(id)   → GET /api/projects/{id}/tasks → { items: 嵌套任务树 }
   - 视图方案：独立子路由 projects/:id（浏览器返回/深链可用），两级视图共用本文件
     （受「只允许新建一个文件」约束），见 report §4。
   ================================================================ */

const PROJECT_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  待启动: { label: '待启动', cls: 'bg-gray-100 text-gray-500' },
  进行中: { label: '进行中', cls: 'bg-blue-100 text-blue-800' },
  已完成: { label: '已完成', cls: 'bg-green-100 text-green-800' },
  已暂停: { label: '已暂停', cls: 'bg-amber-100 text-amber-800' },
  已归档: { label: '已归档', cls: 'bg-gray-100 text-gray-600' },
};

const TASK_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  未开始: { label: '未开始', cls: 'bg-gray-100 text-gray-600' },
  进行中: { label: '进行中', cls: 'bg-blue-50 text-blue-700' },
  已完成: { label: '已完成', cls: 'bg-green-50 text-green-700' },
  挂起: { label: '挂起', cls: 'bg-amber-50 text-amber-700' },
};

/** GET /api/projects/{id}/tasks 返回嵌套任务树（backend crud_project.get_task_tree），
 *  此处拍平为带层级的行序列，供移动端逐行展示。 */
interface FlatTask {
  task: ProjectTask;
  depth: number;
}

function flattenTasks(roots: ProjectTask[], depth = 0, out: FlatTask[] = []): FlatTask[] {
  for (const t of roots) {
    out.push({ task: t, depth });
    if (t.children?.length) flattenTasks(t.children, depth + 1, out);
  }
  return out;
}

interface TaskStats {
  total: number;
  done: number;
  latestPlannedEnd: string | null;
}

/** 进度摘要：完成/总数（含子任务）+ 最近计划完成（任务树中最晚 planned_end）。
 *  说明：项目与任务的 API 响应均不返回 updated_at（后端模型有该列但未序列化），
 *  故「最近更新时间」以任务树中最晚的计划完成日期呈现（见 report §4 偏离说明）。 */
function taskStats(roots: ProjectTask[]): TaskStats {
  const stats: TaskStats = { total: 0, done: 0, latestPlannedEnd: null };
  const walk = (ts: ProjectTask[]) => {
    for (const t of ts) {
      stats.total += 1;
      if (t.status === '已完成') stats.done += 1;
      if (t.planned_end && (!stats.latestPlannedEnd || t.planned_end > stats.latestPlannedEnd)) {
        stats.latestPlannedEnd = t.planned_end;
      }
      if (t.children?.length) walk(t.children);
    }
  };
  walk(roots);
  return stats;
}

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

interface Props {
  /** 覆盖层模式（详情栈内嵌）传入的项目 id；路由模式缺省时从 /projects/:id 读取 */
  detailId?: string;
  /** 覆盖层模式返回回调（缺省时返回按钮走 navigate(-1)） */
  onBack?: () => void;
}

export default function ProjectsPage({ detailId, onBack }: Props = {}) {
  const navigate = useNavigate();
  const { id: paramId } = useParams<{ id: string }>();
  const id = detailId ?? paramId;

  // 独立路由模式（列表 ↔ /projects/:id 详情同组件切换）：进入详情保存列表滚动位置，
  // 返回列表（全面屏返回手势 / ‹ 均触发 id 变 undefined）恢复——覆盖层模式列表不卸载，天然保留
  const hadDetailRef = useRef(false);
  useEffect(() => {
    if (id) {
      hadDetailRef.current = true;
      return;
    }
    if (hadDetailRef.current) {
      hadDetailRef.current = false;
      const saved = Number(sessionStorage.getItem('mobile.projects.scroll') || '0');
      if (saved > 0) {
        requestAnimationFrame(() => document.querySelector('main')?.scrollTo(0, saved));
      }
    }
  }, [id]);

  /* ---- 列表视图状态 ---- */
  const [projects, setProjects] = useState<Project[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);

  /* ---- 详情视图状态 ---- */
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 列表加载（GET /api/projects/ 一次返回全部项目，无分页参数 → 搜索在客户端过滤）
  useEffect(() => {
    let alive = true;
    setListLoading(true);
    projectApi
      .listProjects()
      .then((res) => {
        const data = (res.data ?? {}) as { items?: Project[] };
        if (alive) {
          setProjects(data.items ?? []);
          setListError(null);
        }
      })
      .catch(() => {
        if (alive) {
          // 失败时清空旧卡片，避免错误提示下方残留上一次成功的数据
          setProjects([]);
          setListError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setListLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 详情加载：项目详情 + 任务树；任一失败即整体错误态（与空态互斥）
  useEffect(() => {
    let alive = true;
    if (!id) return;
    setDetailLoading(true);
    setDetailError(null);
    setProject(null);
    setTasks([]);
    Promise.all([projectApi.getProject(id), projectApi.listTasks(id)])
      .then(([pRes, tRes]) => {
        if (alive) {
          setProject(pRes.data ?? null);
          setTasks(((tRes.data ?? {}) as { items?: ProjectTask[] }).items ?? []);
        }
      })
      .catch(() => {
        if (alive) {
          setProject(null);
          setTasks([]);
          setDetailError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const filtered = useMemo(
    () => projects.filter((p) => !debounced || p.code.includes(debounced) || p.name.includes(debounced)),
    [projects, debounced],
  );

  const stats = useMemo(() => taskStats(tasks), [tasks]);
  const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  /* ---------------- 详情视图（/projects/:id） ---------------- */
  if (id) {
    const title = project ? `${project.code} ${project.name}` : id;
    return (
      <div className="flex flex-col">
        <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
          <div className="flex items-center gap-1 min-h-10">
            <button
              aria-label="返回"
              onClick={() => (onBack ? onBack() : navigate(-1))}
              className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
            >
              ‹
            </button>
            <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
          </div>
        </div>

        {detailLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
        {!detailLoading && detailError && <p className="text-center text-xs text-red-400 py-3">{detailError}</p>}
        {!detailLoading && !detailError && !project && <EmptyState text="未找到项目" />}

        {!detailLoading && !detailError && project && (
          <div className="p-3 flex flex-col gap-3">
            {/* 项目头：状态 + 负责人 + 计划起止 + 创建时间 */}
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <StatusBadge status={project.status} map={PROJECT_STATUS_MAP} />
                <span className="text-xs text-gray-500">负责人 {project.owner_name}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {formatMeta([
                  ['计划', `${project.planned_start || '—'} ~ ${project.planned_end || '—'}`],
                  ['创建时间', fmtDate(project.created_at)],
                ])}
              </div>
            </div>

            {/* 进度摘要：完成/总数 + 完成率 + 最近计划完成 */}
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">进度摘要</div>
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-medium text-primary-600">{percent}%</span>
                <span className="text-xs text-gray-500">任务完成 {stats.done} / {stats.total}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                {formatMeta([
                  ['最近计划完成', stats.latestPlannedEnd ? fmtDate(stats.latestPlannedEnd) : '—'],
                ])}
              </div>
            </div>

            {/* 任务列表（甘特图不渲染：任务 + 日期文本，按层级缩进） */}
            <div className="flex flex-col gap-2">
              <div className="px-1 text-xs text-gray-400">任务列表（{stats.total}）</div>
              {tasks.length === 0 ? (
                <EmptyState text="暂无任务" />
              ) : (
                flatTasks.map(({ task, depth }) => (
                  <div
                    key={task.id}
                    className="bg-white rounded-lg px-4 py-2.5 shadow-sm"
                    style={{ paddingLeft: 16 + depth * 14 }}
                  >
                    <div className="text-sm text-gray-900 break-all">{task.code} {task.name}</div>
                    <div className="mt-1 text-xs text-gray-500 flex flex-wrap items-center gap-2">
                      <StatusBadge status={task.status} map={TASK_STATUS_MAP} />
                      <span>
                        {formatMeta([
                          ['计划', `${task.planned_start || '—'} ~ ${task.planned_end || '—'}`],
                          ['负责人', task.assignee_name || '—'],
                        ])}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- 列表视图（/projects） ---------------- */
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {listLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!listLoading && listError && <p className="text-center text-xs text-red-400 py-3">{listError}</p>}
      {!listLoading && !listError && filtered.length === 0 && <EmptyState text="未找到项目" />}
      <MobileCardList
        items={filtered}
        keyOf={(p) => p.id}
        renderMain={(p) => `${p.code} ${p.name}`}
        renderMeta={(p) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} map={PROJECT_STATUS_MAP} />
            <span>
              {formatMeta([
                ['计划', `${p.planned_start || '—'} ~ ${p.planned_end || '—'}`],
                ['负责人', p.owner_name],
                ['成员', String(p.member_count ?? 0)],
              ])}
            </span>
          </span>
        )}
        onClick={(p) => {
          // 保存列表滚动位置（详情返回时恢复）
          sessionStorage.setItem(
            'mobile.projects.scroll',
            String(document.querySelector('main')?.scrollTop ?? 0)
          );
          navigate(`/projects/${p.id}`);
        }}
      />
    </div>
  );
}
