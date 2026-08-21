import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { boardApi } from '../../services/api';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';

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

const ENTITY_LABEL: Record<string, string> = { part: '零部件', assembly: '零部件', component: '零部件', document: '图文档', configuration: '构型项' };
const ENTITY_ICON: Record<string, string> = { part: '📦', assembly: '📦', component: '📦', document: '📄', configuration: '⚙️' };

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  active: { label: '有效', cls: 'bg-green-100 text-green-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

type FilterTab = 'all' | 'component' | 'document' | 'configuration';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'component', label: '零部件' },
  { key: 'document', label: '图文档' },
  { key: 'configuration', label: '构型项' },
];

function findFolder(folders: FolderNode[], id: string): FolderNode | null {
  for (const f of folders) {
    if (f.id === id) return f;
    const found = findFolder(f.children, id);
    if (found) return found;
  }
  return null;
}

function folderPath(folders: FolderNode[], id: string): string {
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

export default function BoardPage() {
  const navigate = useNavigate();
  const [myFolders, setMyFolders] = useState<FolderNode[]>([]);
  const [sharedFolders, setSharedFolders] = useState<FolderNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const allFolders = useMemo(() => [...myFolders, ...sharedFolders], [myFolders, sharedFolders]);
  const selectedFolder = useMemo(() => (selectedId ? findFolder(allFolders, selectedId) : null), [selectedId, allFolders]);
  const selectedItems = useMemo(() => (selectedFolder ? [...selectedFolder.items] : []), [selectedFolder]);
  const filteredItems = useMemo(
    () =>
      filterTab === 'all'
        ? selectedItems
        : selectedItems.filter((i) => (filterTab === 'component' ? isComponentType(i.entity_type) : i.entity_type === filterTab)),
    [selectedItems, filterTab],
  );
  const tabCounts = useMemo(
    () => ({
      all: selectedItems.length,
      component: selectedItems.filter((i) => isComponentType(i.entity_type)).length,
      document: selectedItems.filter((i) => i.entity_type === 'document').length,
      configuration: selectedItems.filter((i) => i.entity_type === 'configuration').length,
    }),
    [selectedItems],
  );

  const handleItemClick = (item: DashboardItem) => {
    // 跳转目标与桌面版一致：零部件 → 零部件详情（master_id），图文档 → 图文档详情（revision_id）
    if (isComponentType(item.entity_type)) {
      navigate(`/parts/${item.master_id || item.entity_id}`);
    } else if (item.entity_type === 'document') {
      navigate(`/documents/${item.entity_id}`);
    }
    // configuration：移动端暂无构型详情页，不跳转（详见报告 §4）
  };

  /* ---------------- 渲染 ---------------- */

  if (loading) return <p className="text-center text-xs text-gray-400 py-3">加载中...</p>;
  if (error) return <p className="text-center text-xs text-red-400 py-3">{error}</p>;

  // 根视图：我的文件夹 + 共享给我的
  if (!selectedFolder) {
    if (myFolders.length === 0 && sharedFolders.length === 0) {
      return <EmptyState text="暂无文件夹" />;
    }
    return (
      <div className="p-3 flex flex-col gap-4">
        <section>
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide px-1 mb-1">📁 我的文件夹</h2>
          {myFolders.length === 0 ? (
            <EmptyState text="暂无文件夹" />
          ) : (
            <div className="flex flex-col gap-2">
              {myFolders.map((f) => (
                <FolderRow key={f.id} folder={f} shared={false} onOpen={() => setSelectedId(f.id)} />
              ))}
            </div>
          )}
        </section>
        {sharedFolders.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide px-1 mb-1">📂 共享给我的</h2>
            <div className="flex flex-col gap-2">
              {sharedFolders.map((f) => (
                <FolderRow key={`s-${f.id}`} folder={f} shared onOpen={() => setSelectedId(f.id)} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  // 文件夹视图：面包屑 + 子文件夹 + 类型筛选 + 项目条目卡片
  const children = selectedFolder.children ?? [];
  return (
    <div className="flex flex-col">
      <div className="sticky top-0 bg-gray-50 px-2 pt-2 pb-1 z-10 border-b border-gray-100">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="min-w-10 min-h-10 rounded-lg text-gray-600 text-lg leading-none flex items-center justify-center"
            aria-label="返回文件夹列表"
          >
            ‹
          </button>
          <span className="flex-1 text-xs text-gray-500 truncate">{folderPath(allFolders, selectedFolder.id)}</span>
        </div>
        <div className="flex gap-2 px-1 pb-1">
          {FILTER_TABS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilterTab(f.key)}
              className={`min-h-10 px-3 rounded-full text-xs ${filterTab === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label} ({tabCounts[f.key]})
            </button>
          ))}
        </div>
      </div>

      {children.length === 0 && filteredItems.length === 0 ? (
        <EmptyState text="暂无关联项目" />
      ) : (
        <div className="flex flex-col">
          {children.length > 0 && (
            <div className="p-3 pb-1 flex flex-col gap-2">
              {children.map((c) => (
                <FolderRow key={c.id} folder={c} shared={!!c.shared_from} onOpen={() => setSelectedId(c.id)} />
              ))}
            </div>
          )}
          {filteredItems.length > 0 && (
            <MobileCardList
              items={filteredItems}
              keyOf={(i) => i.id}
              renderMain={(i) => (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span>{ENTITY_ICON[i.entity_type]}</span>
                  <span className="font-medium">{i.code}</span>
                  <span className="text-gray-500 font-normal">{ENTITY_LABEL[i.entity_type]}</span>
                </span>
              )}
              renderMeta={(i) => (
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={i.status} map={STATUS_MAP} />
                  <span>{formatMeta([['名称', i.name], ['版本', i.version]])}</span>
                </span>
              )}
              onClick={handleItemClick}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   文件夹行（触控目标 ≥ 40px）
   ================================================================ */

function FolderRow({ folder, shared, onOpen }: { folder: FolderNode; shared: boolean; onOpen: () => void }) {
  const count = folder.items?.length ?? 0;
  const childCount = folder.children?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 bg-white rounded-lg px-4 py-3 min-h-12 shadow-sm text-left"
    >
      <span className="text-base">{shared ? '📂' : '📁'}</span>
      <span className="flex-1 text-sm text-gray-800 truncate">{folder.name}</span>
      {shared && folder.shared_from && (
        <span className="text-xs text-gray-400 shrink-0">{folder.shared_from.real_name}</span>
      )}
      {count > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">{count}</span>
      )}
      {childCount > 0 && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 shrink-0">{childCount} 子</span>
      )}
    </button>
  );
}
