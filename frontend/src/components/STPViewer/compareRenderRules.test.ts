import { describe, it, expect } from 'vitest';
import { renderDecision, CHANGE_COLORS } from './compareRenderRules';

describe('renderDecision - 叠加模式', () => {
  it('未变件只画左侧一份（避免重合几何 z-fighting），灰色', () => {
    const d = renderDecision('none', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: false, color: 0xB4B2A9, leftGhost: false });
  });

  it('修改件两侧都画，左侧(旧版)为幽灵、右侧(新版)为实体，黄色', () => {
    const d = renderDecision('modify', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: true, color: 0xEF9F27, leftGhost: true });
  });

  it('新增件只有右侧，绿色实体', () => {
    const d = renderDecision('add', 'both');
    expect(d).toEqual({ drawLeft: false, drawRight: true, color: 0x639922, leftGhost: false });
  });

  it('删除件只有左侧，红色实体', () => {
    const d = renderDecision('delete', 'both');
    expect(d).toEqual({ drawLeft: true, drawRight: false, color: 0xE24B4A, leftGhost: false });
  });

  it('internal 是分组行，本身不渲染', () => {
    const d = renderDecision('internal', 'both');
    expect(d.drawLeft).toBe(false);
    expect(d.drawRight).toBe(false);
  });
});

describe('renderDecision - 只看左', () => {
  it('未变件画左侧', () => {
    expect(renderDecision('none', 'left')).toMatchObject({ drawLeft: true, drawRight: false });
  });

  it('修改件只画左侧，且不再是幽灵（此时它是唯一一份）', () => {
    expect(renderDecision('modify', 'left')).toMatchObject({ drawLeft: true, drawRight: false, leftGhost: false });
  });

  it('新增件在左侧不存在，什么都不画', () => {
    expect(renderDecision('add', 'left')).toMatchObject({ drawLeft: false, drawRight: false });
  });

  it('删除件画左侧', () => {
    expect(renderDecision('delete', 'left')).toMatchObject({ drawLeft: true, drawRight: false });
  });
});

describe('renderDecision - 只看右', () => {
  it('未变件改画右侧（否则切到只看右时未变件会全消失）', () => {
    expect(renderDecision('none', 'right')).toMatchObject({ drawLeft: false, drawRight: true });
  });

  it('修改件只画右侧', () => {
    expect(renderDecision('modify', 'right')).toMatchObject({ drawLeft: false, drawRight: true, leftGhost: false });
  });

  it('新增件画右侧', () => {
    expect(renderDecision('add', 'right')).toMatchObject({ drawLeft: false, drawRight: true });
  });

  it('删除件在右侧不存在，什么都不画', () => {
    expect(renderDecision('delete', 'right')).toMatchObject({ drawLeft: false, drawRight: false });
  });
});

describe('CHANGE_COLORS', () => {
  it('四种变更色与设计文档一致', () => {
    expect(CHANGE_COLORS.none).toBe(0xB4B2A9);
    expect(CHANGE_COLORS.modify).toBe(0xEF9F27);
    expect(CHANGE_COLORS.add).toBe(0x639922);
    expect(CHANGE_COLORS.delete).toBe(0xE24B4A);
  });
});
