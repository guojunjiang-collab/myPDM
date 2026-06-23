import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import ConfigItemPicker from './ConfigItemPicker';
import ConfigurationDetailModal from './ConfigurationDetailModal';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import ProfileStatusBadge from './ProfileStatusBadge';
import ProfileReviewPanel from './ProfileReviewPanel';
import { configurationApi, configurationProfileApi, partsApi, assembliesApi, usersApi } from '../../services/api';
import { exportProfilePdf, exportProfileExcel } from '../../services/configProfilePdfExport';
import { isAdmin } from '../../stores/auth';
import { useAuthStore } from '../../stores/auth';
import type { ConfigurationProfileDetail, ConfigTreeNode, Part, Assembly, ProfileReviewer, ProfileCcUser } from '../../types';

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
    configuration_item_id: '',
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
  const [detailData, setDetailData] = useState<Part | Assembly | null>(null);

  const handleFormalRowClick = async (itemType: string, itemId: string) => {
    setDetailModal({ type: itemType, id: itemId });
    if (itemType === 'part') {
      try {
        const r = await partsApi.get(itemId);
        setDetailData(r.data as Part);
      } catch { setDetailData(null); }
    } else if (itemType === 'assembly') {
      try {
        const r = await assembliesApi.get(itemId);
        setDetailData(r.data as Assembly);
      } catch { setDetailData(null); }
    } else {
      setDetailData(null);
    }
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
        configuration_item_id: data.configuration_item_id,
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
        setForm({ code: '', name: '', configuration_item_id: '', effectivity_start: '', effectivity_end: '', remark: '' });
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
        configuration_item_id: form.configuration_item_id || undefined,
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
        configuration_item_id: form.configuration_item_id || null,
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
    if (item.id === form.configuration_item_id) return;
    setForm(prev => ({ ...prev, configuration_item_id: item.id }));
    try {
      await configurationProfileApi.update(profileId!, { configuration_item_id: item.id } as any);
      await loadProfile();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '关联构型项失败');
    }
  };

  // Force regenerate checklist from latest config item content
  const handleRegenerate = async () => {
    if (!profileId || !form.configuration_item_id) return;
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
      await configurationProfileApi.update(profileId, { configuration_item_id: null } as any);
      setForm(prev => ({ ...prev, configuration_item_id: '' }));
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

  const getStatusLabel = (s: string | undefined) => {
    if (!s) return '-';
    const map: Record<string, string> = { draft: '草稿', active: '生效', archived: '归档', released: '发布' };
    return map[s] || s;
  };

  const partStatusBadge = (s: string | undefined) => {
    if (!s || s === '-') return <span className="text-gray-400">-</span>;
    const colorMap: Record<string, string> = {
      draft: 'bg-blue-100 text-blue-800',
      frozen: 'bg-orange-100 text-orange-800',
      released: 'bg-green-100 text-green-800',
      obsolete: 'bg-red-100 text-red-800',
    };
    const labelMap: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
    return <span className={`px-1.5 py-0.5 rounded text-xs ${colorMap[s] || 'bg-gray-100 text-gray-800'}`}>{labelMap[s] || s}</span>;
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
      <tr key={node.id} className="bg-gray-50/70 cursor-pointer hover:bg-purple-50 transition-colors"
        onClick={() => handleFormalRowClick('config_item', node.id)}>
        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {levelPrefix}{level}
          {hasChildren ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleFormalExpand(node.id); }}
              className="inline-flex items-center text-gray-400 hover:text-gray-600 cursor-pointer select-none ml-1">
              {isExpanded ? '\u25bc' : '\u25b6'}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-700">{node.code}</td>
        <td className="px-3 py-2 text-sm text-gray-600">{node.name}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">构型项</span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">-</td>
        <td className="px-3 py-2 text-xs text-gray-400">-</td>
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
            <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>{'-'.repeat(level)}</td>
            <td className="px-3 py-2 text-sm font-mono text-gray-600">{part.item_code}</td>
            <td className="px-3 py-2 text-sm text-gray-600">{part.item_name || '-'}</td>
            <td className="px-3 py-2 text-sm whitespace-nowrap">
              <span className={`px-1.5 py-0.5 rounded text-xs ${part.item_type === 'assembly' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                {part.item_type === 'assembly' ? '部件' : '零件'}
              </span>
            </td>
            <td className="px-3 py-2 text-sm text-gray-500">{part.item_version || '-'}</td>
            <td className="px-3 py-2 text-sm text-gray-500">{partStatusBadge(part.item_status)}</td>
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
      <tr key={node.id} className="bg-gray-50/70 hover:bg-purple-50 transition-colors">
        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
          {levelPrefix}{level}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpand(node.id)}
              className="inline-flex items-center text-gray-400 hover:text-gray-600 cursor-pointer select-none ml-1"
            >
              {isExpanded ? '\u25bc' : '\u25b6'}
            </button>
          ) : null}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-700">{node.code}</td>
        <td className="px-3 py-2 text-sm text-gray-600">{node.name}</td>
        <td className="px-3 py-2 text-xs whitespace-nowrap">
          <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">构型项</span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">-</td>
        <td className="px-3 py-2 text-xs text-gray-400">-</td>
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
            <span className={`text-xs px-1.5 py-0.5 rounded ${node.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
              {node.is_required ? '必选' : '可选'}
            </span>
          </label>
        </td>
      </tr>
    );

    // ── Part Rows (hidden when collapsed) ──
    if (!hasChildren || isExpanded) {
      for (const part of node.parts) {
        if (part.item_type === 'config_item') continue;
        rows.push(
        <tr key={part.id} className={`${!node.is_selected ? 'opacity-40' : ''} hover:bg-gray-50/50 transition-colors`}>
          <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
            <span className="inline-block w-4 mr-1" />
            {'-'.repeat(level)}
          </td>
          <td className="px-3 py-2 text-sm font-mono text-gray-600">{part.item_code}</td>
          <td className="px-3 py-2 text-sm text-gray-600">{part.item_name || '-'}</td>
          <td className="px-3 py-2 text-sm whitespace-nowrap">
            <span className={`px-1.5 py-0.5 rounded text-xs ${part.item_type === 'assembly' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
              {part.item_type === 'assembly' ? '部件' : '零件'}
            </span>
          </td>
          <td className="px-3 py-2 text-sm text-gray-500">{part.item_version || '-'}</td>
          <td className="px-3 py-2 text-sm text-gray-500">{partStatusBadge(part.item_status)}</td>
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
              <span className={`text-xs px-1.5 py-0.5 rounded ${part.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                {part.is_required ? '必选' : '可选'}
              </span>
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
            <button
              type="button"
              onClick={() => { try { exportProfileExcel(profile, configTree); } catch (e: any) { setError(e?.message || '导出失败'); } }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              title="导出正式配置清单为 Excel 表格"
            >
              📊 导出表格
            </button>
            <button
              type="button"
              onClick={() => { try { exportProfilePdf(profile, configTree); } catch (e: any) { setError(e?.message || '导出失败'); } }}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
              title="导出为 PDF（正式配置清单全展开）"
            >
              📄 导出PDF
            </button>
          </div>
        ) : undefined}
      >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>
        )}

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">加载中...</div>
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
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">编号 {isCreate && '*'}</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-400 placeholder:text-gray-300"
                  placeholder="如 CFG-PROFILE-001"
                />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">名称 {isCreate && '*'}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-400 placeholder:text-gray-300"
                  placeholder="如 A型机翼配置"
                />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">架次起始</label>
                <input
                  value={form.effectivity_start}
                  onChange={(e) => setForm({ ...form, effectivity_start: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-400 placeholder:text-gray-300"
                  placeholder="如 001"
                />
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">架次结束</label>
                <input
                  value={form.effectivity_end}
                  onChange={(e) => setForm({ ...form, effectivity_end: e.target.value })}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100 disabled:text-gray-400 placeholder:text-gray-300"
                  placeholder="如 999"
                />
              </div>
              <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                <label className="block text-xs text-gray-500 mb-0.5">备注</label>
                <textarea
                  ref={remarkRef}
                  value={form.remark}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  rows={1}
                  disabled={!isCreate && (fieldDisabled || profile?.status !== 'draft')}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              {!isCreate && profile && (
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <label className="block text-xs text-gray-500 mb-0.5">状态</label>
                  <div className="flex items-center gap-2 pt-0.5">
                    <ProfileStatusBadge status={profile.status} />
                  </div>
                </div>
              )}
              {!isView && (!isCreate ? (profile && profile.status === 'draft') : true) && (
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <label className="block text-xs text-gray-500 mb-0.5">审批模式</label>
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
                  <button onClick={handleWithdraw} disabled={saving}
                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                    撤回
                  </button>
                )}
                {profile.status === 'rejected' && (
                  <button onClick={handleReopen} disabled={saving}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">
                    重新编辑
                  </button>
                )}
                {(profile.status === 'active' || profile.status === 'rejected') && isAdmin() && (
                  <button onClick={handleArchive} disabled={saving}
                    className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50">
                    归档
                  </button>
                )}
              </div>
            )}

            {/* ── Reviewers & CC section (draft / new) ── */}
            {!isView && (!isCreate ? (profile && profile.status === 'draft') : true) && (
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">审批人</label>
                    <button type="button" onClick={addReviewer}
                      className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">
                      + 添加
                    </button>
                  </div>
                  <div className="space-y-1">
                    {reviewers.length === 0 && (
                      <div className="text-sm text-gray-400 py-2">暂无审批人（提交时将自动生效）</div>
                    )}
                    {reviewers.map((rv, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-5">{rv.seq || i + 1}</span>
                        <select value={rv.user_id}
                          onChange={(e) => updateReviewer(i, e.target.value)}
                          disabled={usersLoading}
                          className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500">
                          <option value="">{usersLoading ? '加载中...' : '请选择审批人'}</option>
                          {users.filter((u) => u.id !== currentUserId && (u.role === 'admin' || u.role === 'engineer')).map((u) => (
                            <option key={u.id} value={u.id}>{u.real_name} ({u.username})</option>
                          ))}
                        </select>
                        <button type="button" onClick={() => removeReviewer(i)}
                          className="text-red-400 hover:text-red-600 text-sm">✕</button>
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
                    {form.configuration_item_id && (
                      <>
                        <button type="button" onClick={handleRegenerate} disabled={saving}
                          className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50">
                          更新
                        </button>
                        <button type="button" onClick={handleRemoveConfigItem} disabled={saving}
                          className="text-xs text-red-600 hover:text-red-700 border border-red-200 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-50">
                          删除
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setCfgPickOpen(true)}
                      className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                    >
                      {form.configuration_item_id ? '更换构型项' : '+ 关联构型项'}
                    </button>
                  </div>
                </div>
                <ConfigItemPicker
                  open={cfgPickOpen}
                  onClose={() => setCfgPickOpen(false)}
                  onConfirm={handleChangeConfigItem}
                  excludeId={form.configuration_item_id || undefined}
                />

                {/* Table-based checklist */}
                {configTree ? (
                  <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[500px] overflow-y-auto bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-20">层级</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-44 whitespace-nowrap">构型号/零部件件号</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-28">名称</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16 whitespace-nowrap">类型</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16">版本</th>
                          <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16">状态</th>
                          <th className="text-center px-3 py-2 text-sm font-medium text-gray-500 w-12">数量</th>
                          <th className="text-center px-3 py-2 text-sm font-medium text-gray-500 w-24">可选</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {renderTableRows(configTree)}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="border border-gray-200 rounded-lg p-4 text-center">
                    <p className="text-xs text-gray-400">
                      {form.configuration_item_id ? '请先关联构型项以展开配置清单' : '暂无关联构型项，无法生成配置清单'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── 正式配置清单 ── */}
            {profile && configTree && (
              <div className="border-t pt-3">
                <h4 className="text-sm font-bold text-gray-700 mb-2">正式配置清单</h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[600px] overflow-y-auto bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-20">层级</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-44 whitespace-nowrap">构型号/零部件件号</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-28">名称</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16 whitespace-nowrap">类型</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16">版本</th>
                        <th className="text-left px-3 py-2 text-sm font-medium text-gray-500 w-16">状态</th>
                        <th className="text-center px-3 py-2 text-sm font-medium text-gray-500 w-12">数量</th>
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
                <ul className="text-xs text-gray-500 space-y-1 max-h-32 overflow-y-auto">
                  {(profile.status_logs || []).map((l) => (
                    <li key={l.id} className="flex gap-2">
                      <span className="text-gray-400">{l.created_at ? new Date(l.created_at).toLocaleString() : ''}</span>
                      <span>{l.from_status || '—'} → {l.to_status}</span>
                      <span>{l.operator_name}</span>
                      <span className="text-gray-400">{l.comment}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </>
        )}
      </div>

      {/* Footer Buttons — 置于滚动容器外侧，始终可见 */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-gray-200">
        <button
          onClick={onClose}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm"
        >
          关闭
        </button>
        {isCreate && (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        )}
        {canEdit && (
          <>
            <button
              onClick={handleUpdate}
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleSubmitReview}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
            >
              提交
            </button>
          </>
        )}
      </div>
    </Modal>

    {/* ── 正式清单行点击 → 详情弹窗 ── */}
    {detailModal?.type === 'config_item' && (
      <ConfigurationDetailModal
        itemId={detailModal.id}
        onClose={() => setDetailModal(null)}
      />
    )}
    {detailModal && (detailModal.type === 'part' || detailModal.type === 'assembly') && (
      <Modal
        open={!!detailModal}
        title={detailModal.type === 'part' ? '零件详情' : '部件详情'}
        onClose={() => { setDetailModal(null); setDetailData(null); }}
        width="full"
        zIndex={70}
      >
        {detailData && detailModal.type === 'part' && (
          <PartDetailContent
            part={detailData as Part}
            customFieldDefs={[]}
            customFieldValues={{}}
          />
        )}
        {detailData && detailModal.type === 'assembly' && (
          <AssemblyDetailContent
            assembly={detailData as Assembly}
            customFieldDefs={[]}
            customFieldValues={{}}
          />
        )}
        {!detailData && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">加载中...</div>
        )}
      </Modal>
    )}
  </>
);
}

function InfoItem({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 ${className || ''}`}>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium whitespace-pre-wrap">{value}</div>
    </div>
  );
}
