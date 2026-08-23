import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { boardApi, partsApi, documentsApi, mediaApi } from '../../services/api';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import type { BadgeTone } from '../../constants/badges';
import EmptyState from '../components/EmptyState';
import DetailOverlayStack from '../components/DetailOverlayStack';
import { useDetailOverlay } from '../hooks/useDetailOverlay';
import { openAttachmentInNewTab, isAttachmentPreviewable } from '../components/AttachmentPreview';
import type { PreviewAttachment } from '../components/AttachmentPreview';

/* ================================================================
   看板数据结构（与桌面 pages/Board.tsx 一致，由 GET /api/dashboard/ 返回）
   ================================================================ */

interface DashboardItem {
  id: string;
  entity_type: 'component' | 'part' | 'assembly' | 'document' | 'configuration';
  entity_id: string;
  master_id?: string;
  code: string;
  name: string;
  version: string;
  status: string;
  check_out_user_name?: string;
}

interface FolderNode {
  id: string;
  parent_id: string | null;
  name: string;
  items: DashboardItem[];
  children: FolderNode[];
  is_shared?: boolean;
  shared_from?: { user_id: string; real_name: string; permission: string };
}

// 零件/部件已统一为「零部件」，旧数据 entity_type 可能仍为 part/assembly
const isComponentType = (t: string) => t === 'component' || t === 'part' || t === 'assembly';

// 类型徽标（行1 件号与版本之间）：零件灰 / 部件蓝 / 图文档靛 / 构型项紫（与 entity 域一致）
const ENTITY_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  part: { label: '零件', tone: 'gray' },
  component: { label: '零件', tone: 'gray' },
  assembly: { label: '部件', tone: 'blue' },
  document: { label: '图文档', tone: 'indigo' },
  configuration: { label: '构型项', tone: 'purple' },
};

// 状态徽标（draft/active/frozen/released/obsolete；active 无 domain 映射，tone+label）
const STATUS_TAG: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'blue' },
  active: { label: '有效', tone: 'green' },
  frozen: { label: '冻结', tone: 'orange' },
  released: { label: '发布', tone: 'green' },
  obsolete: { label: '作废', tone: 'red' },
};

type FilterTab = 'all' | 'component' | 'document' | 'configuration';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'component', label: '零部件' },
  { key: 'document', label: '图文档' },
  { key: 'configuration', label: '构型项' },
];

// 会话级持久化 key：看板展开/筛选状态与滚动位置
const BOARD_STATE_KEY = 'mobile.board.state';
const BOARD_SCROLL_KEY = 'mobile.board.scroll';

export default function BoardPage() {
  const [myFolders, setMyFolders] = useState<FolderNode[]>([]);
  const [sharedFolders, setSharedFolders] = useState<FolderNode[]>([]);
  // 会话级持久化：进入详情返回后保留看板状态（展开/筛选/滚动）
  const [filterTab, setFilterTab] = useState<FilterTab>(() => {
    try {
      const raw = sessionStorage.getItem(BOARD_STATE_KEY);
      if (raw) return (JSON.parse(raw).filterTab as FilterTab) ?? 'all';
    } catch {
      /* ignore */
    }
    return 'all';
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const raw = sessionStorage.getItem(BOARD_STATE_KEY);
      if (raw) return (JSON.parse(raw).expanded as Record<string, boolean>) ?? {};
    } catch {
      /* ignore */
    }
    return {};
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const toggleFolder = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] === true) }));
  };

  // 展开/筛选变化时保存
  useEffect(() => {
    try {
      sessionStorage.setItem(BOARD_STATE_KEY, JSON.stringify({ expanded, filterTab }));
    } catch {
      /* ignore */
    }
  }, [expanded, filterTab]);

  // 滚动位置：挂载恢复、卸载保存（点击条目跳详情卸载时记录）
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const st = sessionStorage.getItem(BOARD_SCROLL_KEY);
      if (st && scrollRef.current) scrollRef.current.scrollTop = Number(st);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        if (scrollRef.current) sessionStorage.setItem(BOARD_SCROLL_KEY, String(scrollRef.current.scrollTop));
      } catch {
        /* ignore */
      }
    };
  }, []);

  // 加载看板数据（桌面 loadDashboard 照搬：boardApi.getDashboard）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    boardApi
      .getDashboard()
      .then((res) => {
        if (!alive) return;
        const d = res.data ?? {};
        setMyFolders(d.folders || []);
        setSharedFolders(d.shared_folders || []);
      })
      .catch(() => {
        if (alive) {
          // 失败时清空旧数据，保证错误提示与内容/空态互斥
          setMyFolders([]);
          setSharedFolders([]);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleItemClick = (item: DashboardItem) => {
    // 覆盖层模式：在列表上方打开详情（看板不卸载、展开/滚动位置保留），
    // 跳转目标与桌面版一致：零部件 → 零部件详情（master_id），图文档 → 图文档详情（revision_id）
    if (isComponentType(item.entity_type)) {
      openItemDetail({ kind: 'part', id: item.master_id || item.entity_id });
    } else if (item.entity_type === 'document') {
      openItemDetail({ kind: 'document', id: item.entity_id });
    }
    // configuration：移动端暂无构型详情页，不跳转（详见报告 §4）
  };

  // 条目详情覆盖层栈：看板保持原状，详情叠在上方，详情内跳转逐级入栈返回
  const {
    stack: itemStack,
    openDetail: openItemDetail,
    pushTarget,
    handleDetailNavigate,
  } = useDetailOverlay();

  /* ---------------- 渲染：文件夹按树形结构展开 ---------------- */

  if (loading) return <p className="text-center text-xs text-gray-400 py-3">加载中...</p>;
  if (error) return <p className="text-center text-xs text-red-400 py-3">{error}</p>;

  if (myFolders.length === 0 && sharedFolders.length === 0) {
    return <EmptyState text="暂无文件夹" />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：类型筛选（过滤树中所有层级的条目） */}
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <div className="flex gap-2">
          {FILTER_TABS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilterTab(f.key)}
              className={`min-h-10 px-3 rounded-lg text-xs ${filterTab === f.key ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-4">
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide px-1 mb-1">📁 我的文件夹</h2>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            {myFolders.map((f) => (
              <FolderTreeNode
                key={f.id}
                folder={f}
                shared={false}
                depth={0}
                expanded={expanded}
                onToggle={toggleFolder}
                filterTab={filterTab}
                onItemClick={handleItemClick}
              />
            ))}
          </div>
        </section>
        {sharedFolders.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide px-1 mb-1">📂 共享给我的</h2>
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {sharedFolders.map((f) => (
                <FolderTreeNode
                  key={f.id}
                  folder={f}
                  shared
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  filterTab={filterTab}
                  onItemClick={handleItemClick}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 条目详情覆盖层栈：看板保持原状（展开/筛选/滚动位置全保留），逐级返回 */}
      <DetailOverlayStack stack={itemStack} onNavigate={handleDetailNavigate} pushTarget={pushTarget} />
    </div>
  );
}

/* ================================================================
   文件夹树节点（递归）：缩进 + 竖线 + 展开箭头 + 文件夹行 + 子文件夹/条目
   ================================================================ */

const INDENT = 24;

function FolderTreeNode({
  folder,
  shared,
  depth,
  expanded,
  onToggle,
  filterTab,
  onItemClick,
}: {
  folder: FolderNode;
  shared: boolean;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  filterTab: FilterTab;
  onItemClick: (item: DashboardItem) => void;
}) {
  const items = (filterTab === 'all' ? folder.items : folder.items.filter((i) => (filterTab === 'component' ? isComponentType(i.entity_type) : i.entity_type === filterTab))) as DashboardItem[];
  const hasContent = folder.children.length > 0 || folder.items.length > 0;
  const isOpen = expanded[folder.id] === true; // 默认折叠
  return (
    <>
      <div className="flex items-stretch min-h-11 border-b border-gray-50 last:border-b-0">
        {/* 缩进 + 层级竖线（每级一条，对齐对应祖先箭头区中心，同 BOM 树 i*INDENT + 18） */}
        <span className="relative shrink-0" style={{ width: depth * INDENT }}>
          {depth > 0 &&
            Array.from({ length: depth }).map((_, i) => (
              <span
                key={i}
                className="absolute top-0 bottom-0 border-l border-gray-200"
                style={{ left: i * INDENT + 18 }}
              />
            ))}
        </span>
        {/* 展开箭头（有子文件夹或条目才可展开） */}
        {hasContent ? (
          <button
            type="button"
            aria-label={isOpen ? '折叠' : '展开'}
            onClick={() => onToggle(folder.id)}
            className="shrink-0 w-9 flex items-center justify-center text-gray-500 text-lg"
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="shrink-0 w-9 flex items-center justify-center text-gray-300 text-sm">•</span>
        )}
        {/* 文件夹行（点击切换展开） */}
        <button
          type="button"
          onClick={() => hasContent && onToggle(folder.id)}
          className="flex-1 min-w-0 flex items-center gap-2 text-left pr-3"
        >
          <span className="text-sm shrink-0">{shared ? '📂' : '📁'}</span>
          <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{folder.name}</span>
          {shared && folder.shared_from && (
            <span className="text-xs text-gray-400 shrink-0">{folder.shared_from.real_name}</span>
          )}
        </button>
      </div>
      {isOpen && (
        <>
          {folder.children.map((c) => (
            <FolderTreeNode
              key={c.id}
              folder={c}
              shared={shared || !!c.shared_from}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              filterTab={filterTab}
              onItemClick={onItemClick}
            />
          ))}
          {items.map((i) => (
            <ItemRow key={i.id} item={i} depth={depth + 1} onClick={() => onItemClick(i)} />
          ))}
        </>
      )}
    </>
  );
}

/** 树内条目行（缩进 + 圆点对齐文件夹，两行排版）；零件/部件/图文档行2 最右侧提供「预览」按钮（无可预览附件时不显示） */
function ItemRow({ item, depth, onClick }: { item: DashboardItem; depth: number; onClick: () => void }) {
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  // 预查可预览性：部件（装配模式）恒可预览；零件/旧零件 → 有 STP 附件；图文档 → 有可预览附件
  const [previewable, setPreviewable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setPreviewable(null);
    const check = async (): Promise<boolean> => {
      if (item.entity_type === 'assembly') return true;
      try {
        if (item.entity_type === 'document') {
          const res = await documentsApi.listAttachments(item.entity_id);
          const atts = ((res.data ?? []) as PreviewAttachment[]).filter((a) => a.file_name);
          return atts.some((a) => isAttachmentPreviewable(a.file_name));
        }
        // part / component：STP 附件
        const list = (await partsApi.listAttachments(item.entity_id)) as Array<{ id: string; file_name?: string }>;
        return list.some((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
      } catch {
        return false;
      }
    };
    check().then((v) => {
      if (alive) setPreviewable(v);
    });
    return () => {
      alive = false;
    };
  }, [item.id, item.entity_type, item.entity_id]);

  const onPreview = async (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (previewingId) return;
    setPreviewingId(item.id);
    try {
      if (item.entity_type === 'document') {
        const res = await documentsApi.listAttachments(item.entity_id);
        const atts = ((res.data ?? []) as PreviewAttachment[]).filter((a) => a.file_name);
        const att = atts.find((a) => isAttachmentPreviewable(a.file_name));
        if (!att) {
          window.alert('该图文档暂无可用预览附件');
          return;
        }
        await openAttachmentInNewTab(att);
        return;
      }
      const win = window.open('', '_blank');
      if (item.entity_type === 'assembly') {
        const url = `/stp-viewer?assembly=${item.entity_id}&code=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}`;
        if (win) win.location.href = url;
        return;
      }
      // 零件（part/component）：STP 单模型
      const list = (await partsApi.listAttachments(item.entity_id)) as Array<{ id: string; file_name?: string }>;
      const stp = list.find((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
      if (!stp) {
        window.alert('该零件暂无 STP 三维模型');
        return;
      }
      const t = await mediaApi.token(stp.id, 'gltf');
      const url = `/stp-viewer?id=${encodeURIComponent(stp.id)}&token=${encodeURIComponent(t)}&code=${encodeURIComponent(item.code)}&version=${encodeURIComponent(item.version)}&name=${encodeURIComponent(item.name)}`;
      if (win) win.location.href = url;
    } catch {
      window.alert('预览失败，请稍后重试');
    } finally {
      setPreviewingId(null);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-stretch min-h-11 text-left border-b border-gray-50 last:border-b-0"
    >
      {/* 缩进 + 层级竖线（与文件夹行同构，竖线对齐箭头区中心） */}
      <span className="relative shrink-0" style={{ width: depth * INDENT }}>
        {depth > 0 &&
          Array.from({ length: depth }).map((_, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 border-l border-gray-200"
              style={{ left: i * INDENT + 18 }}
            />
          ))}
      </span>
      {/* 圆点区（与文件夹行的箭头/圆点对齐） */}
      <span className="shrink-0 w-9 flex items-center justify-center text-gray-300 text-sm">•</span>
      <span className="flex-1 min-w-0 flex flex-col justify-center py-1.5 pr-3">
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">{item.code}</span>
          {/* 类型徽标：件号与版本之间（零件/部件/图文档/构型项） */}
          <Badge
            tone={ENTITY_BADGE[item.entity_type]?.tone ?? 'gray'}
            label={ENTITY_BADGE[item.entity_type]?.label ?? '对象'}
            size="xs"
          />
          <span className="shrink-0 text-xs text-gray-500">{item.version}</span>
          <Badge
            tone={STATUS_TAG[item.status]?.tone ?? 'gray'}
            label={STATUS_TAG[item.status]?.label ?? item.status}
          />
        </span>
        <span className="flex items-center gap-2 min-w-0 mt-0.5">
          <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{item.name}</span>
          {/* 检出状态向右靠：与预览按钮成组靠右，间距 gap-2；无按钮时保留不可见同宽占位，排版整齐 */}
          <span className="ml-auto shrink-0 min-w-0 flex items-center gap-2">
            {item.check_out_user_name && (
              <span className="text-xs text-gray-500 truncate">{item.check_out_user_name}</span>
            )}
            {previewable === true ? (
              <Button
                type="button"
                onClick={onPreview}
                disabled={previewingId === item.id}
                variant="primary"
                size="xs"
                className="shrink-0 min-h-8"
              >
                {previewingId === item.id ? '加载中...' : '预览'}
              </Button>
            ) : (
              <span className="invisible shrink-0 px-2 py-0.5 rounded text-xs whitespace-nowrap">预览</span>
            )}
          </span>
        </span>
      </span>
    </button>
  );
}
