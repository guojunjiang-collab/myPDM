import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { partsApi } from '../../services/api';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import { bomPath, parentBomPath } from './bomPath';
import type { PartMaster, PartRevisionBrief } from '../../types';

/**
 * GET /api/parts/{master_id} 实际返回后端 PartMasterResponse：
 * { id, code, name, type, ..., latest_revision: PartRevisionBrief | null }
 * 前端 PartMaster 类型缺少 latest_revision 字段，此处本地扩展（与 PartDetailPage 一致，不改 types/）。
 */
interface PartDetail extends PartMaster {
  latest_revision?: PartRevisionBrief | null;
}

/**
 * GET /parts/revisions/{revision_id}/bom 实际返回「直接子层」列表（后端 crud_parts.get_bom_tree，
 * 非整棵树）：每项含 child_revision_id 与 has_children。
 * 因此下钻 = 以子件版本 id 再次调用 partsApi.getBOM(childId) 取该层子项。
 */
interface BomChild {
  id: string;
  child_revision_id: string;
  child_master_id: string;
  child_code: string;
  child_name: string;
  child_version: string;
  child_status: string;
  child_check_out_user_id?: string | null;
  child_check_out_user_name?: string | null;
  child_type?: 'part' | 'assembly';
  has_children: boolean;
  quantity: number;
  sort_order: number;
  cad_instances?: unknown[];
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

function sortedByOrder(list: BomChild[]): BomChild[] {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export default function PartBomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const pathname = location.pathname;
  // URL 形如 /parts/:id/bom（首层）或 /parts/:id/bom/:childId[/bom/:childId...]（下钻层，可任意深度）。
  // childId = 最后一个 /bom/ 之后的段，即当前节点（子件版本）id。
  const bomSegs = pathname.split('/bom/').filter(Boolean);
  const childId = bomSegs.length > 1 ? bomSegs[bomSegs.length - 1] : undefined;

  const [items, setItems] = useState<BomChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    let alive = true;
    if (!id) {
      setError('缺少零部件 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setItems([]);
    const load = async () => {
      try {
        if (!childId) {
          // 首层：master → 最新版本 → 该版本 BOM
          const detail = (await partsApi.get(id)) as PartDetail;
          const header = detail ? `${detail.code} ${detail.name}` : id;
          const revisionId = detail?.latest_revision?.id;
          if (!revisionId) {
            // 无版本即无 BOM：保持空列表（空态提示），不算错误
            if (alive) {
              setTitle(header);
              setItems([]);
            }
            return;
          }
          const list = (await partsApi.getBOM(revisionId)) as BomChild[];
          if (alive) {
            setTitle(header);
            setItems(sortedByOrder(list));
          }
        } else {
          // 下钻层：childId 即子件版本 id，直接取该版本 BOM；标题信息尽力而为（失败不阻塞列表）
          const list = (await partsApi.getBOM(childId)) as BomChild[];
          let header = '';
          try {
            const rev = await partsApi.getRevision(childId);
            if (rev?.master_id) {
              const master = await partsApi.get(rev.master_id);
              header = `${master.code} ${master.name}`;
            }
          } catch {
            // 标题获取失败：保持空标题，仅展示 BOM 列表
          }
          if (alive) {
            setTitle(header);
            setItems(sortedByOrder(list));
          }
        }
      } catch {
        if (alive) {
          setItems([]);
          setError('加载失败，请稍后重试');
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [id, childId]);

  const isRoot = !childId;
  const emptyText = isRoot ? '该零部件暂无 BOM 子项' : '该零部件无下级 BOM';
  const displayTitle = title || id || 'BOM';

  return (
    <div className="flex flex-col">
      {/* 顶部：返回按钮 + 标题（当前节点 件号/名称） + 面包屑（上级路径） */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="shrink-0 min-w-9 h-9 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{displayTitle}</div>
        </div>
        {/* 面包屑：parentBomPath 逐级回退，首层回列表页 */}
        <div className="flex items-center gap-2 mt-1 min-h-8">
          {isRoot ? (
            <button
              onClick={() => navigate('/parts')}
              className="min-h-8 px-2 rounded-full text-xs text-primary-600 bg-white border border-gray-200"
            >
              ‹ 零部件列表
            </button>
          ) : (
            <button
              onClick={() => navigate(parentBomPath(pathname))}
              className="min-h-8 px-2 rounded-full text-xs text-primary-600 bg-white border border-gray-200"
            >
              ‹ 返回上级
            </button>
          )}
          {title && <span className="text-xs text-gray-400 truncate">{isRoot ? '根 BOM' : 'BOM'}</span>}
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text={emptyText} />}

      <MobileCardList
        items={items}
        keyOf={(b) => b.id}
        renderMain={(b) => `${b.child_code} ${b.child_name}`}
        renderMeta={(b) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.child_status} map={STATUS_MAP} />
            <span className="text-gray-500">数量 ×{b.quantity}</span>
            <span className="text-gray-500">{formatMeta([['版本', b.child_version]])}</span>
            {b.has_children && <span className="text-primary-600">可下钻 ›</span>}
          </span>
        )}
        onClick={(b) => {
          // 仅装配（has_children）可继续下钻；零件无子 BOM，点击无操作
          if (!b.has_children) return;
          navigate(bomPath(pathname, b.child_revision_id));
        }}
      />
    </div>
  );
}
