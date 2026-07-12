import { Link } from 'react-router-dom';
import { greeting, statusDistribution, type Distribution } from './lib/aggregate';
import type { RecentDisplay, Activity } from './hooks';
import type { FavItem } from './lib/aggregate';
import type { DocumentBrief, ConfigItemBrief } from '../../types';

// myPDM 统一 components：part/assembly/component 均落到 /components
const ENTITY_ICON: Record<string, string> = { part: '🔧', assembly: '📦', component: '🔧', document: '📄', configuration: '⚙️' };
const ENTITY_ROUTE: Record<string, string> = { part: '/components', assembly: '/components', component: '/components', document: '/documents', configuration: '/configuration' };

export function Tile({ title, icon, right, children, className = '' }: {
  title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 flex flex-col ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon && <span className="text-gray-400">{icon}</span>}
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-4">{text}</div>;
}

export function GreetingHeader({ name, todoCount, overdueCount }: { name: string; todoCount: number; overdueCount: number }) {
  const hour = new Date().getHours();
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-lg font-medium text-gray-900">{greeting(hour)}，{name || '同事'}</span>
      <span className="text-sm text-gray-400">· 你有 {todoCount} 项待处理{overdueCount > 0 ? `、${overdueCount} 个任务逾期` : ''}</span>
    </div>
  );
}

export function KpiStrip({ partsMasters, documents, configItems, changeOpen }: {
  partsMasters: number; documents: number; configItems: number; changeOpen: number;
}) {
  const items = [
    { label: '零部件', value: partsMasters, cls: 'text-gray-900', to: '/components' },
    { label: '构型项', value: configItems, cls: 'text-gray-900', to: '/configuration' },
    { label: '图文档', value: documents, cls: 'text-gray-900', to: '/documents' },
    { label: '变更进行中', value: changeOpen, cls: 'text-red-500', to: '/ec' },
  ];
  return (
    <div className="grid grid-cols-4 gap-3">
      {items.map((it) => (
        <Link key={it.label} to={it.to} className="bg-gray-50 rounded-xl p-3 flex flex-col items-center hover:bg-gray-100 transition-colors">
          <span className={`text-xl font-medium ${it.cls}`}>{it.value}</span>
          <span className="text-sm text-gray-500 mt-1">{it.label}</span>
        </Link>
      ))}
    </div>
  );
}

const SEG_COLOR: Record<string, string> = { draft: '#85B7EB', frozen: '#EF9F27', released: '#97C459', obsolete: '#F09595' };
const SEG_LABEL: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };

function DistRow({ label, dist }: { label: string; dist: Distribution }) {
  const keys: ('draft' | 'frozen' | 'released' | 'obsolete')[] = ['draft', 'frozen', 'released', 'obsolete'];
  return (
    <div>
      <div className="text-sm text-gray-500 mb-1">{label} · {dist.total}</div>
      <div className="flex h-3 rounded overflow-hidden bg-gray-100">
        {dist.total > 0 && keys.map((k) => dist.pct[k] > 0 && (
          <div key={k} style={{ width: `${dist.pct[k]}%`, background: SEG_COLOR[k] }} title={`${SEG_LABEL[k]} ${dist[k]}`} />
        ))}
      </div>
    </div>
  );
}

export function StatusDistributionTile({ partsMasters, documents, configItems }: {
  partsMasters: any[];
  documents: DocumentBrief[];
  configItems: ConfigItemBrief[];
}) {
  const rows = [
    { label: '零部件', dist: statusDistribution(partsMasters) },
    { label: '图文档', dist: statusDistribution(documents as { status: string }[]) },
  ];
  const empty = rows.every((r) => r.dist.total === 0) && configItems.length === 0;
  return (
    <Tile title="状态分布" icon={<span>📊</span>} className="min-h-[180px]">
      {empty ? <EmptyState text="暂无数据，去各页面检出后自动统计" /> : (
        <div className="flex flex-col gap-3 flex-1">
          {rows.map((r) => <DistRow key={r.label} label={r.label} dist={r.dist} />)}
          <div className="flex gap-3 flex-wrap text-sm text-gray-500 mt-auto pt-1">
            {(['draft', 'frozen', 'released', 'obsolete'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: SEG_COLOR[k] }} />{SEG_LABEL[k]}
              </span>
            ))}
          </div>
        </div>
      )}
    </Tile>
  );
}

export function RecentItemsTile({ items }: { items: RecentDisplay[] }) {
  return (
    <Tile title="最近访问" icon={<span>🕘</span>}>
      {items.length === 0 ? <EmptyState text="最近没有编辑记录" /> : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <Link key={it.key} to={ENTITY_ROUTE[it.entityType] || '/'} className="flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600 truncate">
              <span>{ENTITY_ICON[it.entityType]}</span>
              <span className="text-gray-400">{it.code}</span>
              <span className="truncate">{it.name}</span>
            </Link>
          ))}
        </div>
      )}
    </Tile>
  );
}

export function FavoritesTile({ items }: { items: FavItem[] }) {
  return (
    <Tile title="我的收藏" icon={<span className="text-amber-500">★</span>}>
      {items.length === 0 ? <EmptyState text="还没有收藏，去看板添加" /> : (
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <Link key={it.id} to={ENTITY_ROUTE[it.entity_type] || '/'} className="flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600 truncate">
              <span>{ENTITY_ICON[it.entity_type]}</span>
              <span className="text-gray-400">{it.code}</span>
              <span className="truncate">{it.name}</span>
            </Link>
          ))}
        </div>
      )}
    </Tile>
  );
}

export function ActivityFeedTile({ items }: { items: Activity[] }) {
  return (
    <Tile title="系统动态流" icon={<span>📡</span>} className="min-h-[180px]">
      {items.length === 0 ? <EmptyState text="暂无动态" /> : (
        <div className="flex flex-col gap-3">
          {items.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-sm flex items-center justify-center shrink-0">{a.initial}</span>
              <span className="flex-1 text-sm text-gray-700 truncate">{a.text}</span>
              <span className="text-sm text-gray-400 shrink-0">{a.time}</span>
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}
