import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { projectApi } from '../../services/projectApi';
import { logsApi, ecrApi, ecoApi, partsApi, documentsApi, mediaApi } from '../../services/api';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AttachmentPreview, { openAttachmentInNewTab, isAttachmentPreviewable } from '../components/AttachmentPreview';
import type { PreviewAttachment } from '../components/AttachmentPreview';
import { formatMeta } from '../components/formatMeta';
import type { ProjectTask, TaskLink, TaskStatus, TaskPriority } from '../../types/project';

/* ================================================================
   任务详情覆盖层（移动端，只读）：
   - 多个 Tab：概览 / 子任务 / 关联对象 / 操作记录
   - 子任务 Tab 内点击行 → 在覆盖层内部切换到子任务（返回逐级弹出，不涉及路由/history）
   - 关联对象点击 → onNavigate（零部件/图文档/EC 跳转；构型项只读）
   ================================================================ */

const TASK_TYPE_LABEL: Record<string, string> = { 任务: '任务', 里程碑: '里程碑', 评审: '评审' };

const STATUS_MAP: Record<TaskStatus, { label: string; cls: string }> = {
  未开始: { label: '未开始', cls: 'bg-gray-100 text-gray-600' },
  进行中: { label: '进行中', cls: 'bg-blue-50 text-blue-700' },
  已完成: { label: '已完成', cls: 'bg-green-50 text-green-700' },
  挂起: { label: '挂起', cls: 'bg-amber-50 text-amber-700' },
};

const PRIORITY_MAP: Record<TaskPriority, { label: string; cls: string }> = {
  高: { label: '高', cls: 'bg-red-50 text-red-700' },
  中: { label: '中', cls: 'bg-gray-100 text-gray-600' },
  低: { label: '低', cls: 'bg-blue-50 text-blue-700' },
};

/** 通用状态徽标（draft/frozen/released/obsolete，与移动端其它页一致） */
const ENTITY_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

/** 关联对象分区顺序与聚合键 */
const LINK_SECTIONS: Array<{ key: string; title: string; match: (t: string) => boolean }> = [
  { key: 'part', title: '零部件', match: (t) => t === 'part' || t === 'assembly' },
  { key: 'document', title: '图文档', match: (t) => t === 'document' },
  { key: 'ec', title: '变更单', match: (t) => t === 'ec' },
  { key: 'config_item', title: '构型项', match: (t) => t === 'config_item' },
];

function fmtDate(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function OverviewRow({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 break-all">{children}</div>
    </div>
  );
}

interface Props {
  projectId: string;
  task: ProjectTask;
  /** 覆盖层返回回调（缺省 navigate(-1)） */
  onBack?: () => void;
  /** 覆盖层跳转回调（详情栈内导航）；缺省走路由 navigate */
  onNavigate?: (to: string) => void;
  /** 独立路由模式：系统返回弹掉覆盖层哨兵后关闭本地任务覆盖层（详情栈模式不需要） */
  onCloseOverlay?: () => void;
}

export default function TaskDetailPage({ projectId, task: rootTask, onBack, onNavigate, onCloseOverlay }: Props) {
  // 详情栈模式：子任务下钻复用详情栈（Context push → 全面屏手势逐级返回）
  const overlayPush = useDetailOverlayPush();
  // 独立路由模式：子任务内部导航栈 + history 哨兵（弹出时逐级返回）
  const [subStack, setSubStack] = useState<ProjectTask[]>([]);
  const subRef = useRef(0);
  useEffect(() => {
    subRef.current = subStack.length;
  }, [subStack]);
  const cur = subStack.length > 0 ? subStack[subStack.length - 1] : rootTask;

  // 全面屏返回手势：子任务栈非空 → 弹掉一层子任务；否则（独立模式）关闭本地覆盖层；
  // 详情栈模式子任务栈恒空（子任务已入详情栈），本处理不动作，交详情栈逐级弹出
  useEffect(() => {
    const onPop = () => {
      if (subRef.current > 0) {
        setSubStack((prev) => prev.slice(0, -1));
        return;
      }
      if (onCloseOverlay) onCloseOverlay();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onCloseOverlay]);

  /** 点击子任务行：详情栈模式 → 入详情栈（压哨兵）；独立模式 → 内部栈 + 哨兵 */
  const openChild = (c: ProjectTask) => {
    if (overlayPush) {
      overlayPush.push({ kind: 'task', projectId, task: c });
      return;
    }
    setSubStack((prev) => [...prev, c]);
    window.history.pushState({ mobileTaskSub: true }, '');
  };

  const [tab, setTab] = useState<'overview' | 'children' | 'links' | 'logs'>('overview');
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ created_at: string; user_name?: string; action?: string; detail?: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // 关联对象 / 操作记录：跟随当前显示的任务（含子任务切换）
  useEffect(() => {
    if (tab !== 'links') return;
    let alive = true;
    setLinksLoading(true);
    projectApi
      .listLinks(projectId, cur.id)
      .then((res) => {
        if (alive) setLinks(((res.data ?? {}) as { items?: TaskLink[] }).items ?? []);
      })
      .catch(() => {
        if (alive) setLinks([]);
      })
      .finally(() => {
        if (alive) setLinksLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, cur.id, projectId]);

  useEffect(() => {
    if (tab !== 'logs') return;
    let alive = true;
    setLogsLoading(true);
    logsApi
      .list({ target_type: 'project_task', target_id: cur.id, limit: 100 })
      .then((res) => {
        const items = ((res.data ?? {}) as { items?: unknown[] }).items ?? (res.data as unknown[]) ?? [];
        if (alive) setLogs(items as Array<{ created_at: string; user_name?: string; action?: string; detail?: string }>);
      })
      .catch(() => {
        if (alive) setLogs([]);
      })
      .finally(() => {
        if (alive) setLogsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, cur.id]);

  const backClick = () => {
    // 子任务栈非空：回退一层（弹哨兵 → popstate 逐级处理，全面屏手势一致）
    if (subStack.length > 0) {
      window.history.back();
    } else if (onBack) {
      onBack();
    } else if (typeof window !== 'undefined') {
      window.history.back();
    }
  };

  // 关联对象点击：EC 先试 ECR 再试 ECO；零部件/图文档走 onNavigate
  const openLink = async (l: TaskLink) => {
    if (!onNavigate) return;
    if (l.entity_type === 'ec') {
      try {
        await ecrApi.get(l.entity_id);
        onNavigate(`/ec/ecr/${l.entity_id}`);
      } catch {
        try {
          await ecoApi.detail(l.entity_id);
          onNavigate(`/ec/eco/${l.entity_id}`);
        } catch {
          window.alert('无法打开该变更单（ECR/ECO 不存在或无权限）');
        }
      }
      return;
    }
    if (l.entity_type === 'part' || l.entity_type === 'assembly') {
      onNavigate(`/parts/${l.entity_master_id || l.entity_id}`);
      return;
    }
    if (l.entity_type === 'document') {
      onNavigate(`/documents/${l.entity_id}`);
      return;
    }
    // config_item：移动端暂无构型详情，只读
  };

  // 快速预览：零部件/装配 → STP 3D 预览（新标签）；图文档 → 首个可预览附件
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const onPreview = async (l: TaskLink, e: ReactMouseEvent) => {
    e.stopPropagation();
    if (previewingId) return;
    setPreviewingId(l.id);
    try {
      if (l.entity_type === 'document') {
        const res = await documentsApi.listAttachments(l.entity_id);
        const atts = ((res.data ?? []) as PreviewAttachment[]).filter((a) => a.file_name);
        const att = atts.find((a) => isAttachmentPreviewable(a.file_name));
        if (!att) {
          window.alert('该图文档暂无可用预览附件');
          return;
        }
        await openAttachmentInNewTab(att);
        return;
      }
      // 零部件/装配：STP 三维预览（同步占位空标签，异步取 token 后写入，防弹窗拦截）
      if (l.entity_type === 'assembly') {
        const url = `/stp-viewer?assembly=${l.entity_id}&code=${encodeURIComponent(l.entity_code ?? '')}&name=${encodeURIComponent(l.entity_name ?? '')}`;
        const w = window.open('', '_blank');
        if (w) w.location.href = url;
        return;
      }
      if (l.entity_type === 'part') {
        const list = (await partsApi.listAttachments(l.entity_id)) as Array<{ id: string; file_name?: string }>;
        const stp = list.find((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
        if (!stp) {
          window.alert('该零件暂无 STP 三维模型');
          return;
        }
        const t = await mediaApi.token(stp.id, 'gltf');
        const url = `/stp-viewer?id=${encodeURIComponent(stp.id)}&token=${encodeURIComponent(t)}&code=${encodeURIComponent(l.entity_code ?? '')}&version=${encodeURIComponent(l.entity_version ?? '')}&name=${encodeURIComponent(l.entity_name ?? '')}`;
        const w = window.open('', '_blank');
        if (w) w.location.href = url;
      }
    } catch {
      window.alert('预览失败，请重试');
    } finally {
      setPreviewingId(null);
    }
  };

  const TABS: Array<{ key: typeof tab; label: string }> = [
    { key: 'overview', label: '概览' },
    { key: 'children', label: `子任务${cur.children?.length ? ` (${cur.children.length})` : ''}` },
    { key: 'links', label: '关联对象' },
    { key: 'logs', label: '操作记录' },
  ];

  return (
    <div className="flex flex-col">
      {/* 顶部：返回 + 标题 + Tab */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={backClick}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">
            {cur.code} {cur.name}
          </div>
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                tab === t.key ? 'bg-primary-600 text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {/* 概览 */}
        {tab === 'overview' && (
          <div className="bg-white rounded-lg px-4 py-2 shadow-sm">
            <OverviewRow label="类型">{TASK_TYPE_LABEL[cur.task_type] ?? cur.task_type}</OverviewRow>
            <OverviewRow label="状态">
              <StatusBadge status={cur.status} map={STATUS_MAP} />
            </OverviewRow>
            <OverviewRow label="优先级">
              <StatusBadge status={cur.priority} map={PRIORITY_MAP} />
            </OverviewRow>
            <OverviewRow label="负责人">{cur.assignee_name || '—'}</OverviewRow>
            <OverviewRow label="计划">
              {formatMeta([
                ['开始', fmtDate(cur.planned_start)],
                ['完成', fmtDate(cur.planned_end)],
              ])}
            </OverviewRow>
            <OverviewRow label="实际">
              {formatMeta([
                ['开始', fmtDate(cur.actual_start)],
                ['完成', fmtDate(cur.actual_end)],
              ])}
            </OverviewRow>
            {cur.description && <OverviewRow label="说明">{cur.description}</OverviewRow>}
          </div>
        )}

        {/* 子任务（递归树，点击行进入子任务详情） */}
        {tab === 'children' && (
          <div className="flex flex-col gap-2">
            {!cur.children || cur.children.length === 0 ? (
              <EmptyState text="暂无子任务" />
            ) : (
              cur.children.map((c) => (
                <button
                  key={c.id}
                  onClick={() => openChild(c)}
                  className="w-full text-left bg-white rounded-lg px-4 py-2.5 min-h-12 shadow-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                      {c.code} {c.name}
                    </span>
                    <StatusBadge status={c.status} map={STATUS_MAP} />
                  </div>
                  <div className="mt-1 text-xs text-gray-500 flex flex-wrap items-center gap-2">
                    <span>{TASK_TYPE_LABEL[c.task_type] ?? c.task_type}</span>
                    <span>{c.assignee_name || '未分配'}</span>
                    <span>{fmtDate(c.planned_start)} ~ {fmtDate(c.planned_end)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* 关联对象（按数据类型分区展示） */}
        {tab === 'links' && (
          <div className="flex flex-col gap-4">
            {linksLoading ? (
              <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
            ) : links.length === 0 ? (
              <EmptyState text="暂无关联对象" />
            ) : (
              LINK_SECTIONS.map((sec) => {
                const secLinks = links.filter((l) => sec.match(l.entity_type));
                if (secLinks.length === 0) return null;
                return (
                  <section key={sec.key}>
                    <div className="flex items-center gap-1.5 px-1 mb-1.5">
                      <span className="text-sm font-bold text-gray-900">{sec.title}</span>
                      <span className="min-w-5 h-5 px-1.5 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center">
                        {secLinks.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {secLinks.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => openLink(l)}
                          className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                        >
                          {/* 行1：编号 + 预览按钮 + 版本（类型已由分区标题区分） */}
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                              {l.entity_code || l.entity_name || '未知对象'}
                            </span>
                            {(l.entity_type === 'part' || l.entity_type === 'assembly' || l.entity_type === 'document') && (
                              <button
                                type="button"
                                onClick={(e) => onPreview(l, e)}
                                disabled={previewingId === l.id}
                                className="shrink-0 px-2 min-h-7 rounded bg-primary-50 text-primary-600 text-xs font-medium disabled:opacity-60"
                              >
                                {previewingId === l.id ? '加载中...' : '预览'}
                              </button>
                            )}
                            {l.entity_version && (
                              <span className="shrink-0 text-xs text-gray-400">{l.entity_version}</span>
                            )}
                            <span className="shrink-0 text-gray-300">›</span>
                          </span>
                          {/* 行2：名称 + 状态 */}
                          {l.entity_name && (
                            <span className="flex items-center gap-2 min-w-0 mt-1">
                              <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{l.entity_name}</span>
                              {l.entity_status && (
                                <StatusBadge status={l.entity_status} map={ENTITY_STATUS_MAP} />
                              )}
                            </span>
                          )}
                          {/* 行3：备注/描述（有则显示） */}
                          {l.entity_remark && (
                            <div className="mt-1 text-xs text-gray-400 truncate">{l.entity_remark}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        )}

        {/* 操作记录 */}
        {tab === 'logs' && (
          <div className="flex flex-col gap-2">
            {logsLoading ? (
              <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
            ) : logs.length === 0 ? (
              <EmptyState text="暂无操作记录" />
            ) : (
              logs.map((lg, i) => (
                <div key={i} className="bg-white rounded-lg px-4 py-2.5 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">{lg.user_name || '系统'}</span>
                    <span className="shrink-0 text-xs text-gray-400">{fmtDate(lg.created_at)}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-900 break-all">
                    {lg.detail || lg.action || '—'}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
