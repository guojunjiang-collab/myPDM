import { useEffect, useState, useMemo, useRef } from 'react';
import { configurationApi } from '../../services/api';
import type { ConfigurationItem } from '../../types';
import { canEdit, isAdmin, canDownload } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import ConfigurationCreateModal from './ConfigurationCreateModal';
import ConfigurationDetailModal from './ConfigurationDetailModal';
import { useDataStore } from '../../stores/data';
import {
  exportConfigurationItems,
  previewConfigurationItemsImport,
  executeConfigurationItemsImport,
} from '../../services/importExport';
import type { ImportPreview } from '../../services/importExport';
import ImportPreviewModal from '../ImportPreviewModal';

export default function ConfigurationList() {
  const [items, setItems] = useState<ConfigurationItem[]>([]);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [loading, setLoading] = useState(false);
  // 仅显示顶层构型项（不作为任何其它构型项的子项）。由服务端按父子关系筛选。
  const [topLevelOnly, setTopLevelOnly] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<ConfigurationItem | null>(null);
  const [detailItem, setDetailItem] = useState<ConfigurationItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const configCustomDefs = storeCustomDefs.filter((d) => d.applies_to?.includes('configuration_item'));

  // 导入导出
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importPreviewOpen, setImportPreviewOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const PAGE_CAP = 10000;
  const [serverTotal, setServerTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const res = await configurationApi.listItems({ page: 1, page_size: PAGE_CAP, top_level: topLevelOnly || undefined });
      setItems(res.data.items || []);
      setServerTotal(res.data.total ?? (res.data.items || []).length);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [topLevelOnly]);

  // 客户端筛选
  const filteredData = useMemo(() => {
    if (!search) return items;
    const keyword = search.toLowerCase();
    const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
    return items.filter(item => {
      if (searchField === 'all') {
        return match(item.code) || match(item.name) || match(item.spec) || match(item.remark);
      }
      if (searchField === 'code') return match(item.code);
      if (searchField === 'name') return match(item.name);
      if (searchField === 'spec') return match(item.spec);
      if (searchField === 'remark') return match(item.remark);
      return true;
    });
  }, [items, search, searchField]);


  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await configurationApi.deleteItem(deleteId);
      setDeleteId(null);
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail) {
        setDeleteError(typeof detail === 'string' ? detail : '删除失败');
      } else {
        setDeleteError('删除失败，请重试');
      }
    }
  };

  const handleExport = async () => {
    try {
      await exportConfigurationItems();
    } catch (err: any) {
      alert(err.message || '导出失败');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const preview = await previewConfigurationItemsImport(file);
      setImportPreview(preview);
      setImportPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || '导入解析失败');
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await executeConfigurationItemsImport(importPreview);
      setImportPreviewOpen(false);
      setImportPreview(null);
      load();
      let msg = `导入成功（新增 ${result.created}，更新 ${result.updated}）`;
      if (result.warnings.length > 0) {
        msg += `\n\n⚠️ ${result.warnings.length} 条告警：\n` + result.warnings.slice(0, 20).join('\n');
        if (result.warnings.length > 20) msg += `\n… 其余 ${result.warnings.length - 20} 条见控制台`;
      }
      alert(msg);
    } catch (err: any) {
      alert(err.message || '导入执行失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 搜索 + 新建 */}
      <div className="flex gap-2 mb-4 shrink-0">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">构型号</option>
          <option value="name">名称</option>
          <option value="spec">规格型号</option>
          <option value="remark">备注</option>
          {configCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={searchField === 'all' ? '搜索全部字段...' : searchField.startsWith('cf_') ? `搜索${configCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '构型号' : searchField === 'name' ? '名称' : searchField === 'spec' ? '规格型号' : '备注'}...`}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap" title="只显示没有父项的最顶层构型项">
          <input
            type="checkbox"
            checked={topLevelOnly}
            onChange={(e) => setTopLevelOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          仅顶层构型项
        </label>
        <div className="flex-1" />
        {canDownload() && (
          <button onClick={handleExport} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">导出全部</button>
        )}
        {canEdit() && (
          <>
            <button onClick={handleImportClick} disabled={importLoading} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">{importLoading ? '解析中...' : '导入'}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          </>
        )}
        {canEdit() && (
          <button onClick={() => setCreateOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建构型</button>
        )}
      </div>

      {/* 数据超过加载上限时提示（避免静默截断） */}
      {serverTotal > items.length && (
        <div className="mb-3 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
          共 {serverTotal} 条，当前仅加载前 {items.length} 条。请用上方搜索缩小范围以定位目标构型项。
        </div>
      )}

      {/* 表格（滚动容器，不分页） */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">构型号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">备注</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : filteredData.map((item) => (
              <tr key={item.id} onClick={() => setDetailItem(item)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium">{item.code}</td>
                <td className="px-4 py-3 text-sm">{item.name}</td>
                <td className="px-4 py-3 text-sm">{item.remark || '-'}</td>
                <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                  {canEdit() && (
                    <button onClick={(e) => { e.stopPropagation(); setEditItem(item); }} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                  )}
                  {isAdmin() && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* 新建弹窗 */}
      <ConfigurationCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      {/* 编辑弹窗 */}
      <ConfigurationCreateModal
        open={!!editItem}
        item={editItem || undefined}
        onClose={() => setEditItem(null)}
        onSaved={() => { setEditItem(null); load(); }}
      />

      {/* 详情弹窗 */}
      <ConfigurationDetailModal
        itemId={detailItem?.id || null}
        onClose={() => setDetailItem(null)}
      />

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "删除构型项"}
        content={deleteError || "确认删除该构型项？此操作不可恢复。"}
        confirmText={deleteError ? "知道了" : "删除"}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* 导入预览弹窗 */}
      <ImportPreviewModal
        open={importPreviewOpen}
        preview={importPreview}
        loading={importing}
        onClose={() => { setImportPreviewOpen(false); setImportPreview(null); }}
        onConfirm={handleImportConfirm}
      />
    </div>
  );
}
