import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { configurationApi } from '../../services/api';
import Badge from '../../components/ui/Badge';
import type { ConfigChildItem } from '../../types';

/**
 * 移动端构型项子构型项树形组件（参照 BOM Tab 的 BomTree）。
 * - 根层由父组件传入（当前构型项的下一层子构型项），子树懒加载：
 *   点击展开箭头 → configurationApi.detail(child_revision_id) 取该子构型项的下一层，就地展开。
 * - 点击行（非箭头区域）→ 回调打开子构型项详情（覆盖层详情栈逐级下钻）。
 * - 触控目标 ≥40px：展开箭头 w-9，行内容 min-h-10。
 */

function sortedByOrder(list: ConfigChildItem[]): ConfigChildItem[] {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// 每级缩进 24px；展开按钮 36px（根行代码距左框 36px）。
// 竖线位置 = i*INDENT + BTN/2 = 父项展开按钮中心，保证竖线与父项展开按钮对齐。
const INDENT = 24;
const BTN = 36;

interface Props {
  rootItems: ConfigChildItem[];
  /** 点击行（子构型项）→ 打开子构型项详情（详情栈 push） */
  onOpenChild?: (revisionId: string) => void;
}

export default function ConfigTree({ rootItems, onOpenChild }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, ConfigChildItem[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const toggle = (revId: string) => {
    const willExpand = !expanded[revId];
    setExpanded((e) => ({ ...e, [revId]: willExpand }));
    // 首次展开时懒加载子树（失败后可再次点击重试）
    if (willExpand && !children[revId] && !loading[revId]) {
      setLoading((l) => ({ ...l, [revId]: true }));
      setErrors((er) => ({ ...er, [revId]: false }));
      configurationApi
        .detail(revId)
        .then((d) => {
          setChildren((c) => ({ ...c, [revId]: sortedByOrder((d?.children ?? []) as ConfigChildItem[]) }));
        })
        .catch(() => {
          setErrors((er) => ({ ...er, [revId]: true }));
        })
        .finally(() => {
          setLoading((l) => ({ ...l, [revId]: false }));
        });
    }
  };

  const renderNode = (c: ConfigChildItem, depth: number): ReactNode => {
    const revId = c.child_detail?.id ?? c.child_id;
    const isOpen = !!expanded[revId];
    const kids = children[revId];
    const isLoading = !!loading[revId];
    const hasError = !!errors[revId];
    const detail = c.child_detail;
    return (
      <Fragment key={c.id}>
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
          {c.has_children ? (
            <button
              type="button"
              aria-label={isOpen ? '折叠' : '展开'}
              onClick={() => toggle(revId)}
              className="shrink-0 w-9 flex items-center justify-center text-gray-500 text-lg"
            >
              {isLoading ? '⋯' : isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="shrink-0 w-9 flex items-center justify-center text-gray-300 text-sm">•</span>
          )}
          {/* 点击行 → 打开子构型项详情（详情栈逐级下钻） */}
          <button
            type="button"
            onClick={() => {
              if (revId && onOpenChild) onOpenChild(revId);
            }}
            className="flex-1 min-w-0 flex flex-col justify-center py-1.5 pr-4 text-left"
          >
            {/* 行1：代码(左) + 数量 + 版本 + 状态(右) */}
            <span className="flex items-center min-w-0">
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                {detail?.code || revId}
              </span>
              {c.quantity != null && (
                <span className="shrink-0 w-8 truncate text-center text-xs text-gray-500">x{c.quantity}</span>
              )}
              {detail?.version && (
                <span className="shrink-0 w-7 truncate text-center text-xs text-gray-500">{detail.version}</span>
              )}
              <span className="shrink-0 w-12 flex justify-end">
                {detail?.status && <Badge status={detail.status} />}
              </span>
            </span>
            {/* 行2：名称(左) + 要求/检出(右) */}
            <span className="flex items-center min-w-0 mt-0.5">
              <span className="flex-1 min-w-0 truncate text-xs text-gray-500">
                {detail?.name || ''}
                {!c.is_required && <span className="text-amber-500">（选装）</span>}
              </span>
              {detail?.check_out_user_name && (
                <span className="shrink-0 truncate text-right text-xs text-gray-500">
                  {detail.check_out_user_name}
                </span>
              )}
            </span>
          </button>
        </div>
        {isOpen && (
          <div className="bg-white">
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
                该构型项无下级子构型项
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
      {rootItems.map((c) => renderNode(c, 0))}
    </div>
  );
}
