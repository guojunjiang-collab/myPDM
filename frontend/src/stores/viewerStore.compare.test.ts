import { describe, it, expect, beforeEach } from 'vitest';
import { useViewerStore } from './viewerStore';
import type { CompareNode } from '../components/STPViewer/compareTypes';

const side = (bomItemId: string) => ({
  bomItemId, code: bomItemId, name: '', version: 'V1',
  quantity: 1, meshUuids: [] as string[], hasModel: true,
});

/** ROOT → /G → /G/X 三层树 */
const makeTree = (): CompareNode => {
  const leaf: CompareNode = {
    key: '/G/X', parentKey: '/G', level: 1, changeType: 'modify',
    left: side('bl'), right: side('br'), children: [],
  };
  const group: CompareNode = {
    key: '/G', parentKey: 'ROOT', level: 0, changeType: 'internal',
    left: side('gl'), right: side('gr'), children: [leaf],
  };
  return {
    key: 'ROOT', parentKey: null, level: -1, changeType: 'internal',
    left: side(''), right: side(''), children: [group],
  };
};

describe('viewerStore compare 分片', () => {
  beforeEach(() => useViewerStore.getState().reset());

  it('默认 compare 为 null，既有模式不受影响', () => {
    expect(useViewerStore.getState().compare).toBeNull();
  });

  it('setCompareTree 建立 nodeMap 并记录缺模型标记', () => {
    useViewerStore.getState().setCompareTree(makeTree(), { leftMissing: false, rightMissing: true });
    const c = useViewerStore.getState().compare!;
    expect(c.nodeMap.size).toBe(3);
    expect(c.nodeMap.get('/G/X')!.changeType).toBe('modify');
    expect(c.rightMissing).toBe(true);
    expect(c.displayMode).toBe('both');
    expect(c.onlyDiff).toBe(false);
    expect(c.ghostOpacity).toBe(0.12);
    expect(c.selectedKey).toBeNull();
  });

  it('mergeCompareMeshes 把 mesh 并入指定侧并向上聚合到祖先', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['m1', 'm2']);

    const c = useViewerStore.getState().compare!;
    expect(c.nodeMap.get('/G/X')!.left!.meshUuids).toEqual(['m1', 'm2']);
    expect(c.nodeMap.get('/G')!.left!.meshUuids).toEqual(['m1', 'm2']);
    expect(c.nodeMap.get('ROOT')!.left!.meshUuids).toEqual(['m1', 'm2']);
    // 右侧不受影响
    expect(c.nodeMap.get('/G/X')!.right!.meshUuids).toEqual([]);
  });

  it('mergeCompareMeshes 去重，重复调用不累加', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['m1']);
    s.mergeCompareMeshes('/G/X', 'left', ['m1', 'm3']);
    expect(useViewerStore.getState().compare!.nodeMap.get('/G/X')!.left!.meshUuids).toEqual(['m1', 'm3']);
  });

  it('selectCompareByMesh 反查配对行并展开所有祖先', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'right', ['mr1']);
    s.selectCompareByMesh('mr1');

    const st = useViewerStore.getState();
    expect(st.compare!.selectedKey).toBe('/G/X');
    expect(st.expandedIds.has('/G')).toBe(true);
    expect(st.expandedIds.has('ROOT')).toBe(true);
  });

  it('selectCompareByMesh 对未知 mesh 无副作用', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.selectCompareByMesh('unknown');
    expect(useViewerStore.getState().compare!.selectedKey).toBeNull();
  });

  it('显示模式 / 仅显示差异 / 幽灵透明度可设置', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.setDisplayMode('right');
    s.setOnlyDiff(true);
    s.setGhostOpacity(0.3);
    const c = useViewerStore.getState().compare!;
    expect(c.displayMode).toBe('right');
    expect(c.onlyDiff).toBe(true);
    expect(c.ghostOpacity).toBe(0.3);
  });

  it('compare 为 null 时调用对比 actions 不抛错', () => {
    const s = useViewerStore.getState();
    expect(() => {
      s.setDisplayMode('left');
      s.setOnlyDiff(true);
      s.mergeCompareMeshes('/G/X', 'left', ['m1']);
      s.selectCompareKey('/G/X');
      s.selectCompareByMesh('m1');
    }).not.toThrow();
    expect(useViewerStore.getState().compare).toBeNull();
  });

  it('reset 清空 compare 分片', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    useViewerStore.getState().reset();
    expect(useViewerStore.getState().compare).toBeNull();
  });

  it('toggleCompareSideVisibility 只隐藏指定侧的 mesh，再次调用恢复', () => {
    const s = useViewerStore.getState();
    s.setCompareTree(makeTree(), { leftMissing: false, rightMissing: false });
    s.mergeCompareMeshes('/G/X', 'left', ['ml']);
    s.mergeCompareMeshes('/G/X', 'right', ['mr']);

    s.toggleCompareSideVisibility('/G/X', 'left');
    expect(useViewerStore.getState().hiddenParts.has('ml')).toBe(true);
    expect(useViewerStore.getState().hiddenParts.has('mr')).toBe(false);

    useViewerStore.getState().toggleCompareSideVisibility('/G/X', 'left');
    expect(useViewerStore.getState().hiddenParts.has('ml')).toBe(false);
  });
});
