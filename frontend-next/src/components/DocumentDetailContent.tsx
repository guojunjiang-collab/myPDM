import type { Document, CustomFieldDefinition } from '../types';
import { formatDateTime } from '../utils/date';

interface DocumentDetailContentProps {
  doc: Document;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, any>;
}

const statusTag = (s: string) => {
  const tags: Record<string, { label: string; class: string }> = {
    draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', class: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
  };
  return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
};

export default function DocumentDetailContent({ doc, customFieldDefs, customFieldValues }: DocumentDetailContentProps) {
  return (
    <div className="space-y-4">
      {/* 基本属性 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">图文档编号</label>
          <div className="text-sm font-medium">{doc.code}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">图文档名称</label>
          <div className="text-sm">{doc.name}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
          <div className="text-sm">{doc.version || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
          <span className={`inline-block px-2 py-1 text-xs rounded-full ${statusTag(doc.status).class}`}>
            {statusTag(doc.status).label}
          </span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
          <div className="text-sm">{doc.remark || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
          <div className="text-sm">{formatDateTime(doc.created_at)}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
          <div className="text-sm">{formatDateTime(doc.updated_at)}</div>
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
                    ? (def.options || []).find(o => o === customFieldValues[def.id]) || customFieldValues[def.id] || '-'
                    : (customFieldValues[def.id] ?? '-')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}