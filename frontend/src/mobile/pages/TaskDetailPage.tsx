import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { projectApi } from '../../services/projectApi';
import { logsApi, ecrApi, ecoApi, partsApi, documentsApi, mediaApi } from '../../services/api';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import EmptyState from '../components/EmptyState';
import AttachmentPreview, { openAttachmentInNewTab, isAttachmentPreviewable } from '../components/AttachmentPreview';
import type { PreviewAttachment } from '../components/AttachmentPreview';
import { formatMeta } from '../components/formatMeta';
import type { ProjectTask, TaskLink, TaskStatus, TaskPriority, TaskComment } from '../../types/project';

/* ================================================================
   任务详情覆盖层（移动端，只读）：
   - 多个 Tab：概览 / 子任务 / 关联对象 / 操作记录
   - 子任务 Tab 内点击行 → 在覆盖层内部切换到子任务（返回逐级弹出，不涉及路由/history）
   - 关联对象点击 → onNavigate（零部件/图文档/EC 跳转；构型项只读）
   ================================================================ */

const TASK_TYPE_LABEL: Record<string, string> = { 任务: '任务', 里程碑: '里程碑', 评审: '评审' };

/** 任务优先级徽标（高/中/低，中文值无 domain 映射，本地 tone+label） */
const PRIORITY_TAG: Record<TaskPriority, { label: string; tone: 'red' | 'gray' | 'blue' }> = {
  高: { label: '高', tone: 'red' },
  中: { label: '中', tone: 'gray' },
  低: { label: '低', tone: 'blue' },
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

function fmtDateTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

function FieldCard({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="bg-white rounded-lg px-3 py-3 shadow-sm min-h-14">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
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

  const [tab, setTab] = useState<'overview' | 'children' | 'links' | 'comments' | 'logs'>('overview');
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ created_at: string; user_name?: string; action?: string; detail?: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // 评论（桌面任务评论接口：listComments/addComment）
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  useEffect(() => {
    if (tab !== 'comments') return;
    let alive = true;
    setCommentsLoading(true);
    projectApi
      .listComments(projectId, cur.id)
      .then((res) => {
        if (alive) setComments(((res.data ?? {}) as { items?: TaskComment[] }).items ?? []);
      })
      .catch(() => {
        if (alive) setComments([]);
      })
      .finally(() => {
        if (alive) setCommentsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, cur.id, projectId]);

  const sendComment = async () => {
    const content = commentText.trim();
    if (!content || commentSending) return;
    setCommentSending(true);
    try {
      const res = await projectApi.addComment(projectId, cur.id, content);
      const created = (res.data ?? res) as TaskComment;
      setComments((prev) => [...prev, created]);
      setCommentText('');
    } catch {
      window.alert('评论发送失败，请稍后重试');
    } finally {
      setCommentSending(false);
    }
  };

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

  // 快速预览：装配体 → 装配体模式 3D 预览（stp-viewer?assembly=，从装配体预览入口进）；
  // 零件 → STP 附件单模型预览；图文档 → 首个可预览附件
  const isAssembly = (l: TaskLink) =>
    l.entity_type === 'assembly' || (l.entity_type === 'part' && l.entity_kind === 'assembly');
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  // 预查可预览性：装配体（按实际类型）→ 恒可预览；零件 → 有 STP 附件；图文档 → 有可预览附件
  // 无可预览内容不显示预览按钮（避免点击后才提示）
  const [previewableMap, setPreviewableMap] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (tab !== 'links' || links.length === 0) return;
    const targets = links.filter((l) => l.entity_type === 'part' || l.entity_type === 'assembly' || l.entity_type === 'document');
    if (targets.length === 0) return;
    let alive = true;
    const check = async (l: TaskLink): Promise<[string, boolean]> => {
      if (isAssembly(l)) return [l.id, true];
      try {
        if (l.entity_type === 'document') {
          const res = await documentsApi.listAttachments(l.entity_id);
          const atts = ((res.data ?? []) as PreviewAttachment[]).filter((a) => a.file_name);
          return [l.id, atts.some((a) => isAttachmentPreviewable(a.file_name))];
        }
        const list = (await partsApi.listAttachments(l.entity_id)) as Array<{ id: string; file_name?: string }>;
        return [l.id, list.some((a) => /\.(stp|step)$/i.test(a.file_name ?? ''))];
      } catch {
        return [l.id, false];
      }
    };
    Promise.allSettled(targets.map(check)).then((results) => {
      if (!alive) return;
      const map: Record<string, boolean> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') map[targets[i].id] = r.value[1];
      });
      setPreviewableMap(map);
    });
    return () => {
      alive = false;
    };
  }, [tab, links]);
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
      // 装配体：从装配体模式 3D 预览入口进（stp-viewer?assembly=，不直接预览 STP 附件）
      if (isAssembly(l)) {
        const url = `/stp-viewer?assembly=${l.entity_id}&code=${encodeURIComponent(l.entity_code ?? '')}&name=${encodeURIComponent(l.entity_name ?? '')}`;
        const w = window.open('', '_blank');
        if (w) w.location.href = url;
        return;
      }
      // 零件：STP 附件单模型预览
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
    { key: 'comments', label: `评论${comments.length ? ` (${comments.length})` : ''}` },
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
                tab === t.key ? 'bg-[var(--ui-btn-primary-bg)] text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3">
        {/* 概览（卡片式：字段网格 + 时间计划 + 说明） */}
        {tab === 'overview' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <FieldCard label="类型">
                <span>{TASK_TYPE_LABEL[cur.task_type] ?? cur.task_type}</span>
              </FieldCard>
              <FieldCard label="状态">
                <Badge status={cur.status} domain="task" />
              </FieldCard>
              <FieldCard label="优先级">
                <Badge tone={PRIORITY_TAG[cur.priority]?.tone ?? 'gray'} label={PRIORITY_TAG[cur.priority]?.label ?? cur.priority} />
              </FieldCard>
              <FieldCard label="负责人">
                <span>{cur.assignee_name || '—'}</span>
              </FieldCard>
            </div>
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-bold text-gray-900 mb-2">时间计划</div>
              <div className="text-xs text-gray-500 space-y-1">
                <div>
                  <span className="text-gray-400">计划</span>
                  <span className="ml-2">{fmtDate(cur.planned_start)} ~ {fmtDate(cur.planned_end)}</span>
                </div>
                <div>
                  <span className="text-gray-400">实际</span>
                  <span className="ml-2">{fmtDate(cur.actual_start)} ~ {fmtDate(cur.actual_end)}</span>
                </div>
              </div>
            </div>
            {cur.description && (
              <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
                <div className="text-sm font-bold text-gray-900 mb-1.5">说明</div>
                <div className="text-xs text-gray-700 whitespace-pre-wrap break-all">{cur.description}</div>
              </div>
            )}
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
                    <Badge status={c.status} domain="task" />
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
                      <Badge tone="gray" label={secLinks.length} size="xs" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {secLinks.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => openLink(l)}
                          className="w-full text-left bg-white rounded-lg px-4 py-3 min-h-14 shadow-sm"
                        >
                          {/* 行1：编号 + 版本 + 类型徽标（零部件）+ 状态徽标（右） */}
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                              {l.entity_code || l.entity_name || '未知对象'}
                            </span>
                            {l.entity_version && (
                              <span className="shrink-0 text-xs text-gray-400">{l.entity_version}</span>
                            )}
                            {(l.entity_type === 'part' || l.entity_type === 'assembly') && (
                              <Badge
                                tone={isAssembly(l) ? 'blue' : 'gray'}
                                label={isAssembly(l) ? '部件' : '零件'}
                              />
                            )}
                            {l.entity_status && (
                              <Badge status={l.entity_status} />
                            )}
                          </span>
                          {/* 行2：名称/描述（左）+ 预览按钮（右下角，预查确认可预览才显示） */}
                          <span className="mt-1 flex items-center gap-2 min-w-0 min-h-7">
                            <span className="flex-1 min-w-0 truncate text-xs text-gray-500">
                              {l.entity_name || l.entity_remark || ''}
                            </span>
                            {previewableMap[l.id] === true && (
                              <Button
                                type="button"
                                onClick={(e) => onPreview(l, e)}
                                disabled={previewingId === l.id}
                                variant="primary"
                                size="xs"
                                className="shrink-0 min-h-8"
                              >
                                {previewingId === l.id ? '加载中...' : '预览'}
                              </Button>
                            )}
                          </span>
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

        {/* 评论：列表 + 输入框（桌面任务评论接口） */}
        {tab === 'comments' && (
          <div className="flex flex-col gap-3">
            {commentsLoading ? (
              <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
            ) : comments.length === 0 ? (
              <EmptyState text="暂无评论" />
            ) : (
              <div className="flex flex-col gap-2">
                {comments.map((c) => (
                  <div key={c.id} className="bg-white rounded-lg px-4 py-2.5 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{c.user_name || '用户'}</span>
                      <span className="shrink-0 text-xs text-gray-400">{fmtDateTime(c.created_at)}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-all">{c.content}</div>
                  </div>
                ))}
              </div>
            )}
            {/* 输入区 */}
            <div className="bg-white rounded-lg p-2 shadow-sm flex items-end gap-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="写下评论..."
                rows={2}
                className="flex-1 min-w-0 text-sm px-2 py-1.5 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <Button
                onClick={sendComment}
                disabled={!commentText.trim() || commentSending}
                variant="primary"
                size="xs"
                className="shrink-0 min-h-9 px-3 rounded-lg text-sm"
              >
                {commentSending ? '发送中...' : '发送'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
