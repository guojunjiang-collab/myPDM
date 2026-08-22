export function bomPath(parentPath: string, childId: string): string {
  // parentPath 可能是详情页路径（/parts/{master}）或 BOM 页自身路径（/parts/{master}/bom）：
  // 以 /bom 结尾时直接拼接，否则补 /bom/，避免产生 /bom/bom/ 冗余段。
  const base = parentPath.endsWith('/bom') ? parentPath : `${parentPath}/bom`;
  return `${base}/${childId}`;
}
export function parentBomPath(path: string): string {
  // URL 层级：/parts/{master}/bom（首层）/bom/{c1}（一层）/bom/{c1}/bom/{c2}（二层）...
  // 上级：二层+ 去掉最后一个 /bom/{child}；一层 去掉最后一个 /{child}（保留 /bom）；首层返回列表页。
  const multi = path.match(/^(.*\/bom\/[^/]+)\/bom\/[^/]+$/);
  if (multi) return multi[1];
  const single = path.match(/^(\/parts\/[^/]+\/bom)\/[^/]+$/);
  if (single) return single[1];
  return '/parts';
}
