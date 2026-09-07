import type { CompareNode, CompareInstanceNode, CompareChildRow, Side, ChangeType } from './compareTypes';
import type { InstanceMatch } from './matchInstances';

/**
 * 把叶子实例按"完整 bom_path 层级"挂载成实例层级树。
 *
 * 对比树的 BOM 行（CompareNode）只是"件号路径"维度；同一个多实例部件在装配中
 * 有多个实例（link.cad_instances），且每个实例下还有自己的 BOM 子项。实例层级树
 * 把这些实例化维度插入 BOM 层级之间：
 *
 *   CompareNode（BOM 行，左右配对）
 *   └── instances（实例层，左右配对）
 *       └── CompareInstanceNode（实例）
 *           └── children（该实例的 BOM 子项行视图）
 *               └── CompareChildRow
 *                   ├── node（子项 BOM 行，左右配对数据源）
 *                   ├── instances（该子项行在此实例上下文下的实例层，递归）
 *                   └── children（该行的 BOM 子项行，递归）
 *
 * 挂载规则（沿实例 bom_path 逐段）：
 * - 多实例段（段含 ":idx"）→ 在"当前行"的实例层挂实例节点（seq = idx+1）；
 *   左右两侧按 (路径, seq) 聚合到同一节点（配对由叶子 matchInstancePairs 结果推导）。
 * - 单实例段（无 ":idx"）：
 *   - 叶子段 → 在"当前行"的实例层挂 seq=1 的实例节点；
 *   - 中间段 → 穿透（不产生实例层），进入该行的子项行视图继续。
 * - 未配对的 delete/add 实例 → 独立节点（追加序号），不参与左右聚合。
 */

/** 参与挂载的叶子实例（已解析 bom_path） */
export interface CompareLeafInput {
  side: Side;
  /** 在所属侧 instances 数组中的下标 */
  index: number;
  /** 每段 bom_path → CompareNode.key（'ROOT' 兜底） */
  keyPath: string[];
  /** 每段的实例序号（":idx" 解析；无则 null） */
  seqs: (number | null)[];
}

/** 实例层数组的宿主：顶层 BOM 行（node.instances）或子项行（row.instances） */
type Host =
  | { kind: 'node'; node: CompareNode }
  | { kind: 'inst'; inst: CompareInstanceNode }
  | { kind: 'row'; row: CompareChildRow };

function ensureRow(rows: CompareChildRow[], parentKey: string, key: string, node: CompareNode): CompareChildRow {
  let row = rows.find((r) => r.node.key === key);
  if (!row) {
    // key 含父实例/父行的 key，保证全树唯一，且可作为选中时前缀匹配的路径
    row = { key: `${parentKey}:${key}`, node, instances: [], children: [] };
    rows.push(row);
  }
  return row;
}

/** 某上下文下 K 对应行的实例层数组 */
function instancesArrOf(ctx: Host, key: string, nodeMap: Map<string, CompareNode>): { arr: CompareInstanceNode[]; parentKey: string } {
  if (ctx.kind === 'node') return { arr: ctx.node.instances ??= [], parentKey: ctx.node.key };
  if (ctx.kind === 'inst') {
    const row = ensureRow(ctx.inst.children ??= [], ctx.inst.key, key, nodeMap.get(key)!);
    return { arr: row.instances ??= [], parentKey: row.key };
  }
  const row = ensureRow(ctx.row.children ??= [], ctx.row.key, key, nodeMap.get(key)!);
  return { arr: row.instances ??= [], parentKey: row.key };
}

function createInstance(parentKey: string, seq: number, side: Side | 'both' = 'both'): CompareInstanceNode {
  return {
    key: `${parentKey}:inst:${seq}`,
    changeType: 'none',
    side,
    seq,
    leftMeshUuids: [],
    rightMeshUuids: [],
    children: [],
  };
}

/** 该层已用序号中的最大值 + 1（delete/add 独立节点追加用） */
function nextSeq(arr: CompareInstanceNode[]): number {
  let max = 0;
  for (const n of arr) if (n.seq > max) max = n.seq;
  return max + 1;
}

function register(leaf: CompareLeafInput, instNode: CompareInstanceNode, instByRef: Map<string, CompareInstanceNode>, matchByRef: Map<string, InstanceMatch>) {
  instByRef.set(`${leaf.side}:${leaf.index}`, instNode);
  const m = matchByRef.get(`${leaf.side}:${leaf.index}`);
  if (leaf.side === 'left') {
    instNode.leftIndex = leaf.index;
    if (m) {
      instNode.rightIndex = m.rightIndex;
      instNode.changeType = m.changeType;
      instNode.side = m.side;
    } else {
      instNode.changeType = 'delete';
      instNode.side = 'left';
    }
  } else {
    instNode.rightIndex = leaf.index;
    if (m) {
      instNode.leftIndex = m.leftIndex;
      instNode.changeType = m.changeType;
      instNode.side = m.side;
    } else {
      instNode.changeType = 'add';
      instNode.side = 'right';
    }
  }
}

function mount(
  leaf: CompareLeafInput,
  ctx: Host,
  seg: number,
  nodeMap: Map<string, CompareNode>,
  instByRef: Map<string, CompareInstanceNode>,
  matchByRef: Map<string, InstanceMatch>,
  pairNodes: Map<string, CompareInstanceNode>,
  idxMap: Map<string, CompareInstanceNode>,
): void {
  const key = leaf.keyPath[seg];
  const idx = leaf.seqs[seg];
  const isLast = seg === leaf.keyPath.length - 1;

  if (idx !== null || isLast) {
    // 实例段：多实例段（idx 非空）或叶子单实例段
    const { arr, parentKey } = instancesArrOf(ctx, key, nodeMap);
    const m = matchByRef.get(`${leaf.side}:${leaf.index}`);
    const paired = !!m && m.side === 'both';

    let instNode: CompareInstanceNode;
    if (isLast) {
      // 叶子实例段：配对按"配对对"聚合 —— 数量不等时左右组内位置会错位
      // （左 idx1 可配右 idx0），seq/idx 不唯一；未配对 → 独立节点
      // （delete=left / add=right），nextSeq 追加不与配对区冲突。
      if (paired) {
        const pairKey = `${parentKey}|${m!.leftIndex}:${m!.rightIndex}`;
        const existing = pairNodes.get(pairKey);
        if (existing) {
          instNode = existing;
        } else {
          instNode = createInstance(parentKey, nextSeq(arr), 'both');
          pairNodes.set(pairKey, instNode);
          arr.push(instNode);
        }
      } else {
        instNode = createInstance(parentKey, nextSeq(arr), leaf.side);
        arr.push(instNode);
      }
    } else {
      // 中间实例段：按 (parentKey, idx) 聚合 —— 同一装配实例（idx）下的多个
      // 子项（如 003 与 001）共享一个中间实例；左右同 idx 即同一装配实例。
      // 配对状态须一致：配对 ↔ both，delete ↔ left，add ↔ right；同 idx 但
      // 配对状态不同（位置不同）视为不同实例，独立建节点。
      const instKey = `${parentKey}|idx:${idx}`;
      const existing = idxMap.get(instKey);
      if (existing && (paired ? existing.side === 'both' : existing.side === leaf.side)) {
        instNode = existing;
      } else {
        instNode = createInstance(parentKey, nextSeq(arr), paired ? 'both' : leaf.side);
        idxMap.set(instKey, instNode);
        arr.push(instNode);
      }
    }

    // 只有叶子段才注册（mesh 回填目标）；中间实例节点仅作层级分组，无几何
    if (isLast) register(leaf, instNode, instByRef, matchByRef);
    if (!isLast) mount(leaf, { kind: 'inst', inst: instNode }, seg + 1, nodeMap, instByRef, matchByRef, pairNodes, idxMap);
    return;
  }

  // 中间单实例段：穿透到子项行视图（不产生实例层）
  if (ctx.kind === 'node') {
    // 顶层单实例：跳到下一段对应的 BOM 行
    const next = nodeMap.get(leaf.keyPath[seg + 1]);
    mount(leaf, { kind: 'node', node: next ?? ctx.node }, seg + 1, nodeMap, instByRef, matchByRef, pairNodes, idxMap);
  } else if (ctx.kind === 'inst') {
    const row = ensureRow(ctx.inst.children ??= [], ctx.inst.key, key, nodeMap.get(key)!);
    mount(leaf, { kind: 'row', row }, seg + 1, nodeMap, instByRef, matchByRef, pairNodes, idxMap);
  } else {
    const row = ensureRow(ctx.row.children ??= [], ctx.row.key, key, nodeMap.get(key)!);
    mount(leaf, { kind: 'row', row }, seg + 1, nodeMap, instByRef, matchByRef, pairNodes, idxMap);
  }
}

/** 中间实例节点的 changeType 聚合：子孙有变更 → 'internal'（分组行黄底） */
function deriveChange(node: CompareInstanceNode): boolean {
  let changed = node.changeType !== 'none';
  for (const row of node.children ?? []) {
    for (const inst of row.instances ?? []) if (deriveChange(inst)) changed = true;
    for (const sub of row.children ?? []) if (deriveRow(sub)) changed = true;
  }
  if (changed && node.changeType === 'none') node.changeType = 'internal';
  return changed;
}

function deriveRow(row: CompareChildRow): boolean {
  let changed = false;
  for (const inst of row.instances ?? []) if (deriveChange(inst)) changed = true;
  for (const sub of row.children ?? []) if (deriveRow(sub)) changed = true;
  return changed;
}

/**
 * 构建实例层级树。
 *
 * @param leaves  全部叶子实例（左右两侧，含解析后的 keyPath/seqs）
 * @param nodeMap 对比树 BOM 行索引（node.key → CompareNode）
 * @param matchByRef 叶子配对索引：'left:idx' / 'right:idx' → InstanceMatch
 * @returns 实例引用表：'left:idx' / 'right:idx' → 叶子实例节点（mesh 回填用）
 */
export function buildCompareInstances(
  leaves: CompareLeafInput[],
  nodeMap: Map<string, CompareNode>,
  matchByRef: Map<string, InstanceMatch>,
): Map<string, CompareInstanceNode> {
  const instByRef = new Map<string, CompareInstanceNode>();
  // 叶子配对聚合表：`${parentKey}|${leftIndex}:${rightIndex}` → 叶子实例节点
  const pairNodes = new Map<string, CompareInstanceNode>();
  // 中间实例聚合表：`${parentKey}|idx:${idx}` → 中间实例节点
  const idxMap = new Map<string, CompareInstanceNode>();

  for (const leaf of leaves) {
    mount(leaf, { kind: 'node', node: nodeMap.get(leaf.keyPath[0]) ?? nodeMap.get('ROOT')! }, 0, nodeMap, instByRef, matchByRef, pairNodes, idxMap);
  }

  // 中间实例 changeType 聚合（后序遍历，从每个叶子实例节点向上）
  const seen = new Set<CompareInstanceNode>();
  const deriveUp = (node: CompareInstanceNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    deriveChange(node);
  };
  for (const node of instByRef.values()) deriveUp(node);
  for (const node of nodeMap.values()) {
    for (const inst of node.instances ?? []) deriveUp(inst);
  }

  // 实例层按 seq 排序（配对实例在前，delete/add 追加在后）
  const sortArr = (arr: CompareInstanceNode[]) => arr.sort((a, b) => a.seq - b.seq);
  for (const node of nodeMap.values()) {
    sortArr(node.instances ?? []);
    for (const inst of node.instances ?? []) sortRecursive(inst, sortArr);
  }

  return instByRef;
}

function sortRecursive(inst: CompareInstanceNode, sortArr: (a: CompareInstanceNode[]) => void): void {
  for (const row of inst.children ?? []) {
    sortArr(row.instances ?? []);
    for (const sub of row.children ?? []) sortSubRow(sub, sortArr);
    for (const subInst of row.instances ?? []) sortRecursive(subInst, sortArr);
  }
}

function sortSubRow(row: CompareChildRow, sortArr: (a: CompareInstanceNode[]) => void): void {
  sortArr(row.instances ?? []);
  for (const sub of row.children ?? []) sortSubRow(sub, sortArr);
  for (const subInst of row.instances ?? []) sortRecursive(subInst, sortArr);
}

/** 导出类型以便测试断言 */
export type { ChangeType };
