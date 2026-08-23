import { useEffect, useState, useMemo } from 'react';
import { configurationProfileApi, usersApi } from '../../services/api';
import type { ConfigurationProfile } from '../../types';
import { canEdit, isAdmin } from '../../stores/auth';
import { ConfirmModal } from '../Modal';
import ProfileEditModal from './ProfileEditModal';
import ProfileStatusBadge from './ProfileStatusBadge';
import ProfileCompareModal from './ProfileCompareModal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

export default function ProfileList() {
  const [items, setItems] = useState<ConfigurationProfile[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  const formatDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 搜索 + 新建 */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : '备注'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0"
        />
        <Select
          className="!w-auto"
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
        >
          <option value="all">全部字段</option>
          <option value="code">编号</option>
          <option value="name">名称</option>
          <option value="remark">备注</option>
        </Select>
        <Select
          className="!w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="reviewing">评审中</option>
          <option value="active">生效中</option>
          <option value="rejected">已驳回</option>
          <option value="archived">已归档</option>
        </Select>
        <Button onClick={() => setCompareOpen(true)}>
          ⇄ 配置对比
        </Button>
        <div className="flex-1" />
        {canEdit() && (
          <Button onClick={() => setCreateOpen(true)}>+ 新建配置</Button>
        )}
      </div>

      {/* 表格 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">编号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">状态</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">架次</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">创建时间</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)] w-0 whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : pagedData.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">无匹配结果</td></tr>
            ) : pagedData.map((profile) => (
              <tr key={profile.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setDetailId(profile.id)}>
                <td className="px-4 py-3 text-sm font-medium">{profile.code}</td>
                <td className="px-4 py-3 text-sm font-medium">{profile.name}</td>
                <td className="px-4 py-3 text-sm font-medium"><ProfileStatusBadge status={profile.status} /></td>
                <td className="px-4 py-3 text-sm font-medium">{profile.effectivity_start || '-'} ~ {profile.effectivity_end || '-'}</td>
                <td className="px-4 py-3 text-sm font-medium">{formatDate(profile.created_at)}</td>
                <td className="px-4 py-3 text-right text-sm space-x-3 w-0 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  {profile.status === 'draft' && (
                    <>
                      {canEdit() && (
                        <Button variant="link" size="xs" onClick={() => setEditId(profile.id)}>编辑</Button>
                      )}
                      <Button variant="link" size="xs" onClick={() => handleSubmit(profile)}>提交评审</Button>
                    </>
                  )}
                  {profile.status === 'reviewing' && (
                    <>
                      <Button variant="link" size="xs" onClick={() => setDetailId(profile.id)}>审批</Button>
                      <Button variant="link" size="xs" onClick={() => handleWithdraw(profile.id)}>撤回</Button>
                      <Button variant="link" size="xs" onClick={() => handleCcOpen(profile.id)}>知会</Button>
                    </>
                  )}
                  {profile.status === 'active' && (
                    <>
                      {isAdmin() && (
                        <Button variant="link" size="xs" onClick={() => handleArchive(profile.id)}>归档</Button>
                      )}
                      <Button variant="link" size="xs" onClick={() => handleCcOpen(profile.id)}>知会</Button>
                    </>
                  )}
                  {profile.status === 'rejected' && (
                    <>
                      <Button variant="link" size="xs" onClick={() => handleReopen(profile.id)}>重新编辑</Button>
                      {isAdmin() && (
                        <Button variant="link" size="xs" onClick={() => handleArchive(profile.id)}>归档</Button>
                      )}
                      <Button variant="link" size="xs" onClick={() => handleCcOpen(profile.id)}>知会</Button>
                    </>
                  )}
                  {profile.status === 'archived' && (
                    <Button variant="link" size="xs" onClick={() => setDetailId(profile.id)}>查看</Button>
                  )}
                  {isAdmin() && (
                    <Button variant="danger" size="xs" onClick={() => setDeleteId(profile.id)}>删除</Button>
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
          <Select
            onChange={(e) => { if (e.target.value) handleCcAdd(e.target.value); }}
            size="xs"
            autoFocus
          >
            <option value="">请选择</option>
            {ccUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.real_name}</option>
            ))}
          </Select>
          <Button variant="link" size="xs" onClick={() => setCcTargetId(null)}>取消</Button>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-4">
          {Array.from({ length: totalPages }, (_, i) => (
            <Button key={i} onClick={() => setPage(i + 1)}
              variant={page === i + 1 ? 'primary' : 'ghost'} size="xs"
            >{i + 1}</Button>
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

      <ProfileCompareModal open={compareOpen} onClose={() => setCompareOpen(false)} />
    </div>
  );
}
