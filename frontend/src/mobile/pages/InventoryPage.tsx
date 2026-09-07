import { useEffect, useMemo, useState } from 'react';
import { inventoryApi } from '../../services/inventoryApi';
import { useDebounced } from '../../hooks/useDebounced';
import MobileCardList from '../components/MobileCardList';
import Badge from '../../components/ui/Badge';
import { resolveBadge } from '../../constants/badges';
import EmptyState from '../components/EmptyState';
import { formatMeta } from '../components/formatMeta';
import type { StockRow, InvDocument, Warehouse, InvMaterial } from '../../types';

/* ================================================================
   库存管理移动页（只读）
   - 两段视图（brief 允许的简化取舍，见 report §4）：
     · 库存查询（stock）：物料库存行列表 + 详情（各仓库/批次 + 库存流水）
     · 单据（documents）：库存单据列表 + 详情（明细/审批记录/状态流转）
   - 桌面 Inventory.tsx 的「物料主数据」「仓库」两 tab 未收录（移动端简化）
   - 纯只读：无新建/编辑/提交/审批/过账/删除等任何状态流转入口
   - 详情为同页内两级视图（本地 state 选中），返回按钮回列表
   - API 核验（对应桌面 Inventory 组件）：
     · inventoryApi.listWarehouses()  → GET /api/inventory/warehouses  → res.data.items
     · inventoryApi.listMaterials({}) → GET /api/inventory/materials   → res.data.items
     · inventoryApi.listStock()       → GET /api/inventory/stock       → res.data.items（StockRow[]）
     · inventoryApi.listLedger({material_id}) → GET /api/inventory/stock/ledger → res.data.items
     · inventoryApi.listDocuments({page_size:100}) → GET /api/inventory/documents → res.data.items
     · inventoryApi.getDocument(id)   → GET /api/inventory/documents/{id} → res.data（InvDocument）
   ================================================================ */

type Section = 'stock' | 'documents';

const DOC_TYPE_LABEL: Record<string, string> = {
  inbound: '入库单',
  outbound: '出库单',
  transfer: '调拨单',
  stocktake: '盘点单',
  adjustment: '库存调整单',
};

interface LedgerRow {
  id: string;
  doc_id?: string | null;
  doc_number?: string;
  doc_type?: string;
  warehouse_id?: string;
  direction?: 'in' | 'out';
  quantity?: number;
  balance_after?: number;
  operator_name?: string;
  created_at?: string;
}

interface DocReviewRecord {
  id?: string;
  reviewer_name?: string;
  decision?: string;
  comment?: string;
  created_at?: string;
}

interface DocStatusLog {
  id?: string;
  to_status?: string;
  operator_name?: string;
  comment?: string;
  created_at?: string;
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

export default function InventoryPage() {
  const [section, setSection] = useState<Section>('stock');

  /* ---- 字典数据：仓库 / 物料（详情展示用） ---- */
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [materials, setMaterials] = useState<InvMaterial[]>([]);

  /* ---- 库存查询段 ---- */
  const [stockRows, setStockRows] = useState<StockRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockSearch, setStockSearch] = useState('');
  const debouncedStock = useDebounced(stockSearch, 400);

  /* ---- 单据段 ---- */
  const [docs, setDocs] = useState<InvDocument[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState('');
  const debouncedDoc = useDebounced(docSearch, 400);

  /* ---- 详情选中（同页内两级视图） ---- */
  const [stockDetailMatId, setStockDetailMatId] = useState<string | null>(null);
  const [docDetailId, setDocDetailId] = useState<string | null>(null);

  // 字典 + 库存查询加载（alive 竞态防护）
  useEffect(() => {
    let alive = true;
    inventoryApi
      .listWarehouses()
      .then((res) => {
        if (alive) setWarehouses(((res.data ?? {}) as { items?: Warehouse[] }).items ?? []);
      })
      .catch(() => {});
    inventoryApi
      .listMaterials({})
      .then((res) => {
        if (alive) setMaterials(((res.data ?? {}) as { items?: InvMaterial[] }).items ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 库存查询列表
  useEffect(() => {
    let alive = true;
    setStockLoading(true);
    inventoryApi
      .listStock()
      .then((res) => {
        if (alive) {
          setStockRows(((res.data ?? {}) as { items?: StockRow[] }).items ?? []);
          setStockError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setStockRows([]);
          setStockError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setStockLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 单据列表
  useEffect(() => {
    let alive = true;
    setDocLoading(true);
    inventoryApi
      .listDocuments({ page_size: 100 })
      .then((res) => {
        if (alive) {
          setDocs(((res.data ?? {}) as { items?: InvDocument[] }).items ?? []);
          setDocError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setDocs([]);
          setDocError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setDocLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const whName = (id?: string | null) => (id ? warehouses.find((w) => w.id === id)?.name || id : '-');
  const matName = (id?: string) => {
    const m = materials.find((x) => x.id === id);
    return m ? `${m.code} ${m.name}` : id || '-';
  };

  /* ---- 客户端即时过滤（与桌面 StockTab/DocumentTab 一致） ---- */
  const filteredStock = useMemo(() => {
    const kw = debouncedStock.trim().toLowerCase();
    if (!kw) return stockRows;
    return stockRows.filter(
      (r) =>
        r.material_code?.toLowerCase().includes(kw) || r.material_name?.toLowerCase().includes(kw),
    );
  }, [stockRows, debouncedStock]);

  const filteredDocs = useMemo(() => {
    const kw = debouncedDoc.trim().toLowerCase();
    if (!kw) return docs;
    return docs.filter((d) =>
      [d.doc_number, d.biz_type, d.creator_name, d.keeper_name, DOC_TYPE_LABEL[d.doc_type]]
        .some((v) => (v || '').toLowerCase().includes(kw)),
    );
  }, [docs, debouncedDoc]);

  /* ---------------- 单据详情（可从单据列表或库存流水进入） ---------------- */
  if (docDetailId) {
    return <DocDetailView docId={docDetailId} whName={whName} matName={matName} onBack={() => setDocDetailId(null)} />;
  }

  /* ---------------- 库存详情（库存查询列表 → 各仓库/批次 + 流水） ---------------- */
  if (stockDetailMatId) {
    return (
      <StockDetailView
        materialId={stockDetailMatId}
        rows={stockRows.filter((r) => r.material_id === stockDetailMatId)}
        whName={whName}
        onBack={() => setStockDetailMatId(null)}
        onViewDoc={setDocDetailId}
      />
    );
  }

  /* ---------------- 列表视图（两段：库存查询 / 单据） ---------------- */
  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-[var(--ui-bg-subtle)] px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] text-base"
          placeholder={section === 'stock' ? '搜索物料编码/名称...' : '搜索单据号/业务/创建人...'}
          value={section === 'stock' ? stockSearch : docSearch}
          onChange={(e) => (section === 'stock' ? setStockSearch(e.target.value) : setDocSearch(e.target.value))}
        />
        <div className="flex gap-1 mt-2">
          {([
            { key: 'stock', label: '库存查询' },
            { key: 'documents', label: '单据' },
          ] as { key: Section; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => setSection(t.key)}
              className={`flex-1 h-11 rounded-lg text-sm font-medium transition-colors ${
                section === t.key ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-[var(--ui-bg-surface)] text-[var(--ui-text-secondary)] border border-[var(--ui-border)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {section === 'stock' && (
        <>
          {stockLoading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
          {!stockLoading && stockError && <p className="text-center text-xs text-red-400 py-3">{stockError}</p>}
          {!stockLoading && !stockError && filteredStock.length === 0 && <EmptyState text="暂无库存数据" />}
          <MobileCardList
            items={filteredStock}
            keyOf={(r) => `${r.material_id}-${r.warehouse_id}-${r.batch_no}`}
            renderMain={(r) => `${r.material_code} ${r.material_name}`}
            renderMeta={(r) => (
              <span className="flex flex-wrap items-center gap-2">
                {r.is_low && <Badge tone="red" label="低库存" />}
                <span>
                  {formatMeta([
                    ['仓库', whName(r.warehouse_id)],
                    ['批次', r.batch_no || undefined],
                    ['数量', `${r.quantity}${r.unit || ''}`],
                    ['安全库存', r.safety_stock != null ? String(r.safety_stock) : undefined],
                  ])}
                </span>
              </span>
            )}
            onClick={(r) => setStockDetailMatId(r.material_id)}
          />
        </>
      )}

      {section === 'documents' && (
        <>
          {docLoading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
          {!docLoading && docError && <p className="text-center text-xs text-red-400 py-3">{docError}</p>}
          {!docLoading && !docError && filteredDocs.length === 0 && <EmptyState text="暂无单据" />}
          <MobileCardList
            items={filteredDocs}
            keyOf={(d) => d.id}
            renderMain={(d) => d.doc_number}
            renderMeta={(d) => (
              <span className="flex flex-wrap items-center gap-2">
                <Badge status={d.status} domain="inventoryDoc" />
                <span>
                  {formatMeta([
                    ['类型', DOC_TYPE_LABEL[d.doc_type]],
                    ['库管员', d.keeper_name || undefined],
                    ['创建人', d.creator_name || undefined],
                    ['创建时间', fmtDate(d.created_at)],
                  ])}
                </span>
              </span>
            )}
            onClick={(d) => setDocDetailId(d.id)}
          />
        </>
      )}
    </div>
  );
}

/* ==================== 库存详情（同页内二级视图） ==================== */

function StockDetailView({ materialId, rows, whName, onBack, onViewDoc }: {
  materialId: string;
  rows: StockRow[];
  whName: (id?: string | null) => string;
  onBack: () => void;
  onViewDoc: (docId: string) => void;
}) {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLedgerLoading(true);
    inventoryApi
      .listLedger({ material_id: materialId })
      .then((res) => {
        if (alive) {
          setLedger(((res.data ?? {}) as { items?: LedgerRow[] }).items ?? []);
          setLedgerError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setLedger([]);
          setLedgerError('流水加载失败');
        }
      })
      .finally(() => {
        if (alive) setLedgerLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [materialId]);

  const first = rows[0];
  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const anyLow = rows.some((r) => r.is_low);
  const title = first ? `${first.material_code} ${first.material_name}` : materialId;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-[var(--ui-bg-subtle)] px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={onBack}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-[var(--ui-text-secondary)]"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-[var(--ui-text-primary)] truncate">{title}</div>
        </div>
      </div>

      <div className="p-3 flex flex-col gap-3">
        {/* 基础信息 */}
        {first && (
          <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              {anyLow && <Badge tone="red" label="低库存" />}
            </div>
            <div className="mt-1 text-sm text-[var(--ui-text-primary)] break-all">{first.material_code} {first.material_name}</div>
            <div className="mt-1 text-xs text-[var(--ui-text-secondary)]">
              {formatMeta([
                ['单位', first.unit || undefined],
                ['总库存', `${total}${first.unit || ''}`],
                ['安全库存', first.safety_stock != null ? String(first.safety_stock) : undefined],
              ])}
            </div>
          </div>
        )}

        {/* 各仓库 / 批次库存 */}
        <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
          <div className="text-sm font-medium text-gray-800 mb-2">各仓库 / 批次库存</div>
          {rows.length === 0 ? (
            <div className="text-xs text-[var(--ui-text-tertiary)] py-2 text-center">暂无库存</div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 border ${r.is_low ? 'bg-red-50 border-red-100' : 'bg-[var(--ui-bg-subtle)] border-gray-100'}`}>
                  <div className="text-sm text-[var(--ui-text-primary)] break-all">
                    {whName(r.warehouse_id)}
                    <span className="text-[var(--ui-text-tertiary)] mx-1">·</span>
                    <span className={r.is_low ? 'text-red-600' : ''}>{r.quantity}</span>
                  </div>
                  <div className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                    {formatMeta([
                      ['批次', r.batch_no || undefined],
                      ['安全库存', r.safety_stock != null ? String(r.safety_stock) : undefined],
                    ])}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 库存流水 */}
        <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
          <div className="text-sm font-medium text-gray-800 mb-2">库存流水</div>
          {ledgerLoading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
          {!ledgerLoading && ledgerError && <p className="text-center text-xs text-red-400 py-3">{ledgerError}</p>}
          {!ledgerLoading && !ledgerError && ledger.length === 0 && (
            <div className="text-xs text-[var(--ui-text-tertiary)] py-2 text-center">暂无流水</div>
          )}
          {!ledgerLoading && !ledgerError && ledger.length > 0 && (
            <div className="flex flex-col gap-2">
              {ledger.map((l) => (
                <button
                  key={l.id}
                  onClick={() => l.doc_id && onViewDoc(l.doc_id)}
                  className="text-left rounded-lg px-3 py-2 bg-[var(--ui-bg-subtle)] border border-gray-100 disabled:opacity-100"
                  disabled={!l.doc_id}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-sm font-medium ${l.doc_id ? 'text-primary-600' : 'text-gray-700'}`}>
                      {l.doc_number || '-'}
                    </span>
                    <span className={`text-sm font-medium ${l.direction === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                      {l.direction === 'in' ? '+' : '-'}{l.quantity}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                    {formatMeta([
                      ['类型', DOC_TYPE_LABEL[l.doc_type || ''] || l.doc_type || undefined],
                      ['仓库', whName(l.warehouse_id)],
                      ['过账后余额', l.balance_after != null ? String(l.balance_after) : undefined],
                      ['操作人', l.operator_name || undefined],
                      ['时间', fmtDateTime(l.created_at)],
                    ])}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== 单据详情（同页内二级视图） ==================== */

function DocDetailView({ docId, whName, matName, onBack }: {
  docId: string;
  whName: (id?: string | null) => string;
  matName: (id?: string) => string;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<InvDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    inventoryApi
      .getDocument(docId)
      .then((res) => {
        if (alive) {
          setDoc(res.data ?? null);
          setError(null);
        }
      })
      .catch(() => {
        if (alive) {
          setDoc(null);
          setError('加载失败，请稍后重试');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [docId]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-[var(--ui-bg-subtle)] px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={onBack}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-[var(--ui-text-secondary)]"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-[var(--ui-text-primary)] truncate">{doc?.doc_number || '单据详情'}</div>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && !doc && <EmptyState text="未找到单据" />}

      {!loading && !error && doc && (
        <div className="p-3 flex flex-col gap-3">
          {/* 基础信息 */}
          <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Badge status={doc.status} domain="inventoryDoc" />
              <span className="text-xs text-[var(--ui-text-secondary)]">{DOC_TYPE_LABEL[doc.doc_type]}</span>
            </div>
            <div className="mt-2 text-xs text-[var(--ui-text-secondary)]">
              {formatMeta([
                ['业务子类', doc.biz_type || undefined],
                ['审批模式', doc.review_mode === 'any' ? '或签' : '会签'],
                ['库管员', doc.keeper_name || undefined],
                ['仓库', whName(doc.warehouse_id)],
                ...(doc.doc_type === 'transfer' ? ([['目标仓', whName(doc.to_warehouse_id)]] as [string, string][]) : []),
                ['创建人', doc.creator_name || undefined],
                ['创建时间', fmtDateTime(doc.created_at)],
              ])}
            </div>
          </div>

          {/* 明细 */}
          <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">明细（{(doc.lines || []).length}）</div>
            {(doc.lines || []).length === 0 ? (
              <div className="text-xs text-[var(--ui-text-tertiary)] py-2 text-center">暂无明细</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(doc.lines || []).map((l) => (
                  <div key={l.id ?? `${l.material_id}-${l.batch_no}`} className="rounded-lg px-3 py-2 bg-[var(--ui-bg-subtle)] border border-gray-100">
                    <div className="text-sm text-[var(--ui-text-primary)] break-all">{matName(l.material_id)}</div>
                    <div className="text-xs text-[var(--ui-text-secondary)] mt-0.5">
                      {formatMeta([
                        ['批次', l.batch_no || undefined],
                        ['方向', l.direction === 'out' ? '出' : l.direction === 'in' ? '入' : undefined],
                        ['账面', l.book_quantity != null ? String(l.book_quantity) : undefined],
                        ['实盘', l.counted_quantity != null ? String(l.counted_quantity) : undefined],
                        ['数量', String(l.quantity)],
                      ])}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 审批记录 */}
          <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
            <div className="text-sm font-medium text-gray-800 mb-2">审批记录</div>
            {(doc.review_records || []).length === 0 ? (
              <div className="text-xs text-[var(--ui-text-tertiary)] py-2 text-center">暂无审批记录</div>
            ) : (
              <div className="flex flex-col gap-2">
                {(doc.review_records || []).map((r: DocReviewRecord, i: number) => (
                  <div key={r.id ?? i} className="rounded-lg px-3 py-2 bg-[var(--ui-bg-subtle)] border border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--ui-text-primary)]">{r.reviewer_name || '-'}</span>
                      <Badge
                        tone={r.decision === 'approved' ? 'green' : 'red'}
                        label={r.decision === 'approved' ? '通过' : r.decision === 'rejected' ? '拒绝' : r.decision === 'returned' ? '退回' : r.decision || '-'}
                      />
                    </div>
                    {r.comment && <div className="text-xs text-[var(--ui-text-secondary)] mt-1">{r.comment}</div>}
                    {r.created_at && <div className="text-xs text-[var(--ui-text-tertiary)] mt-1">{fmtDateTime(r.created_at)}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 状态流转 */}
          {(doc.status_logs || []).length > 0 && (
            <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">状态流转</div>
              <div className="flex flex-col gap-2">
                {(doc.status_logs || []).map((log: DocStatusLog, i: number) => (
                  <div key={log.id ?? i} className="flex gap-3">
                    <div className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 bg-primary-500" />
                    <div className="flex-1 pb-1">
                      <div className="text-sm text-[var(--ui-text-primary)] break-all">
                        <span className="font-medium">{log.operator_name || '-'}</span>
                        <span className="text-[var(--ui-text-tertiary)] mx-1">·</span>
                        <span>{resolveBadge(log.to_status, 'inventoryDoc').label || log.to_status || '-'}</span>
                      </div>
                      {log.comment && <div className="text-xs text-[var(--ui-text-secondary)] mt-0.5">{log.comment}</div>}
                      {log.created_at && <div className="text-xs text-[var(--ui-text-tertiary)] mt-0.5">{fmtDateTime(log.created_at)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 备注 */}
          {doc.remark && (
            <div className="bg-[var(--ui-bg-surface)] rounded-lg px-4 py-3 shadow-sm">
              <div className="text-sm font-medium text-gray-800 mb-2">备注</div>
              <div className="text-xs text-[var(--ui-text-secondary)] whitespace-pre-wrap">{doc.remark}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
