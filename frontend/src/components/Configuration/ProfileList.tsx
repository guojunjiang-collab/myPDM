import { useEffect, useState, useMemo } from 'react';
import { configurationProfileApi } from '../../services/api';
import type { ConfigurationProfile } from '../../types';
import { canEdit, isAdmin } from '../../stores/auth';
import { ConfirmModal } from '../Modal';
import ProfileEditModal from './ProfileEditModal';

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800',
    active: 'bg-green-100 text-green-800',
    archived: 'bg-gray-100 text-gray-800',
  };
  const label: Record<string, string> = {
    draft: '草稿', active: '生效', archived: '归档',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[status] || ''}`}>{label[status] || status}</span>;
};

export default function ProfileList() {
  const [items, setItems] = useState<ConfigurationProfile[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await configurationProfileApi.list({ page: 1, page_size: 100 });
      setItems(res.data.items || []);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // 客户端筛选
  const filteredData = useMemo(() => {
    if (!search) return items;
    const keyword = search.toLowerCase();
    const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
    return items.filter(item => {
      if (searchField === 'all') {
        return match(item.code) || match(item.name) || match(item.remark);
      }
      if (searchField === 'code') return match(item.code);
      if (searchField === 'name') return match(item.name);
      if (searchField === 'remark') return match(item.remark);
      return true;
    });
  }, [items, search, searchField]);

  // 分页
  const PAGE_SIZE = 20;
  const total = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagedData = filteredData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 搜索变化时重置页码
  useEffect(() => { setPage(1); }, [search, searchField]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await configurationProfileApi.delete(deleteId); setDeleteId(null); load(); } catch {}
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <div>
      {/* 搜索 + 新建 */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">编号</option>
          <option value="name">名称</option>
          <option value="remark">备注</option>
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : '备注'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="flex-1" />
        {canEdit() && (
          <button onClick={() => setCreateOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建配置</button>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">编号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">架次</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : pagedData.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : pagedData.map((profile) => (
              <tr key={profile.id} onClick={() => setDetailId(profile.id)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium">{profile.code}</td>
                <td className="px-4 py-3 text-sm">{profile.name}</td>
                <td className="px-4 py-3 text-sm">{statusBadge(profile.status)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{profile.effectivity_start || '-'} ~ {profile.effectivity_end || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{formatDate(profile.created_at)}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  {profile.status === 'draft' && canEdit() && (
                    <button onClick={(e) => { e.stopPropagation(); setEditId(profile.id); }} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                  )}
                  {isAdmin() && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(profile.id); }} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-4">
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`px-3 py-1 text-xs rounded ${page === i + 1 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >{i + 1}</button>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      <ProfileEditModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      {/* 详情弹窗（只读） */}
      <ProfileEditModal
        open={!!detailId}
        profileId={detailId || undefined}
        readOnly={true}
        onClose={() => setDetailId(null)}
        onSaved={() => { setDetailId(null); load(); }}
      />

      {/* 编辑弹窗 */}
      <ProfileEditModal
        open={!!editId}
        profileId={editId || undefined}
        readOnly={false}
        onClose={() => setEditId(null)}
        onSaved={() => { setEditId(null); load(); }}
      />

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title="删除配置"
        content="确定要删除该构型配置吗？配置清单将一并删除。"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
