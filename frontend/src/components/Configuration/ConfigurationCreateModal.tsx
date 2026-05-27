import { useState, useEffect, useRef } from 'react';
import { Modal } from '../Modal';
import { configurationApi, partsApi, assembliesApi } from '../../services/api';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';
import EntityDocumentSection from '../EntityDocumentSection';
import type { ConfigurationItem } from '../../types';

interface Props {
  open: boolean;
  item?: ConfigurationItem;
  onClose: () => void;
  onSaved: () => void;
}

interface PartEntry {
  id?: string;
  part_type: string;
  part_id: string;
  part_code: string;
  part_name: string;
  part_version: string;
  part_spec: string;
  part_status: string;
  is_required: boolean;
}

interface ChildEntry {
  id?: string;
  child_id: string;
  child_code: string;
  child_name: string;
  child_spec?: string;
  is_required: boolean;
}

export default function ConfigurationCreateModal({ open, item, onClose, onSaved }: Props) {
  const isEdit = !!item;
  const [form, setForm] = useState({ code: '', name: '', spec: '', remark: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const remarkRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = remarkRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, [form.remark]);

  // 关联零部件
  const [parts, setParts] = useState<PartEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionSelectIdx, setVersionSelectIdx] = useState<number | null>(null);

  // 子构型项
  const [children, setChildren] = useState<ChildEntry[]>([]);
  const [cfgPickerOpen, setCfgPickerOpen] = useState(false);
  const [cfgSearch, setCfgSearch] = useState('');
  const [cfgResults, setCfgResults] = useState<any[]>([]);
  const [cfgSearching, setCfgSearching] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      setForm(item ? {
        code: item.code, name: item.name, spec: item.spec || '',
        remark: item.remark || '',
      } : { code: '', name: '', spec: '', remark: '' });
      setError('');
      // Load existing parts and children for edit mode
      if (item?.id) {
        configurationApi.getItem(item.id).then(r => {
          setParts((r.data.parts || []).map((p: any) => ({
            id: p.id, part_type: p.part_type, part_id: p.part_id,
            part_code: p.part_detail?.code || '', part_name: p.part_detail?.name || '',
            part_version: p.part_detail?.version || '', part_spec: p.part_detail?.spec || '',
            part_status: p.part_detail?.status || '', is_required: p.is_required,
          })));
          setChildren((r.data.children || []).map((c: any) => ({
            id: c.id, child_id: c.child_id,
            child_code: c.child_detail?.code || '', child_name: c.child_detail?.name || '',
            child_spec: c.child_detail?.spec || '',
            is_required: c.is_required,
          })));
        }).catch(() => {});
      } else {
        setParts([]); setChildren([]);
      }
    }
  }, [open, item]);

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) { setError('构型号和中文名称不能为空'); return; }
    setSaving(true);
    try {
      let configId: string;
      if (isEdit) {
        await configurationApi.updateItem(item!.id, form);
        configId = item!.id;
      } else {
        const r = await configurationApi.createItem(form);
        configId = r.data.id;
      }
      // Save parts
      if (isEdit) {
        // Full replace: fetch existing data, remove all, then re-add current state
        try {
          const current = await configurationApi.getItem(configId);
          const existingParts = current.data?.parts || [];
          const existingChildren = current.data?.children || [];
          for (const p of existingParts) {
            try { await configurationApi.removePart(configId, p.id); } catch {}
          }
          for (const c of existingChildren) {
            try { await configurationApi.removeChild(configId, c.id); } catch {}
          }
        } catch {}
      }
      if (parts.length > 0) {
        await configurationApi.addParts(configId, parts.map(p => ({
          part_type: p.part_type, part_id: p.part_id, is_required: p.is_required,
        })));
      }
      if (children.length > 0) {
        await configurationApi.addChildren(configId, children.map(c => ({
          child_id: c.child_id, is_required: c.is_required,
        })));
      }
      onSaved();
    } catch (e: any) {
      setError(e.response?.data?.detail || '保存失败');
    } finally { setSaving(false); }
  };

  const togglePartRequired = (idx: number) => {
    setParts(prev => prev.map((p, i) => i === idx ? { ...p, is_required: !p.is_required } : p));
  };
  const toggleChildRequired = (idx: number) => {
    setChildren(prev => prev.map((c, i) => i === idx ? { ...c, is_required: !c.is_required } : c));
  };

  const searchConfigItems = () => {
    if (!cfgSearch.trim()) return;
    setCfgSearching(true);
    configurationApi.listItems({ page_size: 50, search: cfgSearch })
      .then(r => setCfgResults(r.data.items || []))
      .catch(() => setCfgResults([]))
      .finally(() => setCfgSearching(false));
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? '编辑构型项' : '新建构型项'} width="full">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</div>}

        {/* 基本信息 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">构型号 *</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={isEdit}
              className="w-full text-sm bg-transparent border-0 p-0 focus:outline-none disabled:text-gray-400 placeholder:text-gray-300" placeholder="如 CFG-001" />
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">中文名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full text-sm bg-transparent border-0 p-0 focus:outline-none placeholder:text-gray-300" placeholder="如 A型机翼构型" />
          </div>
          <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">备注</label>
            <textarea ref={remarkRef} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={1}
              className="w-full text-sm bg-transparent border-0 p-0 focus:outline-none resize-none"
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = el.scrollHeight + 'px';
              }}
            />
          </div>
        </div>

        {/* 关联零部件 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">关联零部件 ({parts.length})</h4>
            <button type="button" onClick={() => setPickerOpen(true)}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">关联零部件</button>
          </div>
          {parts.length === 0 ? (
            <p className="text-xs text-gray-400">暂无关联零部件，点击"关联零部件"添加</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">类型</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">件号</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">名称</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-14">版本</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">状态</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-20">必选/可选</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parts.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${p.part_type === 'assembly' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
                          {p.part_type === 'assembly' ? '部件' : '零件'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs font-mono">{p.part_code}</td>
                      <td className="px-3 py-1.5 text-xs">{p.part_name}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">{p.part_spec || '-'}</td>
                      <td className="px-3 py-1.5 text-xs">{p.part_version || '-'}</td>
                      <td className="px-3 py-1.5 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${p.part_status === 'draft' ? 'bg-blue-100 text-blue-800' : p.part_status === 'frozen' ? 'bg-orange-100 text-orange-800' : p.part_status === 'released' ? 'bg-green-100 text-green-800' : p.part_status === 'obsolete' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                          {p.part_status === 'draft' ? '草稿' : p.part_status === 'frozen' ? '冻结' : p.part_status === 'released' ? '发布' : p.part_status === 'obsolete' ? '作废' : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => togglePartRequired(i)}
                          className={`px-2 py-0.5 text-xs rounded ${p.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                          {p.is_required ? '必选' : '可选'}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => setVersionSelectIdx(i)}
                            className="text-xs text-blue-600 hover:text-blue-800">选择</button>
                          <button onClick={() => setParts(prev => prev.filter((_, j) => j !== i))}
                            className="text-xs text-red-500 hover:text-red-700">移除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 子构型项 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">子构型项 ({children.length})</h4>
            <button type="button" onClick={() => {
              setCfgPickerOpen(true); setCfgSearch(''); setPickerSelected([]);
              setCfgSearching(true);
              const params: any = { page: 1, page_size: 100 };
              if (item?.id) params.exclude_ancestors_of = item.id;
              configurationApi.listItems(params)
                .then(r => setCfgResults(r.data.items || []))
                .finally(() => setCfgSearching(false));
            }}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">添加子构型项</button>
          </div>

          {/* 构型项选择器弹窗 */}
          {cfgPickerOpen && (
            <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center" onClick={() => setCfgPickerOpen(false)}>
              <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <h4 className="text-sm font-semibold">选择子构型项</h4>
                  <button onClick={() => setCfgPickerOpen(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>

                {/* 已选子项 */}
                <div className="border-b">
                  <div className="bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700">已选子项 ({pickerSelected.length})</div>
                  {pickerSelected.length === 0 ? (
                    <div className="px-4 py-4 text-center text-sm text-gray-400">请在下方列表中选择</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b"><tr>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">构型号</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500">名称</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500 w-12"></th>
                      </tr></thead>
                      <tbody className="divide-y">
                        {pickerSelected.map((s: any) => (
                          <tr key={s.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-xs">{s.code}</td>
                            <td className="px-3 py-2 text-xs">{s.name}</td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => setPickerSelected(prev => prev.filter(x => x.id !== s.id))}
                                className="text-xs text-red-500 hover:text-red-700">移除</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 搜索 + 候选列表 */}
                <div className="p-4 flex-1 overflow-auto">
                  <div className="flex gap-2 mb-3">
                    <input value={cfgSearch} onChange={e => setCfgSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && searchConfigItems()}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm" placeholder="搜索构型号/名称..." />
                    <button onClick={searchConfigItems} className="px-4 py-2 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">
                      {cfgSearching ? '搜索中...' : '搜索'}
                    </button>
                  </div>
                  {cfgSearching ? (
                    <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
                  ) : cfgResults.length === 0 ? (
                    <div className="text-center py-8 text-sm text-gray-400">无可用构型项</div>
                  ) : (
                    <table className="w-full text-sm border border-gray-200 rounded">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs text-gray-500">构型号</th>
                          <th className="px-3 py-2 text-left text-xs text-gray-500">名称</th>
                          <th className="px-3 py-2 text-left text-xs text-gray-500">规格型号</th>
                          <th className="px-3 py-2 text-center text-xs text-gray-500 w-20">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {cfgResults.filter((r: any) => !children.some(c => c.child_id === r.id) && !pickerSelected.some(s => s.id === r.id)).map((r: any) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-xs">{r.code}</td>
                            <td className="px-3 py-2 text-xs">{r.name}</td>
                            <td className="px-3 py-2 text-xs text-gray-400">{r.spec || '-'}</td>
                            <td className="px-3 py-2 text-center">
                              <button onClick={() => setPickerSelected(prev => [...prev, r])}
                                className="px-2.5 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700">添加</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 底部按钮 */}
                <div className="px-4 py-3 border-t flex justify-end gap-2">
                  <button onClick={() => setCfgPickerOpen(false)}
                    className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50">取消</button>
                  <button onClick={() => {
                    setChildren(prev => [...prev, ...pickerSelected.map((s: any) => ({
                      child_id: s.id, child_code: s.code, child_name: s.name, child_spec: s.spec || '', is_required: true,
                    }))]);
                    setCfgPickerOpen(false);
                  }}
                    className="px-4 py-2 bg-primary-600 text-white rounded text-sm hover:bg-primary-700">确认添加 ({pickerSelected.length})</button>
                </div>
              </div>
            </div>
          )}

          {children.length === 0 ? (
            <p className="text-xs text-gray-400">暂无子构型项，点击"添加子构型项"选择</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">构型号</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">名称</th>
                    <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-20">必选/可选</th>
                    <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-16">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {children.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs font-mono">{c.child_code}</td>
                      <td className="px-3 py-1.5 text-xs">{c.child_name}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-500">{c.child_spec || '-'}</td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => toggleChildRequired(i)}
                          className={`px-2 py-0.5 text-xs rounded ${c.is_required ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                          {c.is_required ? '必选' : '可选'}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={() => setChildren(prev => prev.filter((_, j) => j !== i))}
                          className="text-xs text-red-500 hover:text-red-700">移除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 关联图文档（仅编辑模式） */}
        {isEdit && item && (
          <EntityDocumentSection entityType="configuration" entityId={item.id} editable />
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-sm">取消</button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 零部件选择器 */}
      <AssemblyPartPicker open={pickerOpen} onClose={() => setPickerOpen(false)}
        onConfirm={async (items) => {
          for (const it of items) {
            const key = `${it.child_type}_${it.child_id}`;
            const exists = parts.some(p => `${p.part_type}_${p.part_id}` === key);
            if (exists) continue;
            let code = ''; let name = ''; let ver = ''; let spec = ''; let status = '';
            try {
              const api = it.child_type === 'assembly' ? assembliesApi : partsApi;
              const r = await api.get(it.child_id);
              code = r.data.code; name = r.data.name; ver = r.data.version || '';
              spec = r.data.spec || ''; status = r.data.status || '';
            } catch {}
            setParts(prev => [...prev, { part_type: it.child_type === 'assembly' ? 'assembly' : 'part', part_id: it.child_id, part_code: code, part_name: name, part_version: ver, part_spec: spec, part_status: status, is_required: true }]);
          }
          setPickerOpen(false);
        }}
      />

      {/* 版本选择器 */}
      {versionSelectIdx !== null && parts[versionSelectIdx] && (
        <VersionSelectModal
          open={versionSelectIdx !== null}
          entityType={parts[versionSelectIdx].part_type === 'assembly' ? 'assembly' : 'part'}
          entityId={parts[versionSelectIdx].part_id}
          entityName={parts[versionSelectIdx].part_name}
          currentVersionId={parts[versionSelectIdx].part_id}
          onSelect={(versionId: string) => {
            const api = parts[versionSelectIdx].part_type === 'assembly' ? assembliesApi : partsApi;
            api.get(versionId).then(r => {
              setParts(prev => prev.map((p, i) => i === versionSelectIdx ? {
                ...p, part_id: versionId,
                part_code: r.data.code, part_name: r.data.name,
                part_version: r.data.version || '', part_spec: r.data.spec || '', part_status: r.data.status || '',
              } : p));
            }).catch(() => {});
            setVersionSelectIdx(null);
          }}
          onClose={() => setVersionSelectIdx(null)}
        />
      )}
    </Modal>
  );
}
