import { useEffect, useState } from 'react';
import { ecoApi } from '../../services/api';
import type { ECOExecutionItem } from '../../types';
import { ECOExecStatusBadge, ECOActionBadge } from './ECOStatusBadge';
import { toast } from '../Toast';

interface Props { ecoId: string; status: string; onRefresh: () => void; }

export function ECOExecutionPanel({ ecoId, status, onRefresh }: Props) {
  const [items, setItems] = useState<ECOExecutionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    ecoApi.getExecutionItems(ecoId).then(r => setItems(r.data.items || [])).catch(() => {});
  }, [ecoId]);

  const executeItem = async (itemId: string) => {
    setExecuting(true);
    try { await ecoApi.executeItem(ecoId, itemId); toast.success('执行成功'); onRefresh(); }
    catch { toast.error('执行失败'); }
    finally { setExecuting(false); }
  };

  const executeAll = async () => {
    setExecuting(true);
    try { await ecoApi.executeAll(ecoId); toast.success('全部执行完成'); onRefresh(); }
    catch { toast.error('执行失败'); }
    finally { setExecuting(false); }
  };

  const canExecute = status === 'approved' || status === 'executing';

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">执行明细</h3>
        {canExecute && (
          <div className="flex gap-2">
            {status === 'approved' && (
              <button className="px-3 py-1 bg-blue-600 text-white rounded text-xs"
                disabled={executing} onClick={() => ecoApi.startExecution(ecoId).then(() => { toast.success('已开始'); onRefresh(); })}>
                开始执行
              </button>
            )}
            <button className="px-3 py-1 bg-green-600 text-white rounded text-xs"
              disabled={executing} onClick={executeAll}>
              一键执行
            </button>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-gray-400">暂无执行项</p>
      ) : (
        <div className="border rounded overflow-hidden">
          <table className="min-w-full text-xs">
            <thead><tr className="bg-gray-50 border-b">
              <th className="p-1.5 text-left">#</th>
              <th className="p-1.5 text-left">实体名称</th>
              <th className="p-1.5 text-left">操作</th>
              <th className="p-1.5 text-left">状态</th>
              <th className="p-1.5 text-left">结果</th>
              <th className="p-1.5 text-left">时间</th>
              <th className="p-1.5 text-left">操作</th>
            </tr></thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} className="border-b hover:bg-gray-50">
                  <td className="p-1.5">{item.sort_order ?? idx + 1}</td>
                  <td className="p-1.5">{item.entity_name}</td>
                  <td className="p-1.5"><ECOActionBadge action={item.action} /></td>
                  <td className="p-1.5"><ECOExecStatusBadge status={item.status} /></td>
                  <td className="p-1.5 text-gray-500">
                    {item.new_version && <span>v{item.new_version}</span>}
                    {item.error_message && <span className="text-red-500">{item.error_message}</span>}
                  </td>
                  <td className="p-1.5 text-gray-400">{item.executed_at?.slice(0, 16) || '-'}</td>
                  <td className="p-1.5">
                    {canExecute && (item.status === 'pending' || item.status === 'failed') && (
                      <button className="text-blue-500 text-xs hover:underline"
                        disabled={executing} onClick={() => executeItem(item.id)}>
                        执行
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
