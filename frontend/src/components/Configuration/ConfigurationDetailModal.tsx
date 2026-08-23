import { useEffect, useState, useRef } from 'react';
import { Modal } from '../Modal';
import { configurationApi, partsApi, customFieldsApi } from '../../services/api';
import type { ConfigPartItem, ConfigChildItem, CustomFieldDefinition, CustomFieldValue } from '../../types';
import EntityDocumentSection from '../EntityDocumentSection';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import PartDetailModal from '../PartDetailModal';
import { useDataStore } from '../../stores/data';
import CustomFieldInput from '../CustomFieldInput';
import Badge from '../ui/Badge';
import TreeToggle from '../ui/TreeToggle';

interface Props {
  itemId: string | null;
  onClose: () => void;
}

export default function ConfigurationDetailModal({ itemId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [cfDefs, setCfDefs] = useState<CustomFieldDefinition[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, any>>({});

  // 展开状态: { key: children[] }
  const [expandedParts, setExpandedParts] = useState<Record<string, any[]>>({});
  const [loadingPart, setLoadingPart] = useState<string | null>(null);
  const [expandedChild, setExpandedChild] = useState<Record<string, { parts: any[]; children: any[] }>>({});
  const [noChildren, setNoChildren] = useState<Set<string>>(new Set());
  const [loadingChild, setLoadingChild] = useState<string | null>(null);

  // PartDetailModal 状态（点击关联零部件行弹出）
  const [partDetailMasterId, setPartDetailMasterId] = useState<string | null>(null);
  const [partDetailRevisionId, setPartDetailRevisionId] = useState<string | null>(null);

  // 嵌套详情弹窗（点击行查看零件/部件详情）
  const [nestedEntity, setNestedEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [nestedData, setNestedData] = useState<any>(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedCustomDefs, setNestedCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [nestedCustomValues, setNestedCustomValues] = useState<Record<string, any>>({});
  const nestedReqId = useRef(0);

  // 子构型项嵌套详情
  const [nestedConfigId, setNestedConfigId] = useState<string | null>(null);

  // 按构型号排序
  const sortByCode = (items: any[]) =>
    [...items].sort((a, b) => ((a.child_detail?.code || a.child_code || '').localeCompare(b.child_detail?.code || b.child_code || '', 'zh-CN', { numeric: true })));

  useEffect(() => {
    if (!itemId) return;
    setLoading(true);
    configurationApi.getItem(itemId)
      .then((res) => {
        const d = res.data;
        if (d.children) d.children = sortByCode(d.children);
        setData(d);
        // 加载自定义字段
        const allDefs = useDataStore.getState().customFieldDefs;
        const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('configuration_item'));
        setCfDefs(defs);
        if (defs.length > 0) {
          customFieldsApi.getValues('configuration_item', itemId).then(res => {
            const vals: Record<string, any> = {};
            (res.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
            setCfValues(vals);
          }).catch(() => {});
        }
        setExpandedParts({}); setExpandedChild({}); setNoChildren(new Set());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [itemId]);

  const togglePart = async (idx: string, entityId: string, revisionId: string) => {
    if (expandedParts[idx]) { setExpandedParts(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (!revisionId) return;
    setLoadingPart(idx);
    try {
      const items = await partsApi.getBOM(revisionId);
      const children = (items || []).map((c: any) => ({
        entity_type: c.child_type || 'part',
        entity_id: c.child_revision_id || '',
        entity_code: c.child_code || '',
        entity_name: c.child_name || '',
        entity_version: c.child_version || '',
        status: c.child_status || '',
        quantity: c.quantity || 1,
        part_detail: {
          id: c.child_master_id || '',
          code: c.child_code || '',
          name: c.child_name || '',
          version: c.child_version || '',
          status: c.child_status || '',
        },
      }));
      setExpandedParts(p => ({ ...p, [idx]: children }));
    } catch { } finally { setLoadingPart(null); }
  };

  const toggleChild = async (idx: string, childId: string) => {
    if (expandedChild[idx]) { setExpandedChild(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (noChildren.has(idx)) return; // already checked, nothing to expand
    setLoadingChild(idx);
    try {
      const r = await configurationApi.getItem(childId);
      const parts = r.data.parts || [];
      const children = sortByCode((r.data.children || []).map((c: any) => ({
        child_id: c.child_id,
        child_code: c.child_detail?.code || '',
        child_name: c.child_detail?.name || '',
        remark: c.child_detail?.remark || '',
        quantity: c.quantity ?? 1,
        is_required: c.is_required,
        has_children: c.has_children,
        has_parts: c.has_parts,
      })));
      if (parts.length > 0 || children.length > 0) {
        setExpandedChild(p => ({ ...p, [idx]: { parts, children } }));
      } else {
        setNoChildren(prev => new Set(prev).add(idx));
      }
    } catch { setNoChildren(prev => new Set(prev).add(idx)); }
    finally { setLoadingChild(null); }
  };

  // 行点击 → 弹出嵌套详情（零件/部件）
  const handleNestedView = async (type: 'part' | 'assembly', id: string) => {
    const reqId = ++nestedReqId.current;
    setNestedEntity({ type, id });
    setNestedData(null);
    setNestedLoading(true);
    setNestedCustomDefs([]);
    setNestedCustomValues({});
    try {
      // id 可能是 revision_id 或 master_id：先按 revision 尝试，回退 master
      const rev = await partsApi.getRevision(id).catch(() => null);
      const masterId = rev?.master_id || id;
      const master = await partsApi.get(masterId);
      if (reqId !== nestedReqId.current) return;
      const revObj = rev || master.latest_revision;
      const revisionId = revObj?.id || id;
      setNestedData({
        ...master,
        id: master.id,
        master_id: master.id,
        revision_id: revisionId,
        version: revObj?.version,
        status: revObj?.status,
      });
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setNestedCustomDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, revisionId);
          if (reqId !== nestedReqId.current) return;
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setNestedCustomValues(vals);
        } catch { /* optional */ }
      }
    } catch {
      if (reqId !== nestedReqId.current) return;
      setNestedData(null);
    }
    finally {
      if (reqId === nestedReqId.current) {
        setNestedLoading(false);
      }
    }
  };

  const renderPartRow = (p: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = p.part_type === 'assembly' || p.entity_type === 'assembly';
    const childRows = expandedParts[idx];
    const entityId = p.part_id || p.entity_id;
    const entityType = (p.part_type || p.entity_type || 'part');
    const onClickRow = p.part_detail?.id ? () => {
      setPartDetailMasterId(p.part_detail?.id);
      setPartDetailRevisionId(null);
    } : undefined;
    const rowCls = onClickRow ? 'cursor-pointer' : '';
    return (
      <>
        <tr key={idx} className={`hover:bg-[var(--ui-bg-hover)] ${rowCls}`}>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && entityId && (
              <span className="ml-1 inline-flex"><TreeToggle expanded={!!childRows} onClick={() => togglePart(idx, entityId, p.part_detail?.revision_id || '')} size="md" /></span>
            )}
          </td>
          <td className={`px-3 py-2 text-sm ${rowCls}`} onClick={onClickRow}>
            <Badge tone={isAssembly ? 'blue' : 'gray'} label={isAssembly ? '部件' : '零件'} />
          </td>
          <td className={`px-3 py-2 text-sm font-medium ${rowCls}`} onClick={onClickRow}>{p.part_detail?.code || p.entity_code || p.part_id}</td>
          <td className={`px-3 py-2 text-sm ${rowCls}`} onClick={onClickRow}>{p.part_detail?.name || p.entity_name || '-'}</td>
          <td className={`px-3 py-2 text-sm ${rowCls}`} onClick={onClickRow}>{p.part_detail?.version || p.entity_version || '-'}</td>
          <td className={`px-3 py-2 text-sm whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <Badge status={p.part_detail?.status || p.status} />
          </td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>{p.quantity ?? 1}</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>
            <Badge tone={p.is_required ? 'blue' : 'gray'} label={p.is_required ? '必选' : '可选'} />
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };

  // 统一树：零部件行（构型号/零部件件号 列序）
  const renderUnifiedPartRow = (p: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = p.part_type === 'assembly' || p.entity_type === 'assembly';
    const childRows = expandedParts[idx];
    const entityId = p.part_id || p.entity_id;
    const entityType = (p.part_type || p.entity_type || 'part');
    const code = p.part_detail?.code || p.entity_code || entityId;
    const name = p.part_detail?.name || p.entity_name || '-';
    const version = p.part_detail?.version || p.entity_version || '-';
    const status = p.part_detail?.status || p.status || '';
    const onClickRow = p.part_detail?.id ? () => {
      setPartDetailMasterId(p.part_detail?.id);
      setPartDetailRevisionId(null);
    } : undefined;
    const rowCls = onClickRow ? 'cursor-pointer' : '';
    return (
      <>
        <tr key={idx} className={`hover:bg-[var(--ui-bg-hover)] ${rowCls}`}>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] whitespace-nowrap">
            <span>{'-'.repeat(level)}</span>
            {isAssembly && entityId && (
              <span className="ml-1 inline-flex"><TreeToggle expanded={!!childRows} onClick={() => togglePart(idx, entityId, p.part_detail?.revision_id || '')} size="md" /></span>
            )}
          </td>
          <td className={`px-3 py-2 text-sm font-mono text-[var(--ui-text-secondary)] ${rowCls}`} onClick={onClickRow}>{code}</td>
          <td className={`px-3 py-2 text-sm ${rowCls}`} onClick={onClickRow}>{name}</td>
          <td className={`px-3 py-2 text-sm whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <Badge tone={isAssembly ? 'blue' : 'gray'} label={isAssembly ? '部件' : '零件'} />
          </td>
          <td className={`px-3 py-2 text-sm text-[var(--ui-text-secondary)] ${rowCls}`} onClick={onClickRow}>{version}</td>
          <td className={`px-3 py-2 text-sm whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <Badge status={status} />
          </td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>{p.quantity ?? 1}</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>
            <Badge tone={p.is_required ? 'blue' : 'gray'} label={p.is_required ? '必选' : '可选'} />
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderUnifiedPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };

  // 统一树：构型项行
  const renderUnifiedChildRow = (c: any, level: number, idx: string): React.ReactNode => {
    const expanded = expandedChild[idx];
    const hasChildren = c.has_children === true;
    const hasParts = c.has_parts === true;
    const isEmpty = noChildren.has(idx);
    const childId = c.child_id || c.child_detail?.id;
    const expandable = (hasChildren || hasParts) && !isEmpty;
    const onClickRow = childId ? () => setNestedConfigId(childId) : undefined;
    const rowCls = onClickRow ? 'cursor-pointer' : '';
    return (
      <>
        <tr key={idx} className={`bg-[var(--ui-bg-subtle)] hover:bg-purple-50 ${rowCls}`}>
          <td className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {expandable && (
              <span className="ml-1 inline-flex"><TreeToggle expanded={!!expanded} onClick={() => toggleChild(idx, childId)} size="md" /></span>
            )}
          </td>
          <td className={`px-3 py-2 text-sm font-medium text-gray-700 ${rowCls}`} onClick={onClickRow}>{c.child_detail?.code || c.child_code || c.child_id}</td>
          <td className={`px-3 py-2 text-sm text-[var(--ui-text-secondary)] ${rowCls}`} onClick={onClickRow}>{c.child_detail?.name || c.child_name || '-'}</td>
          <td className={`px-3 py-2 text-xs whitespace-nowrap ${rowCls}`} onClick={onClickRow}>
            <Badge tone="purple" label="构型项" />
          </td>
          <td className="px-3 py-2 text-xs text-[var(--ui-text-tertiary)]">-</td>
          <td className="px-3 py-2 text-xs text-[var(--ui-text-tertiary)]">-</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>{c.quantity ?? 1}</td>
          <td className={`px-3 py-2 text-center text-sm ${rowCls}`} onClick={onClickRow}>
            <Badge tone={c.is_required ? 'blue' : 'gray'} label={c.is_required ? '必选' : '可选'} />
          </td>
        </tr>
        {expanded && expanded.parts.map((p: any, j: number) => renderUnifiedPartRow(p, level + 1, `${idx}-p${j}`))}
        {expanded && expanded.children.map((cc: any, j: number) => renderUnifiedChildRow(cc, level + 1, `${idx}-c${j}`))}
        {loadingChild === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };

  if (!itemId) return null;

  return (
    <>
    <Modal open={!!itemId} onClose={onClose} title="构型项详情" width="full" height="75vh">
      {loading ? (
        <div className="py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
      ) : !data ? (
        <div className="py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载失败</div>
      ) : (
        <div className="space-y-6 pr-1">
          {/* 基本信息 - 卡片式 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoItem label="构型号" value={data.code} />
            <InfoItem label="中文名称" value={data.name} />
            <InfoItem label="创建人" value={data.creator_name || '-'} />
            <InfoItem label="备注" value={data.remark || '-'} className="col-span-2 md:col-span-4" />
          </div>

          {/* 自定义字段 */}
          {cfDefs.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {cfDefs.map(def => (
                <div key={def.id} className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
                  <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">{def.name}</label>
                  <CustomFieldInput def={def} value={cfValues[def.id]} onChange={() => {}} readOnly />
                </div>
              ))}
            </div>
          )}

          {/* 关联零部件 */}
          <div>
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">关联零部件 ({data.parts?.length || 0})</h4>
            {data.parts?.length > 0 ? (
              <table className="w-full text-sm border border-[var(--ui-border)] rounded">
                <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-20">层级</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">类型</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">件号</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">中文名称</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-14">版本</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                  <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-16">用量</th>
                  <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-24">必选/可选</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.parts as ConfigPartItem[]).map((p, i) => renderPartRow(p, 0, String(i)))}
                </tbody>
              </table>
            ) : <div className="text-sm text-[var(--ui-text-tertiary)] py-2">暂无关联零部件</div>}
          </div>

          {/* 子构型项 */}
          <div>
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">子构型项 ({data.children?.length || 0})</h4>
            {data.children?.length > 0 ? (
              <table className="w-full text-sm border border-[var(--ui-border)] rounded">
                <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-20">层级</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">构型号/零部件件号</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">名称</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">类型</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-14">版本</th>
                  <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                  <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-16">用量</th>
                  <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-24">必选/可选</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.children as ConfigChildItem[]).map((c, i) => renderUnifiedChildRow(c, 1, `c${i}`))}
                </tbody>
              </table>
            ) : <div className="text-sm text-[var(--ui-text-tertiary)] py-2">暂无子构型项</div>}
          </div>

          {/* 关联图文档 */}
          <EntityDocumentSection entityType="configuration" entityId={data.id} entityCode={data.code} entityName={data.name} editable={false} />
        </div>
      )}
    </Modal>

    {/* ========== 嵌套详情弹窗（点击配置清单行查看零件/部件详情） ========== */}
    <Modal
      open={!!nestedEntity}
      title={nestedEntity ? (nestedEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
      onClose={() => { nestedReqId.current++; setNestedEntity(null); setNestedData(null); }}
      width="full"
      height="75vh"
    >
      <div className="pr-1">
      {nestedLoading ? (
        <div className="py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
      ) : !nestedData ? (
        <div className="py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载失败</div>
      ) : nestedEntity?.type === 'part' ? (
        <PartDetailContent part={nestedData} customFieldDefs={nestedCustomDefs} customFieldValues={nestedCustomValues} />
      ) : (
        <AssemblyDetailContent
          assembly={nestedData}
          customFieldDefs={nestedCustomDefs}
          customFieldValues={nestedCustomValues}
          onSubItemClick={(item) => handleNestedView(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
        />
      )}
      </div>
    </Modal>

    {/* ========== 子构型项嵌套详情弹窗 ========== */}
    <ConfigurationDetailModal
      itemId={nestedConfigId}
      onClose={() => setNestedConfigId(null)}
    />

    {/* ========== PartDetailModal（点击关联零部件行弹出） ========== */}
    {partDetailMasterId && (
      <PartDetailModal
        masterId={partDetailMasterId}
        open={!!partDetailMasterId}
        onClose={() => { setPartDetailMasterId(null); setPartDetailRevisionId(null); }}
      />
    )}
    </>
  );
}

function InfoItem({ label, value, icon, className }: { label: string; value: string; icon?: string; className?: string }) {
  return (
    <div className={`bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)] ${className || ''}`}>
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      <div className="text-sm text-[var(--ui-text-primary)] font-medium whitespace-pre-wrap">
        {icon && <span className="mr-1">{icon}</span>}
        {value}
      </div>
    </div>
  );
}
