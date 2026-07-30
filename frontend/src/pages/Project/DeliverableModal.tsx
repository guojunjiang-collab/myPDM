/**
 * 项目交付物汇总弹窗
 * 打开时一次性拉取四类对象，TAB 切换 / 搜索 / 状态筛选全在前端完成。
 */
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { toast } from '../../components/Toast';
import type { DeliverableItem, DeliverableSummary } from '../../types/project';
import {
  DELIVERABLE_TABS, filterItems, statusOptions, statusLabel, taskTooltip,
  type DeliverableTabKey, type DeliverableTabDef,
} from './deliverableUtils';

interface Props {
  open: boolean;
  projectId: string;
  projectCode: string;
  refreshKey?: number;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

const EMPTY_HINT: Record<DeliverableTabKey, string> = {
  config_items: '暂无关联的构型项',
  parts: '暂无关联的零部件',
  documents: '暂无关联的图文档',
  changes: '暂无关联的变更',
};

export default function DeliverableModal({
  open, projectId, projectCode, refreshKey = 0, onClose, onOpenTask,
}: Props) {
  void projectCode; void onOpenTask;

  const [summary, setSummary] = useState<DeliverableSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<DeliverableTabKey>('config_items');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    projectApi.getDeliverables(projectId)
      .then((r) => { if (!cancelled) setSummary(r.data); })
      .catch((e: any) => {
        if (!cancelled) toast.error(e?.response?.data?.detail || '加载交付物失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, refreshKey]);

  useEffect(() => {
    if (!open) { setTab('config_items'); setSearch(''); setStatus(''); }
  }, [open]);

  const handleTabChange = (k: DeliverableTabKey) => {
    setTab(k); setSearch(''); setStatus('');
  };

  const tabDef: DeliverableTabDef = DELIVERABLE_TABS.find((t) => t.key === tab)!;
  const rawItems: DeliverableItem[] = summary ? summary[tab] : [];
  const items = useMemo(() => filterItems(rawItems, search, status), [rawItems, search, status]);
  const options = useMemo(() => statusOptions(rawItems), [rawItems]);

  const colSpan = 7 + (tabDef.showVersion ? 1 : 0);

  return (
    <Modal open={open} title="交付物汇总" onClose={onClose} width="3xl" height="75vh">
      {/* TAB 条 */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-3">
        {DELIVERABLE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary-600 text-primary-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-gray-400">
              {summary ? summary.counts[t.key] : 0}
            </span>
          </button>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          placeholder="搜索编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">全部状态</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-sm text-gray-400">共 {items.length} 条</span>
      </div>

      {/* 表格 */}
      <div className="border border-gray-200 rounded-lg overflow-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">编号</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{tabDef.nameLabel}</th>
              {tabDef.showVersion && (
                <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">版本</th>
              )}
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">{tabDef.extraLabel}</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">状态</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">创建人</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-gray-500 whitespace-nowrap">来源任务</th>
              <th className="px-3 py-2 text-right text-sm font-medium text-gray-500 whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">{EMPTY_HINT[tab]}</td></tr>
            ) : (
              items.map((i) => (
                <tr key={i.entity_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm font-medium whitespace-nowrap">{i.code}</td>
                  <td className="px-3 py-2 text-sm">{i.name}</td>
                  {tabDef.showVersion && (
                    <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{i.version || '—'}</td>
                  )}
                  <td className="px-3 py-2 text-sm text-gray-600">{i.extra || '—'}</td>
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                      {statusLabel(i.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">{i.creator_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-gray-600" title={taskTooltip(i.tasks)}>
                    {i.tasks.length === 0
                      ? '—'
                      : `${i.tasks[0].code} ${i.tasks[0].name}${i.tasks.length > 1 ? ` +${i.tasks.length - 1}` : ''}`}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="text-gray-300 text-sm">详情</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
