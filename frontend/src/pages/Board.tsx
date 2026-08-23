import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { boardApi, usersApi, partsApi, documentsApi, configurationApi } from '../services/api';
import { useDataStore } from '../stores/data';
import { Modal, ConfirmModal } from '../components/Modal';
import PartDetailModal from '../components/PartDetailModal';
import DocumentDetailModal from '../components/DocumentDetailModal';
import ArchiveTreeModal from '../components/ArchiveTreeModal';
import ConfigItemDetailModal from '../components/Configuration/ConfigItemDetailModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import type { BadgeTone } from '../constants/badges';
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

type FilterTab = 'all' | 'component' | 'document' | 'configuration';

const ENTITY_LABEL: Record<string, string> = { part: '零部件', assembly: '零部件', component: '零部件', document: '图文档', configuration: '构型项' };
const ENTITY_ICON: Record<string, string> = { part: '📦', assembly: '📦', component: '📦', document: '📄', configuration: '⚙️' };

// 零件/部件已统一为「零部件」，旧数据 entity_type 可能仍为 part/assembly
const isComponentType = (t: string) => t === 'component' || t === 'part' || t === 'assembly';

const STATUS_TAG: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'blue' },
  active: { label: '有效', tone: 'green' },
  frozen: { label: '冻结', tone: 'orange' },
  released: { label: '发布', tone: 'green' },
  obsolete: { label: '作废', tone: 'red' },
};

const StatusTag = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TAG[status]?.tone ?? 'gray'} label={STATUS_TAG[status]?.label ?? status} />
);

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
  const menuRef = useRef<HTMLDivElement>(null);

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

  /* Close menu on outside click */
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAnchor(null);
    };
    if (menuAnchor) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuAnchor]);

  /* Selected folder */
  const allFolders = useMemo(() => [...myFolders, ...sharedFolders], [myFolders, sharedFolders]);
  const selectedFolder = useMemo(() => selectedId ? findFolderById(allFolders, selectedId) : null, [selectedId, allFolders]);
  const selectedItems = useMemo(() => selectedFolder ? flattenItems(selectedFolder) : [], [selectedFolder]);
  const filteredItems = useMemo(() => filterTab === 'all' ? selectedItems : selectedItems.filter((i) => filterTab === 'component' ? isComponentType(i.entity_type) : i.entity_type === filterTab), [selectedItems, filterTab]);
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
    } catch (e: any) { alert(e?.response?.data?.detail || '创建失败'); }
  };

  const handleRename = async () => {
    if (!renameModal || !renameName.trim()) return;
    try {
      await boardApi.updateFolder(renameModal.id, { name: renameName.trim() });
      setRenameModal(null); await loadDashboard();
    } catch { alert('重命名失败'); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await boardApi.deleteFolder(deleteId);
      if (selectedId === deleteId) setSelectedId(null);
      setDeleteId(null); await loadDashboard();
    } catch { alert('删除失败'); }
  };

  const handleRemoveSharedFolder = async () => {
    if (!removeShareId) return;
    try {
      await boardApi.removeSharedFolder(removeShareId);
      if (selectedId === removeShareId) setSelectedId(null);
      setRemoveShareId(null); await loadDashboard();
    } catch { alert('移除共享失败'); }
  };

  const handleRemoveItem = async (itemId: string) => {
    try { await boardApi.removeItem(itemId); await loadDashboard(); } catch { alert('移除失败'); }
  };

  const handleAddItems = async (items: { entity_type: string; entity_id: string }[]) => {
    if (!selectedId) return;
    try { await boardApi.addItems(selectedId, items); setPickerOpen(false); await loadDashboard(); }
    catch (e: any) { alert(e?.response?.data?.detail || '关联失败'); }
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
    } catch (e: any) { alert(e?.response?.data?.detail || '保存失败'); }
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

  /* Tab counts */
  const tabCounts = useMemo(() => ({
    all: selectedItems.length,
    component: selectedItems.filter((i) => isComponentType(i.entity_type)).length,
    document: selectedItems.filter((i) => i.entity_type === 'document').length,
    configuration: selectedItems.filter((i) => i.entity_type === 'configuration').length,
  }), [selectedItems]);

  /* ================================================================
   Render
   ================================================================ */

  if (loading) return <div className="text-gray-500 py-8 text-center">加载中...</div>;

  return (
    <div className="flex h-full">
      {/* Left: Folder Tree */}
      <div ref={sidebarRef} className="w-72 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-2 pt-2 pb-1">
          <Button type="button" size="sm" className="w-full" onClick={() => { setCreateModal(''); setCreateName(''); }}>
            + 新建文件夹
          </Button>
        </div>
        <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">我的文件夹</div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
          {myFolders.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">暂无文件夹</p>
          ) : (
            <div className="space-y-0.5">
              {myFolders.map((f) => (
                <BoardTreeNode key={f.id} node={f} depth={0} isShared={false} selectedId={selectedId} expandedIds={expandedIds} onSelect={setSelectedId} onToggle={toggleExpand} onMenu={(id, el) => setMenuAnchor({ id, el })} />
              ))}
            </div>
          )}
        </div>
        {sharedFolders.length > 0 && (
          <>
            {/* 可拖动分隔条：调整「共享给我的」区域高度 */}
            <div
              onPointerDown={handleSharedResize}
              title="拖动调整高度"
              className="group shrink-0 h-px cursor-row-resize bg-gray-200 hover:bg-primary-400 active:bg-primary-500 transition-colors relative"
            >
              {/* 视觉 1px，热区上下各扩 3px 便于拖动 */}
              <div className="absolute inset-x-0 -top-[3px] -bottom-[3px]" />
            </div>
            <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide shrink-0">📂 共享给我的</div>
            <div className="shrink-0 overflow-y-auto px-2 pb-2" style={{ height: sharedPaneH }}>
              <div className="space-y-0.5">
                {sharedFolders.map((f) => (
                  <BoardTreeNode key={`s-${f.id}`} node={f} depth={0} isShared={true} selectedId={selectedId} expandedIds={expandedIds} onSelect={setSelectedId} onToggle={toggleExpand} onMenu={(id, el) => setMenuAnchor({ id, el })} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Right: Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFolder ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-sm font-medium text-gray-500 mb-2">{getFolderPath(allFolders, selectedFolder.id)}</h2>
              {canEditFolder && (
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setCreateModal(selectedFolder.id); setCreateName(''); }}>
                    + 子文件夹
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                    + 关联项目
                  </Button>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="px-6 flex gap-0 border-b border-gray-200">
              {(['all', 'component', 'document', 'configuration'] as FilterTab[]).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
                    filterTab === tab
                      ? 'border-primary-500 text-primary-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'all' ? `全部 (${tabCounts.all})` : `${ENTITY_LABEL[tab]} (${tabCounts[tab]})`}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {filteredItems.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-16">暂无关联项目</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-5 py-2.5 text-left text-gray-500 font-medium w-28">类型</th>
                      <th className="px-5 py-2.5 text-left text-gray-500 font-medium">编号</th>
                      <th className="px-5 py-2.5 text-left text-gray-500 font-medium">名称</th>
                      <th className="px-5 py-2.5 text-left text-gray-500 font-medium w-20">版本</th>
                      <th className="px-5 py-2.5 text-left text-gray-500 font-medium w-20">状态</th>
                      {canEditFolder && <th className="px-5 py-2.5 text-right text-gray-500 font-medium w-20">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleViewDetail(item)}>
                        <td className="px-5 py-2.5">
                          <span className="mr-1">{ENTITY_ICON[item.entity_type]}</span>
                          <span className="text-xs text-gray-500">{ENTITY_LABEL[item.entity_type]}</span>
                        </td>
                        <td className="px-5 py-2.5 font-medium text-gray-800">{item.code}</td>
                        <td className="px-5 py-2.5 text-gray-600">{item.name}</td>
                        <td className="px-5 py-2.5 text-gray-500">{item.version || '-'}</td>
                        <td className="px-5 py-2.5"><StatusTag status={item.status} /></td>
                        {canEditFolder && (
                          <td className="px-5 py-2.5 text-right">
                            <Button type="button" variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); handleRemoveItem(item.id); }}>移除</Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-2">📂</div>
              <p className="text-sm">选择左侧文件夹查看内容</p>
            </div>
          </div>
        )}

      </div>


      {/* ---- Context Menu ---- */}
      {menuAnchor && (() => {
        const menuFolder = findFolderById(allFolders, menuAnchor.id);
        const menuIsShared = !!menuFolder?.shared_from;

        return (
          <div ref={menuRef} className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[120px]" style={{ left: menuAnchor.el.getBoundingClientRect().left, top: menuAnchor.el.getBoundingClientRect().bottom + 4 }}>
            {menuIsShared ? (
              <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none !text-red-600 hover:!bg-red-50" onClick={() => { setRemoveShareId(menuAnchor.id); setMenuAnchor(null); }}>🚫 移除共享</Button>
            ) : (
              <>
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none" onClick={() => { const f = findFolderById(allFolders, menuAnchor.id); setRenameModal({ id: menuAnchor.id, name: f?.name || '' }); setRenameName(f?.name || ''); setMenuAnchor(null); }}>✏️ 重命名</Button>
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none" onClick={() => { setShareModal(menuAnchor.id); setUserSearch(''); setShareUserId(''); setSharePermission('view'); setMenuAnchor(null); }}>🔗 共享</Button>
                <div className="border-t border-gray-100 my-1" />
                <Button type="button" variant="ghost" size="sm" className="w-full !justify-start rounded-none !text-red-600 hover:!bg-red-50" onClick={() => { setDeleteId(menuAnchor.id); setMenuAnchor(null); }}>🗑️ 删除</Button>
              </>
            )}
          </div>
        );
      })()}

      {/* ---- Rename ---- */}
      <Modal open={!!renameModal} title="重命名文件夹" onClose={() => setRenameModal(null)} width="sm">
        <div className="space-y-4">
          <input type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenameModal(null)}>取消</Button>
            <Button type="button" onClick={handleRename}>确认</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Create Folder ---- */}
      <Modal open={createModal !== null && createModal !== undefined} title="新建文件夹" onClose={() => setCreateModal(null)} width="sm">
        <div className="space-y-4">
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="请输入文件夹名称" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
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
            <input type="text" placeholder="搜索用户名/姓名..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
            <select value={sharePermission} onChange={(e) => setSharePermission(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="view">只读查看</option>
              <option value="edit">可编辑</option>
            </select>
          </div>
          <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg">
            {usersList.filter((u) => !userSearch.trim() || u.username.includes(userSearch) || u.real_name.includes(userSearch)).filter((u) => !workingShares.some((s) => s.shared_with_user_id === u.id)).map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => setShareUserId(u.id)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 transition-colors ${
                  shareUserId === u.id
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'hover:bg-gray-50 text-gray-700'
                }`}
              >
                {u.real_name} ({u.username})
                {shareUserId === u.id && <span className="ml-2 text-xs text-primary-500">✓ 已选中</span>}
              </button>
            ))}
            {usersList.filter((u) => !userSearch.trim() || u.username.includes(userSearch) || u.real_name.includes(userSearch)).filter((u) => !workingShares.some((s) => s.shared_with_user_id === u.id)).length === 0 && (
              <p className="text-center text-sm text-gray-400 py-4">无匹配用户</p>
            )}
          </div>
          {shareUserId && <div className="flex justify-end"><Button type="button" size="sm" onClick={handleAddShare}>添加到列表</Button></div>}
          {workingShares.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">已共享 ({workingShares.length})</h4>
              <div className="space-y-1">
                {workingShares.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded">
                    <span className="text-sm">{s.shared_with_user?.real_name || '-'}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={s.permission}
                        onChange={(e) => handleUpdateSharePermissionLocal(s.id, e.target.value)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="view">只读</option>
                        <option value="edit">可编辑</option>
                      </select>
                      <Button type="button" variant="danger" size="xs" onClick={() => handleRemoveShareLocal(s.id)}>取消</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Save / Cancel */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
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
            : 'hover:bg-gray-100 text-gray-700'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(node.id); }} className="w-3.5 flex items-center justify-center text-gray-400 hover:text-gray-600 text-xs">
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <span className="text-gray-400">{isShared ? '📂' : '📁'}</span>
        <span className="flex-1 truncate">{node.name}</span>
        {/* 共享状态标识：仅根级自己的文件夹显示 */}
        {depth === 0 && !isShared && node.is_shared && (
          <span className="text-xs text-blue-500" title="已共享">🔗</span>
        )}
        {isShared && node.shared_from && (
          <span className="text-xs text-gray-400">{node.shared_from.real_name}</span>
        )}
        {count > 0 && (
          <Badge size="xs" tone={isSelected ? 'blue' : 'gray'} label={count} />
        )}
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded"
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

/* ================================================================
   Item Picker
   ================================================================ */

interface ItemPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { entity_type: string; entity_id: string }[]) => void;
  existingIds: Set<string>;
}

function ItemPicker({ open, onClose, onConfirm, existingIds }: ItemPickerProps) {
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, any>>(new Map());

  /* 服务器数据（弹窗打开时实时拉取，失败时回退到本地缓存） */
  const [srcComponents, setSrcComponents] = useState<any[]>([]);
  const [srcDocuments, setSrcDocuments] = useState<any[]>([]);
  const [srcConfigItems, setSrcConfigItems] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataWarning, setDataWarning] = useState<string | null>(null);

  const extract = (res: any): any[] => {
    const d = res?.data;
    return Array.isArray(d) ? d : (d?.items || []);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDataLoading(true);
    setDataWarning(null);
    (async () => {
      const [comp, d, c] = await Promise.allSettled([
        partsApi.list({ page_size: 10000, show_all_versions: true }),  // 零部件：所有版本
        documentsApi.list({ page_size: 10000, show_all_versions: true }),
        configurationApi.listItems({ page_size: 10000 }),  // 非brief模式，返回version/status
      ]);
      if (cancelled) return;
      // 每类独立处理：成功用服务器数据，失败回退到本地缓存，互不影响
      const cache = useDataStore.getState();
      const pick = (r: PromiseSettledResult<any>, fallback: any[], label: string): any[] => {
        if (r.status === 'fulfilled') return extract(r.value);
        console.error(`[ItemPicker] 加载${label}失败：`, r.reason);
        return fallback;
      };
      // partsApi.list 直接返回 data（{items,total}），非 axios 响应，需单独解构
      const comps = comp.status === 'fulfilled'
        ? (Array.isArray(comp.value) ? comp.value : (comp.value?.items || []))
        : (console.error('[ItemPicker] 加载零部件失败：', comp.reason), cache.parts);
      setSrcComponents(comps);
      setSrcDocuments(pick(d, cache.documents, '图文档'));
      setSrcConfigItems(pick(c, cache.configItems, '构型项'));
      const failed = [comp, d, c].some((r) => r.status === 'rejected');
      setDataWarning(failed ? '部分数据从服务器加载失败，已使用本地缓存' : null);
      setDataLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]);

  const candidates = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const all: any[] = [];
    const seen = new Set<string>();
    // 零部件：id 取 revision_id（看板存储 revision_id，显示时按关联版本展示）；同时检查 master_id 兼容旧数据
    if (tab === 'all' || tab === 'component') srcComponents.forEach((p: any) => { const id = p.revision_id || p.id; const mid = p.master_id || p.id; if (!existingIds.has(id) && !existingIds.has(mid) && !seen.has(id)) { seen.add(id); all.push({ t: 'component', id, code: p.code, name: p.name, version: p.version || '', status: p.status || '' }); } });
    if (tab === 'all' || tab === 'document') srcDocuments.forEach((d: any) => { const id = d.id || d.revision_id; if (!existingIds.has(id) && !seen.has(id)) { seen.add(id); all.push({ t: 'document', id, code: d.code, name: d.name, version: d.version || '', status: d.status || '' }); } });
    if (tab === 'all' || tab === 'configuration') srcConfigItems.forEach((c: any) => { const id = c.id || c.revision_id; if (!existingIds.has(id) && !seen.has(id)) { seen.add(id); all.push({ t: 'configuration', id, code: c.code, name: c.name, version: c.version || '', status: c.status || '' }); } });
    return kw ? all.filter((i) => i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw)) : all;
  }, [tab, search, srcComponents, srcDocuments, srcConfigItems, existingIds]);

  const handleConfirm = () => {
    onConfirm(Array.from(selected.values()).map((v) => ({ entity_type: v.t, entity_id: v.id })));
    setSelected(new Map()); setSearch(''); setTab('all');
  };

  const selectedList = Array.from(selected.values());

  return (
    <Modal open={open} title="关联项目" onClose={onClose} width="full">
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* Already selected */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 border-b px-4 py-2 text-sm font-medium text-gray-700">已选 ({selectedList.length})</div>
          {selectedList.length === 0 ? (
            <div className="px-4 py-3 text-center text-sm text-gray-400">请在下方选择</div>
          ) : (
            <div className="max-h-32 overflow-y-auto">
              <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
                {selectedList.map((item) => (
                  <tr key={item.id}><td className="px-3 py-1.5"><span className="mr-1">{ENTITY_ICON[item.t]}</span>{item.code}</td><td className="px-3 py-1.5 text-gray-500">{item.version || '-'}</td><td className="px-3 py-1.5 text-gray-500">{item.name}</td><td className="px-3 py-1.5 text-right"><Button type="button" variant="danger" size="xs" onClick={() => { const n = new Map(selected); n.delete(item.id); setSelected(n); }}>✕</Button></td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
        {/* Search + filter */}
        <div className="flex gap-2">
          <input type="text" placeholder="搜索编号/名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
          <div className="flex gap-1">{(['all', 'component', 'document', 'configuration'] as FilterTab[]).map((t) => (
            <button type="button" key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm rounded-lg ${tab === t ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t === 'all' ? '全部' : ENTITY_LABEL[t]}</button>
          ))}</div>
        </div>
        {/* Candidates */}
        {dataWarning && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">{dataWarning}</p>}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0"><div className="max-h-64 overflow-y-auto">
          {dataLoading ? (
            <p className="p-4 text-center text-sm text-gray-400">加载中...</p>
          ) : candidates.length === 0 ? (
            <p className="p-4 text-center text-sm text-gray-400">无匹配结果</p>
          ) : (
            <table className="w-full text-sm table-fixed"><thead className="bg-gray-50 border-b sticky top-0"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">类型</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-48">编号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
              <th className="px-3 py-2 text-center text-gray-500 font-medium w-20">操作</th>
            </tr></thead><tbody className="divide-y divide-gray-100">
              {candidates.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><span className="mr-1">{ENTITY_ICON[item.t]}</span><span className="text-xs text-gray-500">{ENTITY_LABEL[item.t]}</span></td>
                  <td className="px-3 py-2 font-medium">{item.code}</td>
                  <td className="px-3 py-2 text-gray-500">{item.version || '-'}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2"><StatusTag status={item.status} /></td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">{selected.has(item.id) ? <span className="text-xs text-green-600">已选</span> : <Button type="button" size="xs" onClick={() => setSelected(new Map(selected).set(item.id, item))}>添加</Button>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div></div>
        {/* Bottom */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
          <Button type="button" onClick={handleConfirm} disabled={selectedList.length === 0}>确认关联 ({selectedList.length})</Button>
        </div>
      </div>
    </Modal>
  );
}
