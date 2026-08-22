import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ProjectTask } from '../../types/project';

export type DetailTarget =
  | { kind: 'part'; id: string; rev?: string }
  | { kind: 'document'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'ec'; ecType: 'eco' | 'ecr'; id: string }
  | { kind: 'task'; projectId: string; task: ProjectTask }
  | { kind: 'gantt'; projectId: string }
  | { kind: 'config-item'; id: string };

/**
 * 详情覆盖层栈上下文：详情内容（如项目详情）需要把任务详情等无路由目标推入详情栈时使用，
 * 与栈共用同一 popstate 哨兵（逐级返回），避免多个 popstate 消费者互相冲突。
 */
export const DetailOverlayContext = createContext<{ push: (t: DetailTarget) => void } | null>(null);

/**
 * 详情覆盖层栈（零部件/图文档/看板等主界面共用）：
 * - 主界面点卡片 → openDetail 打开第一层（覆盖在主界面上，主界面不卸载、滚动位置保留）
 * - 详情内跳转（BOM 下钻 / 反查 / 零部件 / 图文档 / 项目 / EC）→ handleDetailNavigate 逐级入栈并压入 history 哨兵
 * - 页面 ‹ 返回 / 全面屏返回手势（popstate）每次弹掉一层详情，可逐级返回
 * - 不可嵌入的目标（如 /users 等）→ 新标签打开
 */
export function useDetailOverlay() {
  const [stack, setStack] = useState<DetailTarget[]>([]);
  const overlayRef = useRef(false);
  useEffect(() => {
    overlayRef.current = stack.length > 0;
  }, [stack]);

  // 系统返回（popstate）：覆盖层开着时每次 back 弹掉栈顶一层详情（全面屏手势逐级返回）
  useEffect(() => {
    const onPop = () => {
      if (overlayRef.current) {
        setStack((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openDetail = (t: DetailTarget) => {
    setStack([t]);
    window.history.pushState({ mobileDetailOverlay: true }, '');
  };

  /** 直接把详情目标推入栈（供详情内容通过 Context 使用，如项目详情打开任务详情） */
  const pushTarget = (t: DetailTarget) => {
    setStack((prev) => [...prev, t]);
    window.history.pushState({ mobileDetailOverlay: true }, '');
  };

  /** 详情内跳转分流：零部件/图文档/项目/EC → 栈内导航（压哨兵，可逐级返回）；其他 → 新标签 */
  const handleDetailNavigate = (to: string) => {
    const seg = to.split('?')[0].split('/').filter(Boolean);
    if (seg[0] === 'parts' && seg[1] && seg[1] !== 'compare') {
      pushTarget({ kind: 'part', id: seg[1] });
      return;
    }
    if (seg[0] === 'documents' && seg[1]) {
      pushTarget({ kind: 'document', id: seg[1] });
      return;
    }
    if (seg[0] === 'projects' && seg[1]) {
      pushTarget({ kind: 'project', id: seg[1] });
      return;
    }
    if (seg[0] === 'ec' && seg[1] === 'eco' && seg[2]) {
      pushTarget({ kind: 'ec', ecType: 'eco', id: seg[2] });
      return;
    }
    if (seg[0] === 'ec' && seg[1] === 'ecr' && seg[2]) {
      pushTarget({ kind: 'ec', ecType: 'ecr', id: seg[2] });
      return;
    }
    window.open(to, '_blank');
  };

  return { stack, openDetail, pushTarget, handleDetailNavigate };
}

/** 详情栈内内容取 push（无 Provider 时返回 null，调用方回落本地覆盖层） */
export function useDetailOverlayPush() {
  return useContext(DetailOverlayContext);
}
