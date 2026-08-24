/**
 * 实例级匹配：判定左右两版装配中的零件实例是否为"同一个实例"。
 *
 * 判定分两轮：
 * 1. 件号 + 版本（revision_id）+ 空间位置三者全同 → none（未变）。
 *    revision_id 在数据上等价于"件号+版本"这对组合，是同一个 PartRevision。
 * 2. 件号相同、版本不同、位置相同 → modify（版本变更）。零件升版必然产生
 *    新 revision_id，但件号（master）不变、摆位不变，仍是同一个实例，只是换了版本，
 *    不能算删除+新增。
 * 其余（件号不同，或位置不同）→ delete / add。
 *
 * 空间位置按容差比对矩阵。不用 toFixed 串比：一是舍入边界会抖
 * （0.00005 与 0.000049999 落到不同串），二是同一装配重新导出后矩阵尾数几乎必然
 * 变化，4 位小数在 mm 单位下约等于要求二进制完全一致。
 */

/** 平移欧氏距离阈值（mm）。远小于任何有意义的位置变动，又足以吸收重导出噪声。 */
export const POSITION_TOLERANCE = 0.01;

/** 旋转 3×3 分量最大绝对差阈值（约 0.006°） */
export const ROTATION_TOLERANCE = 1e-4;

/** 行主序 4×4 中平移分量的下标 */
const TRANSLATION_INDICES = [3, 7, 11];

/** 行主序 4×4 中旋转 3×3 部分的下标 */
const ROTATION_INDICES = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/** 参与匹配的实例引用 */
export interface InstanceRef {
  /** 在所属侧 instances 数组中的下标 */
  index: number;
  /** 行主序 4×4，共 16 个数 */
  matrix: number[];
  /** 件号（master 等价身份）：版本变更但件号不变仍是同一个零件 */
  code: string;
  /** 件号+版本的等价身份 */
  revisionId: string;
}

/** 一条匹配结果 */
export interface InstanceMatch {
  changeType: 'none' | 'add' | 'delete' | 'modify';
  side: 'left' | 'right' | 'both';
  leftIndex?: number;
  rightIndex?: number;
}

/**
 * 两个矩阵是否表示同一空间位置。
 * 平移与旋转分开设阈值——两者量纲不同，用同一个数比没有物理意义。
 */
export function isSamePlacement(a: number[], b: number[]): boolean {
  if (a.length !== 16 || b.length !== 16) return false;

  let sq = 0;
  for (const i of TRANSLATION_INDICES) {
    const d = a[i] - b[i];
    sq += d * d;
  }
  if (Math.sqrt(sq) > POSITION_TOLERANCE) return false;

  for (const i of ROTATION_INDICES) {
    if (Math.abs(a[i] - b[i]) > ROTATION_TOLERANCE) return false;
  }
  return true;
}

/**
 * 左右实例配对。左侧按序贪心：
 * 1. 第一轮：找第一个未被占用、revision 相同、位置相同的右实例配成 none；
 * 2. 第二轮：把第一轮落空的 delete 项，升级为"件号相同、位置相同但版本不同"的
 *    modify（版本变更），从右侧未被占用的实例中配对；
 * 3. 左侧剩余标 delete，右侧剩余标 add。
 *
 * 贪心不保证全局最优，但在 0.01mm 容差下两个候选同时命中意味着两个零件几乎
 * 重叠——现实装配里不出现，因此解唯一。两轮分离保证同版本实例优先配对，
 * 版本不同的实例只与真正没有同版本对手的实例配对。
 *
 * 返回顺序即树中显示顺序：左侧原序在前，右侧未匹配追加在后。
 */
export function matchInstancePairs(left: InstanceRef[], right: InstanceRef[]): InstanceMatch[] {
  const out: InstanceMatch[] = [];
  const usedRight = new Set<number>();

  for (const l of left) {
    const hit = right.findIndex(
      (r, i) => !usedRight.has(i) && r.revisionId === l.revisionId && isSamePlacement(l.matrix, r.matrix),
    );
    if (hit >= 0) {
      usedRight.add(hit);
      out.push({ changeType: 'none', side: 'both', leftIndex: l.index, rightIndex: right[hit].index });
    } else {
      out.push({ changeType: 'delete', side: 'left', leftIndex: l.index });
    }
  }

  // 第二轮：同件号、不同版本、位置相同 → 版本变更（modify）
  // 注意：out 前 left.length 项与 left 数组一一对应（左侧原序 push），必须按
  // 数组下标 i 取左实例 —— m.leftIndex 是原始 instances 数组的下标，而 left 是
  // 分组后的子集数组，用它索引 left 会越界成 undefined。
  for (let i = 0; i < left.length; i++) {
    const m = out[i];
    if (m.changeType !== 'delete') continue;
    const l = left[i];
    const hit = right.findIndex(
      (r, j) =>
        !usedRight.has(j) &&
        r.code === l.code &&
        r.revisionId !== l.revisionId &&
        isSamePlacement(l.matrix, r.matrix),
    );
    if (hit >= 0) {
      usedRight.add(hit);
      m.changeType = 'modify';
      m.side = 'both';
      m.rightIndex = right[hit].index;
    }
  }

  for (let i = 0; i < right.length; i++) {
    if (!usedRight.has(i)) {
      out.push({ changeType: 'add', side: 'right', rightIndex: right[i].index });
    }
  }

  return out;
}
