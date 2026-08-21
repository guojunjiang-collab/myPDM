import { useEffect, useMemo, useState } from 'react';
import { configurationApi, configurationProfileApi } from '../../services/api';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { ConfigurationItemDetail, ConfigurationProfileDetail } from '../../types';

/* ================================================================
   构型管理移动页（只读）
   - 两段视图：构型项列表 + 配置概要列表（对应桌面 Configuration.tsx 两个 tab）
   - 每段列表 + 同页内二级详情（本地 state 选中）：
     · 构型项详情：基础信息 + 关联零部件（parts）+ 子构型项（children）+ 版本历史
     · 配置概要详情：基础信息 + 配置清单（items）+ 审批记录 + 状态流转
   - 纯只读：无新建/编辑/提交/审批/归档等入口（桌面「配置对比」等入口不收录）
   - API 核验（对应桌面 ConfigurationList / ProfileList）：
     · configurationApi.listItems({page:1,page_size:100,include_custom_fields:true})
       → GET /api/configurations/items → r.data.{items,total}
     · configurationApi.detail(revisionId) → GET /api/configurations/items/{revId} → ConfigurationItemDetail
     · configurationProfileApi.list({page:1,page_size:100}) → GET /api/configurations/profiles → r.data.items
     · configurationProfileApi.get(id) → GET /api/configurations/profiles/{id} → r.data（ConfigurationProfileDetail）
   ================================================================ */

type Section = 'items' | 'profiles';

const ITEM_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

const PROFILE_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-gray-100 text-gray-600' },
  reviewing: { label: '评审中', cls: 'bg-amber-100 text-amber-700' },
  active: { label: '生效中', cls: 'bg-green-100 text-green-700' },
  rejected: { label: '已驳回', cls: 'bg-red-100 text-red-700' },
  archived: { label: '已归档', cls: 'bg-gray-100 text-gray-500' },
};

/** 桌面 ConfigurationList 的列表行（listItems 响应映射） */
interface ConfigItemRow {
  revision_id: string;
  master_id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration?: number;
  created_at?: string;
  version_count?: number;
}

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

export default function ConfigurationPage() {
  const [section, setSection] = useState<Section>('items');

  /* ---- 构型项段 ---- */
  const [items, setItems] = useState<ConfigItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemsSearch, setItemsSearch] = useState('');
  const debouncedItems = useDebounced(itemsSearch, 400);

  /* ---- 配置概要段 ---- */
  const [profiles, setProfiles] = useState<ConfigurationProfileDetail[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesSearch, setProfilesSearch] = useState('');
  const debouncedProfiles = useDebounced(profilesSearch, 400);

  /* ---- 详情选中（同页内两级视图） ---- */
  const [itemDetailRevId, setItemDetailRevId] = useState<string | null>(null);
  const [profileDetailId, setProfileDetailId] = useState<string | null>(null);

  // 构型项列表（alive 竞态防护；映射与桌面 ConfigurationList 一致）
  useEffect(() => {
    let alive = true;
    setItemsLoading(true);
    configurationApi
      .listItems({ page: 1, page_size: 100, include_custom_fields: true })
      .then((r) => {
        if (!alive) return;
        const data = (r.data ?? {}) as { items?: any[] };
        const rows: ConfigItemRow[] = (data.items || []).map((item: any) => ({
          revision_id: item.revision_id || item.id,
          master_id: item.master_id,
          code: item.code || '',
          name: item.name || '',
          version: item.version || '',
          status: item.status || 'draft',
          check_out_user_name: item.check_out_user_name,
          check_out_date: item.check_out_date,
          latest_iteration: item.latest_iteration || 1,
          created_at: item.created_at,
          version_count: item.version_count,
        }));
        setItems(rows);
        setItemsError(null);
      })
      .catch(() => {
        if (alive) {
          setItems([]);
          setItemsError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setItemsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 配置概要列表
  useEffect(() => {
    let alive = true;
    setProfilesLoading(true);
    configurationProfileApi
      .list({ page: 1, page_size: 100 })
      .then((r) => {
        if (alive) {
          setProfiles(((r.data ?? {}) as { items?: ConfigurationProfileDetail[] }).items ?? []);
          setProfilesError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setProfiles([]);
          setProfilesError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setProfilesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 客户端即时过滤
  const filteredItems = useMemo(() => {
    const kw = debouncedItems.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((i) => i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw));
  }, [items, debouncedItems]);

  const filteredProfiles = useMemo(() => {
    const kw = debouncedProfiles.trim().toLowerCase();
    if (!kw) return profiles;
    return profiles.filter(
      (p) =>
        p.code.toLowerCase().includes(kw) ||
        p.name.toLowerCase().includes(kw) ||
        (p.remark || '').toLowerCase().includes(kw),
    );
  }, [profiles, debouncedProfiles]);

  /* ---------------- 配置概要详情 ---------------- */
  if (profileDetailId) {
    return <ProfileDetailView profileId={profileDetailId} onBack={() => setProfileDetailId(null)} />;
  }

  /* ---------------- 构型项详情 ---------------- */
  if (itemDetailRevId) {
    return <ItemDetailView revisionId={itemDetailRevId} onBack={() => setItemDetailRevId(null)} />;
  }

  /* ---------------- 列表视图（两段：构型项 / 配置概要） ---------------- */
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder={section === 'items' ? '搜索构型号/名称...' : '搜索编号/名称/备注...'}
          value={section === 'items' ? itemsSearch : profilesSearch}
          onChange={(e) => (section === 'items' ? setItemsSearch(e.target.value) : setProfilesSearch(e.target.value))}
        />
        <div className="flex gap-1 mt-2">
          {([
            { key: 'items', label: '构型项' },
            { key: 'profiles', label: '配置概要' },
          ] as { key: Section; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
                section === t.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {section === 'items' && (
        <>
          {itemsLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!itemsLoading && itemsError && <p className="text-center text-xs text-red-400 py-3">{itemsError}</p>}
          {!itemsLoading && !itemsError && filteredItems.length === 0 && <EmptyState text="暂无构型项" />}
          <MobileCardList
            items={filteredItems}
            keyOf={(i) => i.revision_id}
            renderMain={(i) => i.code}
            renderMeta={(i) => (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={i.status} map={ITEM_STATUS_MAP} />
                <span>
                  {formatMeta([
                    ['名称', i.name || undefined],
                    ['版本', i.version || undefined],
                    ['签出', i.check_out_user_name || undefined],
                    ['创建时间', fmtDate(i.created_at)],
                  ])}
                </span>
              </span>
            )}
            onClick={(i) => setItemDetailRevId(i.revision_id)}
          />
        </>
      )}

      {section === 'profiles' && (
        <>
          {profilesLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!profilesLoading && profilesError && <p className="text-center text-xs text-red-400 py-3">{profilesError}</p>}
          {!profilesLoading && !profilesError && filteredProfiles.length === 0 && <EmptyState text="暂无配置概要" />}
          <MobileCardList
            items={filteredProfiles}
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
        </>
      )}
    </div>
  );
}

/* ==================== 构型项详情（同页内二级视图） ==================== */

function ItemDetailView({ revisionId, onBack }: { revisionId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ConfigurationItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    configurationApi
      .detail(revisionId)
      .then((data) => {
        if (alive) {
          setDetail(data ?? null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
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
  }, [revisionId]);

  const code = detail?.revision.code || detail?.master.code || revisionId;
  const name = detail?.revision.name || detail?.master.name || '';

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
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">{code}</div>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !detail && <EmptyState text="未找到构型项" />}

      {!loading && !error && detail && (
        <div className="p-3 flex flex-col gap-3">
          {/* 基础信息 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.revision.status} map={ITEM_STATUS_MAP} />
              <span className="text-xs text-gray-500">版本 {detail.revision.version}</span>
            </div>
            <div className="mt-2 text-sm text-gray-900 break-all">{code} {name}</div>
            <div className="mt-1 text-xs text-gray-500">
              {formatMeta([
                ['签出', detail.revision.check_out_user_name || detail.revision.check_out_user_id || undefined],
                ['迭代', detail.revision.latest_iteration != null ? String(detail.revision.latest_iteration) : undefined],
                ['创建时间', fmtDate(detail.revision.created_at)],
              ])}
            </div>
            {detail.revision.remark && (
              <div className="mt-2 text-xs text-gray-600 whitespace-pre-wrap">{detail.revision.remark}</div>
            )}
          </div>

          {/* 关联零部件 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">关联零部件（{detail.parts.length}）</div>
            {detail.parts.length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无零部件</div>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.parts.map((p) => (
                  <div key={p.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="text-sm text-gray-900 break-all">
                      {p.part_detail ? `${p.part_detail.code} ${p.part_detail.name}` : p.part_id}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatMeta([
                        ['类型', p.part_type === 'assembly' ? '部件' : '零件'],
                        ['要求', p.is_required ? '必装' : '选装'],
                        ['数量', p.quantity != null ? String(p.quantity) : undefined],
                        ['版本', p.part_detail?.version || undefined],
                      ])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 子构型项 */}
          <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">子构型项（{detail.children.length}）</div>
            {detail.children.length === 0 ? (
              <div className="text-xs text-gray-400 py-2 text-center">暂无子构型项</div>
            ) : (
              <div className="flex flex-col gap-2">
                {detail.children.map((c) => (
                  <div key={c.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="text-sm text-gray-900 break-all">
                      {c.child_detail ? `${c.child_detail.code} ${c.child_detail.name}` : c.child_id}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatMeta([
                        ['要求', c.is_required ? '必装' : '选装'],
                        ['数量', c.quantity != null ? String(c.quantity) : undefined],
                      ])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 版本历史 */}
          {detail.versions.length > 0 && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">版本历史（{detail.versions.length}）</div>
              <div className="flex flex-col gap-2">
                {detail.versions.map((v) => (
                  <div key={v.id} className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-gray-900">{v.version}</span>
                      <StatusBadge status={v.status} map={ITEM_STATUS_MAP} />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatMeta([
                        ['签出', v.check_out_user_name || undefined],
                        ['创建时间', fmtDate(v.created_at)],
                      ])}
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
