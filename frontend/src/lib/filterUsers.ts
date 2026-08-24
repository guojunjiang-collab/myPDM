/** 可被搜索挑选的用户最小结构 */
export interface PickableUser {
  id: string;
  real_name: string;
  username: string;
}

/**
 * 过滤可选用户：排除已选（excludedIds）+ 按姓名/账号模糊匹配（忽略大小写）。
 * 关键字为空白时返回排除后的全部用户。
 */
export function filterUsers<T extends PickableUser>(
  users: T[],
  excludedIds: Iterable<string>,
  query: string,
): T[] {
  const excluded = new Set(excludedIds);
  const q = query.trim().toLowerCase();
  return users.filter(
    (u) =>
      !excluded.has(u.id) &&
      (q === '' || u.real_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
  );
}
