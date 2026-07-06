import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { partsApi, customFieldsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { PartMaster, PartRevision, PartIteration, PartStatus, CascadeResult } from '../types';
import { Loading } from './Loading';
import { toast } from './Toast';
import { Modal } from './Modal';
import EntityDocumentSection from './EntityDocumentSection';

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

interface PartDetailModalProps {
  masterId: string;
  revisionId?: string;
  open: boolean;
  onClose: () => void;
}

export default function PartDetailModal({ masterId, revisionId: propRevisionId, open, onClose }: PartDetailModalProps) {
  const { user } = useAuthStore();

  const [master, setMaster] = useState<PartMaster | null>(null);
  const [revision, setRevision] = useState<PartRevision | null>(null);
  const [iteration, setIteration] = useState<PartIteration | null>(null);
  const [internalRevisionId, setInternalRevisionId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'bom' | 'docs' | 'attachments' | 'versions' | 'iterations'>('info');
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [viewingIteration, setViewingIteration] = useState<PartIteration | null>(null);
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  const [bomItems, setBomItems] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [iterationsList, setIterationsList] = useState<any[]>([]);

  const [cfDefs, setCfDefs] = useState<any[]>([]);
  const [editData, setEditData] = useState<{ custom_fields: Record<string, any>; remark: string }>({ custom_fields: {}, remark: '' });

  useEffect(() => {
    if (open) {
      setMaster(null);
      setRevision(null);
      setIteration(null);
      setInternalRevisionId(propRevisionId || null);
      setActiveTab('info');
      setViewingIterationId(null);
      setViewingIteration(null);
      customFieldsApi.listDefinitions().then((res: any) => {
        const defs = (res.data || res || []).filter((d: any) => {
          const applies: string[] = d.applies_to || [];
          return applies.includes('parts');
        });
        setCfDefs(defs);
      }).catch((e: any) => {
        console.error('Failed to load custom field definitions', e);
        setCfDefs([]);
      });
    }
  }, [open, masterId, propRevisionId]);

  const revisionId = internalRevisionId || revision?.id;

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoSave = useCallback((data: Record<string, any>) => {
    if (!revisionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      partsApi.updateIteration(revisionId, data).catch(console.error);
    }, 500);
  }, [revisionId]);

  const loadDetail = useCallback(async () => {
    if (!masterId) return;
    setDetailLoading(true);
    try {
      const m = await partsApi.get(masterId);
      setMaster(m);
      const revId = internalRevisionId || (m.latest_revision?.id);
      if (revId) {
        if (!internalRevisionId) setInternalRevisionId(revId);
        const rev = await partsApi.getRevision(revId);
        setRevision(rev);
        if (rev.current_iteration) {
          setIteration(rev.current_iteration);
          setEditData({
            custom_fields: rev.current_iteration.custom_fields || {},
            remark: rev.current_iteration.remark || '',
          });
        }
      }
    } catch (e) { console.error(e); } finally { setDetailLoading(false); }
  }, [masterId, internalRevisionId]);

  useEffect(() => { if (open) { loadDetail(); } }, [loadDetail, open]);

  const loadTabs = useCallback(async () => {
    if (!revisionId || !masterId) return;
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
  const isAdminUser = user?.role === 'admin';
  const canEdit = isCheckedOutByMe && isDraft;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canFreeze = revision?.status === 'draft';
  const canUnfreeze = revision?.status === 'frozen' && isAdminUser;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdminUser;

  const doAction = async (action: () => Promise<any>, msg: string) => {
    try {
      await action();
      toast.success(msg);
      loadDetail();
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
      loadDetail();
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

  const handleClose = () => {
    setActiveTab('info');
    setViewingIterationId(null);
    setViewingIteration(null);
    onClose();
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

  if (!open) return null;

  return (
    <Modal open={open} title="零部件详情" onClose={handleClose} width="full">
      <div className="h-[50vh] flex flex-col">
        {detailLoading && !master ? (
          <Loading />
        ) : !master ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shrink-0 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-500">件号：</span> <span className="font-mono font-medium">{master?.code}</span></div>
                <div><span className="text-gray-500">名称：</span> {master?.name}</div>
                <div><span className="text-gray-500">规格：</span> {master?.spec || '—'}</div>
                <div><span className="text-gray-500">类型：</span> {master?.type === 'assembly' ? '部件' : '零件'}</div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4 shrink-0 mb-4">
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
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 shrink-0 mb-4 text-sm flex items-center justify-between">
                <span>正在查看 Iteration #{viewingIteration?.iteration} 的历史数据（只读）</span>
                <button onClick={() => { setViewingIterationId(null); setViewingIteration(null); }}
                  className="text-primary-600 hover:text-primary-800 hover:underline text-xs">返回当前迭代</button>
              </div>
            )}

            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="flex border-b border-gray-200 shrink-0">
                {tabs.map((t: { key: string; label: string }) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key as any)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
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
                    {!viewingIterationId && canEdit ? (
                      <>
                        <div>
                          <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {cfDefs.length === 0 ? (
                              <div className="text-gray-400 text-sm col-span-3">无</div>
                            ) : (
                              cfDefs.map((def: any) => {
                                const key = def.name;
                                return (
                                  <div key={def.id}>
                                    <label className="text-xs text-gray-500">{def.name}</label>
                                    <input
                                      type="text"
                                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5"
                                      value={editData.custom_fields[key] || ''}
                                      onChange={(e) => {
                                        const newCf = { ...editData.custom_fields, [key]: e.target.value };
                                        setEditData(prev => ({ ...prev, custom_fields: newCf }));
                                        autoSave({ custom_fields: newCf });
                                      }}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold mb-1">备注</h4>
                          <textarea
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mt-1"
                            rows={3}
                            value={editData.remark}
                            onChange={(e) => {
                              setEditData(prev => ({ ...prev, remark: e.target.value }));
                              autoSave({ remark: e.target.value });
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {cfDefs.length === 0 ? (
                              <div className="text-gray-400 text-sm col-span-3">无</div>
                            ) : (
                              cfDefs.map((def: any) => {
                                const val = (currentDisplay.custom_fields || {})[def.name];
                                return (
                                  <div key={def.id}>
                                    <label className="text-xs text-gray-500">{def.name}</label>
                                    <div className="text-sm">{val !== undefined && val !== null ? String(val) : '—'}</div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold mb-1">备注</h4>
                          <div className="text-sm text-gray-600">{currentDisplay.remark || '—'}</div>
                        </div>
                      </>
                    )}
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

                {activeTab === 'docs' && revisionId && (
                  <EntityDocumentSection
                    entityType="part"
                    entityId={revisionId}
                    editable={isCheckedOutByMe && isDraft}
                    entityCode={master?.code}
                    entityName={master?.name}
                  />
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
                              <button onClick={() => setInternalRevisionId(v.id)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">切换</button>
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
          </>
        )}
      </div>

      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明" width="md">
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
    </Modal>
  );
}
