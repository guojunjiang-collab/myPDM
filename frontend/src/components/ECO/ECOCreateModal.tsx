import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecoApi, usersApi, documentsApi, ecrApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { ECORequest, ECRDocumentLink } from '../../types';

const statusTag = (s: string) => {
  const labels: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '已发布', obsolete: '已作废' };
  const colors: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800', frozen: 'bg-orange-100 text-orange-800',
    released: 'bg-green-100 text-green-800', obsolete: 'bg-red-100 text-red-800',
  };
  return { label: labels[s] || s, cls: colors[s] || 'bg-gray-100 text-gray-800' };
};
import { ECOEditView } from './ECOEditView';
import { ECRDocumentPicker } from '../ECR/ECRDocumentPicker';

const REASON_OPTIONS = [
  { value: 'quality_defect', label: '质量缺陷' },
  { value: 'design_opt', label: '设计优化' },
  { value: 'cost_reduce', label: '成本降低' },
  { value: 'customer_req', label: '客户要求' },
  { value: 'supplier_change', label: '供应商变更' },
  { value: 'process_improve', label: '工艺改进' },
  { value: 'new_release', label: '首次发布' },
  { value: 'other', label: '其他' },
];

const CATEGORY_OPTIONS = [
  { value: 'design_change', label: '设计变更' },
  { value: 'process_change', label: '工艺变更' },
  { value: 'material_change', label: '物料变更' },
  { value: 'new_release', label: '新发布' },
  { value: 'other', label: '其他' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低' },
];

interface ReviewerFormItem {
  user_id: string;
  seq: number;
}

interface UserOption {
  id: string;
  real_name: string;
  username: string;
  role: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  ecrId?: string;
  ecrTitle?: string;
  ecrItems?: Array<{ entity_type: string; entity_name: string; entity_id?: string; action: string }>;
  editingEco?: ECORequest | null;
}

export function ECOCreateModal({ open, onClose, onCreated, ecrId, ecrTitle, ecrItems, editingEco }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [localEco, setLocalEco] = useState<ECORequest | null>(null);
  useEffect(() => {
    if (editingEco) { setLocalEco(editingEco ?? null); }
  }, [editingEco]);

  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('design_opt');
  const [category, setCategory] = useState('design_change');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [reviewers, setReviewers] = useState<ReviewerFormItem[]>([]);
  const [reviewMode, setReviewMode] = useState('all');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [bomData, setBomData] = useState<{ up: any[]; down: any[] } | null>(null);
  const [documentLinks, setDocumentLinks] = useState<ECRDocumentLink[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showEcrPicker, setShowEcrPicker] = useState(false);
  const [docData, setDocData] = useState<Record<string, any>>({});
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const onCloseRef = useRef(onClose);
  const onCreatedRef = useRef(onCreated);
  onCloseRef.current = onClose;
  onCreatedRef.current = onCreated;

  useEffect(() => {
    if (submitted) {
      onCloseRef.current();
      onCreatedRef.current();
    }
  }, [submitted]);

  // Load document details when links change
  useEffect(() => {
    const ids = documentLinks.map(d => d.document_id);
    ids.forEach(id => {
      if (!docData[id]) {
        documentsApi.get(id).then(r => setDocData(prev => ({...prev, [id]: r.data}))).catch(() => {});
        documentsApi.listAttachments(id).then(r => setDocAttachments(prev => ({...prev, [id]: r.data||[]}))).catch(() => {});
      }
    });
  }, [documentLinks]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const resp = await usersApi.list({ page_size: 200 });
      const data = resp.data;
      const list = data.items || data || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch { /* silently fail */ }
    finally { setUsersLoading(false); }
  }, []);

  useEffect(() => {
    if (open) {
      loadUsers();
      setSubmitted(false);
      if (editingEco) {
        setTitle(editingEco.title || '');
        setReason(editingEco.reason || 'design_opt');
        setCategory(editingEco.category || 'design_change');
        setPriority(editingEco.priority || 'normal');
        setDescription(editingEco.description || '');
        setReviewers((editingEco.reviewers || []).map((r: { user_id: string; seq: number }) => ({ user_id: r.user_id, seq: r.seq })));
        setReviewMode(editingEco.review_mode || 'all');
        setDocumentLinks(editingEco.document_links || []);
      } else {
        setTitle('');
        setReason('design_opt');
        setCategory('design_change');
        setPriority('normal');
        setDescription('');
        setReviewers([]);
        setReviewMode('all');
      }
      setErrors({});
    }
  }, [open, editingEco]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = '请输入标题';
    if (!reason) e.reason = '请选择变更原因';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const addReviewer = () => {
    const nextSeq = reviewers.length > 0 ? Math.max(...reviewers.map((r) => r.seq)) + 1 : 1;
    setReviewers([...reviewers, { user_id: '', seq: nextSeq }]);
  };
  const removeReviewer = (index: number) => {
    setReviewers(reviewers.filter((_, i) => i !== index));
  };
  const updateReviewer = (index: number, field: 'user_id' | 'seq', value: string | number) => {
    const updated = [...reviewers];
    updated[index] = { ...updated[index], [field]: value };
    setReviewers(updated);
  };

  const handleSubmit = async () => {
    if (!validate()) { toast.error('请填写必填项（标题、变更原因）'); return; }
    setLoading(true);
    try {
      const data: Record<string, unknown> = {
        title: title.trim(),
        reason,
        priority,
        category,
        description: description || undefined,
        reviewers: reviewers.map((r) => ({ user_id: r.user_id, seq: r.seq })),
        review_mode: reviewMode,
        document_links: documentLinks,
        execution_items: (ecrItems || []).map((it) => ({
          source: 'ecr',
          entity_type: it.entity_type,
          entity_name: it.entity_name,
          action: it.action || 'upgrade',
          entity_id: it.entity_id || undefined,
        })),
      };
      // Merge BOM modifications into execution_items
      if (bomData) {
        const modified: Record<string, string> = {};
        (bomData.up || []).concat(bomData.down || []).forEach((n: any) => {
          if (n.entity_id && n.action) modified[n.entity_id] = n.action;
        });
        const items = data.execution_items as any[];
        items.forEach((it: any) => {
          if (it.entity_id && modified[it.entity_id]) it.action = modified[it.entity_id];
        });
      }
      if (ecrId) data.ecr_id = ecrId;
      if (localEco?.ecr_id) data.ecr_id = localEco.ecr_id;
      if (editingEco) {
        await ecoApi.update(editingEco.id, data);
        toast.success('ECO 更新成功');
      } else {
        await ecoApi.create(data);
        toast.success('ECO 创建成功');
      }
      setSubmitted(true);
    } catch { toast.error('创建失败，请重试'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={editingEco ? '编辑 ECO' : '新建 ECO'} onClose={onClose} width="3xl">
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {ecrTitle && (
          <div className="text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            来源 ECR: {ecrTitle}
          </div>
        )}

        {/* 标题 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题 <span className="text-red-500">*</span></label>
          <input type="text" value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${errors.title ? 'border-red-500' : 'border-gray-300'}`}
            placeholder="请输入 ECO 标题" />
          {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
        </div>

        {/* 变更原因 + 变更类别 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">变更原因 <span className="text-red-500">*</span></label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.reason ? 'border-red-400' : 'border-gray-300'}`}>
              {REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {errors.reason && <p className="text-red-500 text-xs mt-1">{errors.reason}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">变更类别</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* 优先级 — radio 单选项 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
          <div className="flex gap-3 flex-wrap">
            {PRIORITY_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="priority" value={o.value} checked={priority === o.value}
                  onChange={(e) => setPriority(e.target.value)} className="text-blue-600" />
                <span className="text-sm text-gray-700">{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 描述 — 自适应高度 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">变更描述</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
            rows={1} style={{ minHeight: '38px', resize: 'none' }}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 overflow-hidden"
            placeholder="变更详细描述（选填）" />
        </div>

        {/* 审批模式 + 审批人 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">审批模式</label>
          <div className="flex gap-4">
            {[
              { value: 'all', label: '会签（全部通过才通过）' },
              { value: 'any', label: '或签（任一通过即通过）' },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="reviewMode" value={opt.value}
                  checked={reviewMode === opt.value}
                  onChange={(e) => setReviewMode(e.target.value)}
                  className="text-blue-600" />
                <span className="text-sm text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {editingEco && <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">👤 审批人</label>
            <button type="button" onClick={addReviewer}
              className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
              + 添加审批人
            </button>
          </div>

          {reviewers.length === 0 && (
            <div className="text-center text-gray-400 py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂无审批人，请点击上方按钮添加
            </div>
          )}

          <div className="space-y-2">
            {reviewers.map((reviewer, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs text-gray-400 w-6">{reviewer.seq}</span>
                <select value={reviewer.user_id}
                  onChange={(e) => updateReviewer(index, 'user_id', e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={usersLoading}>
                  <option value="">{usersLoading ? '加载中...' : '请选择审批人'}</option>
                  {users.filter((u) => u.id !== currentUserId).map((u) => (
                    <option key={u.id} value={u.id}>{u.real_name} ({u.username}) - {u.role}</option>
                  ))}
                </select>
                <input type="number" value={reviewer.seq}
                  onChange={(e) => updateReviewer(index, 'seq', parseInt(e.target.value) || 1)}
                  className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min={1} />
                <button type="button" onClick={() => removeReviewer(index)}
                  className="text-red-400 hover:text-red-600 text-sm px-2" title="移除">✕</button>
              </div>
            ))}
          </div>
        </div>}

        {ecrItems && ecrItems.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">执行项（从 ECR 带入）</label>
            <div className="border border-gray-200 rounded-lg divide-y max-h-40 overflow-auto">
              {ecrItems.map((it, i) => (
                <div key={i} className="px-3 py-2 text-sm flex justify-between items-center">
                  <span>{it.entity_name}</span>
                  <span className="text-gray-400 text-xs">{it.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {editingEco && <div>
        {/* 关联图文档 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">关联图文档</h4>
            <button type="button" onClick={() => setShowDocPicker(true)}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 关联图文档</button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            {documentLinks.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">暂无关联图文档</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档编号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                    <th className="px-3 py-2 text-center w-20">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {documentLinks.map((link) => {
                    const doc = docData[link.document_id];
                    const atts = docAttachments[link.document_id] || [];
                    return (
                      <tr key={link.document_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{doc?.code || link.document_code}</td>
                        <td className="px-3 py-2 text-gray-600">{doc?.name || link.document_name}</td>
                        <td className="px-3 py-2">{doc?.version || link.document_version || '-'}</td>
                        <td className="px-3 py-2">{doc ? <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(doc.status).cls}`}>{statusTag(doc.status).label}</span> : '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{doc?.file_name || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => setDocumentLinks((prev) => prev.filter((d) => d.document_id !== link.document_id))}
                            className="text-red-400 hover:text-red-600 text-xs">移除</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>}

        {/* 关联 ECR（仅编辑模式） */}
        {!!localEco && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-700">关联 ECR</h4>
            <div className="flex gap-2">
              <span className="text-xs text-gray-500 self-center">{localEco.ecr_number || '未关联'}</span>
              <button type="button" onClick={() => setShowEcrPicker(true)}
                className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">
                {localEco.ecr_id ? '更换' : '+ 关联 ECR'}
              </button>
              {localEco.ecr_id && (
                <button type="button" onClick={async () => {
                  try {
                    await ecoApi.update(localEco.id, { ecr_id: null } as any);
                    setLocalEco({ ...localEco, ecr_id: undefined, ecr_number: undefined });
                    toast.success('已解除 ECR 关联');
                  } catch { toast.error('操作失败'); }
                }} className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-500 hover:bg-gray-50">解除</button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ECR BOM 影响分析（编辑模式） */}
        {!!localEco && (
          <div className="pt-4 border-t border-gray-200">
            <ECOEditView ecrId={localEco.ecr_id} onEcrLinked={async (newEcrId) => {
              try {
                await ecoApi.update(localEco.id, { ecr_id: newEcrId } as any);
                setLocalEco({ ...localEco, ecr_id: newEcrId });
                toast.success('ECR 关联成功');
              } catch { toast.error('关联失败'); }
            }} onBomChange={setBomData} />
          </div>
        )}

        {/* 按钮 */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '保存中...' : (localEco ? '保存' : '创建')}
          </button>
        </div>
      </div>

      {/* 图文档选择器 — 独立弹窗 */}
      <ECRDocumentPicker
        open={showDocPicker}
        onClose={() => setShowDocPicker(false)}
        onSelect={(docs: ECRDocumentLink[]) => {
          setDocumentLinks(prev => {
            const existing = new Set(prev.map(d => d.document_id));
            const newDocs = docs.filter(d => !existing.has(d.document_id));
            return [...prev, ...newDocs];
          });
          setShowDocPicker(false);
        }}
        alreadyLinked={documentLinks.map(d => d.document_id)}
      />

      {/* ECR 选择弹窗 */}
      {showEcrPicker && (
      <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center" onClick={() => setShowEcrPicker(false)}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[70vh] overflow-auto p-4" onClick={e => e.stopPropagation()}>
          <h4 className="text-sm font-semibold mb-3">选择 ECR</h4>
          <EcrPicker onSelect={async (id, number) => {
            try {
              await ecoApi.update(localEco!.id, { ecr_id: id } as any);
              setLocalEco(prev => prev ? { ...prev, ecr_id: id, ecr_number: number } : prev);
              toast.success('ECR 关联成功');
            } catch { toast.error('关联失败'); }
            setShowEcrPicker(false);
          }} />
        </div>
      </div>
      )}
    </Modal>
  );
}

function EcrPicker({ onSelect }: { onSelect: (id: string, number: string) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) {
      setSearching(true);
      ecrApi.list({ page_size: 100 }).then(r => setResults(r.data?.items || r.data || [])).catch(() => {}).finally(() => { setSearching(false); setLoaded(true); });
    }
  }, [loaded]);
  const handleSearch = async () => {
    if (!search.trim()) {
      setSearching(true);
      ecrApi.list({ page_size: 100 }).then(r => setResults(r.data?.items || r.data || [])).catch(() => {}).finally(() => setSearching(false));
      return;
    }
    setSearching(true);
    try {
      const r = await ecrApi.list({ search: search.trim(), page_size: 10 });
      setResults(r.data?.items || r.data || []);
    } catch {}
    finally { setSearching(false); }
  };
  const stl = (s: string) => {
    const map: Record<string, string> = { draft: '草稿', reviewing: '审核中', approved: '已批准', rejected: '已驳回', executing: '执行中', completed: '已完成', closed: '已关闭' };
    return map[s] || s;
  };
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索 ECR 编号或标题..." className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" />
        <button onClick={handleSearch} disabled={searching}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">搜索</button>
      </div>
      {searching ? <p className="text-xs text-gray-400 text-center py-4">加载中...</p> : (
        <table className="w-full text-sm border-collapse">
          <thead><tr className="bg-gray-50 border-b">
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs">ECR 编号</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs">标题</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs w-20">状态</th>
          </tr></thead>
          <tbody className="divide-y">
            {results.map(e => (
              <tr key={e.id || e.ecr_number} className="hover:bg-blue-50 cursor-pointer" onClick={() => onSelect(e.id || e.ecr_number, e.ecr_number)}>
                <td className="px-3 py-2 font-mono text-xs text-blue-600">{e.ecr_number || '-'}</td>
                <td className="px-3 py-2 text-xs truncate max-w-0">{e.title || '无标题'}</td>
                <td className="px-3 py-2 text-xs">{stl(e.status)}</td>
              </tr>
            ))}
            {results.length === 0 && <tr><td colSpan={3} className="text-xs text-gray-400 text-center py-4">无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
