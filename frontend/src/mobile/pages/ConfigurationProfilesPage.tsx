import { useEffect, useMemo, useState } from 'react';
import { configurationProfileApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { ConfigurationProfileDetail } from '../../types';

/* ================================================================
   构型配置移动页（只读，独立界面）
   - 列表 + 同页内二级详情（配置清单/审批记录/状态流转）
   ================================================================ */

const PROFILE_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  reviewing: { label: '评审中', cls: 'bg-amber-100 text-amber-700' },
  active: { label: '生效中', cls: 'bg-green-100 text-green-700' },
  rejected: { label: '已驳回', cls: 'bg-red-100 text-red-700' },
  archived: { label: '已归档', cls: 'bg-gray-100 text-gray-500' },
};

function fmtDate(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN');
}

export default function ConfigurationProfilesPage() {
  const [profiles, setProfiles] = useState<ConfigurationProfileDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 400);
  const [profileDetailId, setProfileDetailId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    configurationProfileApi
      .list({ page: 1, page_size: 100 })
      .then((r) => {
        if (alive) {
          setProfiles(((r.data ?? {}) as { items?: ConfigurationProfileDetail[] }).items ?? []);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setProfiles([]);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const kw = debounced.trim().toLowerCase();
    if (!kw) return profiles;
    return profiles.filter(
      (p) =>
        p.code.toLowerCase().includes(kw) ||
        p.name.toLowerCase().includes(kw) ||
        (p.remark || '').toLowerCase().includes(kw),
    );
  }, [profiles, debounced]);

  /* ---------------- 配置概要详情 ---------------- */
  if (profileDetailId) {
    return <ProfileDetailView profileId={profileDetailId} onBack={() => setProfileDetailId(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索编号/名称/备注..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && filtered.length === 0 && <EmptyState text="暂无配置概要" />}
      <MobileCardList
        items={filtered}
        keyOf={(p) => p.id}
        renderMain={(p) => `${p.code} ${p.name}`}
        renderMeta={(p) => (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} map={PROFILE_STATUS_MAP} />
            <span>
              {formatMeta([
                ['架次', p.effectivity_start || p.effectivity_end ? `${p.effectivity_start || '—'} ~ ${p.effectivity_end || '—'}` : undefined],
                ['创建时间', fmtDate(p.created_at)],
              ])}
            </span>
          </span>
        )}
        onClick={(p) => setProfileDetailId(p.id)}
      />
    </div>
  );
}

/* ==================== 配置概要详情（同页内二级视图） ==================== */

function ProfileDetailView({ profileId, onBack }: { profileId: string; onBack: () => void }) {
  const [profile, setProfile] = useState<ConfigurationProfileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    configurationProfileApi
      .get(profileId)
      .then((r) => {
        if (alive) {
          setProfile((r.data ?? null) as ConfigurationProfileDetail | null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setProfile(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [profileId]);

  const title = profile ? `${profile.code} ${profile.name}` : profileId;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={onBack}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{title}</div>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !profile && <EmptyState text="未找到配置概要" />}

      {!loading && !error && profile && (
        <div className="p-3 flex flex-col gap-3">
          {/* 基础信息 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={profile.status} map={PROFILE_STATUS_MAP} />
              {profile.configuration_item && (
                <span className="text-xs text-gray-500">
                  构型项 {profile.configuration_item.code} {profile.configuration_item.name}
                </span>
              )}
            </div>
            <div className="mt-2 text-sm text-gray-900 break-all">{profile.code} {profile.name}</div>
            <div className="mt-1 text-xs text-gray-500">
              {formatMeta([
                ['架次', profile.effectivity_start || profile.effectivity_end ? `${profile.effectivity_start || '—'} ~ ${profile.effectivity_end || '—'}` : undefined],
                ['创建时间', fmtDate(profile.created_at)],
                ['审批模式', profile.review_mode === 'any' ? '或签' : profile.review_mode === 'all' ? '会签' : undefined],
              ])}
            </div>
            {profile.remark && (
              <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">{profile.remark}</div>
            )}
          </div>

          {/* 配置清单 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">配置清单（{(profile.items || []).length}）</div>
            {(profile.items || []).length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无清单项</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(profile.items || []).map((it) => (
                  <div key={it.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="text-sm text-gray-900 break-all">
                      {it.item_code ? `${it.item_code} ${it.item_name || ''}` : it.item_name || it.item_id}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatMeta([
                        ['来源', it.source_type === 'child' ? '子项' : it.source_type === 'direct' ? '直接' : it.source_type],
                        ['要求', it.is_required ? '必装' : '选装'],
                        ['选择', it.is_selected ? '已选' : '未选'],
                      ])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 审批记录 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">审批记录</div>
            {(profile.review_records || []).length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无审批记录</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(profile.review_records || []).map((r) => (
                  <div key={r.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{r.reviewer_name || r.reviewer_id || '-'}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${r.decision === 'approved' ? 'bg-green-100 text-green-700' : r.decision === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {r.decision === 'approved' ? '通过' : r.decision === 'rejected' ? '拒绝' : r.decision === 'returned' ? '退回' : r.decision || '-'}
                      </span>
                    </div>
                    {r.comment && <div className="text-xs text-gray-500 mt-1">{r.comment}</div>}
                    {r.created_at && <div className="text-xs text-gray-400 mt-1">{fmtDateTime(r.created_at)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 状态流转 */}
          {(profile.status_logs || []).length > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">状态流转</div>
              <div className="flex flex-col gap-2">
                {(profile.status_logs || []).map((log) => (
                  <div key={log.id} className="flex gap-3">
                    <div className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 bg-primary-500" />
                    <div className="flex-1 pb-1">
                      <div className="text-sm text-gray-900 break-all">
                        <span className="font-medium">{log.operator_name || '-'}</span>
                        <span className="text-gray-400 mx-1">·</span>
                        <span>{PROFILE_STATUS_MAP[log.to_status || '']?.label || log.to_status || '-'}</span>
                      </div>
                      {log.comment && <div className="text-xs text-gray-500 mt-0.5">{log.comment}</div>}
                      {log.created_at && <div className="text-xs text-gray-400 mt-0.5">{fmtDateTime(log.created_at)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
