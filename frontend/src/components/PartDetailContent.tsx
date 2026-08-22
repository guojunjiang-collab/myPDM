import type { Part, CustomFieldDefinition } from '../types';
import { formatDateTime } from '../utils/date';
import EntityDocumentSection from './EntityDocumentSection';
import Badge from './ui/Badge';

interface PartDetailContentProps {
  part: Part;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, any>;
}

export default function PartDetailContent({ part, customFieldDefs, customFieldValues }: PartDetailContentProps) {
  return (
    <div className="space-y-4">
      {/* 基本属性 - 卡片式 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoItem label="件号" value={part.code} />
        <InfoItem label="中文名称" value={part.name} />
        <InfoItem label="版本" value={part.version || '-'} />
        <StatusItem label="状态" status={part.status} />
        <InfoItem label="备注" value={part.remark || '-'} />
        <InfoItem label="创建人" value={(part as any).creator_name || '-'} />
        <InfoItem label="创建时间" value={formatDateTime(part.created_at)} />
        <InfoItem label="更新时间" value={formatDateTime(part.updated_at)} />
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
                value={
                  def.field_type === 'select'
                    ? String((def.options || []).find(o => o === customFieldValues[def.id]) || customFieldValues[def.id] || '-')
                    : String(customFieldValues[def.id] ?? '-')
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* 关联图文档 */}
      <EntityDocumentSection entityType="part" entityId={part.id} entityCode={part.code} entityName={part.name} editable={false} />
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
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <Badge status={status} />
    </div>
  );
}