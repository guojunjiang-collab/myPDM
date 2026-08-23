import { useState, useEffect } from 'react';
import BOMTreeTable from './BOMTreeTable';
import type { Assembly, AssemblyPartItem, CustomFieldDefinition } from '../types';
import { formatDateTime } from '../utils/date';
import { partsApi } from '../services/api';
import EntityDocumentSection from './EntityDocumentSection';
import ComponentAttachmentBucket from './ComponentAttachmentBucket';
import Badge from './ui/Badge';

interface AssemblyDetailContentProps {
  assembly: Assembly;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, unknown>;
  onSubItemClick?: (item: AssemblyPartItem) => void;
}

export default function AssemblyDetailContent({ assembly, customFieldDefs, customFieldValues, onSubItemClick }: AssemblyDetailContentProps) {
  const [hasSubItems, setHasSubItems] = useState<boolean | null>(null);
  const docLinks = (assembly as any).document_links;
  const hasDocuments = Array.isArray(docLinks) && docLinks.length > 0;
  // 统一以 revision_id 操作 BOM/附件/文档；master_id 用于身份导航
  const revId = (assembly as any).revision_id || assembly.id;
  const masterId = (assembly as any).master_id || assembly.id;

  useEffect(() => {
    let cancelled = false;
    partsApi.getBOM(revId).then((rows: any[]) => {
      if (!cancelled) setHasSubItems((rows || []).length > 0);
    }).catch(() => {
      if (!cancelled) setHasSubItems(false);
    });
    return () => { cancelled = true; };
  }, [revId]);

  return (
    <div className="space-y-4">
      {/* 基本属性 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoItem label="件号" value={assembly.code} />
        <InfoItem label="中文名称" value={assembly.name} />
        <InfoItem label="版本" value={assembly.version || '-'} />
        <StatusItem label="状态" status={assembly.status} />
        <InfoItem label="备注" value={assembly.remark || '-'} />
        <InfoItem label="创建人" value={(assembly as any).creator_name || '-'} />
        <InfoItem label="创建时间" value={formatDateTime(assembly.created_at)} />
        <InfoItem label="更新时间" value={formatDateTime(assembly.updated_at)} />
      </div>

      {/* 自定义字段 */}
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
      {hasDocuments && (
        <EntityDocumentSection entityType="component" entityId={revId} entityCode={assembly.code} entityName={assembly.name} editable={false} />
      )}

      {/* CAD附件 / 生产附件（只读，无附件时隐藏） */}
      <ComponentAttachmentBucket componentId={revId} category="cad" label="CAD附件" editable={false} hideWhenEmpty />
      <ComponentAttachmentBucket componentId={revId} category="production" label="生产附件" editable={false} hideWhenEmpty />

      {/* 子项清单 */}
      {hasSubItems && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-bold text-gray-700 mb-2">子项清单</h4>
          <BOMTreeTable revisionId={revId} rootMasterId={masterId} onRowClick={onSubItemClick} />
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <Badge status={status} />
    </div>
  );
}
