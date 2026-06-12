import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildModelTree } from './buildModelTree';

function mesh(name: string): THREE.Mesh {
  const m = new THREE.Mesh();
  m.name = name;
  return m;
}

describe('buildModelTree', () => {
  it('单根装配体保留多级层级', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'GD40_Assembly';
    const power = new THREE.Group(); power.name = '动力组件';
    power.add(mesh('电机_1'), mesh('电机_2'));
    root.add(power);
    scene.add(root);

    const tree = buildModelTree(scene)!;
    expect(tree.name).toBe('GD40_Assembly');
    expect(tree.type).toBe('group');
    expect(tree.parentId).toBeNull();
    expect(tree.children).toHaveLength(1);

    const p = tree.children[0];
    expect(p.name).toBe('动力组件');
    expect(p.type).toBe('group');
    expect(p.parentId).toBe(tree.id);
    expect(p.children.map((c) => c.name)).toEqual(['电机_1', '电机_2']);
    expect(p.children[0].type).toBe('part');
    expect(p.children[0].parentId).toBe(p.id);
  });

  it('分组节点聚合整子树 meshUuids', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'A';
    const g = new THREE.Group(); g.name = 'G';
    const m1 = mesh('m1'); const m2 = mesh('m2');
    g.add(m1, m2); root.add(g); scene.add(root);

    const tree = buildModelTree(scene)!;
    expect([...tree.meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
    expect([...tree.children[0].meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
  });

  it('叶子零件 meshUuids 只含自己', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'A';
    const m = mesh('only'); root.add(m); scene.add(root);

    const tree = buildModelTree(scene)!;
    expect(tree.children[0].type).toBe('part');
    expect(tree.children[0].meshUuids).toEqual([m.uuid]);
  });

  it('扁平场景(多顶层节点)降级为虚拟根下单层', () => {
    const scene = new THREE.Scene();
    scene.add(mesh('p1'), mesh('p2'), mesh('p3'));

    const tree = buildModelTree(scene)!;
    expect(tree.children).toHaveLength(3);
    expect(tree.children.every((c) => c.type === 'part')).toBe(true);
  });

  it('空场景返回 null', () => {
    expect(buildModelTree(new THREE.Scene())).toBeNull();
  });
});
