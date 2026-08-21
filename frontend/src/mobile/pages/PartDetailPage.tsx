import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { partsApi } from '../../services/api';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import DesktopOnlyCard from '../components/DesktopOnlyCard';
import type { PartMaster, PartRevisionBrief } from '../../types';

/**
 * GET /api/parts/{master_id} 实际返回后端 PartMasterResponse：
 * { id, code, name, type, created_at, updated_at, latest_revision: PartRevisionBrief | null }
 * 前端 PartMaster 类型缺少 latest_revision 字段，此处本地扩展（不改动 types/）。
 */
interface PartDetail extends PartMaster {
  latest_revision?: PartRevisionBrief | null;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const TYPE_LABEL: Record<string, string> = { part: '零件', assembly: '部件' };

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'bom', label: 'BOM' },
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

export default function PartDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    let alive = true;
    if (!id) {
      setError('缺少零部件 ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    partsApi
      .get(id)
      .then((data: PartDetail) => {
        if (alive) setDetail(data);
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

  const title = detail ? `${detail.code} ${detail.name}` : id ?? '零部件详情';
  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? '';

  // 概览字段以后端 PartMasterResponse 实际返回字段为准
  const overviewRows: Array<{ label: string; value?: ReactNode }> = [
    { label: '件号', value: detail?.code },
    { label: '名称', value: detail?.name },
    { label: '类型', value: detail?.type ? TYPE_LABEL[detail.type] ?? detail.type : undefined },
    {
      label: '状态',
      value: detail?.latest_revision?.status ? (
        <StatusBadge status={detail.latest_revision.status} map={STATUS_MAP} />
      ) : undefined,
    },
    { label: '最新版本', value: detail?.latest_revision?.version },
    {
      label: '最新迭代',
      value:
        detail?.latest_revision?.latest_iteration != null
          ? String(detail.latest_revision.latest_iteration)
          : undefined,
    },
    { label: '检出人', value: detail?.latest_revision?.check_out_user_name },
    { label: '检出时间', value: fmtDateTime(detail?.latest_revision?.check_out_date) },
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
            className="shrink-0 min-w-9 h-9 flex items-center justify-center text-2xl leading-none text-gray-600"
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
      {!loading && !error && !detail && <EmptyState text="未找到零部件" />}

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
          {activeTab === 'bom' && (
            <button
              onClick={() => navigate(`/parts/${id}/bom`)}
              className="w-full bg-white rounded-lg px-4 py-3 min-h-14 flex items-center justify-between shadow-sm"
            >
              <span className="text-sm text-gray-900">查看 BOM 结构</span>
              <span className="text-gray-400">›</span>
            </button>
          )}
          {activeTab !== 'overview' && activeTab !== 'bom' && (
            <DesktopOnlyCard feature={activeLabel} />
          )}
        </div>
      )}
    </div>
  );
}
