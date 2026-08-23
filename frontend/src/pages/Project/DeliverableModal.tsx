/**
 * 项目交付物汇总弹窗
 * 打开时一次性拉取四类对象，TAB 切换 / 搜索 / 状态筛选全在前端完成。
 */
import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { exportDeliverables } from '../../services/deliverableExport';
import { toast } from '../../components/Toast';
import type { DeliverableItem, DeliverableSummary, DeliverableTaskRef } from '../../types/project';
import {
  DELIVERABLE_TABS, filterItems, statusOptions, statusLabel, taskTooltip,
  type DeliverableTabKey, type DeliverableTabDef,
} from './deliverableUtils';
import PartDetailModal from '../../components/PartDetailModal';
import DocumentDetailModal from '../../components/DocumentDetailModal';
import ConfigItemDetailModal from '../../components/Configuration/ConfigItemDetailModal';
import { ECRDetailModal } from '../../components/ECR/ECRDetailModal';
import { ECODetailModal } from '../../components/ECO/ECODetailModal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';

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

/** 来源任务单元格：单任务直接点，多任务用 +N 展开下拉 */
function TaskCell({ tasks, onOpenTask }: {
  tasks: DeliverableTaskRef[];
  onOpenTask: (taskId: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);

  if (tasks.length === 0) return <span className="text-[var(--ui-text-tertiary)]">—</span>;

  return (
    <span className="relative inline-flex items-center gap-1" title={taskTooltip(tasks)}>
      <Button variant="link" size="xs"
        onClick={(e) => { e.stopPropagation(); onOpenTask(tasks[0].id); }}
        className="truncate max-w-[160px]">
        {tasks[0].code} {tasks[0].name}
      </Button>
      {tasks.length > 1 && (
        <>
          <Button variant="ghost" size="xs"
            onClick={(e) => { e.stopPropagation(); setListOpen((v) => !v); }}>
            +{tasks.length - 1}
          </Button>
          {listOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg shadow-lg py-1 min-w-[180px]">
              {tasks.slice(1).map((t) => (
                <Button variant="ghost" size="sm" key={t.id}
                  onClick={(e) => { e.stopPropagation(); setListOpen(false); onOpenTask(t.id); }}
                  className="w-full !justify-start rounded-none truncate">
                  {t.code} {t.name}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </span>
  );
}

export default function DeliverableModal({
  open, projectId, projectCode, refreshKey = 0, onClose, onOpenTask,
}: Props) {
  const [summary, setSummary] = useState<DeliverableSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<DeliverableTabKey>('config_items');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<DeliverableItem | null>(null);

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
    if (!open) { setTab('config_items'); setSearch(''); setStatus(''); setDetail(null); }
  }, [open]);

  const handleTabChange = (k: DeliverableTabKey) => {
    setTab(k); setSearch(''); setStatus('');
  };

  const tabDef: DeliverableTabDef = DELIVERABLE_TABS.find((t) => t.key === tab)!;
  const rawItems: DeliverableItem[] = summary ? summary[tab] : [];
  const items = useMemo(() => filterItems(rawItems, search, status), [rawItems, search, status]);
  const options = useMemo(() => statusOptions(rawItems), [rawItems]);

  const colSpan = 5 + (tabDef.showVersion ? 1 : 0) + (tabDef.showExtra ? 1 : 0);

  const handleExport = () => {
    if (!summary) return;
    exportDeliverables(summary, projectCode);
  };

  return (
    <>
      <Modal open={open} title="交付物汇总" onClose={onClose} width="3xl" height="75vh"
        headerAction={
          <Button variant="primary" size="sm" onClick={handleExport} disabled={!summary}
            title="导出全部四类，不受当前 TAB 与筛选影响">
            导出 Excel
          </Button>
        }>
      <div className="flex flex-col h-full">
      {/* TAB 条 */}
      <div className="flex items-center gap-1 border-b border-[var(--ui-border)] mb-3 shrink-0">
        {DELIVERABLE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary-600 text-primary-600 font-medium'
                : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-[var(--ui-text-tertiary)]">
              {summary ? summary.counts[t.key] : 0}
            </span>
          </button>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Input
          type="text"
          placeholder="搜索编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0"
        />
        <Select
          className="!w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <div className="flex-1" />
        <span className="text-sm text-[var(--ui-text-tertiary)]">共 {items.length} 条</span>
      </div>

      {/* 表格 */}
      <div className="border border-[var(--ui-border)] rounded-lg flex-1 min-h-0 overflow-y-auto">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap w-28">编号</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">{tabDef.nameLabel}</th>
              {tabDef.showVersion && (
                <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap w-16">版本</th>
              )}
              {tabDef.showExtra && (
                <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap w-20">{tabDef.extraLabel}</th>
              )}
              <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap w-18">状态</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap w-18">创建人</th>
              <th className="px-3 py-2 text-left text-sm font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">来源任务</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-[var(--ui-text-secondary)]">{EMPTY_HINT[tab]}</td></tr>
            ) : (
              items.map((i) => (
                <tr key={i.entity_id} onClick={() => setDetail(i)}
                    className="hover:bg-[var(--ui-bg-hover)] cursor-pointer">
                  <td className="px-3 py-2 text-sm font-medium whitespace-nowrap">{i.code}</td>
                  <td className="px-3 py-2 text-sm">{i.name}</td>
                  {tabDef.showVersion && (
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)] whitespace-nowrap">{i.version || '—'}</td>
                  )}
                  {tabDef.showExtra && (
                    <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{i.extra || '—'}</td>
                  )}
                  <td className="px-3 py-2 text-sm whitespace-nowrap">
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                      {statusLabel(i.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)] whitespace-nowrap">{i.creator_name || '—'}</td>
                  <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">
                    <TaskCell tasks={i.tasks} onOpenTask={onOpenTask} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>
      </Modal>

      {detail?.entity_type === 'config_item' && (
        <ConfigItemDetailModal open revisionId={detail.entity_id}
          onClose={() => setDetail(null)} />
      )}
      {detail?.entity_type === 'ec' && detail.extra === 'ECR' && (
        <ECRDetailModal open ecrId={detail.entity_id}
          onClose={() => setDetail(null)} onSuccess={() => {}} />
      )}
      {detail?.entity_type === 'ec' && detail.extra === 'ECO' && (
        <ECODetailModal ecoId={detail.entity_id}
          onClose={() => setDetail(null)} onRefresh={() => {}} />
      )}
      {detail && ['part', 'assembly', 'component'].includes(detail.entity_type) && (
        <PartDetailModal open masterId={detail.master_id || ''} revisionId={detail.entity_id}
          onClose={() => setDetail(null)} />
      )}
      {detail?.entity_type === 'document' && (
        <DocumentDetailModal open revisionId={detail.entity_id}
          onClose={() => setDetail(null)} onSaved={() => {}} />
      )}
    </>
  );
}
