import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { configurationApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { ConfigurationItemDetail, ConfigurationItemRevision } from '../../types';
import { Loading } from '../Loading';
import { toast } from '../Toast';
import { Modal } from '../Modal';
import EntityDocumentSection from '../EntityDocumentSection';

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

interface Props {
  revisionId: string;
  open: boolean;
  onClose: () => void;
}

function InfoCard({ label, value, readonly, onChange }: {
  label: string;
  value: string;
  readonly: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {readonly ? (
        <div className="text-sm text-gray-900 font-medium">{value || '—'}</div>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
        />
      )}
    </div>
  );
}

export default function ConfigItemDetailModal({ revisionId, open, onClose }: Props) {
  const { user } = useAuthStore();

  const [detail, setDetail] = useState<ConfigurationItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'parts' | 'children' | 'docs' | 'versions'>('info');
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);

  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [editRemark, setEditRemark] = useState('');

  const [parts, setParts] = useState<any[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [versions, setVersions] = useState<ConfigurationItemRevision[]>([]);

  const loadDetail = useCallback(async () => {
    if (!revisionId) return;
    setDetailLoading(true);
    try {
      const d = await configurationApi.detail(revisionId);
      setDetail(d);
      setEditCode(d.master.code || '');
      setEditName(d.revision.name || d.master.name || '');
      setParts(d.parts || []);
      setChildren(d.children || []);
      setVersions(d.versions || []);
    } catch (e) {
      console.error(e);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [revisionId]);

  useEffect(() => {
    if (open) {
      setDetail(null);
      setActiveTab('info');
      loadDetail();
    }
  }, [open, loadDetail]);

  const loadTabs = useCallback(async () => {
    if (!revisionId) return;
    try {
      if (activeTab === 'parts' || activeTab === 'children') {
        const d = await configurationApi.detail(revisionId);
        setParts(d.parts || []);
        setChildren(d.children || []);
      }
      if (activeTab === 'versions') {
        setVersions(await configurationApi.versions(revisionId));
      }
    } catch (e) {
      console.error(e);
    }
  }, [revisionId, activeTab]);

  useEffect(() => { loadTabs(); }, [loadTabs]);

  const master = detail?.master;
  const revision = detail?.revision;

  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const isAdminUser = user?.role === 'admin';
  const canEdit = isCheckedOutByMe && isDraft;

  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canFreeze = revision?.status === 'draft' && !isCheckedOut;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdminUser;

  const masterTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoSaveMaster = useCallback((data: Record<string, any>) => {
    if (!master?.id) return;
    if (masterTimer.current) clearTimeout(masterTimer.current);
    masterTimer.current = setTimeout(() => {
      configurationApi.updateMaster(master.id, data).catch((e: any) => {
        toast.error(e?.response?.data?.detail || '保存失败');
      });
    }, 500);
  }, [master?.id]);

  const remarkTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoSaveRemark = useCallback((remark: string) => {
    if (!revisionId) return;
    if (remarkTimer.current) clearTimeout(remarkTimer.current);
    remarkTimer.current = setTimeout(() => {
      configurationApi.update(revisionId, { remark }).catch((e: any) => {
        toast.error(e?.response?.data?.detail || '保存失败');
      });
    }, 500);
  }, [revisionId]);

  const doAction = async (action: () => Promise<any>, msg: string) => {
    try {
      await action();
      toast.success(msg);
      loadDetail();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '操作失败');
    }
  };

  const handleClose = () => {
    setActiveTab('info');
    onClose();
  };

  const tabs = useMemo(() => [
    { key: 'info' as const, label: '基本信息' },
    { key: 'parts' as const, label: '关联零部件' },
    { key: 'children' as const, label: '子构型项' },
    { key: 'docs' as const, label: '关联图文档' },
    { key: 'versions' as const, label: '版本历史' },
  ], []);

  if (!open) return null;

  return (
    <Modal open={open} title="构型项详情" onClose={handleClose} width="full">
      <div className="h-[50vh] flex flex-col">
        {detailLoading && !master ? (
          <Loading />
        ) : !master ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            {/* 信息卡片网格 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0 mb-3">
              {canEdit ? (
                <>
                  <InfoCard label="构型号" value={editCode}
                    readonly={false}
                    onChange={(v) => { setEditCode(v); autoSaveMaster({ code: v }); }} />
                  <InfoCard label="中文名称" value={editName}
                    readonly={false}
                    onChange={(v) => { setEditName(v); autoSaveMaster({ name: v }); }} />
                  <InfoCard label="规格型号" value={editSpec}
                    readonly={false}
                    onChange={(v) => { setEditSpec(v); autoSaveMaster({ spec: v }); }} />
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">类型</div>
                    <div className="text-sm text-gray-900 font-medium">构型项</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">构型号</div>
                    <div className="text-sm text-gray-900 font-medium font-mono">{master?.code}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">中文名称</div>
                    <div className="text-sm text-gray-900 font-medium">{master?.name}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">类型</div>
                    <div className="text-sm text-gray-900 font-medium">构型项</div>
                  </div>
                </>
              )}
            </div>

            {/* 版本/状态/操作栏 */}
            <div className="bg-white rounded-lg border border-gray-200 p-3 shrink-0 mb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm">版本：{revision?.version}</span>
                  <span className={`px-2 py-1 text-xs rounded-full ${statusTag(revision?.status || 'draft').cls}`}>
                    {statusTag(revision?.status || 'draft').label}
                  </span>
                  {isCheckedOut && (
                    <span className="text-xs text-orange-600">
                      已签出：{revision?.check_out_user_name || revision?.check_out_user_id}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap items-center">
                  {(canCheckout || canCheckin || canUndo || canFreeze || canRelease || canUpgrade || canObsolete || canForceCheckin) && (
                    <span className="mx-1 text-gray-300 self-center select-none">|</span>
                  )}
                  {canCheckout && (
                    <button onClick={() => doAction(() => configurationApi.checkout(revisionId), '签出成功')}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签出</button>
                  )}
                  {canCheckin && (
                    <button onClick={() => setShowCheckinModal(true)}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签入</button>
                  )}
                  {canUndo && (
                    <button onClick={() => doAction(() => configurationApi.undocheckout(revisionId), '已撤销签出')}
                      className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>
                  )}
                  {canFreeze && (
                    <button onClick={() => doAction(() => configurationApi.freeze(revisionId), '已冻结')}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>
                  )}
                  {canRelease && (
                    <button onClick={() => doAction(() => configurationApi.release(revisionId), '已发布')}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">发布</button>
                  )}
                  {canUpgrade && (
                    <button onClick={() => doAction(() => configurationApi.upgrade(revisionId), '已升版')}
                      className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>
                  )}
                  {canObsolete && (
                    <button onClick={() => doAction(() => configurationApi.obsolete(revisionId), '已作废')}
                      className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>
                  )}
                  {canForceCheckin && (
                    <button onClick={() => doAction(() => configurationApi.forceCheckin(revisionId), '已强制签入')}
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>
                  )}
                </div>
              </div>
            </div>

            {/* Tab 导航 + 内容区 */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="flex border-b border-gray-200 shrink-0">
                {tabs.map((t) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
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
                {/* 基本信息 Tab */}
                {activeTab === 'info' && (
                  <div className="space-y-4">
                    <div className="text-xs text-gray-500">
                      Iteration #{revision?.latest_iteration}
                      {revision?.check_out_date && (
                        <span className="ml-2">
                          签出时间：{new Date(revision.check_out_date).toLocaleString('zh-CN')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      创建时间：{master?.created_at ? new Date(master.created_at).toLocaleString('zh-CN') : '—'}
                    </div>
                  </div>
                )}

                {/* 关联零部件 Tab */}
                {activeTab === 'parts' && (
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 mb-3">关联零部件</h4>
                    {parts.length === 0 ? (
                      <div className="text-gray-400 text-sm py-4 text-center">暂无关联零部件</div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">类型</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">版本</th>
                              <th className="px-3 py-2 text-center text-gray-500 font-medium">必选</th>
                              <th className="px-3 py-2 text-center text-gray-500 font-medium">数量</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {parts.map((p: any) => (
                              <tr key={p.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <span className="text-xs text-gray-500">{p.part_type === 'assembly' ? '部件' : '零件'}</span>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">{p.part_detail?.code || '—'}</td>
                                <td className="px-3 py-2">{p.part_detail?.name || '—'}</td>
                                <td className="px-3 py-2 text-gray-500">{p.part_detail?.version || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  {p.is_required ? (
                                    <span className="text-green-600 text-xs">是</span>
                                  ) : (
                                    <span className="text-gray-400 text-xs">否</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">{p.quantity || 1}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 子构型项 Tab */}
                {activeTab === 'children' && (
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 mb-3">子构型项</h4>
                    {children.length === 0 ? (
                      <div className="text-gray-400 text-sm py-4 text-center">暂无子构型项</div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">构型号</th>
                              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                              <th className="px-3 py-2 text-center text-gray-500 font-medium">必选</th>
                              <th className="px-3 py-2 text-center text-gray-500 font-medium">数量</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {children.map((c: any) => (
                              <tr key={c.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-mono text-xs">{c.child_detail?.code || '—'}</td>
                                <td className="px-3 py-2">{c.child_detail?.name || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  {c.is_required ? (
                                    <span className="text-green-600 text-xs">是</span>
                                  ) : (
                                    <span className="text-gray-400 text-xs">否</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center">{c.quantity || 1}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* 关联图文档 Tab */}
                {activeTab === 'docs' && revisionId && (
                  <EntityDocumentSection
                    entityType="configuration"
                    entityId={revisionId}
                    editable={isCheckedOutByMe && isDraft}
                    entityCode={master?.code}
                    entityName={master?.name}
                  />
                )}

                {/* 版本历史 Tab */}
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
                            <span className={`px-2 py-1 text-xs rounded-full ${statusTag(v.status).cls}`}>
                              {statusTag(v.status).label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}
                          </td>
                          <td className="px-4 py-3">
                            {v.id === revision?.id ? (
                              <span className="text-primary-600 text-xs">当前</span>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
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

      {/* 签入说明弹窗 */}
      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明" width="md">
          <div className="p-4">
            <textarea
              className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="请输入签入说明（选填）..."
              value={checkinNote}
              onChange={(e) => setCheckinNote(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCheckinModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setSaving(true);
                  await doAction(
                    () => configurationApi.checkin(revisionId, checkinNote || ''),
                    '签入成功'
                  );
                  setSaving(false);
                  setShowCheckinModal(false);
                  setCheckinNote('');
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                disabled={saving}
              >
                {saving ? '保存中...' : '确认签入'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
