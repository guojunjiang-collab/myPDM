import { useEffect } from 'react';
import { Modal } from '../Modal';
import { useDataStore } from '../../stores/data';
import type { InvMaterial } from '../../types';

interface Props {
  material: InvMaterial;
  onClose: () => void;
  onViewEntity: (type: 'part' | 'assembly', id: string) => void;
}

function InfoItem({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium">
        {icon && <span className="mr-1">{icon}</span>}{value}
      </div>
    </div>
  );
}

const sourceLabel = (m: InvMaterial) =>
  m.source_type === 'standalone' ? '非PDM（独立物料）' : m.source_type === 'part' ? '零件' : '部件';
const trackLabel = (m: InvMaterial) => (m.track_mode === 'batch' ? '按批次' : '按数量');
const statusLabel = (s: string) => {
  const map: Record<string, string> = { active: '启用', inactive: '停用', draft: '草稿' };
  return map[s] || s || '-';
};
// PDM 零件/部件状态中文
const PDM_STATUS: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };

export default function MaterialDetail({ material, onClose, onViewEntity }: Props) {
  const m = material;
  const hasPdmRef = m.source_type !== 'standalone' && !!m.ref_entity_id;

  const storeParts = useDataStore((s) => s.parts);
  const storeAssemblies = useDataStore((s) => s.assemblies);
  const syncAll = useDataStore((s) => s.syncAll);

  // 关联零部件（取自全局 DataStore 的 brief）
  const pdmEntity = hasPdmRef
    ? (m.ref_entity_type === 'part' ? storeParts : storeAssemblies).find((e: any) => e.id === m.ref_entity_id)
    : null;

  // store 未加载时拉一次
  useEffect(() => {
    if (hasPdmRef && storeParts.length === 0 && storeAssemblies.length === 0) syncAll();
  }, [hasPdmRef, storeParts.length, storeAssemblies.length, syncAll]);

  return (
    <Modal open={true} title="物料详情" onClose={onClose} width="3xl">
      <div className="space-y-6 max-h-[72vh] overflow-y-auto pr-1">
        {/* 基本信息卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <InfoItem label="编码" value={m.code} />
          <InfoItem label="名称" value={m.name} />
          <InfoItem label="规格型号" value={m.spec || '-'} />
          <InfoItem label="单位" value={m.unit || '-'} />
          <InfoItem label="来源类型" value={sourceLabel(m)} />
          <InfoItem label="追踪方式" value={trackLabel(m)} />
          <InfoItem label="安全库存" value={m.safety_stock != null ? String(m.safety_stock) : '-'} />
          <InfoItem label="状态" value={statusLabel(m.status)} />
        </div>

        {/* PDM 关联零部件 */}
        {hasPdmRef && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">🔗 PDM 关联零部件</h4>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">类型</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">件号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格型号</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">版本</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onViewEntity(m.ref_entity_type as 'part' | 'assembly', m.ref_entity_id!)}>
                    <td className="px-3 py-2 text-sm text-gray-500">{m.ref_entity_type === 'part' ? '零件' : '部件'}</td>
                    <td className="px-3 py-2 text-sm font-medium text-primary-600">{pdmEntity?.code || m.code}</td>
                    <td className="px-3 py-2 text-sm">{pdmEntity?.name || m.name}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{pdmEntity?.spec || m.spec || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{pdmEntity?.version || '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-500">{pdmEntity ? (PDM_STATUS[pdmEntity.status] || pdmEntity.status) : '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-1">点击上方行可查看零部件详情。</p>
          </div>
        )}

        {/* 备注 */}
        {m.remark && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">📝 备注</h4>
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap border border-gray-200">{m.remark}</div>
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">关闭</button>
        </div>
      </div>
    </Modal>
  );
}
