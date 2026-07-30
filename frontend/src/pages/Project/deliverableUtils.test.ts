import { describe, it, expect } from 'vitest';
import {
  DELIVERABLE_TABS, statusLabel, filterItems, statusOptions, taskTooltip,
} from './deliverableUtils';
import type { DeliverableItem } from '../../types/project';

function item(over: Partial<DeliverableItem> = {}): DeliverableItem {
  return {
    entity_type: 'part', entity_id: 'e1', master_id: 'm1',
    code: 'P-001', name: '支架', version: 'A', status: 'released',
    creator_name: '张三', extra: '零件', tasks: [{ id: 't1', code: 'T-01', name: '设计' }],
    ...over,
  };
}

describe('DELIVERABLE_TABS', () => {
  it('四个 TAB，仅变更不显示版本列', () => {
    expect(DELIVERABLE_TABS.map((t) => t.key)).toEqual(
      ['config_items', 'parts', 'documents', 'changes']);
    expect(DELIVERABLE_TABS.find((t) => t.key === 'changes')!.showVersion).toBe(false);
    expect(DELIVERABLE_TABS.filter((t) => t.showVersion)).toHaveLength(3);
  });

  it('变更 TAB 的名称列表头为「标题」', () => {
    expect(DELIVERABLE_TABS.find((t) => t.key === 'changes')!.nameLabel).toBe('标题');
    expect(DELIVERABLE_TABS.find((t) => t.key === 'parts')!.nameLabel).toBe('名称');
  });
});

describe('statusLabel', () => {
  it('映射零部件/图文档状态', () => {
    expect(statusLabel('draft')).toBe('草稿');
    expect(statusLabel('released')).toBe('发布');
    expect(statusLabel('obsolete')).toBe('作废');
  });

  it('映射变更专有状态', () => {
    expect(statusLabel('reviewing')).toBe('审核中');
    expect(statusLabel('executing')).toBe('执行中');
  });

  it('未知状态原样返回', () => {
    expect(statusLabel('weird_state')).toBe('weird_state');
  });
});

describe('filterItems', () => {
  const items = [
    item({ code: 'P-001', name: '支架', status: 'released' }),
    item({ code: 'P-002', name: '底板', status: 'draft' }),
  ];

  it('空条件返回全部', () => {
    expect(filterItems(items, '', '')).toHaveLength(2);
  });

  it('按编号搜索', () => {
    expect(filterItems(items, 'P-002', '').map((i) => i.code)).toEqual(['P-002']);
  });

  it('按名称搜索', () => {
    expect(filterItems(items, '支架', '').map((i) => i.code)).toEqual(['P-001']);
  });

  it('搜索忽略大小写与首尾空格', () => {
    expect(filterItems([item({ code: 'ABC-1' })], '  abc  ', '')).toHaveLength(1);
  });

  it('都不命中返回空', () => {
    expect(filterItems(items, '不存在', '')).toEqual([]);
  });

  it('按状态筛选', () => {
    expect(filterItems(items, '', 'draft').map((i) => i.code)).toEqual(['P-002']);
  });

  it('搜索与状态同时生效', () => {
    expect(filterItems(items, 'P-001', 'draft')).toEqual([]);
  });
});

describe('statusOptions', () => {
  it('去重、排序并带中文标签', () => {
    const opts = statusOptions([
      item({ status: 'released' }), item({ status: 'draft' }), item({ status: 'released' }),
    ]);
    expect(opts).toEqual([
      { value: 'draft', label: '草稿' },
      { value: 'released', label: '发布' },
    ]);
  });

  it('空数组返回空', () => {
    expect(statusOptions([])).toEqual([]);
  });
});

describe('taskTooltip', () => {
  it('多任务按行拼接', () => {
    expect(taskTooltip([
      { id: 't1', code: 'T-01', name: '设计' },
      { id: 't2', code: 'T-02', name: '校核' },
    ])).toBe('T-01 设计\nT-02 校核');
  });

  it('空任务返回空串', () => {
    expect(taskTooltip([])).toBe('');
  });
});
