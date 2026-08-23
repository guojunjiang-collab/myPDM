import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { previewAttachment } from '../utils/attachmentPreview';
import { boardApi, usersApi, partsApi, documentsApi, configurationApi, mediaApi } from '../services/api';
import { useDataStore } from '../stores/data';
import { Modal, ConfirmModal } from '../components/Modal';
import { toast } from '../components/Toast';
import PartDetailModal from '../components/PartDetailModal';
import DocumentDetailModal from '../components/DocumentDetailModal';
import ArchiveTreeModal from '../components/ArchiveTreeModal';
import ConfigItemDetailModal from '../components/Configuration/ConfigItemDetailModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import TreeToggle from '../components/ui/TreeToggle';
import Dropdown from '../components/ui/Dropdown';
import type { BadgeTone } from '../constants/badges';
import ItemPicker, { typeBadge, StatusTag, type FilterTab } from '../components/ItemPicker';
import { useAuthStore } from '../stores/auth';

/* ================================================================
   Types
   ================================================================ */

interface DashboardItem {
  id: string;
  entity_type: 'part' | 'assembly' | 'component' | 'document' | 'configuration';
  entity_id: string;
  master_id?: string;
  code: string;
  name: string;
  version: string;
  status: string;
  attachment_count?: number;
  /** 生产附件是否含 STP/STEP（零件 3D 预览可用性） */
  has_stp?: boolean;
}

interface FolderNode {
  id: string;
  parent_id: string | null;
  name: string;
  items: DashboardItem[];
  children: FolderNode[];
  shared_from?: { user_id: string; real_name: string; permission: string };
  is_shared?: boolean;
}

interface ShareRecord {
  id: string;
  shared_with_user_id: string;
  shared_with_user: { id: string; username: string; real_name: string } | null;
  permission: string;
  created_at: string;
}

const ENTITY_LABEL: Record<string, string> = { part: '零部件', assembly: '零部件', component: '零部件', document: '图文档', configuration: '构型项' };
const ENTITY_ICON: Record<string, string> = { part: '📦', assembly: '📦', component: '📦', document: '📄', configuration: '⚙️' };

// 零件/部件已统一为「零部件」，旧数据 entity_type 可能仍为 part/assembly
const isComponentType = (t: string) => t === 'component' || t === 'part' || t === 'assembly';

/* ================================================================
   Helpers
   ================================================================ */

function flattenItems(folder: FolderNode): DashboardItem[] {
  return [...folder.items];
}

function findFolderById(folders: FolderNode[], id: string): FolderNode | null {
  for (const f of folders) {
    if (f.id === id) return f;
    const found = findFolderById(f.children, id);
    if (found) return found;
  }
  return null;
}

function getFolderPath(folders: FolderNode[], id: string): string {
  const parts: string[] = [];
  const walk = (list: FolderNode[], trail: string[]) => {
    for (const f of list) {
      if (f.id === id) { parts.push(...trail, f.name); return; }
      walk(f.children, [...trail, f.name]);
    }
  };
  walk(folders, []);
  return parts.join(' / ');
}

/* ================================================================
   Component
   ================================================================ */

export default function Board() {
  const [myFolders, setMyFolders] = useState<FolderNode[]>([]);
  const [sharedFolders, setSharedFolders] = useState<FolderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  /* ---- Modals ---- */
  const [createModal, setCreateModal] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [shareModal, setShareModal] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [removeShareId, setRemoveShareId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; el: HTMLElement } | null>(null);

  /* ---- Data ---- */
  const [usersList, setUsersList] = useState<{ id: string; username: string; real_name: string }[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [workingShares, setWorkingShares] = useState<ShareRecord[]>([]);
  const [isShareDirty, setIsShareDirty] = useState(false);
  const [shareUserId, setShareUserId] = useState('');
  const [sharePermission, setSharePermission] = useState('view');
  const [userSearch, setUserSearch] = useState('');
  const [detailItem, setDetailItem] = useState<DashboardItem | null>(null);
  const [detailComponentId, setDetailComponentId] = useState<string | null>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  /** 预览模式：打开详情弹窗时直达附件 Tab */
  const [previewMode, setPreviewMode] = useState(false);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);

  /* ---- 侧边栏「共享给我的」区域高度（可拖动分隔条调整） ---- */
  const SHARED_PANE_MIN = 80;
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sharedPaneH, setSharedPaneH] = useState<number>(() => {
    const v = Number(localStorage.getItem('board.sharedPaneH'));
    return v >= SHARED_PANE_MIN ? v : 192;
  });

  const handleSharedResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = sharedPaneH;

    const onMove = (ev: PointerEvent) => {
      // 向上拖动 → 共享区域变高
      const sidebarH = sidebarRef.current?.clientHeight ?? window.innerHeight;
      const max = Math.max(SHARED_PANE_MIN, sidebarH - 160);
      const next = Math.min(max, Math.max(SHARED_PANE_MIN, startH + (startY - ev.clientY)));
      setSharedPaneH(next);
    };
    const onUp = () => {
      handle.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setSharedPaneH((h) => { localStorage.setItem('board.sharedPaneH', String(h)); return h; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [sharedPaneH]);

  /* Load */
  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await boardApi.getDashboard();
      const d = res.data;
      setMyFolders(d.folders || []);
      setSharedFolders(d.shared_folders || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (shareModal) loadShares(shareModal); }, [shareModal]);
  useEffect(() => { if (shareModal) usersApi.list({ page_size: 10000 }).then((r) => { const d = r.data; setUsersList(Array.isArray(d) ? d : (d as any)?.items || []); }).catch(() => {}); }, [shareModal]);

  /* Load on mount */
  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  /* Selected folder */
  const allFolders = useMemo(() => [...myFolders, ...sharedFolders], [myFolders, sharedFolders]);
  const selectedFolder = useMemo(() => selectedId ? findFolderById(allFolders, selectedId) : null, [selectedId, allFolders]);
  const selectedItems = useMemo(() => selectedFolder ? flattenItems(selectedFolder) : [], [selectedFolder]);
  const filteredItems = useMemo(() => filterTab === 'all' ? selectedItems : selectedItems.filter((i) => i.entity_type === filterTab), [selectedItems, filterTab]);
  const existingIds = useMemo(() => {
    const ids = new Set(selectedItems.map((i) => i.entity_id));
    selectedItems.forEach((i) => { if (i.master_id) ids.add(i.master_id); });
    return ids;
  }, [selectedItems]);

  /* Count items recursively */
  const countItems = (folder: FolderNode): number => {
    return folder.items.length;
  };

  /* ---- Actions ---- */
  const toggleExpand = (id: string) => setExpandedIds((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleCreate = async () => {
    if (!createName.trim()) return;
    try {
      await boardApi.createFolder({ name: createName.trim(), parent_id: createModal || undefined });
      setCreateModal(null); setCreateName('');
      await loadDashboard();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '创建失败'); }
  };

  const handleRename = async () => {
    if (!renameModal || !renameName.trim()) return;
    try {
      await boardApi.updateFolder(renameModal.id, { name: renameName.trim() });
      setRenameModal(null); await loadDashboard();
    } catch { toast.error('重命名失败'); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await boardApi.deleteFolder(deleteId);
      if (selectedId === deleteId) setSelectedId(null);
      setDeleteId(null); await loadDashboard();
    } catch { toast.error('删除失败'); }
  };

  const handleRemoveSharedFolder = async () => {
    if (!removeShareId) return;
    try {
      await boardApi.removeSharedFolder(removeShareId);
      if (selectedId === removeShareId) setSelectedId(null);
      setRemoveShareId(null); await loadDashboard();
    } catch { toast.error('移除共享失败'); }
  };

  const handleRemoveItem = async (itemId: string) => {
    try { await boardApi.removeItem(itemId); await loadDashboard(); } catch { toast.error('移除失败'); }
  };

  const handleAddItems = async (items: { entity_type: string; entity_id: string }[]) => {
    if (!selectedId) return;
    try { await boardApi.addItems(selectedId, items); setPickerOpen(false); await loadDashboard(); }
    catch (e: any) { toast.error(e?.response?.data?.detail || '关联失败'); }
  };

  const loadShares = async (fid: string) => {
    try {
      const data = (await boardApi.getShares(fid)).data || [];
      setShares(data);
      setWorkingShares(data);
      setIsShareDirty(false);
    } catch { setShares([]); setWorkingShares([]); setIsShareDirty(false); }
  };

  const handleAddShare = () => {
    if (!shareModal || !shareUserId) return;
    const newShare: ShareRecord = {
      id: `pending-${Date.now()}`,
      shared_with_user_id: shareUserId,
      shared_with_user: usersList.find(u => u.id === shareUserId) || null,
      permission: sharePermission,
      created_at: new Date().toISOString(),
    };
    setWorkingShares(prev => [...prev, newShare]);
    setIsShareDirty(true);
    setShareUserId('');
  };

  const handleRemoveShareLocal = (sid: string) => {
    setWorkingShares(prev => prev.filter(s => s.id !== sid));
    setIsShareDirty(true);
  };

  const handleUpdateSharePermissionLocal = (sid: string, permission: string) => {
    setWorkingShares(prev => prev.map(s => s.id === sid ? { ...s, permission } : s));
    setIsShareDirty(true);
  };

  const handleSaveShares = async () => {
    if (!shareModal) return;
    try {
      await boardApi.saveShares(shareModal, workingShares.map(s => ({
        shared_with_user_id: s.shared_with_user_id,
        permission: s.permission,
      })));
      setShareModal(null);
      setShareUserId('');
      setUserSearch('');
      await loadDashboard();
    } catch (e: any) { toast.error(e?.response?.data?.detail || '保存失败'); }
  };

  const handleCancelShares = () => {
    setWorkingShares([...shares]);
    setIsShareDirty(false);
    setShareModal(null);
    setShareUserId('');
    setUserSearch('');
  };

  const canEditFolder = selectedFolder ? !selectedFolder.shared_from || selectedFolder.shared_from?.permission === 'edit' : false;

  const handleViewDetail = (item: DashboardItem) => {
    setPreviewMode(false);
    // 图文档 → DocumentDetailModal；零部件 → 复用零部件管理的 PartDetailModal；构型项 → 复用构型项管理的 ConfigItemDetailModal
    if (item.entity_type === 'document') {
      setDetailDocId(item.entity_id);
      setDetailComponentId(null);
      setDetailItem(null);
    } else if (isComponentType(item.entity_type)) {
      setDetailComponentId(item.master_id || item.entity_id);
      setDetailItem(null);
    } else {
      setDetailItem(item);
      setDetailComponentId(null);
    }
  };

  /** 预览：部件 → 装配体 3D；零件 → STP 附件 3D；图文档 → 附件预览 */
  const handlePreview = async (item: DashboardItem) => {
    if (item.entity_type === 'assembly') {
      // 部件：装配体 3D 预览（装配结构实例，不依赖附件）
      window.open(`/stp-viewer?assembly=${item.entity_id}`, '_blank');
      return;
    }
    if (item.entity_type === 'part') {
      // 零件：找该 revision 的 STP/STEP 附件，打开 3D 查看器
      try {
        const res: any = await partsApi.listAttachments(item.entity_id);
        const atts: any[] = Array.isArray(res) ? res : (res?.items || []);
        const stp = atts.find((a) => /\.(stp|step)$/i.test(a.file_name || ''));
        if (stp) {
          const mt = await mediaApi.token(stp.id, 'gltf');
          window.open(`/stp-viewer?id=${stp.id}&token=${encodeURIComponent(mt)}`, '_blank');
          return;
        }
      } catch { /* 忽略，走 fallback */ }
      // 无 STP 附件：打开详情弹窗直达附件 Tab
      setPreviewMode(true);
      setDetailComponentId(item.master_id || item.entity_id);
      setDetailItem(null);
    } else if (item.entity_type === 'document') {
      // 图文档：直接做附件预览（与附件预览一致——新窗口按格式分发）
      try {
        const res: any = await documentsApi.listAttachments(item.entity_id);
        // documentsApi.listAttachments 返回 axios 响应（未 .then(r => r.data)），兼容两种结构
        const atts: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : (res?.items || []));
        const att = atts[0];
        if (att) {
          await previewAttachment(att.id, att.file_name || '', {
            // 压缩包无法直接预览：明确提示，不打开详情弹窗
            onArchive: () => toast.info('压缩包附件请在图文档详情中查看'),
          });
          return;
        }
        toast.info('该图文档暂无附件可预览');
      } catch {
        toast.error('附件预览失败，请重试');
      }
    }
  };

  /* Tab counts */
  const tabCounts = useMemo(() => ({
    all: selectedItems.length,
    part: selectedItems.filter((i) => i.entity_type === 'part').length,
    assembly: selectedItems.filter((i) => i.entity_type === 'assembly').length,
    document: selectedItems.filter((i) => i.entity_type === 'document').length,
    configuration: selectedItems.filter((i) => i.entity_type === 'configuration').length,
  }), [selectedItems]);

  /* ================================================================
   Render
   ================================================================ */

  if (loading) return <div className="text-[var(--ui-text-secondary)] py-8 text-center">加载中...</div>;

  return (
    <div className="flex h-full gap-4 p-4 bg-[var(--ui-bg-page)]">
      {/* Left: 文件夹树（子卡片直接落在页面底） */}
      <div ref={sidebarRef} className="w-72 shrink-0 flex flex-col">
        <div className="pb-3">
          <Button type="button" size="md" className="w-full" onClick={() => { setCreateModal(''); setCreateName(''); }}>
            + 新建文件夹
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col gap-2.5">
          {/* 子卡① 我的文件夹 */}
          <div className="flex-1 min-h-0 flex flex-col bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm overflow-y-auto">
            <div className="px-3 py-2 text-xs font-medium text-[var(--ui-text-tertiary)] uppercase tracking-wide shrink-0">我的文件夹</div>
            <div className="space-y-0.5">
              {myFolders.length === 0 ? (
                <p className="text-sm text-[var(--ui-text-tertiary)] text-center py-6">暂无文件夹</p>
              ) : (
                myFolders.map((f) => (
                  <BoardTreeNode key={f.id} node={f} depth={0} isShared={false} selectedId={selectedId} expandedIds={expandedIds} onSelect={setSelectedId} onToggle={toggleExpand} onMenu={(id, el) => setMenuAnchor({ id, el })} />
                ))
              )}
            </div>
          </div>
          {sharedFolders.length > 0 && (
            <>
              {/* 可拖动分隔条：调整「我的文件夹 / 共享给我的」高度比例 */}
              <div
                onPointerDown={handleSharedResize}
                title="拖动调整两个区域高度"
                className="group shrink-0 h-3 cursor-row-resize flex items-center justify-center -my-0.5"
              >
                <div className="w-9 h-1 rounded-full bg-[var(--ui-border)] group-hover:bg-primary-500 transition-colors" />
              </div>
              {/* 子卡② 共享给我的 */}
              <div className="shrink-0 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm overflow-y-auto" style={{ height: sharedPaneH }}>
                <div className="px-3 py-2 text-xs font-medium text-[var(--ui-text-tertiary)] uppercase tracking-wide shrink-0">📂 共享给我的</div>
                <div className="space-y-0.5">
                  {sharedFolders.map((f) => (
                    <BoardTreeNode key={`s-${f.id}`} node={f} depth={0} isShared={true} selectedId={selectedId} expandedIds={expandedIds} onSelect={setSelectedId} onToggle={toggleExpand} onMenu={(id, el) => setMenuAnchor({ id, el })} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: 内容区（子卡片直接落在页面底） */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 flex flex-col gap-2.5">
        {selectedFolder ? (
          <>
            {/* 子卡① 头部：路径 */}
            <div className="shrink-0 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm px-5 py-3.5">
              <h2 className="text-sm font-medium text-[var(--ui-text-secondary)]">{getFolderPath(allFolders, selectedFolder.id)}</h2>
            </div>

            {/* 子卡② 工具栏：Tab 筛选（Button 规范）+ 操作按钮 */}
            <div className="shrink-0 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm px-4 py-2.5 flex items-center gap-2">
              <div className="flex gap-2">
                {(['all', 'part', 'assembly', 'document', 'configuration'] as FilterTab[]).map((tab) => (
                  <Button
                    key={tab}
                    size="md"
                    active={filterTab === tab}
                    onClick={() => setFilterTab(tab)}
                  >
                    {tab === 'all' ? `全部 (${tabCounts.all})` : `${typeBadge(tab).label} (${tabCounts[tab]})`}
                  </Button>
                ))}
              </div>
              {canEditFolder && (
                <div className="ml-auto flex gap-2">
                  <Button type="button" size="md" onClick={() => { setCreateModal(selectedFolder.id); setCreateName(''); }}>
                    + 子文件夹
                  </Button>
                  <Button type="button" size="md" onClick={() => setPickerOpen(true)}>
                    + 关联对象
                  </Button>
                </div>
              )}
            </div>

            {/* 子卡③ 内容表格 */}
            <div className="flex-1 min-h-0 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm overflow-auto">
              {filteredItems.length === 0 ? (
                <p className="text-sm text-[var(--ui-text-tertiary)] text-center py-16">暂无关联项目</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                    <tr>
                      <th className="px-5 py-2.5 text-left text-[var(--ui-text-secondary)] font-medium w-28">类型</th>
                      <th className="px-5 py-2.5 text-left text-[var(--ui-text-secondary)] font-medium">编号</th>
                      <th className="px-5 py-2.5 text-left text-[var(--ui-text-secondary)] font-medium">名称</th>
                      <th className="px-5 py-2.5 text-left text-[var(--ui-text-secondary)] font-medium w-20">版本</th>
                      <th className="px-5 py-2.5 text-left text-[var(--ui-text-secondary)] font-medium w-20">状态</th>
                      <th className="px-5 py-2.5 text-right text-[var(--ui-text-secondary)] font-medium w-44">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('button')) return; handleViewDetail(item); }}>
                        <td className="px-5 py-2.5"><Badge size="xs" tone={typeBadge(item.entity_type).tone} label={typeBadge(item.entity_type).label} /></td>
                        <td className="px-5 py-2.5 font-medium text-gray-800">{item.code}</td>
                        <td className="px-5 py-2.5 text-[var(--ui-text-secondary)]">{item.name}</td>
                        <td className="px-5 py-2.5 text-[var(--ui-text-secondary)]">{item.version || '-'}</td>
                        <td className="px-5 py-2.5"><StatusTag status={item.status} /></td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          {isComponentType(item.entity_type) && (
                            <Button
                              type="button"
                              size="xs"
                              className="mr-2"
                              disabled={item.entity_type === 'assembly' ? false : !item.has_stp}
                              title={item.entity_type === 'assembly' ? '装配体 3D 预览' : (item.has_stp ? '3D 预览' : '生产附件无 STP 文件')}
                              onClick={(e) => { e.stopPropagation(); handlePreview(item); }}
                            >3D</Button>
                          )}
                          {item.entity_type === 'document' && (
                            <Button
                              type="button"
                              size="xs"
                              className="mr-2"
                              disabled={!((item.attachment_count ?? 0) > 0)}
                              title={((item.attachment_count ?? 0) > 0) ? '预览附件' : '暂无附件'}
                              onClick={(e) => { e.stopPropagation(); handlePreview(item); }}
                            >预览</Button>
                          )}
                          {canEditFolder && (
                            <Button type="button" variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); handleRemoveItem(item.id); }}>移除</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-sm">
            <div className="text-center text-[var(--ui-text-tertiary)]">
              <div className="text-4xl mb-2">📂</div>
              <p className="text-sm">选择左侧文件夹查看内容</p>
            </div>
          </div>
        )}

        </div>
      </div>


      {/* ---- Context Menu（共享 Dropdown；⋮ 在 BoardTreeNode 组件树深处，用 0 尺寸锚点 span 承接定位） ---- */}
      {menuAnchor && (() => {
        const menuFolder = findFolderById(allFolders, menuAnchor.id);
        const menuIsShared = !!menuFolder?.shared_from;
        const rect = menuAnchor.el.getBoundingClientRect();

        return (
          <Dropdown
            open
            onOpenChange={(v) => { if (!v) setMenuAnchor(null); }}
            align="left"
            trigger={<span className="fixed w-0 h-0" style={{ left: rect.left, top: rect.bottom }} />}
          >
            {menuIsShared ? (
              <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none !text-red-600 hover:!bg-red-50" onClick={() => { setRemoveShareId(menuAnchor.id); setMenuAnchor(null); }}>🚫 移除共享</Button>
            ) : (
              <>
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none" onClick={() => { const f = findFolderById(allFolders, menuAnchor.id); setRenameModal({ id: menuAnchor.id, name: f?.name || '' }); setRenameName(f?.name || ''); setMenuAnchor(null); }}>✏️ 重命名</Button>
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none" onClick={() => { setShareModal(menuAnchor.id); setUserSearch(''); setShareUserId(''); setSharePermission('view'); setMenuAnchor(null); }}>🔗 共享</Button>
                <div className="border-t border-[var(--ui-border)] my-1" />
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none !text-red-600 hover:!bg-red-50" onClick={() => { setDeleteId(menuAnchor.id); setMenuAnchor(null); }}>🗑️ 删除</Button>
              </>
            )}
          </Dropdown>
        );
      })()}

      {/* ---- Rename ---- */}
      <Modal open={!!renameModal} title="重命名文件夹" onClose={() => setRenameModal(null)} width="sm">
        <div className="space-y-4">
          <Input type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenameModal(null)}>取消</Button>
            <Button type="button" onClick={handleRename}>确认</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Create Folder ---- */}
      <Modal open={createModal !== null && createModal !== undefined} title="新建文件夹" onClose={() => setCreateModal(null)} width="sm">
        <div className="space-y-4">
          <Input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="请输入文件夹名称" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreateModal(null)}>取消</Button>
            <Button type="button" onClick={handleCreate}>创建</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Share ---- */}
      <Modal open={!!shareModal} title={`共享文件夹${isShareDirty ? ' (未保存)' : ''}`} onClose={handleCancelShares} width="md">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input type="text" placeholder="搜索用户名/姓名..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="flex-1" />
            <Select value={sharePermission} onChange={(e) => setSharePermission(e.target.value)}>
              <option value="view">只读查看</option>
              <option value="edit">可编辑</option>
            </Select>
          </div>
          <div className="max-h-36 overflow-y-auto border border-[var(--ui-border)] rounded-lg">
            {usersList.filter((u) => !userSearch.trim() || u.username.includes(userSearch) || u.real_name.includes(userSearch)).filter((u) => !workingShares.some((s) => s.shared_with_user_id === u.id)).map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => setShareUserId(u.id)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 transition-colors ${
                  shareUserId === u.id
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'hover:bg-[var(--ui-bg-hover)] text-gray-700'
                }`}
              >
                {u.real_name} ({u.username})
                {shareUserId === u.id && <span className="ml-2 text-xs text-primary-500">✓ 已选中</span>}
              </button>
            ))}
            {usersList.filter((u) => !userSearch.trim() || u.username.includes(userSearch) || u.real_name.includes(userSearch)).filter((u) => !workingShares.some((s) => s.shared_with_user_id === u.id)).length === 0 && (
              <p className="text-center text-sm text-[var(--ui-text-tertiary)] py-4">无匹配用户</p>
            )}
          </div>
          {shareUserId && <div className="flex justify-end"><Button type="button" size="sm" onClick={handleAddShare}>添加到列表</Button></div>}
          {workingShares.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">已共享 ({workingShares.length})</h4>
              <div className="space-y-1">
                {workingShares.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-[var(--ui-bg-subtle)] rounded">
                    <span className="text-sm">{s.shared_with_user?.real_name || '-'}</span>
                    <div className="flex items-center gap-2">
                      <Select size="xs"
                        value={s.permission}
                        onChange={(e) => handleUpdateSharePermissionLocal(s.id, e.target.value)}
                      >
                        <option value="view">只读</option>
                        <option value="edit">可编辑</option>
                      </Select>
                      <Button type="button" variant="danger" size="xs" onClick={() => handleRemoveShareLocal(s.id)}>取消</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Save / Cancel */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ui-border)]">
            <Button type="button" variant="secondary" onClick={handleCancelShares}>取消</Button>
            <Button type="button" onClick={handleSaveShares} disabled={!isShareDirty}>保存</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Item Picker ---- */}
      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={handleAddItems} existingIds={existingIds} />

      {/* ---- 零部件详情：复用零部件管理的 PartDetailModal ---- */}
      <PartDetailModal
        masterId={detailComponentId || ''}
        open={!!detailComponentId}
        onClose={() => setDetailComponentId(null)}
        initialTab={previewMode ? 'attachments' : undefined}
      />

      {detailDocId && (
        <DocumentDetailModal
          open={!!detailDocId}
          revisionId={detailDocId}
          onClose={() => setDetailDocId(null)}
          onSaved={() => {}}
        />
      )}

      {/* ---- 构型项详情：复用构型项管理的 ConfigItemDetailModal ---- */}
      {detailItem?.entity_type === 'configuration' && (
        <ConfigItemDetailModal
          revisionId={detailItem.entity_id}
          open
          onClose={() => setDetailItem(null)}
        />
      )}

      {/* ---- Delete Confirm ---- */}
      <ConfirmModal open={!!deleteId} title="删除文件夹" content="确定要删除该文件夹吗？所有子文件夹和关联项将一并删除。" confirmText="删除" cancelText="取消" type="danger" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />

      {/* ---- Remove Shared Folder Confirm ---- */}
      <ConfirmModal open={!!removeShareId} title="移除共享文件夹" content="确定要移除该共享文件夹吗？将从您的看板中移除该文件夹及其所有子文件夹。" confirmText="移除" cancelText="取消" type="danger" onConfirm={handleRemoveSharedFolder} onCancel={() => setRemoveShareId(null)} />

      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
        />
      )}
    </div>
  );
}

/* ================================================================
   Tree Node Renderer
   ================================================================ */

function BoardTreeNode({
  node, depth, isShared,
  selectedId, expandedIds,
  onSelect, onToggle, onMenu,
}: {
  node: FolderNode; depth: number; isShared: boolean;
  selectedId: string | null; expandedIds: Set<string>;
  onSelect: (id: string) => void; onToggle: (id: string) => void; onMenu: (id: string, el: HTMLElement) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const count = node.items.length;

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer group text-sm transition-colors ${
          isSelected
            ? 'bg-primary-50 text-primary-700'
            : 'hover:bg-[var(--ui-bg-hover)] text-gray-700'
        }`}
        style={{ paddingLeft: `calc(8px + ${depth} * var(--ui-tree-indent))` }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <TreeToggle expanded={isExpanded} onClick={() => onToggle(node.id)} size="sm" />
        ) : (
          <TreeToggle leaf size="sm" />
        )}
        <span className="text-[var(--ui-text-tertiary)]">{isShared ? '📂' : '📁'}</span>
        <span className="flex-1 truncate">{node.name}</span>
        {/* 共享状态标识：仅根级自己的文件夹显示 */}
        {depth === 0 && !isShared && node.is_shared && (
          <span className="text-xs text-blue-500" title="已共享">🔗</span>
        )}
        {isShared && node.shared_from && (
          <span className="text-xs text-[var(--ui-text-tertiary)]">{node.shared_from.real_name}</span>
        )}
        {count > 0 && (
          <Badge size="xs" tone={isSelected ? 'blue' : 'gray'} label={count} />
        )}
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] rounded"
          onClick={(e) => { e.stopPropagation(); onMenu(node.id, e.currentTarget); }}
        >
          ⋮
        </button>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((c) => (
            <BoardTreeNode key={c.id} node={c} depth={depth + 1} isShared={false} selectedId={selectedId} expandedIds={expandedIds} onSelect={onSelect} onToggle={onToggle} onMenu={onMenu} />
          ))}
        </div>
      )}
    </>
  );
}
