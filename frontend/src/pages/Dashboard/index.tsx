import { useEffect, useMemo, useState } from 'react';
import { useDataStore } from '../../stores/data';
import { useAuthStore } from '../../stores/auth';
import { configurationApi } from '../../services/api';
import { inventoryApi } from '../../services/inventoryApi';
import { useRecentEdited, useFavorites, useActivityFeed } from './hooks';
import {
  GreetingHeader, KpiStrip, StatusDistributionTile, RecentItemsTile, FavoritesTile, ActivityFeedTile,
} from './tiles';
import { MyTodosTile } from './MyTodosTile';
import { MyTasksTile } from './MyTasksTile';

export default function Dashboard() {
  // myPDM 统一 components 模型（含 part/assembly）
  const components = useDataStore((s) => s.parts);
  const documents = useDataStore((s) => s.documents);
  const configItems = useDataStore((s) => s.configItems);
  const user = useAuthStore((s) => s.user);

  const recent = useRecentEdited(user?.id, 5);
  const favorites = useFavorites(6);
  const activity = useActivityFeed(6);

  const [todoCount, setTodoCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  // 有库存物料数（库存数量 > 0 的物料，按 material_id 去重；与移动端仪表盘一致）
  const [stockItems, setStockItems] = useState(0);
  // 构型项状态分布数据（store 缓存的 configItems 无 status，此处单独取数）
  const [configItemStatuses, setConfigItemStatuses] = useState<{ status: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    inventoryApi.listStock().then((v: any) => {
      if (cancelled) return;
      const items: any[] = v?.data?.items ?? [];
      setStockItems(new Set(items.filter((i) => (i.quantity ?? 0) > 0).map((i) => i.material_id)).size);
    }).catch(() => {});
    configurationApi.listItems({ page_size: 10000 }).then((v: any) => {
      if (cancelled) return;
      const items: any[] = v?.data?.items ?? [];
      setConfigItemStatuses(items.map((i) => ({ status: i.status || 'draft' })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const hasData = useMemo(
    () => components.length > 0 || documents.length > 0 || configItems.length > 0,
    [components.length, documents.length, configItems.length],
  );

  return (
    <div className="flex flex-col gap-4">
      <GreetingHeader name={user?.real_name || ''} todoCount={todoCount} overdueCount={overdueCount} />

      {!hasData && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-xs">
          当前无本地缓存数据，请先在对应页面检出。统计将自动从本地缓存计算。
        </div>
      )}

      {/* 个人工作区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MyTasksTile onOverdue={setOverdueCount} />
        <div className="flex flex-col gap-4">
          <MyTodosTile onCount={setTodoCount} />
          <div className="grid grid-cols-2 gap-4">
            <RecentItemsTile items={recent} />
            <FavoritesTile items={favorites} />
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--ui-border)]" />

      {/* 全局概览 */}
      <KpiStrip partsMasters={components.length} documents={documents.length} configItems={configItems.length} stockItems={stockItems} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusDistributionTile partsMasters={components} documents={documents} configItems={configItemStatuses} />
        <ActivityFeedTile items={activity} />
      </div>
    </div>
  );
}
