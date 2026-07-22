import { useEffect, useState, useMemo, useRef } from 'react';
import { useTableSort } from '../../hooks/useTableSort';
import { configurationApi } from '../../services/api';
import { canEdit, isAdmin, canDownload } from '../../stores/auth';
import { ConfirmModal } from '../Modal';
import ConfigurationCreateModal from './ConfigurationCreateModal';
import {
  exportConfigurationItems,
  previewConfigurationItemsImport,
  executeConfigurationItemsImport,
} from '../../services/importExport';
import type { ImportPreview } from '../../services/importExport';
import ImportPreviewModal from '../ImportPreviewModal';

interface ConfigItemRow {
  revision_id: string;
  master_id: string;
  code: string;
  name: string;
  spec?: string;
  remark?: string;
  version: string;
  status: string;
  check_out_user_id?: string;
  check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration: number;
  creator_id?: string;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  onOpenDetail: (revisionId: string) => void;
}

export default function ConfigurationList({ onOpenDetail }: Props) {
  const [items, setItems] = useState<ConfigItemRow[]>([]);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [loading, setLoading] = useState(false);
  const [topLevelOnly, setTopLevelOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      const result = await configurationApi.list({ page: 1, page_size: PAGE_CAP, top_level: topLevelOnly || undefined });
      const rawItems = result.items || [];
      const rows: ConfigItemRow[] = rawItems.map((item: any) => ({
        revision_id: item.revision_id || item.id,
        master_id: item.master_id,
        code: item.code || '',
        name: item.name || '',
        spec: item.spec || undefined,
        remark: item.remark || undefined,
        version: item.version || '',
        status: item.status || 'draft',
        check_out_user_id: item.check_out_user_id,
        check_out_user_name: item.check_out_user_name,
        check_out_date: item.check_out_date,
        latest_iteration: item.latest_iteration || 1,
        creator_id: item.creator_id,
        created_at: item.created_at,
        updated_at: item.updated_at,
      }));
      setItems(rows);
      setServerTotal(result.total ?? rawItems.length);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [topLevelOnly]);

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

  const { sortedData, handleSort, getSortIcon } = useTableSort<ConfigItemRow>(filteredData, 'code', 'asc');

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await configurationApi.delete(deleteId);
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
        if (result.warnings.length > 20) msg += `\n... 其余 ${result.warnings.length - 20} 条见控制台`;
      }
      alert(msg);
    } catch (err: any) {
      alert(err.message || '导入执行失败');
    } finally {
      setImporting(false);
    }
  };

  const statusTagLabel = (s: string) => {
    const map: Record<string, string> = {
      draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废',
    };
    return map[s] || s;
  };

  const statusTagClass = (s: string) => {
    const map: Record<string, string> = {
      draft: 'bg-blue-100 text-blue-800',
      frozen: 'bg-orange-100 text-orange-800',
      released: 'bg-green-100 text-green-800',
      obsolete: 'bg-red-100 text-red-800',
    };
    return map[s] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
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
        </select>
        <input
          type="text"
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={searchField === 'all' ? '搜索全部字段...' : `搜索${searchField === 'code' ? '构型号' : searchField === 'name' ? '名称' : searchField === 'spec' ? '规格型号' : '备注'}...`}
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

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof ConfigItemRow)} className="text-left px-3 py-3 text-sm font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap w-60">构型号 {getSortIcon('code' as keyof ConfigItemRow)}</th>
              <th onClick={() => handleSort('name' as keyof ConfigItemRow)} className="text-left px-3 py-3 text-sm font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap">名称 {getSortIcon('name' as keyof ConfigItemRow)}</th>
              <th onClick={() => handleSort('version' as keyof ConfigItemRow)} className="text-center px-2 py-3 text-sm font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap w-16">版本 {getSortIcon('version' as keyof ConfigItemRow)}</th>
              <th onClick={() => handleSort('status' as keyof ConfigItemRow)} className="text-center px-2 py-3 text-sm font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap w-20">状态 {getSortIcon('status' as keyof ConfigItemRow)}</th>
              <th onClick={() => handleSort('check_out_user_name')} className="text-center px-2 py-3 text-sm font-medium text-gray-500 cursor-pointer select-none whitespace-nowrap w-20">签出状态 {getSortIcon('check_out_user_name')}</th>
              <th className="text-center px-2 py-3 text-sm font-medium text-gray-500 w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : sortedData.map((item) => (
              <tr key={item.revision_id} onClick={() => onOpenDetail(item.revision_id)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-3 text-sm font-medium">{item.code}</td>
                <td className="px-3 py-3 text-sm">{item.name}</td>
                <td className="px-2 py-3 text-sm font-mono text-center">{item.version}</td>
                <td className="px-2 py-3 text-sm text-center">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${statusTagClass(item.status)}`}>
                    {statusTagLabel(item.status)}
                  </span>
                </td>
                <td className="px-2 py-3 text-sm text-center">
                  {item.check_out_user_name ? (
                    <span className="text-xs text-orange-600">{item.check_out_user_name}</span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-2 py-3 text-sm text-center" onClick={(e) => e.stopPropagation()}>
                  {isAdmin() && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(item.revision_id); }} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfigurationCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "删除构型项"}
        content={deleteError || "确认删除该构型项？此操作不可恢复。"}
        confirmText={deleteError ? "知道了" : "删除"}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

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
