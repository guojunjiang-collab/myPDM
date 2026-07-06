import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { PartListItem, PartMaster, PartRevision, PartIteration, PartStatus, CascadeResult } from '../types';
import { Loading } from '../components/Loading';
import { toast } from '../components/Toast';
import { Modal } from '../components/Modal';
import { useTableSort } from '../hooks/useTableSort';

const STATUS_LABELS: Record<PartStatus, string> = {
  draft: '草稿', frozen: '冻结', released: '已发布', obsolete: '已作废',
};

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

export default function PartsPage() {
  const { masterId } = useParams<{ masterId: string }>();
  if (masterId) {
    return <PartDetailPanel masterId={masterId} />;
  }
  return <PartList />;
}

function PartList() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [allData, setAllData] = useState<PartListItem[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page_size: 200 };
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      if (search && searchField === 'all') params.search = search;
      else if (searchField === 'code') params.search = search;
      else if (searchField === 'name') params.search = search;
      else if (searchField === 'spec') params.search = search;
      const res = await partsApi.list(params);
      const rawItems = res.items || [];
      setAllData(rawItems);

      let filtered: PartListItem[] = rawItems;
      if (search && searchField !== 'all') {
        const kw = search.toLowerCase();
        if (searchField === 'code') filtered = rawItems.filter((i: PartListItem) => i.code?.toLowerCase().includes(kw));
        else if (searchField === 'name') filtered = rawItems.filter((i: PartListItem) => i.name?.toLowerCase().includes(kw));
        else if (searchField === 'spec') filtered = rawItems.filter((i: PartListItem) => i.spec?.toLowerCase().includes(kw));
      }

      if (!showAllVersions) {
        const latestMap: Record<string, PartListItem> = {};
        filtered.forEach((item: PartListItem) => {
          const existing = latestMap[item.code];
          if (!existing || new Date(item.created_at || 0) > new Date(existing.created_at || 0)) {
            latestMap[item.code] = item;
          }
        });
        filtered = Object.values(latestMap);
      }

      setItems(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, searchField, statusFilter, typeFilter, showAllVersions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const versionCountMap: Record<string, number> = {};
  allData.forEach(item => {
    versionCountMap[item.code] = (versionCountMap[item.code] || 0) + 1;
  });

  const { sortedData, handleSort, getSortIcon } = useTableSort<PartListItem>(items, 'code', 'asc');

  const handleCheckout = async (revisionId: string) => {
    try {
      await partsApi.checkout(revisionId);
      toast.success('签出成功');
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签出失败');
    }
  };

  const showCheckoutButton = (item: PartListItem) => {
    return item.status === 'draft' && !item.check_out_user_id;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">件号</option>
          <option value="name">中文名称</option>
          <option value="spec">规格型号</option>
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : `搜索${searchField === 'code' ? '件号' : searchField === 'name' ? '名称' : '规格型号'}...`}
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
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部类型</option>
          <option value="part">零件</option>
          <option value="assembly">部件</option>
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          全部版本
        </label>
        <div className="flex-1" />
        <button
          onClick={() => navigate('/parts/new')}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
        >
          + 新增零件
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof PartListItem)} className="w-56 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                件号 {getSortIcon('code' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('name' as keyof PartListItem)} className="w-80 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                中文名称 {getSortIcon('name' as keyof PartListItem)}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                规格型号
              </th>
              <th onClick={() => handleSort('version' as keyof PartListItem)} className="w-16 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                版本 {getSortIcon('version' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('type' as keyof PartListItem)} className="w-16 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                类型 {getSortIcon('type' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('status' as keyof PartListItem)} className="w-20 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                状态 {getSortIcon('status' as keyof PartListItem)}
              </th>
              <th className="w-28 px-4 py-3 text-left text-sm font-medium text-gray-500">
                签出状态
              </th>
              <th className="w-32 px-4 py-3 text-right text-sm font-medium text-gray-500">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  无匹配数据
                </td>
              </tr>
            ) : (
              sortedData.map((item) => (
                <tr key={item.revision_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">
                    {item.code}
                    {!showAllVersions && (versionCountMap[item.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[item.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm truncate">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 break-words whitespace-normal">{item.spec || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{item.version}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${item.type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                      {item.type === 'assembly' ? '部件' : '零件'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(item.status).cls}`}>
                      {statusTag(item.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.check_out_user_name ? (
                      <span className="text-orange-600">{item.check_out_user_name}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => navigate(`/parts/${item.master_id}?revision=${item.revision_id}`)}
                      className="text-primary-600 hover:text-primary-800 mr-3"
                    >
                      详情
                    </button>
                    {showCheckoutButton(item) && (
                      <button
                        onClick={() => handleCheckout(item.revision_id)}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        签出
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

function PartDetailPanel({ masterId }: { masterId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [master, setMaster] = useState<PartMaster | null>(null);
  const [revision, setRevision] = useState<PartRevision | null>(null);
  const [iteration, setIteration] = useState<PartIteration | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'bom' | 'docs' | 'attachments' | 'versions' | 'iterations'>('info');
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [viewingIteration, setViewingIteration] = useState<PartIteration | null>(null);
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  const [bomItems, setBomItems] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [iterationsList, setIterationsList] = useState<any[]>([]);

  const revisionId = searchParams.get('revision') || revision?.id;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const m = await partsApi.get(masterId);
      setMaster(m);
      const revId = searchParams.get('revision') || (m.latest_revision?.id);
      if (revId) {
        const rev = await partsApi.getRevision(revId);
        setRevision(rev);
        if (rev.current_iteration) {
          setIteration(rev.current_iteration);
        }
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [masterId, searchParams]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadTabs = useCallback(async () => {
    if (!revisionId) return;
    try {
      if (activeTab === 'bom' && master?.type === 'assembly') {
        setBomItems(await partsApi.getBOM(revisionId));
      }
      if (activeTab === 'versions') {
        setVersions(await partsApi.revisions(masterId));
      }
      if (activeTab === 'iterations') {
        setIterationsList(await partsApi.iterations(revisionId));
      }
    } catch (e) { console.error(e); }
  }, [revisionId, activeTab, master?.type, masterId]);

  useEffect(() => { loadTabs(); }, [loadTabs]);

  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const isAdmin = user?.role === 'admin';
  const canEdit = revision?.status === 'draft' && isCheckedOutByMe;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canFreeze = revision?.status === 'draft';
  const canUnfreeze = revision?.status === 'frozen' && isAdmin;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdmin;

  const doAction = async (action: () => Promise<any>, msg: string) => {
    try {
      await action();
      toast.success(msg);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '操作失败');
    }
  };

  const handleCascade = async (action: 'checkout' | 'checkin' | 'undo') => {
    if (!revisionId) return;
    try {
      let result: CascadeResult;
      if (action === 'checkout') result = await partsApi.cascadeCheckout(revisionId);
      else if (action === 'checkin') result = await partsApi.cascadeCheckin(revisionId);
      else result = await partsApi.cascadeUndocheckout(revisionId);
      toast.success(`成功: ${result.succeed_count}, 跳过: ${result.failed_count}`);
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '级联操作失败');
    }
  };

  const handleViewIteration = async (iterationId: string) => {
    if (!revisionId) return;
    try {
      const iter = await partsApi.getIteration(revisionId, iterationId);
      setViewingIterationId(iterationId);
      setViewingIteration(iter);
    } catch (e) { console.error(e); }
  };

  const currentDisplay = viewingIteration || iteration;

  const tabs = useMemo(() => [
    { key: 'info' as const, label: '基本信息', show: !!currentDisplay },
    { key: 'bom' as const, label: 'BOM结构', show: master?.type === 'assembly' },
    { key: 'docs' as const, label: '关联文档', show: !!currentDisplay },
    { key: 'attachments' as const, label: '附件', show: true },
    { key: 'versions' as const, label: '版本历史', show: true },
    { key: 'iterations' as const, label: '迭代历史', show: true },
  ].filter(t => t.show), [currentDisplay, master?.type]);

  if (loading && !master) return <Loading />;

  return (
    <div className="h-full flex flex-col">
      <button onClick={() => navigate('/parts')} className="text-primary-600 hover:text-primary-800 hover:underline text-sm mb-2 self-start">
        &larr; 返回列表
      </button>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">件号：</span> <span className="font-mono font-medium">{master?.code}</span></div>
          <div><span className="text-gray-500">名称：</span> {master?.name}</div>
          <div><span className="text-gray-500">规格：</span> {master?.spec || '—'}</div>
          <div><span className="text-gray-500">类型：</span> {master?.type === 'assembly' ? '部件' : '零件'}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm">版本：{revision?.version}</span>
            <span className={`px-2 py-1 text-xs rounded-full ${statusTag(revision?.status || 'draft').cls}`}>
              {statusTag(revision?.status || 'draft').label}
            </span>
            {isCheckedOut && (
              <span className="text-xs text-orange-600">已签出：{revision?.check_out_user_name}</span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {canCheckout && (
              <button onClick={() => doAction(() => partsApi.checkout(revisionId!), '签出成功')}
                className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签出</button>
            )}
            {canCheckin && (
              <button onClick={() => setShowCheckinModal(true)}
                className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">检入</button>
            )}
            {canUndo && (
              <button onClick={() => doAction(() => partsApi.undocheckout(revisionId!), '已撤销')}
                className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>
            )}
            {canFreeze && (
              <button onClick={() => doAction(() => partsApi.freeze(revisionId!), '已冻结')}
                className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>
            )}
            {canUnfreeze && (
              <button onClick={() => doAction(() => partsApi.unfreeze(revisionId!), '已解冻')}
                className="px-3 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">解冻</button>
            )}
            {canRelease && (
              <button onClick={() => doAction(() => partsApi.release(revisionId!), '已发布')}
                className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">发布</button>
            )}
            {canUpgrade && (
              <button onClick={() => doAction(() => partsApi.upgrade(revisionId!), '已升版')}
                className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>
            )}
            {canObsolete && (
              <button onClick={() => doAction(() => partsApi.obsolete(revisionId!), '已作废')}
                className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>
            )}
            {canForceCheckin && (
              <button onClick={() => doAction(() => partsApi.forceCheckin(revisionId!), '已强制签入')}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>
            )}
          </div>
        </div>
      </div>

      {viewingIterationId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 mb-4 text-sm flex items-center justify-between">
          <span>正在查看 Iteration #{viewingIteration?.iteration} 的历史数据（只读）</span>
          <button onClick={() => { setViewingIterationId(null); setViewingIteration(null); }}
            className="text-primary-600 hover:text-primary-800 hover:underline text-xs">返回当前迭代</button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex border-b border-gray-200 shrink-0">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {activeTab === 'info' && currentDisplay && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">
                Iteration #{currentDisplay.iteration}
                {currentDisplay.check_in_note && <span className="ml-2">签入说明：{currentDisplay.check_in_note}</span>}
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(currentDisplay.custom_fields || {}).map(([k, v]) => (
                    <div key={k}>
                      <label className="text-xs text-gray-500">{k}</label>
                      <div className="text-sm">{String(v)}</div>
                    </div>
                  ))}
                  {Object.keys(currentDisplay.custom_fields || {}).length === 0 && (
                    <div className="text-gray-400 text-sm">无</div>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-1">备注</h4>
                <div className="text-sm text-gray-600">{currentDisplay.remark || '—'}</div>
              </div>
            </div>
          )}

          {activeTab === 'bom' && master?.type === 'assembly' && (
            <div>
              <div className="flex gap-2 mb-3">
                <button onClick={() => handleCascade('checkout')}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">级联签出</button>
                <button onClick={() => handleCascade('checkin')}
                  className="px-3 py-1.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">级联检入</button>
                <button onClick={() => handleCascade('undo')}
                  className="px-3 py-1.5 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">级联撤销</button>
              </div>
              {bomItems.length === 0 ? (
                <div className="text-gray-400 text-sm">无BOM子项</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">件号</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">版本</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">数量</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {bomItems.map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono">{item.child_code}</td>
                        <td className="px-4 py-3">{item.child_name}</td>
                        <td className="px-4 py-3">{item.child_version}</td>
                        <td className="px-4 py-3">{item.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${statusTag(item.child_status || 'draft').cls}`}>
                            {statusTag(item.child_status || 'draft').label}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'docs' && currentDisplay && (
            <div>
              {(currentDisplay.document_links || []).length === 0 ? (
                <div className="text-gray-400 text-sm">无关联文档</div>
              ) : (
                (currentDisplay.document_links || []).map((doc: any, idx: number) => (
                  <div key={idx} className="text-sm py-1">{doc.document_id} {doc.category && `[${doc.category}]`}</div>
                ))
              )}
            </div>
          )}

          {activeTab === 'attachments' && (
            <div className="text-gray-400 text-sm">附件功能待实现</div>
          )}

          {activeTab === 'versions' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">版本</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {versions.map((v: any) => (
                  <tr key={v.id} className={`hover:bg-gray-50 ${v.id === revision?.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3">{v.version}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${statusTag(v.status as PartStatus).cls}`}>
                        {statusTag(v.status as PartStatus).label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td>
                    <td className="px-4 py-3">
                      {v.id === revision?.id ? (
                        <span className="text-primary-600 text-xs">当前</span>
                      ) : (
                        <button onClick={() => setSearchParams({ revision: v.id })} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">切换</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTab === 'iterations' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">迭代</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入时间</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入说明</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {iterationsList.map((it: any) => (
                  <tr key={it.id} className={`hover:bg-gray-50 ${it.id === iteration?.id ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3">#{it.iteration}</td>
                    <td className="px-4 py-3 text-gray-500">{it.check_in_date ? new Date(it.check_in_date).toLocaleString('zh-CN') : '未签入'}</td>
                    <td className="px-4 py-3">{it.check_in_note || '—'}</td>
                    <td className="px-4 py-3">
                      {it.id === iteration?.id ? (
                        <span className="text-primary-600 text-xs">当前</span>
                      ) : (
                        <button onClick={() => handleViewIteration(it.id)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">查看数据</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明">
          <div className="p-4">
            <textarea className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" rows={3} placeholder="请输入签入说明（选填）..."
              value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCheckinModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={async () => {
                setSaving(true);
                await doAction(() => partsApi.checkin(revisionId!, checkinNote || undefined), '签入成功');
                setSaving(false);
                setShowCheckinModal(false);
                setCheckinNote('');
              }} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50" disabled={saving}>
                {saving ? '保存中...' : '确认签入'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
