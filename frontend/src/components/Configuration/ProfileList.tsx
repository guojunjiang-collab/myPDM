import { useEffect, useState, useMemo, useRef } from 'react';
import { configurationProfileApi, usersApi } from '../../services/api';
import type { ConfigurationProfile } from '../../types';
import { canEdit, isAdmin, canDownload } from '../../stores/auth';
import { ConfirmModal } from '../Modal';
import ProfileEditModal from './ProfileEditModal';
import ProfileStatusBadge from './ProfileStatusBadge';
import {
  exportConfigurationProfiles,
  previewConfigurationProfilesImport,
  executeConfigurationProfilesImport,
} from '../../services/importExport';
import type { ImportPreview } from '../../services/importExport';
import ImportPreviewModal from '../ImportPreviewModal';

export default function ProfileList() {
  const [items, setItems] = useState<ConfigurationProfile[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // 导入导出
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 知会
  const [ccTargetId, setCcTargetId] = useState<string | null>(null);
  const [ccUsers, setCcUsers] = useState<{ id: string; real_name: string }[]>([]);

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
    let result = items;
    if (statusFilter) {
      result = result.filter((item) => item.status === statusFilter);
    }
    if (!search) return result;
    const keyword = search.toLowerCase();
    const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
    return result.filter(item => {
      if (searchField === 'all') {
        return match(item.code) || match(item.name) || match(item.remark);
      }
      if (searchField === 'code') return match(item.code);
      if (searchField === 'name') return match(item.name);
      if (searchField === 'remark') return match(item.remark);
      return true;
    });
  }, [items, search, searchField, statusFilter]);

  // 分页
  const PAGE_SIZE = 20;
  const total = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagedData = filteredData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 搜索变化时重置页码
  useEffect(() => { setPage(1); }, [search, searchField, statusFilter]);

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await configurationProfileApi.delete(deleteId); setDeleteId(null); load(); } catch {}
  };

  const handleSubmit = async (profile: ConfigurationProfile) => {
    if ((profile.reviewer_count ?? profile.reviewers?.length ?? 0) === 0) {
      if (!confirm('当前无审批人，提交后将直接生效。确认提交？')) return;
    }
    try { await configurationProfileApi.submit(profile.id); load(); } catch {}
  };
  const handleWithdraw = async (id: string) => {
    try { await configurationProfileApi.withdraw(id); load(); } catch {}
  };
  const handleReopen = async (id: string) => {
    try { await configurationProfileApi.reopen(id); load(); } catch {}
  };
  const handleArchive = async (id: string) => {
    if (!confirm('确认归档该配置？')) return;
    try { await configurationProfileApi.archive(id); load(); } catch {}
  };

  const handleCcOpen = async (id: string) => {
    setCcTargetId(id);
    try {
      const resp = await usersApi.list({ page_size: 200 });
      const list = resp.data?.items || resp.data || [];
      setCcUsers(Array.isArray(list) ? list : []);
    } catch { setCcUsers([]); }
  };
  const handleCcAdd = async (userId: string) => {
    if (!ccTargetId) return;
    const u = ccUsers.find((x) => x.id === userId);
    try {
      await configurationProfileApi.addCc(ccTargetId, userId, u?.real_name || '');
      setCcTargetId(null);
      load();
    } catch {}
  };

  const handleExport = async () => {
    try {
      await exportConfigurationProfiles();
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const preview = await previewConfigurationProfilesImport(file);
      setImportPreview(preview);
      setImportPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || '导入解析失败');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await executeConfigurationProfilesImport(importPreview);
      setImportPreviewOpen(false);
      setImportPreview(null);
      load();
      let msg = `导入成功（新增 ${result.created}，更新 ${result.updated}）`;
      if (result.warnings.length > 0) {
        msg += `\n\n⚠️ ${result.warnings.length} 条告警：\n` + result.warnings.slice(0, 20).join('\n');
        if (result.warnings.length > 20) msg += `\n… 其余 ${result.warnings.length - 20} 条见控制台`;
      }
      alert(msg);
    } catch (err: any) {
      alert(err.message || '导入执行失败');
    } finally {
      setImporting(false);
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 搜索 + 新建 */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="reviewing">评审中</option>
          <option value="active">生效中</option>
          <option value="rejected">已驳回</option>
          <option value="archived">已归档</option>
        </select>
        <div className="flex-1" />
        {canDownload() && (
          <button onClick={handleExport} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">导出全部</button>
        )}
        {canEdit() && (
          <>
            <button onClick={handleImportClick} disabled={importLoading} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">{importLoading ? '解析中...' : '导入'}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          </>
        )}
        {canEdit() && (
          <button onClick={() => setCreateOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建配置</button>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">编号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">架次</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500 w-0 whitespace-nowrap">操作</th>
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
              <tr key={profile.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetailId(profile.id)}>
                <td className="px-4 py-3 text-sm font-medium">{profile.code}</td>
                <td className="px-4 py-3 text-sm font-medium">{profile.name}</td>
                <td className="px-4 py-3 text-sm font-medium"><ProfileStatusBadge status={profile.status} /></td>
                <td className="px-4 py-3 text-sm font-medium">{profile.effectivity_start || '-'} ~ {profile.effectivity_end || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{formatDate(profile.created_at)}</td>
                <td className="px-4 py-3 text-right text-sm space-x-3 w-0 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {profile.status === 'draft' && (
                    <>
                      {canEdit() && (
                        <button onClick={() => setEditId(profile.id)} className="text-primary-600 hover:text-primary-800">编辑</button>
                      )}
                      <button onClick={() => handleSubmit(profile)} className="text-green-600 hover:text-green-800">提交评审</button>
                    </>
                  )}
                  {profile.status === 'reviewing' && (
                    <>
                      <button onClick={() => setDetailId(profile.id)} className="text-primary-600 hover:text-primary-800">审批</button>
                      <button onClick={() => handleWithdraw(profile.id)} className="text-orange-600 hover:text-orange-800">撤回</button>
                      <button onClick={() => handleCcOpen(profile.id)} className="text-blue-600 hover:text-blue-800">知会</button>
                    </>
                  )}
                  {profile.status === 'active' && (
                    <>
                      {isAdmin() && (
                        <button onClick={() => handleArchive(profile.id)} className="text-gray-600 hover:text-gray-800">归档</button>
                      )}
                      <button onClick={() => handleCcOpen(profile.id)} className="text-blue-600 hover:text-blue-800">知会</button>
                    </>
                  )}
                  {profile.status === 'rejected' && (
                    <>
                      <button onClick={() => handleReopen(profile.id)} className="text-primary-600 hover:text-primary-800">重新编辑</button>
                      {isAdmin() && (
                        <button onClick={() => handleArchive(profile.id)} className="text-gray-600 hover:text-gray-800">归档</button>
                      )}
                      <button onClick={() => handleCcOpen(profile.id)} className="text-blue-600 hover:text-blue-800">知会</button>
                    </>
                  )}
                  {profile.status === 'archived' && (
                    <button onClick={() => setDetailId(profile.id)} className="text-gray-600 hover:text-gray-800">查看</button>
                  )}
                  {isAdmin() && (
                    <button onClick={() => setDeleteId(profile.id)} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 知会用户选择 */}
      {ccTargetId && (
        <div className="flex items-center gap-2 mt-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm text-blue-700">选择知会人：</span>
          <select
            onChange={(e) => { if (e.target.value) handleCcAdd(e.target.value); }}
            className="border border-blue-300 rounded px-2 py-1 text-sm bg-white"
            autoFocus
          >
            <option value="">请选择</option>
            {ccUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.real_name}</option>
            ))}
          </select>
          <button onClick={() => setCcTargetId(null)} className="text-gray-400 hover:text-gray-600 text-sm">取消</button>
        </div>
      )}

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

      {/* 导入预览弹窗 */}
      <ImportPreviewModal
        open={importPreviewOpen}
        preview={importPreview}
        loading={importing}
        onClose={() => { setImportPreviewOpen(false); setImportPreview(null); }}
        onConfirm={handleImportConfirm}
      />
    </div>
  );
}
