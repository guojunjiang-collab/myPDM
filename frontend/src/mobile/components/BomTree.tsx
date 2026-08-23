import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { mediaApi, partsApi } from '../../services/api';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import TreeToggle from '../../components/ui/TreeToggle';
import type { BomChild } from '../pages/PartBomPage';

/**
 * 移动端 BOM 树形组件。
 * - 根层由父组件传入（当前版本 BOM 直接子层），子树懒加载：
 *   点击展开箭头 → partsApi.getBOM(child_revision_id) 取该层子项，就地展开（无路由下钻）。
 * - 点击行（非箭头区域）→ 打开子项详情页 /parts/{child_master_id}。
 * - 触控目标 ≥40px：展开箭头 w-10，行内容 min-h-10。
 */

function sortedByOrder(list: BomChild[]): BomChild[] {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

// 每级缩进 var(--ui-tree-indent)（14px，多层级不占屏）；展开按钮 36px（根行件号距左框 36px）。
// 竖线位置 = i*INDENT + BTN/2 = 父项按钮中心，保证竖线与父项展开按钮对齐。
const INDENT = 'var(--ui-tree-indent)';
const BTN = 36;

interface Props {
  rootItems: BomChild[];
  /** 覆盖层模式跳转回调（详情栈内导航）；缺省时走路由 navigate */
  onNavigate?: (to: string) => void;
}

export default function BomTree({ rootItems, onNavigate }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, BomChild[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  // 预览中（按钮显示"加载中..."）：装配体 → 装配模式 3D 预览；零件 → 附件 STP 单模型
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const onPreview = async (b: BomChild, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!b.child_revision_id || previewingId) return;
    setPreviewingId(b.child_revision_id);
    try {
      const win = window.open('', '_blank');
      if (b.child_type === 'assembly') {
        const url = `/stp-viewer?assembly=${b.child_revision_id}&code=${encodeURIComponent(b.child_code ?? '')}&name=${encodeURIComponent(b.child_name ?? '')}`;
        if (win) win.location.href = url;
        return;
      }
      const list = (await partsApi.listAttachments(b.child_revision_id)) as Array<{ id: string; file_name?: string }>;
      const stp = list.find((a) => /\.(stp|step)$/i.test(a.file_name ?? ''));
      if (!stp) {
        window.alert('该零件暂无 STP 三维模型');
        return;
      }
      const t = await mediaApi.token(stp.id, 'gltf');
      const url = `/stp-viewer?id=${encodeURIComponent(stp.id)}&token=${encodeURIComponent(t)}&code=${encodeURIComponent(b.child_code ?? '')}&version=${encodeURIComponent(b.child_version ?? '')}&name=${encodeURIComponent(b.child_name ?? '')}`;
      if (win) win.location.href = url;
    } catch {
      window.alert('3D 模型加载失败，请稍后重试');
    } finally {
      setPreviewingId(null);
    }
  };

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
          <span className="relative shrink-0" style={{ width: `calc(${depth} * ${INDENT})` }}>
            {depth > 0 &&
              Array.from({ length: depth }).map((_, i) => (
                <span
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-200"
                  style={{ left: `calc(${i} * ${INDENT} + ${BTN / 2}px)` }}
                />
              ))}
          </span>
          {b.has_children ? (
            <span className="shrink-0 w-9 flex items-center justify-center">
              <TreeToggle
                expanded={isOpen}
                onClick={() => toggle(b.child_revision_id)}
                loading={isLoading}
                size="sm"
                title={isOpen ? '折叠' : '展开'}
              />
            </span>
          ) : (
            <span className="shrink-0 w-9 flex items-center justify-center">
              <TreeToggle leaf size="sm" />
            </span>
          )}
          {/* 点击行 → 打开子项详情页（覆盖层模式走回调，逐级返回） */}
          <button
            type="button"
            onClick={() => {
              const to = `/parts/${b.child_master_id}`;
              if (onNavigate) onNavigate(to);
              else navigate(to);
            }}
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
                <Badge status={b.child_status} />
              </span>
            </span>
            {/* 行2：名称(左) + 检出状态 + 预览按钮（靠右） */}
            <span className="flex items-center min-w-0 mt-0.5">
              <span className="flex-1 min-w-0 truncate text-xs text-gray-500">{b.child_name}</span>
              {b.child_check_out_user_name && (
                <span className="shrink-0 truncate text-right text-xs text-gray-500">
                  {b.child_check_out_user_name}
                </span>
              )}
              {/* 预览按钮（深色小按钮，同状态徽标尺寸）；装配体/零件均提供 3D 预览 */}
              <Button
                type="button"
                onClick={(e) => onPreview(b, e)}
                disabled={previewingId === b.child_revision_id}
                variant="primary"
                size="xs"
                className="shrink-0 ml-2 min-h-8"
              >
                {previewingId === b.child_revision_id ? '加载中...' : '预览'}
              </Button>
            </span>
          </button>
        </div>
        {isOpen && (
          <div className="bg-white">
            {/* 提示对齐该节点子行内容起点：(depth+1) 级缩进 + 按钮宽 */}
            {isLoading && (
              <div className="py-2 text-xs text-gray-400" style={{ paddingLeft: `calc((${depth} + 1) * ${INDENT} + ${BTN}px)` }}>
                加载中...
              </div>
            )}
            {!isLoading && hasError && (
              <div className="py-2 text-xs text-red-400" style={{ paddingLeft: `calc((${depth} + 1) * ${INDENT} + ${BTN}px)` }}>
                加载失败，请重试
              </div>
            )}
            {!isLoading && !hasError && kids && kids.length === 0 && (
              <div className="py-2 text-xs text-gray-400" style={{ paddingLeft: `calc((${depth} + 1) * ${INDENT} + ${BTN}px)` }}>
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
