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
    const frame = new THREE.Group(); frame.name = '机架组件';
    const power = new THREE.Group(); power.name = '动力组件';
    // 零件 = 带 mesh 子节点的 group（典型 Mayo/OCC 输出）
    const upper = new THREE.Group(); upper.name = '上盖'; upper.add(mesh('上盖_solid'));
    const bottom = new THREE.Group(); bottom.name = '底壳'; bottom.add(mesh('底壳_solid'));
    frame.add(upper, bottom);
    power.add(mesh('电机_1'), mesh('电机_2'));
    root.add(frame, power);
    scene.add(root);

    const tree = buildModelTree(scene)!;
    expect(tree.name).toBe('GD40_Assembly');
    expect(tree.type).toBe('group');
    expect(tree.children).toHaveLength(2); // 机架组件 + 动力组件

    // 机架组件：含子装配(上盖/底壳) → group，展开
    expect(tree.children[0].name).toBe('机架组件');
    expect(tree.children[0].type).toBe('group');
    expect(tree.children[0].children).toHaveLength(2);
    // 上盖：仅含 mesh 子节点 → 折叠为 part 叶子
    expect(tree.children[0].children[0].name).toBe('上盖');
    expect(tree.children[0].children[0].type).toBe('part');
    expect(tree.children[0].children[0].children).toHaveLength(0);

    // 动力组件：仅含 mesh 子节点 → 折叠为 part 叶子
    expect(tree.children[1].name).toBe('动力组件');
    expect(tree.children[1].type).toBe('part');
    expect(tree.children[1].children).toHaveLength(0);
  });

  it('分组节点聚合整子树 meshUuids', () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group(); root.name = 'A';
    const g = new THREE.Group(); g.name = 'G';
    const sub = new THREE.Group(); sub.name = '子组件';
    const m1 = mesh('m1'); const m2 = mesh('m2');
    sub.add(m1, m2);
    g.add(sub);
    root.add(g); scene.add(root);

    const tree = buildModelTree(scene)!;
    // A → G → 子组件(m1+m2)，G含子组所以仍是group
    expect(tree.type).toBe('group');
    expect([...tree.meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
    expect(tree.children[0].type).toBe('group'); // G含子组
    expect([...tree.children[0].meshUuids].sort()).toEqual([m1.uuid, m2.uuid].sort());
    expect(tree.children[0].children[0].type).toBe('part'); // 子组件仅mesh→折叠为part
    expect(tree.children[0].children[0].children).toHaveLength(0);
  });

  it('叶子零件 meshUuids 只含自己', () => {
    const scene = new THREE.Scene();
    const outer = new THREE.Group(); outer.name = 'outer';
    const inner = new THREE.Group(); inner.name = 'inner';
    const m = mesh('only');
    inner.add(m);
    outer.add(inner);
    scene.add(outer);

    const tree = buildModelTree(scene)!;
    // outer → inner(仅含mesh→折叠为part)
    expect(tree.type).toBe('group');
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

  it('单一顶层零件(mesh)→ part 根', () => {
    const scene = new THREE.Scene();
    const m = mesh('单件');
    scene.add(m);

    const tree = buildModelTree(scene)!;
    expect(tree.type).toBe('part');
    expect(tree.name).toBe('单件');
    expect(tree.parentId).toBeNull();
    expect(tree.meshUuids).toEqual([m.uuid]);
    expect(tree.children).toHaveLength(0);
  });

  it('part 节点作为叶子不展开子 mesh，但 meshUuids 仍聚合整子树', () => {
    const scene = new THREE.Scene();
    const outer = new THREE.Group(); outer.name = 'outer';
    const mid = new THREE.Group(); mid.name = 'mid';
    const parent = mesh('父零件');
    const childMesh = mesh('子零件');
    parent.add(childMesh); // mesh 带子 mesh（如点/线辅助几何体）
    mid.add(parent);
    outer.add(mid);
    scene.add(outer);

    const tree = buildModelTree(scene)!;
    // outer(group) → mid(仅mesh→part折叠)
    const node = tree.children[0];
    expect(node.type).toBe('part');
    expect([...node.meshUuids].sort()).toEqual([parent.uuid, childMesh.uuid].sort());
    expect(node.children).toHaveLength(0); // 零件不展开子级
  });
});
