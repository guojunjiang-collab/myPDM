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
      {/* 基本属性 */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">件号</label>
          <div className="text-sm font-medium">{assembly.code}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">中文名称</label>
          <div className="text-sm">{assembly.name}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">规格型号</label>
          <div className="text-sm">{assembly.spec || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
          <div className="text-sm">{assembly.version || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
          <span className={`inline-block px-2 py-1 text-xs rounded-full ${statusTag(assembly.status).cls}`}>
            {statusTag(assembly.status).label}
          </span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
          <div className="text-sm">{assembly.remark || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
          <div className="text-sm">{formatDateTime(assembly.created_at)}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
          <div className="text-sm">{formatDateTime(assembly.updated_at)}</div>
        </div>
      </div>

      {/* 自定义字段 */}
      {customFieldDefs.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
          <div className="grid grid-cols-2 gap-4">
            {customFieldDefs.map(def => (
              <div key={def.id}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{def.name}</label>
                <div className="text-sm">
                  {def.field_type === 'select'
                    ? String(
                        (def.options || []).find((o) => o === customFieldValues[def.id]) ||
                          customFieldValues[def.id] ||
                          '-',
                      )
                    : Array.isArray(customFieldValues[def.id])
                      ? ((customFieldValues[def.id] as string[]).join(', ') || '-')
                      : String(customFieldValues[def.id] ?? '-')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 关联图文档 */}
      <EntityDocumentSection entityType="assembly" entityId={assembly.id} editable={false} />

      {/* 子项清单 */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">子项清单</h4>
        <BOMTreeTable assemblyId={assembly.id} onRowClick={onSubItemClick} />
      </div>
    </div>
  );
}
