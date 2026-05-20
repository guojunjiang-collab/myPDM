import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecrApi, usersApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { ECRRequest, ECRCreateData, ECRReviewer, ECRDocumentLink, BomImpactNode } from '../../types';
import { ECRAffectedItemPicker } from './ECRAffectedItemPicker';
import { ECRBomImpactView } from './ECRBomImpactView';
import { ECRDocumentPicker } from './ECRDocumentPicker';

const REASON_OPTIONS = [
  { value: 'quality_defect', label: '质量缺陷' },
  { value: 'design_opt', label: '设计优化' },
  { value: 'cost_reduce', label: '成本降低' },
  { value: 'customer_req', label: '客户要求' },
  { value: 'supplier_change', label: '供应商变更' },
  { value: 'process_improve', label: '工艺改进' },
  { value: 'other', label: '其他' },
];

const CATEGORY_OPTIONS = [
  { value: 'design_change', label: '设计变更' },
  { value: 'process_change', label: '工艺变更' },
  { value: 'material_change', label: '材料变更' },
  { value: 'other', label: '其他' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低' },
];

const REVIEW_MODE_OPTIONS = [
  { value: 'all', label: '会签（全部通过才通过）' },
  { value: 'any', label: '或签（任一通过即通过）' },
];

const CHANGE_TYPE_OPTIONS = [
  { value: '', label: '请选择变更类型' },
  { value: 'upgrade', label: '升版' },
  { value: 'qty_change', label: '数量变更' },
  { value: 'delete', label: '删除' },
  { value: 'replace', label: '替换' },
  { value: 'add_new', label: '新增' },
  { value: 'material_change', label: '材料变更' },
  { value: 'process_change', label: '工艺变更' },
  { value: 'parameter_change', label: '参数变更' },
  { value: 'other', label: '其他' },
];

interface AffectedItemForm {
  id?: string;
  entity_type: 'part' | 'assembly';
  entity_id: string;
  entity_code: string;
  entity_name: string;
  entity_version: string;
  change_type: string;
  change_description: string;
  bom_impact?: {
    upward_chain: BomImpactNode[];
    downward_items: BomImpactNode[];
  };
  traceLoading: boolean;
}

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

interface ECRCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingEcr?: ECRRequest | null;
}

export function ECRCreateModal({ open, onClose, onSuccess, editingEcr }: ECRCreateModalProps) {
  const isEditing = !!editingEcr;
  const currentUserId = useAuthStore((s) => s.user?.id);

  // Form state
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('quality_defect');
  const [category, setCategory] = useState('design_change');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [reviewers, setReviewers] = useState<ReviewerFormItem[]>([]);
  const [reviewMode, setReviewMode] = useState('all');

  // Meta state
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [affectedItems, setAffectedItems] = useState<AffectedItemForm[]>([]);
  const [documentLinks, setDocumentLinks] = useState<ECRDocumentLink[]>([]);
  const [showAffectedPicker, setShowAffectedPicker] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);

  // Load users for reviewer dropdown
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const resp = await usersApi.list({ page_size: 200 });
      const data = resp.data;
      const list = data.items || data || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch {
      // Silently fail - users dropdown will just be empty
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Initialize form on open or when editingEcr changes
  useEffect(() => {
    if (open) {
      loadUsers();
      if (editingEcr) {
        setTitle(editingEcr.title || '');
        setReason(editingEcr.reason || 'quality_defect');
        setCategory(editingEcr.category || 'design_change');
        setPriority(editingEcr.priority || 'normal');
        setDescription(editingEcr.description || '');
        setReviewMode(editingEcr.review_mode || 'all');
        setReviewers(
          (editingEcr.reviewers || []).map((r: ECRReviewer) => ({
            user_id: r.user_id,
            seq: r.seq,
          }))
        );
        setDocumentLinks(editingEcr.document_links || []);
        setAffectedItems(
          (editingEcr.affected_items as unknown as AffectedItemForm[] | undefined) || []
        );
      } else {
        resetForm();
      }
      setErrors({});
    }
  }, [open, editingEcr]);

  const resetForm = () => {
    setTitle('');
    setReason('quality_defect');
    setCategory('design_change');
    setPriority('normal');
    setDescription('');
    setReviewers([]);
    setReviewMode('all');
    setAffectedItems([]);
    setDocumentLinks([]);
  };

  // Reviewer management
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

  // Affected item management
  const addAffectedItems = (items: { entity_type: 'part' | 'assembly'; entity_id: string; entity_code: string; entity_name: string; entity_version: string }[]) => {
    const existing = new Set(affectedItems.map((a) => `${a.entity_type}:${a.entity_id}`));
    const newItems: AffectedItemForm[] = items
      .filter((item) => !existing.has(`${item.entity_type}:${item.entity_id}`))
      .map((item) => ({
        ...item,
        change_type: '',
        change_description: '',
        traceLoading: false,
      }));
    const newStartIndex = affectedItems.length;
    setAffectedItems([...affectedItems, ...newItems]);
    setShowAffectedPicker(false);

    // Auto-trace each new item
    const traceEcrId = editingEcr?.id || '00000000-0000-0000-0000-000000000000';
    newItems.forEach((item, i) => {
      const actualIndex = newStartIndex + i;
      setAffectedItems((prev) => {
        const updated = [...prev];
        if (updated[actualIndex]) {
          updated[actualIndex] = { ...updated[actualIndex], traceLoading: true };
        }
        return updated;
      });
      ecrApi.bomTrace(traceEcrId, item.entity_type, item.entity_id)
        .then((resp) => {
          const data = resp.data as { upward_chain: BomImpactNode[]; downward_items: BomImpactNode[] };
          setAffectedItems((prev) => {
            const updated = [...prev];
            if (updated[actualIndex]) {
              updated[actualIndex] = {
                ...updated[actualIndex],
                traceLoading: false,
                bom_impact: {
                  upward_chain: data.upward_chain || [],
                  downward_items: data.downward_items || [],
                },
              };
            }
            return updated;
          });
        })
        .catch(() => {
          setAffectedItems((prev) => {
            const updated = [...prev];
            if (updated[actualIndex]) {
              updated[actualIndex] = { ...updated[actualIndex], traceLoading: false };
            }
            return updated;
          });
          toast.error('BOM 溯源分析失败');
        });
    });
  };

  const removeAffectedItem = (index: number) => {
    setAffectedItems(affectedItems.filter((_, i) => i !== index));
  };

  const updateAffectedItem = (index: number, field: keyof AffectedItemForm, value: string) => {
    const updated = [...affectedItems];
    updated[index] = { ...updated[index], [field]: value };
    setAffectedItems(updated);
  };

  const traceAffectedItem = async (index: number) => {
    const item = affectedItems[index];
    if (!item.entity_id) return;
    if (!isEditing || !editingEcr?.id) {
      toast.error('请先保存 ECR 后再进行溯源分析');
      return;
    }
    const updated = [...affectedItems];
    updated[index] = { ...updated[index], traceLoading: true };
    setAffectedItems(updated);
    try {
      const resp = await ecrApi.bomTrace(editingEcr.id, item.entity_type, item.entity_id);
      const data = resp.data as { upward_chain: BomImpactNode[]; downward_items: BomImpactNode[] };
      const updated2 = [...affectedItems];
      updated2[index] = {
        ...updated2[index],
        bom_impact: { upward_chain: data.upward_chain || [], downward_items: data.downward_items || [] },
        traceLoading: false,
      };
      setAffectedItems(updated2);
    } catch {
      toast.error('BOM 溯源分析失败');
      const updated2 = [...affectedItems];
      updated2[index] = { ...updated2[index], traceLoading: false };
      setAffectedItems(updated2);
    }
  };

  // Document link management
  const addDocumentLinks = (docs: ECRDocumentLink[]) => {
    const existing = new Set(documentLinks.map((d) => d.document_id));
    const newDocs = docs.filter((d) => !existing.has(d.document_id));
    setDocumentLinks([...documentLinks, ...newDocs]);
  };

  const removeDocumentLink = (docId: string) => {
    setDocumentLinks(documentLinks.filter((d) => d.document_id !== docId));
  };

  // Validation
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = '请输入 ECR 标题';
    }

    reviewers.forEach((r, i) => {
      if (!r.user_id) {
        newErrors[`reviewer_${i}`] = '请选择审批人';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit
  const handleSubmit = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      const data: ECRCreateData = {
        title: title.trim(),
        reason,
        priority,
        category,
        description: description.trim() || undefined,
        review_mode: reviewMode,
        reviewers: reviewers.map((r) => ({
          user_id: r.user_id,
          seq: r.seq,
        })),
        document_links: documentLinks,
        affected_items: affectedItems.map((item) => ({
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          change_description: item.change_description || undefined,
          change_type: item.change_type || undefined,
        })),
      };

      let ecrId = editingEcr?.id;
      if (isEditing && editingEcr) {
        await ecrApi.update(editingEcr.id, data);

        // Delete affected items that were removed during editing
        const originalIds = new Set(
          ((editingEcr.affected_items as unknown as Array<{ id: string }>) || []).map((a) => a.id)
        );
        const currentIds = new Set(affectedItems.filter((a) => a.id).map((a) => a.id!));
        const removedIds = [...originalIds].filter((id) => !currentIds.has(id));
        for (const id of removedIds) {
          try { await ecrApi.removeAffectedItem(ecrId!, id); } catch { /* ignore */ }
        }

        toast.success('ECR 更新成功');
      } else {
        const response = await ecrApi.create(data);
        const responseData = response.data as { id?: string };
        if (responseData?.id) {
          ecrId = responseData.id;
        }
        toast.success('ECR 创建成功');
      }

      // Save bom_impact for each affected item
      if (ecrId && affectedItems.length > 0) {
        const savePromises = affectedItems.map(async (item) => {
          try {
            // Step 1: Create the affected item (if not already exists)
            let affectedItemId: string | undefined;
            if (item.id) {
              affectedItemId = item.id;
            } else {
              // New ECR: need to create affected item first
              const createdResp = await ecrApi.addAffectedItem(ecrId, {
                entity_type: item.entity_type,
                entity_id: item.entity_id,
              });
              const createdData = (createdResp.data || createdResp) as { id?: string };
              affectedItemId = createdData?.id;
            }

            // Step 2: Save bom_impact if we have an item ID
            if (affectedItemId && item.bom_impact) {
              await ecrApi.updateAffectedItem(ecrId, affectedItemId, { bom_impact: item.bom_impact });
            }
          } catch {
            // Silently fail - bom_impact will be lost but ECR is saved
          }
        });
        await Promise.allSettled(savePromises);
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (isEditing ? '更新失败' : '创建失败');
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setErrors({});
    onClose();
  };

  return (
    <>
    <Modal open={open} title={isEditing ? '编辑 ECR' : '新建 ECR'} onClose={handleClose} width="full">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ECR 标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errors.title) setErrors({ ...errors, title: '' });
            }}
            placeholder="请输入 ECR 标题"
            className={`w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              errors.title ? 'border-red-400' : 'border-gray-300'
            }`}
          />
          {errors.title && (
            <p className="text-red-500 text-xs mt-1">{errors.title}</p>
          )}
        </div>

        {/* Reason + Category row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              变更原因
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              变更类别
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            优先级
          </label>
          <div className="flex gap-3">
            {PRIORITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name="priority"
                  value={opt.value}
                  checked={priority === opt.value}
                  onChange={(e) => setPriority(e.target.value)}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Review mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            审批模式
          </label>
          <div className="flex gap-4">
            {REVIEW_MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1.5 cursor-pointer"
              >
                <input
                  type="radio"
                  name="reviewMode"
                  value={opt.value}
                  checked={reviewMode === opt.value}
                  onChange={(e) => setReviewMode(e.target.value)}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            变更描述
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="请描述变更内容和原因"
          />
        </div>

        {/* BOM 影响分析 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              📦 BOM 影响分析
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAffectedPicker(true)}
                className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
              >
                + 添加零件/部件
              </button>
            </div>
          </div>

          {affectedItems.length === 0 && (
            <div className="text-center text-gray-400 py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂未添加受影响物料，请点击上方按钮选择
            </div>
          )}

          <div className="space-y-3">
            {affectedItems.map((item, index) => (
              <div
                key={`${item.entity_type}-${item.entity_id}`}
                className="border border-gray-200 rounded-lg overflow-hidden"
              >
                {/* Item header */}
                <div className="flex items-center gap-3 p-3 bg-gray-50">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      item.entity_type === 'part'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {item.entity_type === 'part' ? '零件' : '部件'}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{item.entity_code}</span>
                  <span className="text-sm text-gray-600">{item.entity_name}</span>
                  <span className="text-xs text-gray-400">{item.entity_version}</span>

                  <div className="flex-1" />
                  <span className="text-xs text-gray-400">变更操作：升版</span>

                  <button
                    type="button"
                    onClick={() => removeAffectedItem(index)}
                    className="text-red-400 hover:text-red-600 text-sm px-1"
                    title="移除"
                  >
                    ✕
                  </button>
                </div>

                {/* Bom impact result */}
                {item.bom_impact && (
                  <div className="p-3 border-t border-gray-200">
                    <ECRBomImpactView
                      upwardChain={item.bom_impact.upward_chain}
                      downwardItems={item.bom_impact.downward_items}
                      onChange={(upwardChain, downwardItems) => {
                        const updated = [...affectedItems];
                        updated[index] = {
                          ...updated[index],
                          bom_impact: { upward_chain: upwardChain, downward_items: downwardItems },
                        };
                        setAffectedItems(updated);
                      }}
                      editable={true}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Reviewers */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              👤 审批人
            </label>
            <button
              type="button"
              onClick={addReviewer}
              className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
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
              <div
                key={index}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <span className="text-xs text-gray-400 w-6">{reviewer.seq}</span>
                <select
                  value={reviewer.user_id}
                  onChange={(e) => {
                    updateReviewer(index, 'user_id', e.target.value);
                    if (errors[`reviewer_${index}`]) {
                      const newErrors = { ...errors };
                      delete newErrors[`reviewer_${index}`];
                      setErrors(newErrors);
                    }
                  }}
                  className={`flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                    errors[`reviewer_${index}`] ? 'border-red-400' : 'border-gray-300'
                  }`}
                  disabled={usersLoading}
                >
                  <option value="">
                    {usersLoading ? '加载中...' : '请选择审批人'}
                  </option>
                  {users.filter((u) => u.id !== currentUserId).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.real_name} ({u.username}) - {u.role}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={reviewer.seq}
                  onChange={(e) =>
                    updateReviewer(index, 'seq', parseInt(e.target.value) || 1)
                  }
                  className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min={1}
                />
                <button
                  type="button"
                  onClick={() => removeReviewer(index)}
                  className="text-red-400 hover:text-red-600 text-sm px-2"
                  title="移除"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {reviewers.some((_, i) => errors[`reviewer_${i}`]) && (
            <p className="text-red-500 text-xs mt-1">请为所有审批人选择用户</p>
          )}
        </div>

        {/* 关联图文档 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">
              📄 关联图文档
            </label>
            <button
              type="button"
              onClick={() => setShowDocPicker(true)}
              className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              + 关联文档
            </button>
          </div>

          {documentLinks.length === 0 && (
            <div className="text-center text-gray-400 py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂未关联文档，请点击上方按钮选择
            </div>
          )}

          <div className="space-y-2">
            {documentLinks.map((doc) => (
              <div
                key={doc.document_id}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
              >
                <span className="text-lg">📄</span>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    {doc.document_code}
                  </div>
                  <div className="text-xs text-gray-500">
                    {doc.document_name} v{doc.document_version}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeDocumentLink(doc.document_id)}
                  className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 transition-colors"
                >
                  取消关联
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
        <button
          onClick={handleClose}
          className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '提交中...' : isEditing ? '保存修改' : '创建 ECR'}
        </button>
      </div>
    </Modal>

      <ECRAffectedItemPicker
        open={showAffectedPicker}
        onClose={() => setShowAffectedPicker(false)}
        onSelect={(items) => addAffectedItems(items)}
        alreadySelected={affectedItems.map((a) => a.entity_id)}
      />

      <ECRDocumentPicker
        open={showDocPicker}
        onClose={() => setShowDocPicker(false)}
        onSelect={(docs) => addDocumentLinks(docs)}
        alreadyLinked={documentLinks.map((d) => d.document_id)}
      />
    </>
  );
}
