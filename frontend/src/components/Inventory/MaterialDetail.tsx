import { Modal } from '../Modal';
import type { InvMaterial } from '../../types';

interface Props {
  material: InvMaterial;
  onClose: () => void;
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

export default function MaterialDetail({ material, onClose }: Props) {
  const m = material;
  const hasPdmRef = m.source_type !== 'standalone' && m.ref_entity_id;

  return (
    <Modal open={true} title="物料详情" onClose={onClose} width="lg">
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

        {/* PDM 关联 */}
        {hasPdmRef && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">🔗 PDM 关联</h4>
            <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
              <span className="text-xs px-2 py-0.5 rounded bg-primary-100 text-primary-700">
                {m.ref_entity_type === 'part' ? '零件' : '部件'}
              </span>
              <span className="text-sm font-medium">{m.code}</span>
              <span className="text-sm text-gray-500">{m.name}</span>
              <div className="flex-1" />
              <a href={m.ref_entity_type === 'part' ? '/parts' : '/assemblies'} target="_blank" rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-800 underline">查看源数据</a>
            </div>
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
