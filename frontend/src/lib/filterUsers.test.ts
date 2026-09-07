import { describe, expect, it } from 'vitest';
import { filterUsers } from './filterUsers';

const users = [
  { id: '1', real_name: '张伟', username: 'zhangwei' },
  { id: '2', real_name: '李娜', username: 'lina' },
  { id: '3', real_name: '王小明', username: 'wangxiaoming' },
  { id: '4', real_name: 'Amy Wang', username: 'amywang' },
];

describe('filterUsers', () => {
  it('空查询时返回排除已选后的全部用户', () => {
    expect(filterUsers(users, ['2'], '')).toEqual([users[0], users[2], users[3]]);
  });

  it('按真实姓名模糊匹配', () => {
    expect(filterUsers(users, [], '王')).toEqual([users[2]]);
  });

  it('按账号模糊匹配且忽略大小写', () => {
    expect(filterUsers(users, [], 'WANG')).toEqual([users[2], users[3]]);
  });

  it('同时排除已选用户与关键字匹配', () => {
    expect(filterUsers(users, ['3'], '王')).toEqual([]);
  });

  it('关键字为空白时按空查询处理', () => {
    expect(filterUsers(users, [], '   ')).toEqual(users);
  });

  it('无匹配时返回空数组', () => {
    expect(filterUsers(users, [], '不存在的用户xyz')).toEqual([]);
  });
});
