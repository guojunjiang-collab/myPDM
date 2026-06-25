import BOMTreeTable from './BOMTreeTable';
import type { Assembly, AssemblyPartItem, CustomFieldDefinition } from '../types';
import { formatDateTime } from '../utils/date';
import EntityDocumentSection from './EntityDocumentSection';

interface AssemblyDetailContentProps {
  assembly: Assembly;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, unknown>;
  onSubItemClick?: (item: AssemblyPartItem) => void;
}

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

export default function AssemblyDetailContent({ assembly, customFieldDefs, customFieldValues, onSubItemClick }: AssemblyDetailContentProps) {
  return (
    <div className="space-y-4">
      {/* 基本属性 - 卡片式 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoItem label="件号" value={assembly.code} />
        <InfoItem label="中文名称" value={assembly.name} />
        <InfoItem label="版本" value={assembly.version || '-'} />
        <StatusItem label="状态" status={assembly.status} />
        <InfoItem label="规格型号" value={assembly.spec || '-'} />
        <InfoItem label="备注" value={assembly.remark || '-'} />
        <InfoItem label="创建人" value={(assembly as any).creator_name || '-'} />
        <InfoItem label="创建时间" value={formatDateTime(assembly.created_at)} />
        <InfoItem label="更新时间" value={formatDateTime(assembly.updated_at)} />
      </div>

      {/* 自定义字段 - 卡片式 */}
      {customFieldDefs.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {customFieldDefs.map(def => (
              <InfoItem
                key={def.id}
                label={def.name}
                value={String(
                  def.field_type === 'select'
                    ? (def.options || []).find(o => o === customFieldValues[def.id]) || customFieldValues[def.id] || '-'
                    : customFieldValues[def.id] ?? '-'
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* 关联图文档 */}
      <EntityDocumentSection entityType="assembly" entityId={assembly.id} entityCode={assembly.code} entityName={assembly.name} editable={false} />

      {/* 子项清单 */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-bold text-gray-700 mb-2">子项清单</h4>
        <BOMTreeTable assemblyId={assembly.id} onRowClick={onSubItemClick} />
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-medium whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  const tag = statusTag(status);
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${tag.cls}`}>{tag.label}</span>
    </div>
  );
}
