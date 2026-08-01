import type { ChangeType, DisplayMode } from './compareTypes';

/** 3D 场景中的变更配色（Three.js 材质 hex） */
export const CHANGE_COLORS: Record<ChangeType, number> = {
  none: 0xB4B2A9,      // 灰：未变
  modify: 0xEF9F27,    // 黄：修改
  add: 0x639922,       // 绿：新增
  delete: 0xE24B4A,    // 红：删除
  internal: 0xB4B2A9,  // 分组行不渲染，占位
};

export interface RenderDecision {
  drawLeft: boolean;
  drawRight: boolean;
  color: number;
  /** 左侧那份是否降为幽灵透明度（仅叠加模式下的 modify） */
  leftGhost: boolean;
}

/**
 * 决定某个变更类型在某显示模式下画哪一侧、什么颜色。
 *
 * 叠加模式的核心取舍：未变件左右几何完全重合，只画一份避免 z-fighting；
 * modify 件两侧都画（旧版半透明 + 新版实体），这是叠加相对分屏唯一不可替代的价值。
 */
export function renderDecision(changeType: ChangeType, mode: DisplayMode): RenderDecision {
  const color = CHANGE_COLORS[changeType];

  // 分组行本身没有几何，由其子项各自渲染
  if (changeType === 'internal') {
    return { drawLeft: false, drawRight: false, color, leftGhost: false };
  }

  if (mode === 'left') {
    // 左侧存在的：none / modify / delete
    const exists = changeType !== 'add';
    return { drawLeft: exists, drawRight: false, color, leftGhost: false };
  }

  if (mode === 'right') {
    // 右侧存在的：none / modify / add
    const exists = changeType !== 'delete';
    return { drawLeft: false, drawRight: exists, color, leftGhost: false };
  }

  // 叠加
  switch (changeType) {
    case 'none':
      return { drawLeft: true, drawRight: false, color, leftGhost: false };
    case 'modify':
      return { drawLeft: true, drawRight: true, color, leftGhost: true };
    case 'add':
      return { drawLeft: false, drawRight: true, color, leftGhost: false };
    case 'delete':
      return { drawLeft: true, drawRight: false, color, leftGhost: false };
  }
}
