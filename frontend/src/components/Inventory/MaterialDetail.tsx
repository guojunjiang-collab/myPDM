import { Modal } from '../Modal';
import type { InvMaterial } from '../../types';

interface Props {
  material: InvMaterial;
  onClose: () => void;
}

const LABEL_CLS = 'block text-sm text-gray-500 mb-0.5';
const VALUE_CLS = 'text-sm font-medium';

const FIELD = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className={LABEL_CLS}>{label}</div>
    <div className={VALUE_CLS}>{children}</div>
  </div>
);

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
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FIELD label="编码">{m.code}</FIELD>
          <FIELD label="名称">{m.name}</FIELD>
          <FIELD label="规格型号">{m.spec || '-'}</FIELD>
          <FIELD label="单位">{m.unit || '-'}</FIELD>
          <FIELD label="来源类型">{sourceLabel(m)}</FIELD>
          <FIELD label="追踪方式">{trackLabel(m)}</FIELD>
          <FIELD label="安全库存">{m.safety_stock ?? '-'}</FIELD>
          <FIELD label="状态">{statusLabel(m.status)}</FIELD>
        </div>

        {hasPdmRef && (
          <div className="border-t border-gray-200 pt-4">
            <div className="text-sm font-medium text-gray-700 mb-2">PDM 关联</div>
            <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-xs px-2 py-0.5 rounded bg-primary-100 text-primary-700">
                {m.ref_entity_type === 'part' ? '零件' : '部件'}
              </span>
              <span className="text-sm font-medium">{m.code}</span>
              <span className="text-sm text-gray-500">{m.name}</span>
              <div className="flex-1" />
              <a
                href={m.ref_entity_type === 'part' ? '/parts' : '/assemblies'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-800 underline"
              >
                查看源数据
              </a>
            </div>
          </div>
        )}

        {m.remark && (
          <div className="border-t border-gray-200 pt-4">
            <div className={LABEL_CLS}>备注</div>
            <div className="text-sm text-gray-600 whitespace-pre-wrap">{m.remark}</div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">关闭</button>
        </div>
      </div>
    </Modal>
  );
}
