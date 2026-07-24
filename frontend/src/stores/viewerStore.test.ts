import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './viewerStore';
import type { TreeNode } from '../components/STPViewer/treeTypes';

// 构造: 根A > 组G(part P1->u1, part P2->u2)
const tree: TreeNode = {
  id: 'A', name: 'A', type: 'group', parentId: null,
  meshUuids: ['u1', 'u2'],
  children: [{
    id: 'G', name: 'G', type: 'group', parentId: 'A',
    meshUuids: ['u1', 'u2'],
    children: [
      { id: 'P1', name: 'm1', type: 'part', parentId: 'G', meshUuids: ['u1'], children: [] },
      { id: 'P2', name: 'm2', type: 'part', parentId: 'G', meshUuids: ['u2'], children: [] },
    ],
  }],
};

beforeEach(() => {
  useViewerStore.getState().reset();
});

describe('viewerStore tree extensions', () => {
  it('setTreeData 构建 nodeMap 与 meshOwner', () => {
    useViewerStore.getState().setTreeData(tree);
    const s = useViewerStore.getState();
    expect(s.nodeMap.get('G')!.name).toBe('G');
    expect(s.meshOwner.get('u1')!.id).toBe('P1');
    expect(s.meshOwner.get('u2')!.id).toBe('P2');
  });

  it('selectByMesh 选中所属叶子并展开祖先', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.selectByMesh('u1');
    const s = useViewerStore.getState();
    expect(s.selectedNodeId).toBe('P1');
    expect(s.expandedIds.has('A')).toBe(true);
    expect(s.expandedIds.has('G')).toBe(true);
  });

  it('isolateMode 默认 true，可切换', () => {
    expect(useViewerStore.getState().isolateMode).toBe(true);
    useViewerStore.getState().setIsolateMode(false);
    expect(useViewerStore.getState().isolateMode).toBe(false);
  });

  it('toggleExpanded 增删展开 id', () => {
    const st = useViewerStore.getState();
    st.toggleExpanded('G');
    expect(useViewerStore.getState().expandedIds.has('G')).toBe(true);
    st.toggleExpanded('G');
    expect(useViewerStore.getState().expandedIds.has('G')).toBe(false);
  });

  it('toggleNodeVisibility 切换整子树显隐', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.toggleNodeVisibility(tree.children[0]); // 隐藏 G 整组
    let s = useViewerStore.getState();
    expect(s.hiddenParts.has('u1')).toBe(true);
    expect(s.hiddenParts.has('u2')).toBe(true);
    st.toggleNodeVisibility(tree.children[0]); // 再切回显示
    s = useViewerStore.getState();
    expect(s.hiddenParts.has('u1')).toBe(false);
    expect(s.hiddenParts.has('u2')).toBe(false);
  });

  it('selectByMesh 对未知 mesh 不改变状态', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.selectByMesh('不存在的uuid');
    const s = useViewerStore.getState();
    expect(s.selectedNodeId).toBeNull();
    expect(s.expandedIds.size).toBe(0);
  });

  it('toggleNodeVisibility 部分隐藏时切为全隐', () => {
    const st = useViewerStore.getState();
    st.setTreeData(tree);
    st.toggleNodeVisibility(tree.children[0].children[0]); // 先单独隐藏 P1(u1)
    st.toggleNodeVisibility(tree.children[0]); // G 部分隐藏(u1已隐,u2未隐)→ 应全隐
    const s = useViewerStore.getState();
    expect(s.hiddenParts.has('u1')).toBe(true);
    expect(s.hiddenParts.has('u2')).toBe(true);
  });

  it('mergeInstanceMeshes 把 mesh 并入叶子及祖先并更新 meshOwner', () => {
    const st = useViewerStore.getState();
    const empty: TreeNode = {
      id: 'A', name: 'A', type: 'group', parentId: null, meshUuids: [],
      children: [{
        id: 'G', name: 'G', type: 'group', parentId: 'A', meshUuids: [],
        children: [
          { id: 'P1', name: 'm1', type: 'part', parentId: 'G', meshUuids: [], children: [] },
          { id: 'P2', name: 'm2', type: 'part', parentId: 'G', meshUuids: [], children: [] },
        ],
      }],
    };
    st.setTreeData(empty);
    st.mergeInstanceMeshes('P1', ['u1', 'ua']);
    const s = useViewerStore.getState();
    expect(s.nodeMap.get('P1')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    expect(s.nodeMap.get('G')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    expect(s.nodeMap.get('A')!.meshUuids.sort()).toEqual(['u1', 'ua']);
    expect(s.meshOwner.get('u1')!.id).toBe('P1');
    expect(s.meshOwner.get('ua')!.id).toBe('P1');
    st.selectByMesh('u1');
    expect(useViewerStore.getState().selectedNodeId).toBe('P1');
  });

  it('mergeInstanceMeshes 去重且第二个叶子独立聚合', () => {
    const st = useViewerStore.getState();
    const empty: TreeNode = {
      id: 'A', name: 'A', type: 'group', parentId: null, meshUuids: [],
      children: [
        { id: 'P1', name: 'm1', type: 'part', parentId: 'A', meshUuids: [], children: [] },
        { id: 'P2', name: 'm2', type: 'part', parentId: 'A', meshUuids: [], children: [] },
      ],
    };
    st.setTreeData(empty);
    st.mergeInstanceMeshes('P1', ['u1']);
    st.mergeInstanceMeshes('P1', ['u1']);
    st.mergeInstanceMeshes('P2', ['u2']);
    const s = useViewerStore.getState();
    expect(s.nodeMap.get('P1')!.meshUuids).toEqual(['u1']);
    expect(s.nodeMap.get('A')!.meshUuids.sort()).toEqual(['u1', 'u2']);
    expect(s.meshOwner.get('u2')!.id).toBe('P2');
  });

  it('mergeInstanceMeshes 后渲染用 treeData 根节点聚合所有已加载 mesh', () => {
    const st = useViewerStore.getState();
    const empty: TreeNode = {
      id: 'A', name: 'A', type: 'group', parentId: null, meshUuids: [],
      children: [
        { id: 'P1', name: 'm1', type: 'part', parentId: 'A', meshUuids: [], children: [] },
        { id: 'P2', name: 'm2', type: 'part', parentId: 'A', meshUuids: [], children: [] },
      ],
    };
    st.setTreeData(empty);
    st.mergeInstanceMeshes('P1', ['u1']);
    st.mergeInstanceMeshes('P2', ['u2']);
    // 渲染用的 treeData（非 nodeMap）根节点必须包含两次加载的 mesh
    expect(useViewerStore.getState().treeData!.meshUuids.sort()).toEqual(['u1', 'u2']);
  });

  it('setStreamProgress 与 reset', () => {
    const st = useViewerStore.getState();
    st.setStreamProgress({ loaded: 2, total: 5 });
    expect(useViewerStore.getState().streamProgress).toEqual({ loaded: 2, total: 5 });
    st.reset();
    expect(useViewerStore.getState().streamProgress).toBeNull();
  });
});
