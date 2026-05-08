import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { boardApi, usersApi, partsApi, assembliesApi, documentsApi, customFieldsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import { Modal, ConfirmModal } from '../components/Modal';
import PartDetailContent from '../components/PartDetailContent';
import DocumentDetailContent from '../components/DocumentDetailContent';
import AssemblyDetailContent from '../components/AssemblyDetailContent';
import type { CustomFieldDefinition, CustomFieldValue } from '../types';

/* ================================================================
   Types
   ================================================================ */

interface DashboardItem {
  id: string;
  entity_type: 'part' | 'assembly' | 'document';
  entity_id: string;
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
}

interface ShareRecord {
  id: string;
  shared_with_user_id: string;
  shared_with: { id: string; username: string; real_name: string } | null;
  permission: string;
  created_at: string;
}

type FilterTab = 'all' | 'part' | 'assembly' | 'document';

const ENTITY_LABEL: Record<string, string> = { part: '零件', assembly: '部件', document: '图文档' };
const ENTITY_ICON: Record<string, string> = { part: '🔧', assembly: '📦', document: '📄' };

const STATUS_TAG: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const StatusTag = ({ status }: { status: string }) => {
  const s = STATUS_TAG[status] || { label: status, cls: 'bg-gray-100 text-gray-800' };
  return <span className={`px-1.5 py-0.5 text-xs rounded-full ${s.cls}`}>{s.label}</span>;
};

/* ================================================================
   Helpers
   ================================================================ */

function flattenItems(folder: FolderNode): DashboardItem[] {
  const result = [...folder.items];
  for (const c of folder.children) result.push(...flattenItems(c));
  return result;
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
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; el: HTMLElement } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /* ---- Data ---- */
  const storeParts = useDataStore((s) => s.parts);
  const storeAssemblies = useDataStore((s) => s.assemblies);
  const storeDocuments = useDataStore((s) => s.documents);
  const [usersList, setUsersList] = useState<{ id: string; username: string; real_name: string }[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [shareUserId, setShareUserId] = useState('');
  const [sharePermission, setSharePermission] = useState('view');
  const [userSearch, setUserSearch] = useState('');
  const [detailItem, setDetailItem] = useState<DashboardItem | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, any>>({});

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

  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => {
    usersApi.list({ page_size: 10000 }).then((r) => {
      const d = r.data;
      setUsersList(Array.isArray(d) ? d : (d as any)?.items || []);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (shareModal) loadShares(shareModal); }, [shareModal]);

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
  const filteredItems = useMemo(() => filterTab === 'all' ? selectedItems : selectedItems.filter((i) => i.entity_type === filterTab), [selectedItems, filterTab]);
  const existingIds = useMemo(() => new Set(selectedItems.map((i) => i.entity_id)), [selectedItems]);

  /* Count items recursively */
  const countItems = (folder: FolderNode): number => {
    let c = folder.items.length;
    for (const ch of folder.children) c += countItems(ch);
    return c;
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

  const handleRemoveItem = async (itemId: string) => {
    try { await boardApi.removeItem(itemId); await loadDashboard(); } catch { alert('移除失败'); }
  };

  const handleAddItems = async (items: { entity_type: string; entity_id: string }[]) => {
    if (!selectedId) return;
    try { await boardApi.addItems(selectedId, items); setPickerOpen(false); await loadDashboard(); }
    catch (e: any) { alert(e?.response?.data?.detail || '关联失败'); }
  };

  const loadShares = async (fid: string) => {
    try { setShares((await boardApi.getShares(fid)).data || []); } catch { setShares([]); }
  };

  const handleAddShare = async () => {
    if (!shareModal || !shareUserId) return;
    try {
      await boardApi.addShare(shareModal, shareUserId, sharePermission);
      setShareUserId(''); await loadShares(shareModal);
    } catch (e: any) { alert(e?.response?.data?.detail || '共享失败'); }
  };

  const handleRemoveShare = async (sid: string) => {
    if (!shareModal) return;
    try { await boardApi.removeShare(shareModal, sid); await loadShares(shareModal); } catch { alert('取消共享失败'); }
  };

  const canEditFolder = selectedFolder ? !selectedFolder.shared_from || selectedFolder.shared_from?.permission === 'edit' : false;

  const handleViewDetail = async (item: DashboardItem) => {
    setDetailItem(item);
    setDetailData(null);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    setDetailLoading(true);
    try {
      let res;
      if (item.entity_type === 'part') res = await partsApi.get(item.entity_id);
      else if (item.entity_type === 'assembly') res = await assembliesApi.get(item.entity_id);
      else res = await documentsApi.get(item.entity_id);
      
      const data = res.data;
      setDetailData(data);
      
      // Load custom field defs and values
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = item.entity_type === 'part' ? 'part' : item.entity_type === 'assembly' ? 'component' : 'document';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setDetailCustomDefs(defs);
      
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, item.entity_id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => {
            vals[v.field_id] = v.value;
          });
          setDetailCustomValues(vals);
        } catch { /* ignore */ }
      }
    } catch { setDetailData(null); }
    finally { setDetailLoading(false); }
  };

  /* Tab counts */
  const tabCounts = useMemo(() => ({
    all: selectedItems.length,
    part: selectedItems.filter((i) => i.entity_type === 'part').length,
    assembly: selectedItems.filter((i) => i.entity_type === 'assembly').length,
    document: selectedItems.filter((i) => i.entity_type === 'document').length,
  }), [selectedItems]);

  /* ================================================================
   Render
   ================================================================ */

  if (loading) return <div className="text-gray-500 py-8 text-center">加载中...</div>;

  return (
    <div className="flex h-full">
      {/* Left: Folder Tree */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-2 pt-2 pb-1">
          <button type="button" onClick={() => { setCreateModal(''); setCreateName(''); }} className="w-full px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">
            + 新建文件夹
          </button>
        </div>
        <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">我的文件夹</div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
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
            <div className="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide border-t border-gray-200">📂 共享给我的</div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 max-h-48">
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
                  <button type="button" onClick={() => { setCreateModal(selectedFolder.id); setCreateName(''); }} className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
                    + 子文件夹
                  </button>
                  <button type="button" onClick={() => setPickerOpen(true)} className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700">
                    + 关联项目
                  </button>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="px-6 flex gap-0 border-b border-gray-200">
              {(['all', 'part', 'assembly', 'document'] as FilterTab[]).map((tab) => (
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
                            <button type="button" onClick={() => handleRemoveItem(item.id)} className="text-red-500 hover:text-red-700 text-xs">移除</button>
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
      {menuAnchor && (
        <div ref={menuRef} className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[120px]" style={{ left: menuAnchor.el.getBoundingClientRect().left, top: menuAnchor.el.getBoundingClientRect().bottom + 4 }}>
          <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50" onClick={() => { const f = findFolderById(allFolders, menuAnchor.id); setRenameModal({ id: menuAnchor.id, name: f?.name || '' }); setRenameName(f?.name || ''); setMenuAnchor(null); }}>✏️ 重命名</button>
          <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50" onClick={() => { setCreateModal(menuAnchor.id); setCreateName(''); setMenuAnchor(null); }}>📁 新建子文件夹</button>
          <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50" onClick={() => { setSelectedId(menuAnchor.id); setPickerOpen(true); setMenuAnchor(null); }}>📎 关联项目</button>
          <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50" onClick={() => { setShareModal(menuAnchor.id); setUserSearch(''); setMenuAnchor(null); }}>🔗 共享</button>
          <div className="border-t border-gray-100 my-1" />
          <button type="button" className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={() => { setDeleteId(menuAnchor.id); setMenuAnchor(null); }}>🗑️ 删除</button>
        </div>
      )}

      {/* ---- Rename ---- */}
      <Modal open={!!renameModal} title="重命名文件夹" onClose={() => setRenameModal(null)} width="sm">
        <div className="space-y-4">
          <input type="text" value={renameName} onChange={(e) => setRenameName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" autoFocus />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameModal(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="button" onClick={handleRename} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">确认</button>
          </div>
        </div>
      </Modal>

      {/* ---- Create Folder ---- */}
      <Modal open={createModal !== null && createModal !== undefined} title="新建文件夹" onClose={() => setCreateModal(null)} width="sm">
        <div className="space-y-4">
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="请输入文件夹名称" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500" autoFocus onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreateModal(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="button" onClick={handleCreate} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">创建</button>
          </div>
        </div>
      </Modal>

      {/* ---- Share ---- */}
      <Modal open={!!shareModal} title="共享文件夹" onClose={() => setShareModal(null)} width="md">
        <div className="space-y-4">
          <div className="flex gap-2">
            <input type="text" placeholder="搜索用户名/姓名..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
            <select value={sharePermission} onChange={(e) => setSharePermission(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="view">只读查看</option>
              <option value="edit">可编辑</option>
            </select>
          </div>
          <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg">
            {usersList.filter((u) => !userSearch.trim() || u.username.includes(userSearch) || u.real_name.includes(userSearch)).filter((u) => !shares.some((s) => s.shared_with_user_id === u.id)).map((u) => (
              <button type="button" key={u.id} onClick={() => setShareUserId(u.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0">
                {u.real_name} ({u.username})
              </button>
            ))}
          </div>
          {shareUserId && <div className="flex justify-end"><button type="button" onClick={handleAddShare} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">确认共享</button></div>}
          {shares.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">已共享</h4>
              <div className="space-y-1">
                {shares.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded">
                    <span className="text-sm">{s.shared_with?.real_name || '-'} <span className="text-xs text-gray-400 ml-1">({s.permission === 'edit' ? '可编辑' : '只读'})</span></span>
                    <button type="button" onClick={() => handleRemoveShare(s.id)} className="text-xs text-red-500 hover:text-red-700">取消</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---- Item Picker ---- */}
      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={handleAddItems} existingIds={existingIds} storeParts={storeParts} storeAssemblies={storeAssemblies} storeDocuments={storeDocuments} />

      {/* ---- Detail Modal ---- */}
      <Modal open={!!detailItem} title={detailItem ? `${ENTITY_LABEL[detailItem.entity_type]}详情` : ''} onClose={() => setDetailItem(null)} width="full">
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !detailData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : detailItem?.entity_type === 'part' ? (
          <PartDetailContent
            part={detailData}
            customFieldDefs={detailCustomDefs}
            customFieldValues={detailCustomValues}
          />
        ) : detailItem?.entity_type === 'assembly' ? (
          <AssemblyDetailContent
            assembly={detailData}
            customFieldDefs={detailCustomDefs}
            customFieldValues={detailCustomValues}
          />
        ) : (
          <DocumentDetailContent
            doc={detailData}
            customFieldDefs={detailCustomDefs}
            customFieldValues={detailCustomValues}
          />
        )}
      </Modal>

      {/* ---- Delete Confirm ---- */}
      <ConfirmModal open={!!deleteId} title="删除文件夹" content="确定要删除该文件夹吗？所有子文件夹和关联项将一并删除。" confirmText="删除" cancelText="取消" type="danger" onConfirm={handleDelete} onCancel={() => setDeleteId(null)} />
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
  const count = node.items.length + node.children.reduce((s, c) => s + c.items.length + c.children.reduce((s2, c2) => s2 + c2.items.length + c2.children.length, 0), 0);

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
        {isShared && node.shared_from && (
          <span className="text-xs text-gray-400">{node.shared_from.real_name}</span>
        )}
        {count > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-primary-100 text-primary-600' : 'bg-gray-200 text-gray-500'}`}>
            {count}
          </span>
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
  storeParts: any[];
  storeAssemblies: any[];
  storeDocuments: any[];
}

function ItemPicker({ open, onClose, onConfirm, existingIds, storeParts, storeAssemblies, storeDocuments }: ItemPickerProps) {
  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, any>>(new Map());

  const candidates = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const all: any[] = [];
    if (tab === 'all' || tab === 'part') storeParts.forEach((p: any) => { if (!existingIds.has(p.id)) all.push({ t: 'part', id: p.id, code: p.code, name: p.name }); });
    if (tab === 'all' || tab === 'assembly') storeAssemblies.forEach((a: any) => { if (!existingIds.has(a.id)) all.push({ t: 'assembly', id: a.id, code: a.code, name: a.name }); });
    if (tab === 'all' || tab === 'document') storeDocuments.forEach((d: any) => { if (!existingIds.has(d.id)) all.push({ t: 'document', id: d.id, code: d.code, name: d.name }); });
    return kw ? all.filter((i) => i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw)) : all;
  }, [tab, search, storeParts, storeAssemblies, storeDocuments, existingIds]);

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
                  <tr key={item.id}><td className="px-3 py-1.5"><span className="mr-1">{ENTITY_ICON[item.t]}</span>{item.code}</td><td className="px-3 py-1.5 text-gray-500">{item.name}</td><td className="px-3 py-1.5 text-right"><button type="button" onClick={() => { const n = new Map(selected); n.delete(item.id); setSelected(n); }} className="text-red-500 text-xs">✕</button></td></tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
        {/* Search + filter */}
        <div className="flex gap-2">
          <input type="text" placeholder="搜索编号/名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
          <div className="flex gap-1">{(['all', 'part', 'assembly', 'document'] as FilterTab[]).map((t) => (
            <button type="button" key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm rounded-lg ${tab === t ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t === 'all' ? '全部' : ENTITY_LABEL[t]}</button>
          ))}</div>
        </div>
        {/* Candidates */}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0"><div className="max-h-64 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="p-4 text-center text-sm text-gray-400">无匹配结果</p>
          ) : (
            <table className="w-full text-sm"><thead className="bg-gray-50 border-b sticky top-0"><tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">类型</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">编号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-center text-gray-500 font-medium w-16">操作</th>
            </tr></thead><tbody className="divide-y divide-gray-100">
              {candidates.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2"><span className="mr-1">{ENTITY_ICON[item.t]}</span><span className="text-xs text-gray-500">{ENTITY_LABEL[item.t]}</span></td>
                  <td className="px-3 py-2 font-medium">{item.code}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2 text-center">{selected.has(item.id) ? <span className="text-xs text-green-600">已选</span> : <button type="button" onClick={() => setSelected(new Map(selected).set(item.id, item))} className="px-2.5 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">添加</button>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div></div>
        {/* Bottom */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button type="button" onClick={handleConfirm} disabled={selectedList.length === 0} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">确认关联 ({selectedList.length})</button>
        </div>
      </div>
    </Modal>
  );
}
