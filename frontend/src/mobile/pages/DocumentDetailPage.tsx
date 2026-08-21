import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { documentsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import AttachmentPreview from '../components/AttachmentPreview';
import DesktopOnlyCard from '../components/DesktopOnlyCard';
import type { DocumentRevision, DocumentAttachment } from '../../types';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'attachments', label: '附件' },
  { key: 'versions', label: '版本' },
  { key: 'whereused', label: 'Where-Used' },
];

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

function OverviewRow({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 break-all">{children}</div>
    </div>
  );
}

export default function DocumentDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<DocumentRevision | null>(null);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let alive = true;
    if (!id) {
      setError('缺少图文档 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    documentsApi
      .detail(id)
      .then((res) => {
        if (alive) setDetail((res.data ?? res) as DocumentRevision);
      })
      .catch(() => {
        if (alive) {
          // 失败时清空详情，保证错误提示与空态互斥
          setDetail(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // 附件仅当切到"附件"段时加载
  useEffect(() => {
    let alive = true;
    if (!id || activeTab !== 'attachments') return;
    setLoadingAttachments(true);
    setAttachmentsError(null);
    documentsApi
      .listAttachments(id)
      .then((res) => {
        if (alive) {
          setAttachments((res.data ?? []) as DocumentAttachment[]);
          setAttachmentsError(null);
        }
      })
      .catch(() => {
        if (alive) {
          // 失败时清空附件并置错误态，与空态互斥
          setAttachments([]);
          setAttachmentsError('附件加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoadingAttachments(false);
      });
    return () => {
      alive = false;
    };
  }, [id, activeTab]);

  const title = detail ? `${detail.code} ${detail.name}` : id ?? '图文档详情';
  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? '';

  // 概览字段以 GET /api/documents/{revision_id} 实际返回字段为准
  const overviewRows: Array<{ label: string; value?: ReactNode }> = [
    { label: '编号', value: detail?.code },
    { label: '名称', value: detail?.name },
    { label: '版本', value: detail?.version },
    { label: '状态', value: detail?.status ? <StatusBadge status={detail.status} map={STATUS_MAP} /> : undefined },
    { label: '备注', value: detail?.remark },
    { label: '创建人', value: detail?.creator_name },
    { label: '检出人', value: detail?.check_out_user_name },
    { label: '检出时间', value: fmtDateTime(detail?.check_out_date) },
    { label: '创建时间', value: fmtDateTime(detail?.created_at) },
    { label: '更新时间', value: fmtDateTime(detail?.updated_at) },
  ].filter((r) => r.value !== undefined && r.value !== null && r.value !== '');

  return (
    <div className="flex flex-col">
      {/* 顶部：返回按钮 + 标题（编号/名称）+ 分段 Tab（sticky 跟随列表页模式） */}
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
        </div>
        <div className="flex mt-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                activeTab === t.key ? 'bg-primary-600 text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !detail && <EmptyState text="未找到图文档" />}

      {!loading && !error && detail && (
        <div className="p-3">
          {activeTab === 'overview' && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              {overviewRows.length === 0 ? (
                <EmptyState text="暂无概览信息" />
              ) : (
                overviewRows.map((r, i) => (
                  <div key={r.label} className={i > 0 ? 'border-t border-gray-100' : ''}>
                    <OverviewRow label={r.label}>{r.value}</OverviewRow>
                  </div>
                ))
              )}
            </div>
          )}
          {activeTab === 'attachments' && (
            <div className="flex flex-col gap-2">
              {loadingAttachments && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
              {!loadingAttachments && attachmentsError && (
                <p className="text-center text-xs text-red-400 py-3">{attachmentsError}</p>
              )}
              {!loadingAttachments && !attachmentsError && attachments.length === 0 && (
                <EmptyState text="暂无附件" />
              )}
              {!loadingAttachments &&
                !attachmentsError &&
                attachments.map((att) => (
                  <AttachmentPreview key={att.id} attachment={att} />
                ))}
            </div>
          )}
          {activeTab !== 'overview' && activeTab !== 'attachments' && (
            <DesktopOnlyCard feature={activeLabel} />
          )}
        </div>
      )}
    </div>
  );
}
