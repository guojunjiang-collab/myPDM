import { useEffect, useState } from 'react';
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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await configurationProfileApi.list({ page, page_size: 20, search: search || undefined });
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page]);

  const handleSearch = () => { setPage(1); load(); };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await configurationProfileApi.delete(deleteId); setDeleteId(null); load(); } catch {}
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div>
      {/* 搜索 + 新建 */}
      <div className="flex gap-2 mb-4">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索编号/名称..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <button onClick={handleSearch} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">搜索</button>
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
            ) : items.map((profile) => (
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
