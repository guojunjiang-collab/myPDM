import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Modal } from '../Modal';
import ConfigItemPicker from './ConfigItemPicker';
import ConfigItemDetailModal from './ConfigItemDetailModal';
import PartDetailModal from '../PartDetailModal';
import ProfileStatusBadge from './ProfileStatusBadge';
import ProfileReviewPanel from './ProfileReviewPanel';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { configurationApi, configurationProfileApi, usersApi, partsApi, customFieldsApi } from '../../services/api';
import { exportProfilePdf, exportProfileExcel } from '../../services/configProfilePdfExport';
import { useAuthStore, isAdmin } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import type { ConfigurationProfileDetail, ConfigTreeNode, ProfileReviewer, ProfileCcUser } from '../../types';

interface Props {
  open: boolean;
  profileId?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/* ──── Tree helpers for optimistic local updates ──── */

/** Deep clone tree, find part by ID and toggle it (independent, no parent recalc) */
function togglePartInTree(root: ConfigTreeNode | null, partId: string, selected: boolean): ConfigTreeNode | null {
  if (!root) return null;
  function walk(node: ConfigTreeNode): ConfigTreeNode {
    // Check parts at this level
    const partIdx = node.parts.findIndex(p => p.id === partId);
    let newParts = node.parts;
    if (partIdx !== -1) {
      newParts = [...node.parts];
      newParts[partIdx] = { ...newParts[partIdx], is_selected: selected };
    }
    // Walk children
    const newChildren = node.children.map(walk);
    return { ...node, parts: newParts, children: newChildren };
  }
  return walk(root);
}

/** Deep clone tree, find node by ID and toggle only that node (independent, no children cascade) */
function toggleNodeInTree(root: ConfigTreeNode | null, nodeId: string, selected: boolean): ConfigTreeNode | null {
  if (!root) return null;
  function walk(node: ConfigTreeNode): ConfigTreeNode {
    const isTarget = node.id === nodeId;
    let newNode = { ...node };
    if (isTarget) {
      // Only toggle this node's is_selected, don't touch children or parts
      newNode.is_selected = selected;
    }
    newNode.children = node.children.map(walk);
    return newNode;
  }
  return walk(root);
}

/**
 * Check if a node's parent is selected (for enabled/disabled state).
 * Returns true if the node can be interacted with.
 */
function isParentSelected(nodeId: string, root: ConfigTreeNode): boolean {
  // Build parent map
  const parentMap = new Map<string, string>();
  const buildParentMap = (node: ConfigTreeNode, parentId?: string) => {
    if (parentId) parentMap.set(node.id, parentId);
    node.children.forEach(c => buildParentMap(c, node.id));
  };
  buildParentMap(root);

  // Find direct parent
  const parentId = parentMap.get(nodeId);
  if (!parentId) return true; // Root node has no parent constraint

  // Find parent node and check its state
  const findNode = (n: ConfigTreeNode): ConfigTreeNode | null => {
    if (n.id === parentId) return n;
    for (const c of n.children) {
      const r = findNode(c);
      if (r) return r;
    }
    return null;
  };
  const parentNode = findNode(root);
  // Parent must be selected (or required) for child to be enabled
  return !parentNode || parentNode.is_selected || parentNode.is_required;
}

/* ──── Component ──── */

export default function ProfileEditModal({ open, profileId, readOnly, onClose, onSaved }: Props) {
  const isCreate = !profileId;
  const isView = !!profileId && !!readOnly;
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [form, setForm] = useState({
    code: '',
    name: '',
    configuration_item_revision_id: '',
    effectivity_start: '',
    effectivity_end: '',
    remark: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = remarkRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [form.remark]);
  const [profile, setProfile] = useState<ConfigurationProfileDetail | null>(null);
  const [configTree, setConfigTree] = useState<ConfigTreeNode | null>(null);
  const [flattenLoading, setFlattenLoading] = useState(false);

  const exportFlattenBom = async () => {
    if (!configTree) return;
    setFlattenLoading(true);
    try {
      // 从正式配置清单中收集所有选中/必选的零部件，递归展开部件BOM取叶节点
      const partsToExpand: { revisionId: string; code: string; name: string; version: string; status: string; qty: number }[] = [];

      const walkConfig = (node: ConfigTreeNode) => {
        if (!node.is_selected && !node.is_required) return;
        (node.parts || []).forEach((p: any) => {
          if (!p.is_selected && !p.is_required) return;
          const revId = p.part_revision_id || p.id || p.item_id;
          if (revId && p.item_code) {
            partsToExpand.push({
              revisionId: revId,
              code: p.item_code,
              name: p.item_name || '',
              version: p.item_version || '',
              status: p.item_status || '',
              qty: (p.quantity || 1) * (node.quantity || 1),
            });
          }
        });
        (node.children || []).forEach(walkConfig);
      };
      walkConfig(configTree);

      // 收集所有字段定义
      const allDefs = useDataStore.getState().customFieldDefs;
      const partFieldDefs = allDefs.filter((d: any) => d.applies_to?.includes('part') || d.applies_to?.includes('component'));

      // 展平：递归展开部件BOM
      const flatMap = new Map<string, any>();
      const recurringCheck = new Set<string>();
      const customFieldCache = new Map<string, Record<string, any>>();

      const expandAssembly = async (revId: string, multiplier: number) => {
        if (!revId) return;
        try {
          const rev = await partsApi.getRevision(revId);
          if (!rev) return;
          const masterId = rev.master_id;
          const master = await partsApi.get(masterId);
          const isAssembly = master.type === 'assembly';

          if (isAssembly) {
            // 仅对部件做防循环（同一版本只展开一次BOM），叶节点零件不做此限制以保证用量累加
            if (recurringCheck.has(revId)) return;
            recurringCheck.add(revId);
            const bomItems = await partsApi.getBOM(revId);
            for (const bom of (bomItems || [])) {
              await expandAssembly(bom.child_revision_id, multiplier * (bom.quantity || 1));
            }
          } else {
            // 叶节点零件始终累加用量
            const key = `${master.code}|${rev.version}`;
            if (flatMap.has(key)) {
              flatMap.get(key).quantity += multiplier;
            } else {
              flatMap.set(key, {
                code: master.code, name: master.name, version: rev.version,
                quantity: multiplier, status: rev.status, revisionId: revId,
              });
            }
          }
        } catch { /* skip */ }
      };

      // 展开每个配置零部件
      for (const p of partsToExpand) {
        try {
          const rev = await partsApi.getRevision(p.revisionId);
          if (!rev) continue;
          const masterId = rev.master_id;
          const master = await partsApi.get(masterId);
          const isAssembly = master.type === 'assembly';

          if (isAssembly) {
            const bomItems = await partsApi.getBOM(p.revisionId);
            for (const bom of (bomItems || [])) {
              await expandAssembly(bom.child_revision_id, p.qty * (bom.quantity || 1));
            }
          } else {
            const key = `${master.code}|${rev.version}`;
            if (flatMap.has(key)) {
              flatMap.get(key).quantity += p.qty;
            } else {
              flatMap.set(key, {
                code: master.code,
                name: master.name,
                version: rev.version,
                quantity: p.qty,
                status: rev.status,
                revisionId: p.revisionId,
              });
            }
          }
        } catch { /* skip */ }
      }

      // 批量获取自定义字段值
      const revIds = Array.from(flatMap.values()).map((r: any) => r.revisionId);
      await Promise.all(revIds.map(async (revId) => {
        try {
          const vals = await customFieldsApi.getValues('component', revId);
          const map: Record<string, any> = {};
          (vals.data || []).forEach((v: any) => { map[v.field_id] = v.value; });
          customFieldCache.set(revId, map);
        } catch { /* skip */ }
      }));

      // 构建 Excel
      const items = Array.from(flatMap.values()).sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'));
      const statusLabel = (s: string) => ({ draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' })[s] || s;
      const headers = ['件号', '名称', '版本', '数量', '状态', ...partFieldDefs.map((d: any) => d.name)];
      const rows = items.map((row: any) => {
        const cfVals = customFieldCache.get(row.revisionId) || {};
        return [
          row.code, row.name, row.version, row.quantity, statusLabel(row.status),
          ...partFieldDefs.map((d: any) => cfVals[d.id] ?? ''),
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '平铺BOM');
      XLSX.writeFile(wb, `平铺BOM_${profile?.code || 'unknown'}.xlsx`);
    } catch (err: any) {
      setError(err?.message || '导出失败');
    } finally {
      setFlattenLoading(false);
    }
  };

  // ── Approval flow state ──
  const [reviewers, setReviewers] = useState<ProfileReviewer[]>([]);
  const [reviewMode, setReviewMode] = useState<'all' | 'any'>('all');
  const [ccUsers, setCcUsers] = useState<ProfileCcUser[]>([]);
  const [users, setUsers] = useState<{ id: string; real_name: string; username: string; role: string }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // 递归按构型号排序
  const sortTreeByCode = (node: ConfigTreeNode | null): ConfigTreeNode | null => {
    if (!node) return null;
    return {
      ...node,
      children: node.children
        .map(sortTreeByCode)
        .filter((c): c is ConfigTreeNode => c !== null)
        .sort((a, b) => a.code.localeCompare(b.code, 'zh-CN', { numeric: true })),
    };
  };
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [cfgPickOpen, setCfgPickOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Formal checklist row click → detail modal
  const [detailModal, setDetailModal] = useState<{ type: string; id: string } | null>(null);
  // 零部件行点击 → 复用最新的 PartDetailModal（master_id）
  const [partDetailMasterId, setPartDetailMasterId] = useState<string | null>(null);

  const handleFormalRowClick = async (itemType: string, itemId: string) => {
    if (itemType === 'part' || itemType === 'assembly' || itemType === 'component') {
      // 复用最新的零部件详情弹窗（三层模型）；itemId 为 master_id
      setPartDetailMasterId(itemId);
      return;
    }
    setDetailModal({ type: itemType, id: itemId });
  };

  // Load profile for VIEW/EDIT mode
  const loadProfile = async () => {
    if (!profileId) return;
    setLoading(true);
    try {
      const r = await configurationProfileApi.get(profileId);
      const data: ConfigurationProfileDetail = r.data;
      setProfile(data);
      setConfigTree(sortTreeByCode(data.config_tree || null));
      // Default expand only level 1 (root node) for edit checklist, to avoid showing too much
      if (data.config_tree) {
        setExpandedNodes(new Set([data.config_tree.id]));
      }
      // Default expand root node for formal checklist (show level 1 children)
      if (data.config_tree) {
        setFormalExpanded(new Set([data.config_tree.id]));
      }
      setForm({
        code: data.code,
        name: data.name,
        configuration_item_revision_id: data.configuration_item_revision_id,
        effectivity_start: data.effectivity_start || '',
        effectivity_end: data.effectivity_end || '',
        remark: data.remark || '',
      });
      setReviewers(data.reviewers || []);
      setReviewMode(data.review_mode || 'all');
      setCcUsers(data.cc_users || []);
    } catch (e: any) {
      setError('加载配置详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setError('');
      if (isCreate) {
        setForm({ code: '', name: '', configuration_item_revision_id: '', effectivity_start: '', effectivity_end: '', remark: '' });
        setProfile(null);
        setConfigTree(null);
        setExpandedNodes(new Set());
        setReviewers([]);
        setReviewMode('all');
        setCcUsers([]);
      } else {
        loadProfile();
      }
    }
  }, [open, profileId]);

  // Fetch users for reviewer/cc selection
  useEffect(() => {
    if (open && (isCreate || (profile && profile.status === 'draft'))) {
      setUsersLoading(true);
      usersApi.list({ page_size: 200 }).then((resp) => {
        const list = resp.data?.items || resp.data || [];
        setUsers(Array.isArray(list) ? list : []);
      }).finally(() => setUsersLoading(false));
    }
  }, [open, isCreate, profile?.status]);

  const canEdit = profile && !readOnly && profile.status === 'draft';
  const fieldDisabled = isView || (profile && !canEdit && !isCreate);

  // CREATE submit
  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('编号和名称不能为空'); return; }
    setSaving(true);
    try {
      await configurationProfileApi.create({
        code: form.code.trim(),
        name: form.name.trim(),
        configuration_item_revision_id: form.configuration_item_revision_id || undefined,
        effectivity_start: form.effectivity_start || undefined,
        effectivity_end: form.effectivity_end || undefined,
        remark: form.remark || undefined,
        reviewers: reviewers.map((r, i) => ({ ...r, seq: i })),
        review_mode: reviewMode,
        cc_users: ccUsers,
      } as any);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // EDIT update basic info
  const handleUpdate = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('编号和名称不能为空'); return; }
    setSaving(true);
    try {
      await configurationProfileApi.update(profileId!, {
        code: form.code.trim(),
        name: form.name.trim(),
        configuration_item_revision_id: form.configuration_item_revision_id || null,
        effectivity_start: form.effectivity_start || undefined,
        effectivity_end: form.effectivity_end || undefined,
        remark: form.remark || undefined,
        reviewers: reviewers.map((r, i) => ({ ...r, seq: i })),
        review_mode: reviewMode,
        cc_users: ccUsers,
      } as any);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // Toggle config item node — optimistic local update, no scroll jump
  const handleToggleConfigNode = async (configItemId: string) => {
    const node = configTree;
    if (!node) return;
    // Read current selected state BEFORE optimistic update
    const currentSelected = node.is_selected; // 简化：用当前节点选中态判断方向
    // Actually, find the real node's state
    const findNode = (n: ConfigTreeNode): ConfigTreeNode | null => {
      if (n.id === configItemId) return n;
      for (const c of n.children) {
        const r = findNode(c);
        if (r) return r;
      }
      return null;
    };
    const targetNode = findNode(node);
    if (!targetNode) return;
    const newSelected = !targetNode.is_selected;
    // Optimistic local update
    setConfigTree(prev => toggleNodeInTree(prev, configItemId, newSelected));
    // API in background
    try {
      await configurationProfileApi.toggleConfigNode(profileId!, configItemId);
      // No reload on success — local state already correct
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
      // Revert on error
      setConfigTree(prev => toggleNodeInTree(prev, configItemId, !newSelected));
    }
  };

  // Toggle individual part — optimistic local update, no scroll jump
  const handleTogglePart = async (itemId: string, currentSelected: boolean) => {
    // Optimistic local update
    setConfigTree(prev => togglePartInTree(prev, itemId, !currentSelected));
    // API in background
    try {
      await configurationProfileApi.updateItem(profileId!, itemId, { is_selected: !currentSelected });
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
      // Revert on error
      setConfigTree(prev => togglePartInTree(prev, itemId, currentSelected));
    }
  };

  // Toggle tree node expand/collapse
  const toggleExpand = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Change associated config item (called from ConfigItemPicker onConfirm)
  const handleChangeConfigItem = async (item: { id: string; code: string; name: string }) => {
    if (item.id === form.configuration_item_revision_id) return;
    setForm(prev => ({ ...prev, configuration_item_revision_id: item.id }));
    try {
      await configurationProfileApi.update(profileId!, { configuration_item_revision_id: item.id } as any);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '关联构型项失败');
    }
  };

  // Force regenerate checklist from latest config item content
  const handleRegenerate = async () => {
    if (!profileId || !form.configuration_item_revision_id) return;
    setSaving(true);
    try {
      const r = await configurationProfileApi.regenerate(profileId);
      setConfigTree(r.data.config_tree || null);
      // Expand only level 1 (root node) after regenerate, consistent with default
      setExpandedNodes(r.data.config_tree ? new Set([r.data.config_tree.id]) : new Set());
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || '重建清单失败');
    } finally {
      setSaving(false);
    }
  };

  // Remove config item association
  const handleRemoveConfigItem = async () => {
    if (!profileId) return;
    setSaving(true);
    try {
      await configurationProfileApi.update(profileId, { configuration_item_revision_id: null } as any);
      setForm(prev => ({ ...prev, configuration_item_revision_id: '' }));
      setConfigTree(null);
      setExpandedNodes(new Set());
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.detail || '删除关联失败');
    } finally {
      setSaving(false);
    }
  };

  // ── Approval flow handlers ──
  const handleSubmitReview = async () => {
    if (!profileId) return;
    if (reviewers.length === 0) {
      if (!confirm('当前无审批人，提交后将直接生效。确认提交？')) return;
    }
    setSaving(true);
    try {
      await configurationProfileApi.submit(profileId);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
    } finally { setSaving(false); }
  };

  const handleWithdraw = async () => {
    if (!profileId) return;
    setSaving(true);
    try {
      await configurationProfileApi.withdraw(profileId);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
    } finally { setSaving(false); }
  };

  const handleReopen = async () => {
    if (!profileId) return;
    setSaving(true);
    try {
      await configurationProfileApi.reopen(profileId);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
    } finally { setSaving(false); }
  };

  const handleArchive = async () => {
    if (!profileId) return;
    setSaving(true);
    try {
      await configurationProfileApi.archive(profileId);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
    } finally { setSaving(false); }
  };

  // ── Reviewer helpers ──
  const addReviewer = () => {
    const nextSeq = reviewers.length > 0 ? Math.max(...reviewers.map((r) => r.seq || 0)) + 1 : 1;
    setReviewers([...reviewers, { user_id: '', user_name: '', seq: nextSeq }]);
  };
  const removeReviewer = (index: number) => {
    setReviewers(reviewers.filter((_, i) => i !== index));
  };
  const updateReviewer = (index: number, user_id: string) => {
    const u = users.find((x) => x.id === user_id);
    const updated = [...reviewers];
    updated[index] = { ...updated[index], user_id, user_name: u?.real_name || '', role: u?.role || '' };
    setReviewers(updated);
  };

  const addCc = (user_id: string) => {
    const u = users.find((x) => x.id === user_id);
    if (!u || ccUsers.some((c) => c.user_id === user_id)) return;
    setCcUsers([...ccUsers, { user_id, user_name: u.real_name || '' }]);
  };
  const removeCc = (user_id: string) => {
    setCcUsers(ccUsers.filter((c) => c.user_id !== user_id));
  };

  const partStatusBadge = (s: string | undefined) => {
    if (!s || s === '-') return <span className="text-[var(--ui-text-tertiary)]">-</span>;
    return <Badge status={s} />;
  };

  // ── Formal checklist: only selected items, default collapsed ──
  const [formalExpanded, setFormalExpanded] = useState<Set<string>>(new Set());
  const toggleFormalExpand = (id: string) => {
    setFormalExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderFormalRows = (node: ConfigTreeNode, level: number = 0): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    if (!node.is_selected && !node.is_required) return rows;

    const hasChildren = node.children.length > 0;
    const isExpanded = formalExpanded.has(node.id);
    const levelPrefix = level > 0 ? '-'.repeat(level) : '';

    const hasSelectedParts = node.parts.some(p => p.is_selected);

    rows.push(
      <tr key={node.id} className="bg-[var(--ui-bg-subtle)] cursor-pointer hover:bg-purple-50 transition-colors"
        onClick={() => handleFormalRowClick('config_item', node.id)}>
        <td className="px-3 py-2 text-xs text-[var(--ui-text-secondary)] whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {levelPrefix}{level}
          {hasChildren ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleFormalExpand(node.id); }}
              className="inline-flex items-center text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] cursor-pointer select-none ml-1">
              {isExpanded ? '\u25bc' : '\u25b6'}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-700">{node.code}</td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{node.name}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <Badge tone="purple" label="构型项" />
        </td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{node.version || '-'}</td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{partStatusBadge(node.status)}</td>
        <td className="px-3 py-2 text-center text-sm">{node.quantity ?? 1}</td>
      </tr>
    );

    // Selected parts (hidden when collapsed)
    if (!hasChildren || isExpanded) {
      for (const part of node.parts) {
        if (part.item_type === 'config_item') continue;
        if (!part.is_selected) continue;
        rows.push(
          <tr key={part.id} className="cursor-pointer hover:bg-blue-50 transition-colors"
            onClick={() => handleFormalRowClick(part.item_type, part.item_id)}>
            <td className="px-3 py-2 text-xs text-[var(--ui-text-tertiary)] whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{'-'.repeat(level)}</td>
            <td className="px-3 py-2 text-sm font-mono text-[var(--ui-text-secondary)]">{part.item_code}</td>
            <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{part.item_name || '-'}</td>
            <td className="px-3 py-2 text-sm whitespace-nowrap">
              <Badge tone={part.item_type === 'assembly' ? 'blue' : 'gray'} label={part.item_type === 'assembly' ? '部件' : '零件'} />
            </td>
            <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{part.item_version || '-'}</td>
            <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{partStatusBadge(part.item_status)}</td>
            <td className="px-3 py-2 text-center text-sm">{part.quantity ?? 1}</td>
          </tr>
        );
      }
    }

    // Recurse into selected children (hidden when collapsed)
    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        rows.push(...renderFormalRows(child, level + 1));
      }
    }

    return rows;
  };

  const renderTableRows = (node: ConfigTreeNode, level: number = 0): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const levelPrefix = level > 0 ? '-'.repeat(level) : '';

    // ── Config Item Row ──
    rows.push(
      <tr key={node.id} className="bg-[var(--ui-bg-subtle)] hover:bg-purple-50 transition-colors">
        <td className="px-3 py-2 text-xs text-[var(--ui-text-secondary)] whitespace-nowrap">
          {levelPrefix}{level}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="inline-flex items-center text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] cursor-pointer select-none ml-1"
            >
              {isExpanded ? '\u25bc' : '\u25b6'}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-700">{node.code}</td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{node.name}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <Badge tone="purple" label="构型项" />
        </td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{node.version || '-'}</td>
        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{partStatusBadge(node.status)}</td>
        <td className="px-3 py-2 text-center text-sm">{node.quantity ?? 1}</td>
        <td className="px-3 py-2 text-center whitespace-nowrap">
          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={node.is_selected}
              disabled={node.is_required || !canEdit || (level > 0 && !isParentSelected(node.id, configTree!))}
              onChange={() => { if (!node.is_required && canEdit) handleToggleConfigNode(node.id); }}
              className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 disabled:opacity-50"
            />
            <Badge tone={node.is_required ? 'blue' : 'gray'} label={node.is_required ? '必选' : '可选'} />
          </label>
        </td>
      </tr>
    );

    // ── Part Rows (hidden when collapsed) ──
    if (!hasChildren || isExpanded) {
      for (const part of node.parts) {
        if (part.item_type === 'config_item') continue;
        rows.push(
        <tr key={part.id} className={`${!node.is_selected ? 'opacity-40' : ''} hover:bg-[var(--ui-bg-subtle)] transition-colors`}>
          <td className="px-3 py-2 text-xs text-[var(--ui-text-tertiary)] whitespace-nowrap">
            <span className="inline-block w-4 mr-1" />
            {'-'.repeat(level)}
          </td>
          <td className="px-3 py-2 text-sm font-mono text-[var(--ui-text-secondary)]">{part.item_code}</td>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{part.item_name || '-'}</td>
          <td className="px-3 py-2 text-sm whitespace-nowrap">
            <Badge tone={part.item_type === 'assembly' ? 'blue' : 'gray'} label={part.item_type === 'assembly' ? '部件' : '零件'} />
          </td>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{part.item_version || '-'}</td>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{partStatusBadge(part.item_status)}</td>
          <td className="px-3 py-2 text-center text-sm">{part.quantity ?? 1}</td>
          <td className="px-3 py-2 text-center whitespace-nowrap">
            <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={part.is_selected}
                disabled={part.is_required || !canEdit || !node.is_selected}
                onChange={() => { if (canEdit && node.is_selected) handleTogglePart(part.id, part.is_selected); }}
                className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 disabled:opacity-50"
              />
              <Badge tone={part.is_required ? 'blue' : 'gray'} label={part.is_required ? '必选' : '可选'} />
            </label>
          </td>
        </tr>
      );
    }
    }

    // ── Child Config Items (recursive, only when expanded) ──
    if (hasChildren && isExpanded) {
      for (const child of node.children) {
        rows.push(...renderTableRows(child, level + 1));
      }
    }

    return rows;
  };

  // Collect selected items for the formal checklist
  const collectSelected = (node: ConfigTreeNode): { configName: string; parts: { code: string; type: string }[] }[] => {
    const result: { configName: string; parts: { code: string; type: string }[] }[] = [];
    const walk = (n: ConfigTreeNode) => {
      if (n.is_selected || n.is_required) {
        const selectedParts = n.parts.filter(p => p.is_selected || p.is_required);
        if (selectedParts.length > 0) {
          result.push({
            configName: n.name,
            parts: selectedParts.map(p => ({ code: p.item_code, type: p.item_type })),
          });
        } else {
          // Config item itself is selected but no parts
          result.push({ configName: n.name, parts: [] });
        }
      }
      n.children.forEach(walk);
    };
    walk(node);
    return result;
  };

  const title = isCreate ? '新建构型配置' : (isView ? '构型配置详情' : '编辑构型配置');

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        width="3xl"
        headerAction={isView && profile && configTree ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm"
              type="button"
              onClick={() => { try { exportProfileExcel(profile, configTree); } catch (e: any) { setError(e?.message || '导出失败'); } }}
              title="导出正式配置清单为 Excel 表格"
            >
              📊 导出表格
            </Button>
            <Button variant="secondary" size="sm"
              type="button"
              onClick={() => { try { exportProfilePdf(profile, configTree); } catch (e: any) { setError(e?.message || '导出失败'); } }}
              title="导出为 PDF（正式配置清单全展开）"
            >
              📄 导出PDF
            </Button>
            <Button size="sm"
              type="button"
              onClick={() => {
                window.open(`/stp-viewer?config-profile=${profile.id}`, '_blank');
              }}
              title="在新标签页中3D预览配置清单中所有零部件"
            >
              🧊 3D预览
            </Button>
            <Button variant="secondary" size="sm"
              type="button"
              onClick={exportFlattenBom}
              disabled={flattenLoading}
              title="将该构型配置下所有构型项关联的部件BOM递归展开为叶节点零件清单并导出为Excel"
            >
              📊 导出平铺BOM
            </Button>
          </div>
        ) : undefined}
      >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
        )}

        {loading ? (
          <div className="text-sm text-[var(--ui-text-tertiary)] py-8 text-center">加载中...</div>
        ) : (
          <>
            {/* Basic Info */}
            {isView && profile ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoItem label="编号" value={profile.code} />
                <InfoItem label="名称" value={profile.name} />
                <InfoItem label="架次范围" value={
                  (profile.effectivity_start || profile.effectivity_end)
                    ? `${profile.effectivity_start || '-'} ~ ${profile.effectivity_end || '-'}`
                    : '-'
                } />
                <InfoItem label="状态" value={<ProfileStatusBadge status={profile.status} />} />
                <InfoItem label="备注" value={profile.remark || '-'} className="col-span-2 md:col-span-2" />
              </div>
            ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">编号 {isCreate && '*'}</label>
                <Input size="xs"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="disabled:text-[var(--ui-text-tertiary)] placeholder:text-gray-300"
                  placeholder="如 CFG-PROFILE-001"
                />
              </div>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">名称 {isCreate && '*'}</label>
                <Input size="xs"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="disabled:text-[var(--ui-text-tertiary)] placeholder:text-gray-300"
                  placeholder="如 A型机翼配置"
                />
              </div>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">架次起始</label>
                <Input size="xs"
                  value={form.effectivity_start}
                  onChange={(e) => setForm({ ...form, effectivity_start: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="disabled:text-[var(--ui-text-tertiary)] placeholder:text-gray-300"
                  placeholder="如 001"
                />
              </div>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">架次结束</label>
                <Input size="xs"
                  value={form.effectivity_end}
                  onChange={(e) => setForm({ ...form, effectivity_end: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="disabled:text-[var(--ui-text-tertiary)] placeholder:text-gray-300"
                  placeholder="如 999"
                />
              </div>
              <div className="col-span-2 md:col-span-2 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">备注</label>
                <Textarea size="xs"
                  ref={remarkRef}
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  rows={1}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="resize-none disabled:text-[var(--ui-text-tertiary)]"
                />
              </div>
              {!isCreate && profile && (
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">状态</label>
                  <div className="flex items-center gap-2 pt-0.5">
                    <ProfileStatusBadge status={profile.status} />
                  </div>
                </div>
              )}
              {!isView && (!isCreate ? (profile && profile.status === 'draft') : true) && (
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">审批模式</label>
                  <div className="flex gap-3 pt-0.5 text-sm">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={reviewMode === 'all'} onChange={() => setReviewMode('all')}
                        className="text-primary-600" />
                      会签
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" checked={reviewMode === 'any'} onChange={() => setReviewMode('any')}
                        className="text-primary-600" />
                      或签
                    </label>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ── Approval action buttons ── */}
            {!isCreate && !isView && profile && (
              <div className="flex items-center gap-2 border-t pt-3">
                {profile.status === 'reviewing' && (
                  <Button variant="secondary" size="sm" onClick={handleWithdraw} disabled={saving}>
                    撤回
                  </Button>
                )}
                {profile.status === 'rejected' && (
                  <Button size="sm" onClick={handleReopen} disabled={saving}>
                    重新编辑
                  </Button>
                )}
                {(profile.status === 'active' || profile.status === 'rejected') && isAdmin() && (
                  <Button variant="secondary" size="sm" onClick={handleArchive} disabled={saving}>
                    归档
                  </Button>
                )}
              </div>
            )}

            {/* ── Reviewers & CC section (draft / new) ── */}
            {!isView && (!isCreate ? (profile && profile.status === 'draft') : true) && (
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">审批人</label>
                    <Button size="xs" type="button" onClick={addReviewer}>
                      + 添加
                    </Button>
                  </div>
                  <div className="space-y-1">
                    {reviewers.length === 0 && (
                      <div className="text-sm text-[var(--ui-text-tertiary)] py-2">暂无审批人（提交时将自动生效）</div>
                    )}
                    {reviewers.map((rv, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-[var(--ui-text-tertiary)] w-5">{rv.seq || i + 1}</span>
                        <Select size="xs" value={rv.user_id}
                          onChange={(e) => updateReviewer(i, e.target.value)}
                          disabled={usersLoading}
                          className="flex-1">
                          <option value="">{usersLoading ? '加载中...' : '请选择审批人'}</option>
                          {users.filter((u) => u.id !== currentUserId && (u.role === 'admin' || u.role === 'engineer')).map((u) => (
                            <option key={u.id} value={u.id}>{u.real_name} ({u.username})</option>
                          ))}
                        </Select>
                        <Button variant="danger" size="xs" type="button" onClick={() => removeReviewer(i)}>✕</Button>
                      </div>
                    ))}
                  </div>
              </div>
            )}

            {/* ── Review panel (viewing mode, non-draft) ── */}
            {profile && profile.status !== 'draft' && !isCreate && (
              <div className="border-t pt-3 space-y-4">
                <ProfileReviewPanel
                  reviewers={profile.reviewers || []}
                  records={profile.review_records || []}
                  reviewMode={profile.review_mode}
                  canReview={profile.status === 'reviewing' &&
                    (isAdmin() || (profile.reviewers || []).some((r) => r.user_id === currentUserId))}
                  onReview={async (decision, comment) => {
                    await configurationProfileApi.review(profile.id, decision, comment);
                    await loadProfile();
                  }}
                />
              </div>
            )}

            {/* ── 配置清单（仅编辑模式） ── */}
            {profile && canEdit && (
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-700">配置清单</h4>
                  <div className="flex items-center gap-2">
                    {form.configuration_item_revision_id && (
                      <>
                        <Button size="xs" type="button" onClick={handleRegenerate} disabled={saving}>
                          更新
                        </Button>
                        <Button variant="danger" size="xs" type="button" onClick={handleRemoveConfigItem} disabled={saving}>
                          删除
                        </Button>
                      </>
                    )}
                    <Button size="sm"
                      type="button"
                      onClick={() => setCfgPickOpen(true)}
                    >
                      {form.configuration_item_revision_id ? '更换构型项' : '+ 关联构型项'}
                    </Button>
                  </div>
                </div>
                <ConfigItemPicker
                  open={cfgPickOpen}
                  onClose={() => setCfgPickOpen(false)}
                  onConfirm={(items) => { if (items.length > 0) handleChangeConfigItem({ id: items[0].child_revision_id, code: '', name: '' }); }}
                  excludeId={form.configuration_item_revision_id || undefined}
                />

                {/* Table-based checklist */}
                {configTree ? (
                  <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden max-h-[500px] overflow-y-auto bg-[var(--ui-bg-surface)]">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-20">层级</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-44 whitespace-nowrap">构型号/零部件件号</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-28">名称</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16 whitespace-nowrap">类型</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16">版本</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16">状态</th>
                          <th className="text-center px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-12">数量</th>
                          <th className="text-center px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-24">可选</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {renderTableRows(configTree)}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="border border-[var(--ui-border)] rounded-lg p-4 text-center">
                    <p className="text-xs text-[var(--ui-text-tertiary)]">
                      {form.configuration_item_revision_id ? '请先关联构型项以展开配置清单' : '暂无关联构型项，无法生成配置清单'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── 正式配置清单 ── */}
            {profile && configTree && (
              <div className="border-t pt-3">
                <h4 className="text-sm font-bold text-gray-700 mb-2">正式配置清单</h4>
                <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden max-h-[600px] overflow-y-auto bg-[var(--ui-bg-surface)]">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-20">层级</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-44 whitespace-nowrap">构型号/零部件件号</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-28">名称</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16 whitespace-nowrap">类型</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16">版本</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-16">状态</th>
                        <th className="text-center px-3 py-2 text-sm font-medium text-[var(--ui-text-secondary)] w-12">数量</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {renderFormalRows(configTree)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── 状态日志 ── */}
            {profile && profile.status !== 'draft' && !isCreate && (profile.status_logs || []).length > 0 && (
              <div className="border-t pt-3">
                <h4 className="text-sm font-bold text-gray-700 mb-2">状态日志</h4>
                <ul className="text-xs text-[var(--ui-text-secondary)] space-y-1 max-h-32 overflow-y-auto">
                  {(profile.status_logs || []).map((l) => (
                    <li key={l.id} className="flex gap-2">
                      <span className="text-[var(--ui-text-tertiary)]">{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</span>
                      <span>{l.from_status || '—'} → {l.to_status}</span>
                      <span>{l.operator_name}</span>
                      <span className="text-[var(--ui-text-tertiary)]">{l.comment}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </>
        )}
      </div>

      {/* Footer Buttons — 置于滚动容器外侧，始终可见 */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-[var(--ui-border)]">
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
        {isCreate && (
          <Button
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        )}
        {canEdit && (
          <>
            <Button
              onClick={handleUpdate}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
            <Button variant="success"
              onClick={handleSubmitReview}
              disabled={saving}
            >
              提交
            </Button>
          </>
        )}
      </div>
    </Modal>

    {/* ── 正式清单行点击 → 详情弹窗 ── */}
    {detailModal?.type === 'config_item' && (
      <ConfigItemDetailModal
        revisionId={detailModal.id}
        open={!!detailModal}
        onClose={() => setDetailModal(null)}
      />
    )}
    {/* 零部件行点击 → 复用最新的零部件详情弹窗 */}
    {partDetailMasterId && (
      <PartDetailModal
        masterId={partDetailMasterId}
        open={!!partDetailMasterId}
        onClose={() => setPartDetailMasterId(null)}
      />
    )}
  </>
);
}

function InfoItem({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100 ${className || ''}`}>
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium whitespace-pre-wrap">{value}</div>
    </div>
  );
}
