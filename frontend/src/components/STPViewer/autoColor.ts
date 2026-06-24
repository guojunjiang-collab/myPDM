import { Color } from 'three';

const GOLDEN_ANGLE = 137.508;
const SAT = 0.55;
const LIGHT = 0.55;

/**
 * 给定一组零件名称，返回 name -> 颜色(packed hex number) 的映射。
 * - 去重并按字典序排序，保证确定性（与输入顺序无关）。
 * - 第 i 个名称色相 = (i * 黄金角) % 360，固定 S/L。
 * - 同名必同色；不同名色相尽量拉开。
 */
export function buildColorMap(names: string[]): Map<string, number> {
  const uniq = Array.from(new Set(names)).sort();
  const map = new Map<string, number>();
  const c = new Color();
  uniq.forEach((name, i) => {
    const h = ((i * GOLDEN_ANGLE) % 360) / 360;
    c.setHSL(h, SAT, LIGHT);
    map.set(name, c.getHex());
  });
  return map;
}
