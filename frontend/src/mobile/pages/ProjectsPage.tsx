import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectApi } from '../../services/projectApi';
import { useDebounced } from '../../hooks/useDebounced';
import { useDetailOverlayPush, useDetailOverlay } from '../hooks/useDetailOverlay';
import { useAuthStore } from '../../stores/auth';
import DetailOverlayStack from '../components/DetailOverlayStack';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import TaskDetailPage from './TaskDetailPage';
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
 *  移动端以可展开/折叠树呈现（默认展开第 1 层级，工具按钮展开各层级）。 */

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

/* 任务树节点：层级缩进 + 展开箭头 + 行内容；点击行打开任务详情。
   当前登录人负责的任务：整行浅主色底 + 名称前主色圆点（高亮标识） */
function TaskTreeNode({
  task,
  depth,
  expanded,
  onToggle,
  onOpen,
  myUserId,
}: {
  task: ProjectTask;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (tid: string) => void;
  onOpen: (task: ProjectTask) => void;
  myUserId?: string | null;
}) {
  const hasChildren = (task.children?.length ?? 0) > 0;
  const isOpen = expanded[task.id] === true;
  const isMine = !!myUserId && task.assignee_id === myUserId;
  return (
    <>
      <div
        className={`rounded-lg shadow-sm flex items-center gap-1 py-2 pr-3 ${isMine ? 'bg-primary-100' : 'bg-white'}`}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <button
          type="button"
          aria-label={hasChildren ? (isOpen ? '折叠' : '展开') : '无子任务'}
          onClick={() => hasChildren && onToggle(task.id)}
          className={`shrink-0 w-7 h-7 flex items-center justify-center text-sm leading-none ${
            hasChildren ? 'text-gray-500' : 'text-gray-300'
          }`}
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : '•'}
        </button>
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="flex-1 min-w-0 flex flex-col justify-center text-left"
        >
          <span className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
              {task.code} {task.name}
            </span>
            <StatusBadge status={task.status} map={TASK_STATUS_MAP} />
          </span>
          <span className="mt-0.5 text-xs text-gray-500 flex flex-wrap items-center gap-2">
            <span>
              {formatMeta([
                ['计划', `${task.planned_start || '—'} ~ ${task.planned_end || '—'}`],
                ['负责人', task.assignee_name || '—'],
              ])}
            </span>
          </span>
        </button>
      </div>
      {hasChildren &&
        isOpen &&
        task.children!.map((c) => (
          <TaskTreeNode
            key={c.id}
            task={c}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpen={onOpen}
            myUserId={myUserId}
          />
        ))}
    </>
  );
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
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  /* ---- 任务树展开状态：默认展开第 1 层级（根任务） ---- */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // 任务加载完成时重置：默认展开根任务（第 1 层级）
    const init: Record<string, boolean> = {};
    for (const t of tasks) init[t.id] = true;
    setExpanded(init);
  }, [tasks]);

  // 任务树最大深度（下拉层级选项自动生成，参考桌面版 maxTreeDepth）
  const maxTreeDepth = useMemo(() => {
    let max = 0;
    const walk = (ts: ProjectTask[], d: number) => {
      for (const t of ts) {
        if (d > max) max = d;
        if (t.children?.length) walk(t.children, d + 1);
      }
    };
    walk(tasks, 0);
    return max;
  }, [tasks]);

  // 展开层级下拉受控值：'collapsed' | 'all' | 数字字符串 | 'custom'（参考桌面版）
  const [expandSel, setExpandSel] = useState<string>('1');
  const [expandOpen, setExpandOpen] = useState(false);
  const expandLabel = useMemo(() => {
    if (expandSel === 'collapsed') return '全部折叠';
    if (expandSel === 'all') return '全部展开';
    if (expandSel === 'custom') return '自定义';
    if (/^\d+$/.test(expandSel)) return `L${expandSel}`;
    return '展开层级';
  }, [expandSel]);
  const handleExpandChange = (v: string) => {
    setExpandSel(v);
    if (v === 'collapsed') expandToLevel(0);
    else if (v === 'all') expandToLevel(null);
    else if (/^\d+$/.test(v)) expandToLevel(Number(v));
    // 'custom'：保持当前展开状态
  };

  /** 展开到指定层级（0=收起全部，null=全部展开） */
  const expandToLevel = (level: number | null) => {
    const next: Record<string, boolean> = {};
    const walk = (ts: ProjectTask[], d: number) => {
      for (const t of ts) {
        next[t.id] = level === null || d < level;
        if (t.children?.length) walk(t.children, d + 1);
      }
    };
    walk(tasks, 0);
    setExpanded(next);
  };

  const toggleTask = (tid: string) => {
    setExpanded((prev) => ({ ...prev, [tid]: !(prev[tid] === true) }));
    // 行内手动展开后下拉显示"自定义"
    setExpandSel('custom');
  };

  /* ---- 任务/关联对象详情：全局详情栈（从零部件反查进入）或本地详情栈（独立路由模式） ---- */
  const overlayPush = useDetailOverlayPush();
  const myUserId = useAuthStore((s) => s.user?.id);
  const localOverlay = useDetailOverlay();
  // 详情栈模式：overlayPush 存在 → 任务详情进全局栈（返回链：任务→项目→零部件→列表）；
  // 独立路由模式 → 进本地详情栈（关联对象跳转也入本地栈，返回逐级回任务详情，不离开项目路由）
  const openTask = (task: ProjectTask) => {
    if (overlayPush && id) {
      overlayPush.push({ kind: 'task', projectId: id, task });
    } else if (id) {
      localOverlay.pushTarget({ kind: 'task', projectId: id, task });
    }
  };

  /** 甘特图入口：全局详情栈（反查进入）或本地详情栈（独立路由） */
  const openGantt = () => {
    if (!id) return;
    if (overlayPush) overlayPush.push({ kind: 'gantt', projectId: id });
    else localOverlay.pushTarget({ kind: 'gantt', projectId: id });
  };

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

            {/* 任务树：默认展开第 1 层级；下拉控件展开各层级/收起；甘特图按钮；行点击打开任务详情（多 Tab） */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs text-gray-400">任务列表（{stats.total}）</span>
                <div className="flex items-center gap-1.5">
                  {maxTreeDepth > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setExpandOpen((o) => !o)}
                        className="w-14 min-h-8 rounded-lg bg-white border border-gray-200 text-xs text-gray-600"
                      >
                        {expandLabel}
                      </button>
                      {expandOpen && (
                        <>
                          {/* 点击外部关闭 */}
                          <div className="fixed inset-0 z-30" onClick={() => setExpandOpen(false)} />
                          <div className="absolute right-0 top-full mt-1 z-40 min-w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                            {(
                              [
                                { value: 'collapsed', label: '全部折叠' },
                                ...Array.from({ length: maxTreeDepth }, (_, i) => i + 1).map((k) => ({
                                  value: String(k),
                                  label: `L${k}`,
                                })),
                                { value: 'all', label: '全部展开' },
                                ...(expandSel === 'custom' ? [{ value: 'custom', label: '自定义' }] : []),
                              ] as Array<{ value: string; label: string }>
                            ).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => {
                                  handleExpandChange(opt.value);
                                  setExpandOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm ${
                                  expandSel === opt.value
                                    ? 'text-primary-600 font-medium bg-primary-50'
                                    : 'text-gray-700'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {/* 甘特图入口（层级下拉右侧） */}
                  <button
                    type="button"
                    onClick={openGantt}
                    className="min-h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-xs text-gray-600"
                  >
                    甘特图
                  </button>
                </div>
              </div>
              {tasks.length === 0 ? (
                <EmptyState text="暂无任务" />
              ) : (
                <div className="flex flex-col gap-1.5">
                  {tasks.map((t) => (
                    <TaskTreeNode
                      key={t.id}
                      task={t}
                      depth={0}
                      expanded={expanded}
                      onToggle={toggleTask}
                      onOpen={openTask}
                      myUserId={myUserId}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 独立路由模式：本地详情栈（任务详情/关联对象跳转都在栈内，返回逐级回任务详情；
            全局详情栈模式不需要——任务/关联对象已在全局栈） */}
        {!overlayPush && (
          <DetailOverlayStack
            stack={localOverlay.stack}
            onNavigate={localOverlay.handleDetailNavigate}
            pushTarget={localOverlay.pushTarget}
          />
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
