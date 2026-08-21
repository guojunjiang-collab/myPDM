export function bomPath(parentPath: string, childId: string): string {
  return `${parentPath}/bom/${childId}`;
}
export function parentBomPath(path: string): string {
  const parts = path.split('/bom/');
  parts.pop();
  return parts.join('/bom/') || '/parts';
}
