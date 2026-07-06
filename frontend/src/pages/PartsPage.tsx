import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { PartListItem, PartMaster, PartRevision, PartIteration, PartStatus, CascadeResult } from '../types';
import { Loading } from '../components/Loading';
import { toast } from '../components/Toast';
import { Modal } from '../components/Modal';

const STATUS_LABELS: Record<PartStatus, string> = {
  draft: '草稿', frozen: '冻结', released: '已发布', obsolete: '已作废',
};
const STATUS_COLORS: Record<PartStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  frozen: 'bg-blue-100 text-blue-700',
  released: 'bg-green-100 text-green-700',
  obsolete: 'bg-red-100 text-red-700',
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: PAGE_SIZE };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      const res = await partsApi.list(params);
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, typeFilter, page]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  if (loading && items.length === 0) return <Loading />;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">零件管理</h1>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input type="text" placeholder="搜索件号/名称..." value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm w-48" />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm">
          <option value="">全部类型</option>
          <option value="part">零件</option>
          <option value="assembly">部件</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-4 py-2">件号</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-left px-4 py-2">版本</th>
              <th className="text-left px-4 py-2">类型</th>
              <th className="text-left px-4 py-2">状态</th>
              <th className="text-left px-4 py-2">签出状态</th>
              <th className="text-left px-4 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={`${item.revision_id}-${idx}`} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 font-mono">{item.code}</td>
                <td className="px-4 py-2">{item.name}</td>
                <td className="px-4 py-2">{item.version}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${item.type === 'assembly' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                    {item.type === 'assembly' ? '部件' : '零件'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
                </td>
                <td className="px-4 py-2 text-xs">
                  {item.check_out_user_name ? (
                    <span className="text-orange-600">{item.check_out_user_name}</span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => navigate(`/parts/${item.master_id}?revision=${item.revision_id}`)}
                      className="text-blue-600 hover:underline text-xs">详情</button>
                    {showCheckoutButton(item) && (
                      <button onClick={() => handleCheckout(item.revision_id)}
                        className="text-green-600 hover:underline text-xs">签出</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: Math.ceil(total / PAGE_SIZE) }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`px-3 py-1 rounded text-sm ${page === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>{i + 1}</button>
          ))}
        </div>
      )}

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

  // ---- 权限计算 ----
  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const isAdmin = user?.role === 'admin';
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canFreeze = revision?.status === 'draft';
  const canUnfreeze = revision?.status === 'frozen' && isAdmin;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdmin;

  // ---- 操作函数 ----
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

  if (loading && !master) return <Loading />;

  return (
    <div className="p-6">
      <button onClick={() => navigate('/parts')} className="text-blue-600 hover:underline text-sm mb-2 inline-block">&larr; 返回列表</button>

      {/* 主数据 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">件号:</span> <span className="font-mono">{master?.code}</span></div>
          <div><span className="text-gray-500">名称:</span> {master?.name}</div>
          <div><span className="text-gray-500">规格:</span> {master?.spec || '—'}</div>
          <div><span className="text-gray-500">类型:</span> {master?.type === 'assembly' ? '部件' : '零件'}</div>
        </div>
      </div>

      {/* 版本+操作栏 */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-semibold">版本: {revision?.version}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[revision?.status || 'draft']}`}>
              {STATUS_LABELS[revision?.status || 'draft']}
            </span>
            {isCheckedOut && (
              <span className="text-xs text-orange-600">已签出: {revision?.check_out_user_name}</span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap">
            {canCheckout && <button onClick={() => doAction(() => partsApi.checkout(revisionId!), '签出成功')}
              className="px-3 py-1 bg-green-600 text-white rounded text-xs">签出</button>}
            {canCheckin && <button onClick={() => setShowCheckinModal(true)}
              className="px-3 py-1 bg-blue-600 text-white rounded text-xs">检入</button>}
            {canUndo && <button onClick={() => doAction(() => partsApi.undocheckout(revisionId!), '已撤销')}
              className="px-3 py-1 bg-gray-500 text-white rounded text-xs">撤销签出</button>}
            {canFreeze && <button onClick={() => doAction(() => partsApi.freeze(revisionId!), '已冻结')}
              className="px-3 py-1 bg-blue-500 text-white rounded text-xs">冻结</button>}
            {canUnfreeze && <button onClick={() => doAction(() => partsApi.unfreeze(revisionId!), '已解冻')}
              className="px-3 py-1 bg-yellow-500 text-white rounded text-xs">解冻</button>}
            {canRelease && <button onClick={() => doAction(() => partsApi.release(revisionId!), '已发布')}
              className="px-3 py-1 bg-green-500 text-white rounded text-xs">发布</button>}
            {canUpgrade && <button onClick={() => doAction(() => partsApi.upgrade(revisionId!), '已升版')}
              className="px-3 py-1 bg-purple-600 text-white rounded text-xs">升版</button>}
            {canObsolete && <button onClick={() => doAction(() => partsApi.obsolete(revisionId!), '已作废')}
              className="px-3 py-1 bg-red-500 text-white rounded text-xs">作废</button>}
            {canForceCheckin && <button onClick={() => doAction(() => partsApi.forceCheckin(revisionId!), '已强制签入')}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs">强制签入</button>}
          </div>
        </div>
      </div>

      {/* 历史迭代提示条 */}
      {viewingIterationId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded px-4 py-2 mb-4 text-sm flex items-center justify-between">
          <span>正在查看 Iteration #{viewingIteration?.iteration} 的历史数据（只读）</span>
          <button onClick={() => { setViewingIterationId(null); setViewingIteration(null); }}
            className="text-blue-600 hover:underline text-xs">返回当前迭代</button>
        </div>
      )}

      {/* TABs */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b">
          {[
            { key: 'info', label: '基本信息' },
            { key: 'bom', label: 'BOM结构', hide: master?.type !== 'assembly' },
            { key: 'docs', label: '关联文档' },
            { key: 'attachments', label: '附件' },
            { key: 'versions', label: '版本历史' },
            { key: 'iterations', label: '迭代历史' },
          ].filter(t => !t.hide).map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key as any)}
              className={`px-4 py-2 text-sm ${activeTab === t.key ? 'border-b-2 border-blue-600 text-blue-600 font-semibold' : 'text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === 'info' && currentDisplay && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">Iteration #{currentDisplay.iteration}
                {currentDisplay.check_in_note && <span className="ml-2">签入说明: {currentDisplay.check_in_note}</span>}
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(currentDisplay.custom_fields || {}).map(([k, v]) => (
                    <div key={k}><label className="text-xs text-gray-500">{k}</label><div className="text-sm">{String(v)}</div></div>
                  ))}
                  {Object.keys(currentDisplay.custom_fields || {}).length === 0 && <div className="text-gray-400 text-sm">无</div>}
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
                <button onClick={() => handleCascade('checkout')} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">级联签出</button>
                <button onClick={() => handleCascade('checkin')} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">级联检入</button>
                <button onClick={() => handleCascade('undo')} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">级联撤销</button>
              </div>
              {bomItems.length === 0 ? <div className="text-gray-400 text-sm">无BOM子项</div> : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 border-b"><th className="text-left px-3 py-1">件号</th><th className="text-left px-3 py-1">名称</th><th className="text-left px-3 py-1">版本</th><th className="text-left px-3 py-1">数量</th><th className="text-left px-3 py-1">状态</th></tr></thead>
                  <tbody>{bomItems.map((item: any, idx: number) => (
                    <tr key={idx} className="border-b"><td className="px-3 py-1 font-mono">{item.child_code}</td><td className="px-3 py-1">{item.child_name}</td><td className="px-3 py-1">{item.child_version}</td><td className="px-3 py-1">{item.quantity}</td><td className="px-3 py-1">{item.child_status}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'docs' && currentDisplay && (
            <div>
              {(currentDisplay.document_links || []).length === 0 ? <div className="text-gray-400 text-sm">无关联文档</div> :
                (currentDisplay.document_links || []).map((doc: any, idx: number) => (
                  <div key={idx} className="text-sm py-1">{doc.document_id} {doc.category && `[${doc.category}]`}</div>
                ))}
            </div>
          )}

          {activeTab === 'attachments' && <div className="text-gray-400 text-sm">附件功能待实现</div>}

          {activeTab === 'versions' && (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-3 py-1">版本</th><th className="text-left px-3 py-1">状态</th><th className="text-left px-3 py-1">创建时间</th><th className="text-left px-3 py-1">操作</th></tr></thead>
              <tbody>{versions.map((v: any) => (
                <tr key={v.id} className={`border-b ${v.id === revision?.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-1">{v.version}</td>
                  <td className="px-3 py-1"><span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[v.status as PartStatus]}`}>{STATUS_LABELS[v.status as PartStatus]}</span></td>
                  <td className="px-3 py-1">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td>
                  <td className="px-3 py-1">{v.id === revision?.id ? <span className="text-blue-600 text-xs">● 当前</span> :
                    <button onClick={() => setSearchParams({ revision: v.id })} className="text-blue-600 hover:underline text-xs">切换</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {activeTab === 'iterations' && (
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b"><th className="text-left px-3 py-1">迭代</th><th className="text-left px-3 py-1">签入时间</th><th className="text-left px-3 py-1">签入说明</th><th className="text-left px-3 py-1">操作</th></tr></thead>
              <tbody>{iterationsList.map((it: any) => (
                <tr key={it.id} className={`border-b ${it.id === iteration?.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-1">#{it.iteration}</td>
                  <td className="px-3 py-1">{it.check_in_date ? new Date(it.check_in_date).toLocaleString('zh-CN') : '未签入'}</td>
                  <td className="px-3 py-1">{it.check_in_note || '—'}</td>
                  <td className="px-3 py-1">{it.id === iteration?.id ? <span className="text-blue-600 text-xs">● 当前</span> :
                    <button onClick={() => handleViewIteration(it.id)} className="text-blue-600 hover:underline text-xs">查看数据</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {/* 签入弹窗 */}
      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明">
          <div className="p-4">
            <textarea className="w-full border rounded p-2 text-sm" rows={3} placeholder="请输入签入说明（选填）..."
              value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCheckinModal(false)} className="px-4 py-1.5 border rounded text-sm">取消</button>
              <button onClick={async () => {
                setSaving(true);
                await doAction(() => partsApi.checkin(revisionId!, checkinNote || undefined), '签入成功');
                setSaving(false);
                setShowCheckinModal(false);
                setCheckinNote('');
              }} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm">{saving ? '保存中...' : '确认签入'}</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
