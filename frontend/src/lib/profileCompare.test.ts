import { describe, it, expect } from 'vitest';
import { diffProfileTrees } from './profileCompare';
import type { ConfigTreeNode, ConfigTreePart } from '../types';

function part(code: string, over: Partial<ConfigTreePart> = {}): ConfigTreePart {
  return {
    id: 'p-' + code, item_id: 'm-' + code, item_type: 'part',
    item_code: code, item_name: code + '名称', item_version: 'A', item_status: 'released',
    is_required: false, is_selected: true, quantity: 1, source_type: 'manual',
    ...over,
  };
}
function node(code: string, over: Partial<ConfigTreeNode> = {}): ConfigTreeNode {
  return {
    id: 'n-' + code, code, name: code + '构型', is_required: false, is_selected: true,
    quantity: 1, parts: [], children: [], ...over,
  };
}

describe('diffProfileTrees', () => {
  it('完全相同时 → 全部 none', () => {
    const left = node('ROOT', { parts: [part('P1'), part('P2')] });
    const right = node('ROOT', { parts: [part('P1'), part('P2')] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.change_type).toBe('none');
    expect(r.summary.part).toEqual({ add: 0, delete: 0, modify: 0, none: 2 });
    expect(r.summary.config_item).toEqual({ add: 0, delete: 0, modify: 0, none: 1 });
  });

  it('零部件版本变化 → part modify 且父构型项 modify(卷积)', () => {
    const left = node('ROOT', { parts: [part('P1', { item_version: 'A' })] });
    const right = node('ROOT', { parts: [part('P1', { item_version: 'B' })] });
    const r = diffProfileTrees(left, right);
    const p = r.root!.parts[0];
    expect(p.change_type).toBe('modify');
    expect(p.changed_fields).toEqual(['version']);
    expect(r.root!.change_type).toBe('modify');
  });

  it('零部件数量/状态变化 → modify 且字段正确', () => {
    const left = node('ROOT', { parts: [part('P1', { quantity: 1, item_status: 'released' })] });
    const right = node('ROOT', { parts: [part('P1', { quantity: 3, item_status: 'draft' })] });
    const p = diffProfileTrees(left, right).root!.parts[0];
    expect(p.change_type).toBe('modify');
    expect(p.changed_fields).toEqual(['quantity', 'status']);
  });

  it('零部件单侧新增/删除', () => {
    const left = node('ROOT', { parts: [part('P1')] });
    const right = node('ROOT', { parts: [part('P1'), part('P2')] });
    const add = diffProfileTrees(left, right).root!.parts.find(p => (p.right?.item_code || p.left?.item_code) === 'P2')!;
    expect(add.change_type).toBe('add');
    const del = diffProfileTrees(right, left).root!.parts.find(p => (p.left?.item_code || p.right?.item_code) === 'P2')!;
    expect(del.change_type).toBe('delete');
  });

  it('构型项单侧新增 → 节点及其零部件 add，父节点卷积 modify', () => {
    const left = node('ROOT');
    const right = node('ROOT', { children: [node('C1', { parts: [part('P1')] })] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.children[0].change_type).toBe('add');
    expect(r.root!.children[0].parts[0].change_type).toBe('add');
    expect(r.root!.change_type).toBe('modify');
  });

  it('构型项数量变化 → 构型项 modify(quantity)', () => {
    const left = node('ROOT', { children: [node('C1', { quantity: 1 })] });
    const right = node('ROOT', { children: [node('C1', { quantity: 2 })] });
    const c = diffProfileTrees(left, right).root!.children[0];
    expect(c.change_type).toBe('modify');
    expect(c.changed_fields).toEqual(['quantity']);
  });

  it('未选项(is_selected=false)被剔除', () => {
    const left = node('ROOT', { parts: [part('P1'), part('P2', { is_selected: false })] });
    const right = node('ROOT', { parts: [part('P1')] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.parts.map(p => p.left?.item_code || p.right?.item_code)).toEqual(['P1']);
    expect(r.root!.change_type).toBe('none');
  });

  it('必选项(is_required=true, is_selected=false)被纳入对比', () => {
    const left = node('ROOT', { parts: [
      part('P1'),
      part('P2', { is_required: true, is_selected: false }),
    ] });
    const right = node('ROOT', { parts: [part('P1')] });
    const r = diffProfileTrees(left, right);
    expect(r.root!.parts.map(p => p.left?.item_code || p.right?.item_code)).toEqual(['P1', 'P2']);
    expect(r.root!.parts.find(p => (p.left?.item_code || p.right?.item_code) === 'P2')!.change_type).toBe('delete');
  });

  it('某侧树为 null → 另一侧全 add；两侧 null → root null', () => {
    const right = node('ROOT', { parts: [part('P1')], children: [node('C1', { parts: [part('P2')] })] });
    const r = diffProfileTrees(null, right);
    expect(r.root!.change_type).toBe('add');
    expect(r.root!.parts[0].change_type).toBe('add');
    expect(r.root!.children[0].change_type).toBe('add');
    expect(r.summary.part.add).toBe(2);
    expect(diffProfileTrees(null, null).root).toBeNull();
  });

  it('code-path 匹配：同型号在不同父级下不被错配', () => {
    const left = node('ROOT', { children: [node('A', { children: [node('X', { parts: [part('PX', { item_version: 'A' })] })] })] });
    const right = node('ROOT', { children: [node('B', { children: [node('X', { parts: [part('PX', { item_version: 'B' })] })] })] });
    const r = diffProfileTrees(left, right);
    const codes = r.root!.children.map(c => ({ code: c.left?.code || c.right?.code, t: c.change_type }));
    expect(codes).toEqual([{ code: 'A', t: 'delete' }, { code: 'B', t: 'add' }]);
  });
});
