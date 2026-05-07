import { useEffect, useState } from 'react';
import { partsApi } from '../services/api';
import type { Part } from '../types';
import { canEdit } from '../stores/auth';

export default function Parts() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadParts();
  }, [search, status]);

  const loadParts = async () => {
    try {
      const response = await partsApi.list({ search, status });
      setParts(response.data.items || []);
    } catch (error) {
      console.error('加载零件失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该零件吗？')) return;
    try {
      await partsApi.delete(id);
      loadParts();
    } catch (error) {
      alert('删除失败');
    }
  };

  const getStatusTag = (s: string) => {
    const tags: Record<string, { label: string; class: string }> = {
      draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
      frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
      released: { label: '发布', class: 'bg-green-100 text-green-800' },
      obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
    };
    return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">零件管理</h2>
        {canEdit() && (
          <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            新增零件
          </button>
        )}
      </div>

      {/* 搜索筛选 */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索零件编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">编号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">规格</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">创建时间</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {parts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              parts.map((part) => (
                <tr key={part.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{part.code}</td>
                  <td className="px-4 py-3 text-sm">{part.name}</td>
                  <td className="px-4 py-3 text-sm">{part.spec || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        getStatusTag(part.status).class
                      }`}
                    >
                      {getStatusTag(part.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {part.created?.slice(0, 10) || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-primary-600 hover:text-primary-800 mr-2">
                      编辑
                    </button>
                    {canEdit() && (
                      <button
                        className="text-red-600 hover:text-red-800"
                        onClick={() => handleDelete(part.id)}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}