import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import type { BomChild } from '../pages/PartBomPage';

/**
 * 移动端 BOM 树形组件。
 * - 根层由父组件传入（当前版本 BOM 直接子层），子树懒加载：
 *   点击展开箭头 → partsApi.getBOM(child_revision_id) 取该层子项，就地展开（无路由下钻）。
 * - 点击行（非箭头区域）→ 打开子项详情页 /parts/{child_master_id}。
 * - 触控目标 ≥40px：展开箭头 w-10，行内容 min-h-10。
 */

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

function sortedByOrder(list: BomChild[]): BomChild[] {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// 每级缩进 24px（多层级不占屏）；展开按钮 36px（根行件号距左框 36px）。
// 竖线位置 = i*INDENT + BTN/2 = 父项按钮中心，保证竖线与父项展开按钮对齐。
const INDENT = 24;
const BTN = 36;

export default function BomTree({ rootItems }: { rootItems: BomChild[] }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, BomChild[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const toggle = (revId: string) => {
    const willExpand = !expanded[revId];
    setExpanded((e) => ({ ...e, [revId]: willExpand }));
    // 首次展开时懒加载子树（失败后可再次点击重试）
    if (willExpand && !children[revId] && !loading[revId]) {
      setLoading((l) => ({ ...l, [revId]: true }));
      setErrors((er) => ({ ...er, [revId]: false }));
      partsApi
        .getBOM(revId)
        .then((list) => {
          setChildren((c) => ({ ...c, [revId]: sortedByOrder((list ?? []) as BomChild[]) }));
        })
        .catch(() => {
          setErrors((er) => ({ ...er, [revId]: true }));
        })
        .finally(() => {
          setLoading((l) => ({ ...l, [revId]: false }));
        });
    }
  };

  const renderNode = (b: BomChild, depth: number): ReactNode => {
    const isOpen = !!expanded[b.child_revision_id];
    const kids = children[b.child_revision_id];
    const isLoading = !!loading[b.child_revision_id];
    const hasError = !!errors[b.child_revision_id];
    return (
      <Fragment key={b.id}>
        <div className="flex items-stretch min-h-10 border-b border-gray-50 bg-white">
          {/* 缩进 + 层级竖线（每级一条，位置 = 父项展开按钮中心） */}
          <span className="relative shrink-0" style={{ width: depth * INDENT }}>
            {depth > 0 &&
              Array.from({ length: depth }).map((_, i) => (
                <span
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-200"
                  style={{ left: i * INDENT + BTN / 2 }}
                />
              ))}
          </span>
          {b.has_children ? (
            <button
              type="button"
              aria-label={isOpen ? '折叠' : '展开'}
              onClick={() => toggle(b.child_revision_id)}
              className="shrink-0 w-9 flex items-center justify-center text-gray-500 text-lg"
            >
              {isLoading ? '⋯' : isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="shrink-0 w-9 flex items-center justify-center text-gray-300 text-sm">•</span>
          )}
          {/* 点击行 → 打开子项详情页 */}
          <button
            type="button"
            onClick={() => navigate(`/parts/${b.child_master_id}`)}
            className="flex-1 min-w-0 flex flex-col justify-center py-1.5 pr-4 text-left"
          >
            {/* 行1：件号(左) + 用量 + 版本 + 状态(右) */}
            <span className="flex items-center min-w-0">
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                {b.child_code}
              </span>
              <span className="shrink-0 w-8 truncate text-center text-xs text-gray-500">x{b.quantity}</span>
              <span className="shrink-0 w-7 truncate text-center text-xs text-gray-500">
                {b.child_version}
              </span>
              <span className="shrink-0 w-12 flex justify-end">
                <StatusBadge status={b.child_status} map={STATUS_MAP} />
              </span>
            </span>
            {/* 行2：名称(左) + 检出状态(右) */}
            <span className="flex items-center min-w-0 mt-0.5">
              <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{b.child_name}</span>
              {b.child_check_out_user_name && (
                <span className="shrink-0 truncate text-right text-xs text-gray-500">
                  {b.child_check_out_user_name}
                </span>
              )}
            </span>
          </button>
        </div>
        {isOpen && (
          <div className="bg-white">
            {/* 提示对齐该节点子行内容起点：(depth+1) 级缩进 + 按钮宽 */}
            {isLoading && (
              <div className="py-2 text-xs text-gray-400" style={{ paddingLeft: (depth + 1) * INDENT + BTN }}>
                加载中...
              </div>
            )}
            {!isLoading && hasError && (
              <div className="py-2 text-xs text-red-400" style={{ paddingLeft: (depth + 1) * INDENT + BTN }}>
                加载失败，请重试
              </div>
            )}
            {!isLoading && !hasError && kids && kids.length === 0 && (
              <div className="py-2 text-xs text-gray-400" style={{ paddingLeft: (depth + 1) * INDENT + BTN }}>
                该零部件无下级 BOM
              </div>
            )}
            {!isLoading && !hasError && (kids ?? []).map((k) => renderNode(k, depth + 1))}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {rootItems.map((b) => renderNode(b, 0))}
    </div>
  );
}
