import { useState, useEffect } from 'react';
import { useDataStore } from '../../stores/data';
import { assembliesApi, partsApi, customFieldsApi } from '../../services/api';
import type { CustomFieldDefinition, CustomFieldValue } from '../../types';
import { Modal } from '../../components/Modal';
import PartDetailContent from '../../components/PartDetailContent';
import AssemblyDetailContent from '../../components/AssemblyDetailContent';
import type { SelectOption } from './helpers';
import BOMTreePanel from './BOMTreePanel';
import BOMComparePanel from './BOMComparePanel';
import BOMTracePanel from './BOMTracePanel';
import DocTracePanel from './DocTracePanel';
import { useHeaderTabs } from '../../hooks/useHeaderTabs';

type ModeKey = 'tree' | 'compare' | 'trace' | 'doc-trace';
const modeTabs: { key: ModeKey; label: string }[] = [
  { key: 'tree', label: 'BOM 树' },
  { key: 'compare', label: 'BOM 对比' },
  { key: 'trace', label: 'BOM 反查' },
  { key: 'doc-trace', label: '图文档反查' },
];

export default function BOM() {
  const [mode, setMode] = useState<ModeKey>('tree');

  // 将模式 Tab 注入顶栏，替代默认的“管理工具”标题，节省一行高度、内容区更高
  useHeaderTabs(modeTabs, mode, setMode);

  // 部件列表（BOM 树模式 & BOM 对比模式共用）
  const [assemblies, setAssemblies] = useState<SelectOption[]>([]);

  // 行点击详情弹窗
  const [detailEntity, setDetailEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, any>>({});

  // 加载部件列表
  useEffect(() => {
    loadAssemblies();
  }, []);

  const loadAssemblies = async () => {
    try {
      const response = await assembliesApi.list();
      const items = Array.isArray(response.data) ? response.data : (response.data.items || []);
      const filtered = items.filter((a: { status?: string }) => a.status !== 'obsolete');
      setAssemblies(filtered.map((a: { id: string; code: string; name: string }) => ({
        id: a.id, code: a.code, name: a.name,
      })));
    } catch (error) {
      console.error('加载部件失败', error);
    }
  };

  const handleViewEntity = async (type: 'part' | 'assembly', id: string) => {
    setDetailEntity({ type, id });
    setDetailData(null);
    setDetailLoading(true);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    try {
      const api = type === 'part' ? partsApi : assembliesApi;
      const res = await api.get(id);
      setDetailData(res.data);

      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setDetailCustomDefs(defs);

      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setDetailCustomValues(vals);
        } catch { /* custom fields optional */ }
      }
    } catch { setDetailData(null); }
    finally { setDetailLoading(false); }
  };

  return (
    <div>
      {/* 各模式 Panel */}
      {mode === 'tree'      && <BOMTreePanel assemblies={assemblies} onViewEntity={handleViewEntity} />}
      {mode === 'compare'   && <BOMComparePanel assemblies={assemblies} onViewEntity={handleViewEntity} />}
      {mode === 'trace'     && <BOMTracePanel onViewEntity={handleViewEntity} />}
      {mode === 'doc-trace' && <DocTracePanel onViewEntity={handleViewEntity} />}

      {/* 行点击详情弹窗 */}
      <Modal
        open={!!detailEntity}
        title={detailEntity ? (detailEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setDetailEntity(null)}
        width="full"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !detailData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : detailEntity?.type === 'part' ? (
          <PartDetailContent part={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} />
        ) : (
          <AssemblyDetailContent assembly={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} onSubItemClick={(item) => handleViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
        )}
      </Modal>
    </div>
  );
}
