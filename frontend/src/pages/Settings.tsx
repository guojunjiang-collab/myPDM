import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { customFieldsApi, authApi } from '../services/api';
import api from '../services/api';
import { useAuthStore } from '../stores/auth';
import { isAdmin } from '../stores/auth';
import type { CustomFieldDefinition } from '../types';
import { Modal } from '../components/Modal';
import { useDataStore } from '../stores/data';
import { exportAllData, exportCustomFieldDefs, importCustomFieldDefs, importAllData, exportDashboardFile, previewDashboardImportFromFile, executeDashboardImport } from '../services/importExport';

import Logs from './Logs';

const FIELD_TYPES = [
  { value: 'text', label: '单行文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
] as const;

const ENTITY_TYPES = [
  { value: 'part', label: '零件' },
  { value: 'component', label: '部件' },
  { value: 'document', label: '图文档' },
] as const;

interface FieldFormData {
  name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'select';
  options: string;
  is_required: boolean;
  applies_to: string[];
  sort_order: number;
}

const defaultFormData: FieldFormData = {
  name: '',
  field_key: '',
  field_type: 'text',
  options: '',
  is_required: false,
  applies_to: ['part'],
  sort_order: 0,
};

export default function Settings() {
  const currentUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [loading, setLoading] = useState(true);

  type TabKey = 'password' | 'logs' | 'customFields' | 'dataManagement';

  const [activeTab, setActiveTab] = useState<TabKey>('password');

  const tabs: { key: TabKey; label: string; enabled: boolean; adminOnly: boolean }[] = [
    { key: 'customFields', label: '自定义字段', enabled: true, adminOnly: false },
    { key: 'dataManagement', label: '数据管理', enabled: true, adminOnly: true },
    { key: 'password', label: '修改密码', enabled: true, adminOnly: false },
    { key: 'logs', label: '操作日志', enabled: true, adminOnly: true },
  ];

  // Password change state
  const [passwordForm, setPasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Custom field modal state
  const [showModal, setShowModal] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [formData, setFormData] = useState<FieldFormData>(defaultFormData);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [viewingField, setViewingField] = useState<CustomFieldDefinition | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [batchConverting, setBatchConverting] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const [dashExporting, setDashExporting] = useState(false);
  const [dashImporting, setDashImporting] = useState(false);

  useEffect(() => {
    if (activeTab === 'customFields') {
      loadCustomFields();
    }
  }, [activeTab]);

  // 订阅 store 数据变化
  const storeCustomFields = useDataStore((s) => s.customFieldDefs);

  const loadCustomFields = async () => {
    const localDefs = useDataStore.getState().customFieldDefs;
    if (localDefs.length > 0) {
      setLoading(false);
      return;
    }
    try {
      const response = await customFieldsApi.listDefinitions();
      useDataStore.getState().setCustomFieldDefs(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('加载自定义字段失败', error);
    } finally {
      setLoading(false);
    }
  };

  // store 变化时刷新
  useEffect(() => {
    if (activeTab === 'customFields') {
      setLoading(false);
    }
  }, [activeTab, storeCustomFields]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (passwordForm.newPassword.length < 6) {
      setPasswordError('新密码至少6位');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('两次密码不一致');
      return;
    }

    setChangingPassword(true);
    try {
      await authApi.changePassword(passwordForm.oldPassword, passwordForm.newPassword);
      setPasswordSuccess('密码修改成功，请重新登录');
      setPasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => {
        logout();
        window.location.href = '/login';
      }, 2000);
    } catch (error: any) {
      setPasswordError(error.response?.data?.detail || '修改失败');
    } finally {
      setChangingPassword(false);
    }
  };

  const openCreateModal = () => {
    setEditingField(null);
    setFormData(defaultFormData);
    setFormError('');
    setSaving(false);
    setShowModal(true);
  };

  const openEditModal = (field: CustomFieldDefinition) => {
    setEditingField(field);
    // applies_to 现在直接是数组
    const appliesToArray = Array.isArray(field.applies_to) ? field.applies_to : [field.applies_to];
    setFormData({
      name: field.name,
      field_key: field.field_key,
      field_type: field.field_type as 'text' | 'number' | 'select',
      options: (field.options || []).join('\n'),
      is_required: field.is_required,
      applies_to: appliesToArray,
      sort_order: field.sort_order || 0,
    });
    setFormError('');
    setSaving(false);
    setShowModal(true);
  };

  const handleSubmitField = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.name.trim()) {
      setFormError('请输入字段名称');
      return;
    }
    if (!formData.field_key.trim()) {
      setFormError('请输入字段标识');
      return;
    }
    if (!/^[a-z_][a-z0-9_]*$/.test(formData.field_key)) {
      setFormError('字段标识只能包含小写字母、数字、下划线，且以字母或下划线开头');
      return;
    }
    if (formData.applies_to.length === 0) {
      setFormError('请选择至少一个适用类型');
      return;
    }

    // applies_to 现在直接传递数组，不做字符串转换
    const payload = {
      name: formData.name.trim(),
      field_key: formData.field_key.trim(),
      field_type: formData.field_type,
      options: formData.options ? formData.options.split('\n').map(s => s.trim()).filter(Boolean) : [],
      is_required: formData.is_required,
      applies_to: formData.applies_to,
      sort_order: formData.sort_order,
    };

    setSaving(true);
    try {
      let newField: CustomFieldDefinition | null = null;
      if (editingField) {
        const res = await customFieldsApi.updateDefinition(editingField.id, payload);
        newField = res.data;
        // 直接更新 store
        useDataStore.getState().setCustomFieldDefs(
          useDataStore.getState().customFieldDefs.map(f => f.id === editingField.id ? newField! : f)
        );
      } else {
        const res = await customFieldsApi.createDefinition(payload);
        newField = res.data;
        // 直接追加到 store
        useDataStore.getState().setCustomFieldDefs([...useDataStore.getState().customFieldDefs, newField!]);
      }
      setShowModal(false);
      setFormData(defaultFormData);
      setEditingField(null);
    } catch (error: any) {
      // 尝试从不同格式的错误响应中提取信息
      const detail = error.response?.data?.detail;
      if (Array.isArray(detail)) {
        setFormError(detail.map((e: any) => e.msg || JSON.stringify(e)).join('; '));
      } else {
        setFormError(typeof detail === 'string' ? detail : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleExportAll = async () => {
    setExporting(true);
    setExportProgress('准备导出...');
    try {
      await exportAllData((msg) => setExportProgress(msg));
    } catch (e: any) {
      setExportProgress('');
      alert(e?.message || '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  const handleImportAll = async () => {
    setImporting(true);
    setImportProgress('准备导入...');
    try {
      await importAllData((msg) => setImportProgress(msg));
    } catch (e: any) {
      setImportProgress('');
      alert(e?.message || '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  // STP 批量转换
  const handleBatchConvert = async () => {
    setBatchConverting(true);
    setBatchStatus('正在启动...');
    try {
      const { data } = await api.post('/v2/attachments/convert-pending');
      if (data.status === 'started') {
        setBatchStatus(`已开始，共 ${data.pending} 个待转换文件`);
        pollConvertStatus();
      } else {
        setBatchStatus(data.message || '已完成，无需转换');
        setBatchConverting(false);
      }
    } catch {
      setBatchStatus('请求失败');
      setBatchConverting(false);
    }
  };

  const pollConvertStatus = () => {
    const t = setInterval(async () => {
      try {
        const { data } = await api.get('/v2/attachments/convert-status');
        if (data.pending === 0) {
          clearInterval(t);
          setBatchStatus('✅ 全部转换完成');
          setBatchConverting(false);
        } else {
          setBatchStatus(`转换中... 剩余 ${data.pending} / ${data.total}`);
        }
      } catch {
        clearInterval(t);
        setBatchStatus('状态查询失败');
        setBatchConverting(false);
      }
    }, 3000);
  };

  const handleExportFields = async () => {
    try {
      await exportCustomFieldDefs();
    } catch (e: any) {
      alert(e?.message || '导出字段定义失败');
    }
  };

  const handleImportFields = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importCustomFieldDefs(file);
      alert(`导入完成：新增 ${result.created} 个，更新 ${result.updated} 个`);
    } catch (err: any) {
      alert(err?.message || '导入失败，请确认文件格式正确');
    }
    // 重置 input 以便重复选择同一文件
    e.target.value = '';
  };

  const handleResetData = async () => {
    if (!resetPassword.trim()) {
      alert('请输入管理员密码');
      return;
    }
    setResetting(true);
    try {
      await customFieldsApi.resetData(resetPassword);
      // 清空本地缓存
      localStorage.removeItem('data-storage');
      // 清空本地 store 中的业务数据
      useDataStore.getState().setParts([]);
      useDataStore.getState().setAssemblies([]);
      useDataStore.getState().setDocuments([]);
      useDataStore.getState().setCustomFieldDefs([]);
      setShowResetConfirm(false);
      setResetPassword('');
      alert('系统已重置。admin 密码已重置为 admin123，请重新登录。');
      // admin 密码已变更，强制重新登录
      logout();
      window.location.href = '/login';
    } catch (error: any) {
      alert(error?.response?.data?.detail || '重置失败，请确认密码正确');
    } finally {
      setResetting(false);
    }
  };

  // 导出用户看板（直接下载文件）
  const handleDashExport = async () => {
    setDashExporting(true);
    try {
      await exportDashboardFile();
    } catch (e: any) {
      alert(e?.message || '导出失败，请重试');
    } finally {
      setDashExporting(false);
    }
  };

  // 导入用户看板（直接选择文件）
  const handleDashImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDashImporting(true);
    try {
      await useDataStore.getState().syncAll();
      const preview = await previewDashboardImportFromFile(file);
      await executeDashboardImport(preview);
      await useDataStore.getState().syncAll();
      alert('用户看板导入完成');
    } catch (e: any) {
      alert(e?.message || '导入失败，请重试');
    } finally {
      setDashImporting(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该自定义字段吗？')) return;
    try {
      await customFieldsApi.deleteDefinition(id);
      // 直接从 store 删除
      useDataStore.getState().setCustomFieldDefs(
        useDataStore.getState().customFieldDefs.filter(f => f.id !== id)
      );
    } catch (error) {
      alert('删除失败');
    }
  };

  return (
    <div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {tabs.map((tab) => {
          if (tab.adminOnly && !isAdmin()) return null;
          return (
            <button
              key={tab.key}
              onClick={() => tab.enabled && setActiveTab(tab.key)}
              disabled={!tab.enabled}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              } ${!tab.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 自定义字段 */}
      {activeTab === 'customFields' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">自定义字段用于扩展零件、部件、图文档的结构</p>
            {isAdmin() && (
              <div className="flex gap-2">
                <button
                  onClick={handleExportFields}
                  className="px-4 py-2 border border-green-600 text-green-600 rounded-lg hover:bg-green-50"
                >
                  导出字段
                </button>
                <label className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 cursor-pointer">
                  导入
                  <input type="file" accept=".xlsx" onChange={handleImportFields} className="hidden" />
                </label>
                <button
                  onClick={openCreateModal}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                >
                  新增字段
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">名称</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">标识</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">适用类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">必填</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">排序</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td>
                  </tr>
                ) : storeCustomFields.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  storeCustomFields.map((field) => (
                    <tr key={field.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setViewingField(field)}>
                      <td className="px-4 py-3 text-sm font-medium">{field.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{field.field_key}</td>
                      <td className="px-4 py-3 text-sm">
                        {FIELD_TYPES.find(t => t.value === field.field_type)?.label || field.field_type}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-1">
                          {(Array.isArray(field.applies_to) ? field.applies_to : [field.applies_to]).map((type) => (
                            <span key={type} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                              {ENTITY_TYPES.find(e => e.value === type)?.label || type}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {field.is_required ? '是' : '否'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{field.sort_order}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {isAdmin() && (
                          <>
                            <button
                              className="text-primary-600 hover:text-primary-800 mr-2"
                              onClick={() => openEditModal(field)}
                            >
                              编辑
                            </button>
                            <button
                              className="text-red-600 hover:text-red-800"
                              onClick={() => handleDelete(field.id)}
                            >
                              删除
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 字段详情弹窗 */}
          {viewingField && (
            <Modal open={!!viewingField} title="字段详情" onClose={() => setViewingField(null)} width="md">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">名称</div>
                    <div className="text-sm font-medium">{viewingField.name}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">标识</div>
                    <div className="text-sm font-mono">{viewingField.field_key}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">类型</div>
                    <div className="text-sm">{FIELD_TYPES.find(t => t.value === viewingField.field_type)?.label || viewingField.field_type}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">排序</div>
                    <div className="text-sm">{viewingField.sort_order}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">必填</div>
                    <div className="text-sm">{viewingField.is_required ? '是' : '否'}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">适用类型</div>
                    <div className="text-sm flex gap-1 flex-wrap">
                      {(Array.isArray(viewingField.applies_to) ? viewingField.applies_to : [viewingField.applies_to]).map((type) => (
                        <span key={type} className="px-2 py-0.5 text-xs bg-gray-100 rounded">{ENTITY_TYPES.find(e => e.value === type)?.label || type}</span>
                      ))}
                    </div>
                  </div>
                  {viewingField.options && viewingField.options.length > 0 && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 col-span-2">
                      <div className="text-xs text-gray-500 mb-0.5">选项列表</div>
                      <div className="text-sm">{viewingField.options.join('、')}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t mt-4">
                <button type="button" onClick={() => setViewingField(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">关闭</button>
              </div>
            </Modal>
          )}
        </div>
      )}

      {/* 数据管理 */}
      {activeTab === 'dataManagement' && (
        <>
        {/* 软删除数据管理入口 */}
        <div className="mb-6 bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-blue-800">软删除数据管理</h3>
            <p className="text-sm text-blue-600 mt-1">查看和管理系统中被软删除的零件、部件、图文档等记录</p>
          </div>
          <a
            href="/data-management"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 whitespace-nowrap"
          >
            进入管理
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 导出全部数据 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">导出全部数据</h3>
            <p className="text-sm text-gray-500 mb-4">
              将系统中的所有零件、部件、图文档、构型项、构型配置、用户看板数据导出为文件备份。请选择目标文件夹。
            </p>
            <button
              onClick={handleExportAll}
              disabled={exporting}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {exporting ? '导出中...' : '导出全部数据'}
            </button>
            {exportProgress && (
              <p className={`mt-3 text-sm ${exporting ? 'text-blue-600' : 'text-green-600'}`}>
                {exporting ? '⏳' : '✅'} {exportProgress}
              </p>
            )}
          </div>

          {/* 导入全部数据 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">导入全部数据</h3>
            <p className="text-sm text-gray-500 mb-4">
              从导出的文件夹中选择"自定义字段定义.xlsx + 图文档清单.xlsx + 零件清单.xlsx + 部件清单.xlsx + 构型项.xlsx + 构型配置.xlsx + 用户看板.xlsx"等文件所在的文件夹，批量导入全部数据。
            </p>
            <button
              onClick={handleImportAll}
              disabled={importing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {importing ? '导入中...' : '导入全部数据'}
            </button>
            {importProgress && (
              <p className={`mt-3 text-sm ${importing ? 'text-blue-600' : 'text-green-600'}`}>
                {importing ? '⏳' : '✅'} {importProgress}
              </p>
            )}
          </div>

          {/* 导出用户看板 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">导出用户看板</h3>
            <p className="text-sm text-gray-500 mb-4">
              仅导出所有用户的看板数据（文件夹、关联项目、共享设置），保存为 Excel 文件。
            </p>
            <button
              onClick={handleDashExport}
              disabled={dashExporting}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {dashExporting ? '导出中...' : '导出用户看板'}
            </button>
            {dashExporting && (
              <p className="mt-3 text-sm text-blue-600">⏳ 导出中...</p>
            )}
          </div>

          {/* 导入用户看板 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">导入用户看板</h3>
            <p className="text-sm text-gray-500 mb-4">
              选择已导出的"用户看板.xlsx"文件，导入用户看板数据。
            </p>
            <label
              className={`inline-block px-4 py-2 rounded-lg cursor-pointer text-white ${dashImporting ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {dashImporting ? '导入中...' : '导入用户看板'}
              <input type="file" accept=".xlsx" onChange={handleDashImport} className="hidden" disabled={dashImporting} />
            </label>
            {dashImporting && (
              <p className="mt-3 text-sm text-blue-600">⏳ 导入中...</p>
            )}
          </div>

          {/* STP 批量转换 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">STP 批量转换</h3>
            <p className="text-sm text-gray-500 mb-4">
              将系统中所有未转换的 STP/STEP 附件转换为 GLB 格式，方便预览时直接加载。
              建议在空闲时段执行，转换过程使用最多 2 个并发进程。
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBatchConvert}
                disabled={batchConverting}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {batchConverting ? '转换中...' : '批量转换 STP'}
              </button>
              {batchStatus && (
                <span className="text-sm text-gray-500">{batchStatus}</span>
              )}
            </div>
          </div>

          {/* 重置系统数据 */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-2">重置系统数据</h3>
            <p className="text-sm text-gray-500 mb-4">
              清空所有零件、部件、图文档、自定义字段、附件文件、看板、构型管理（构型项/构型配置）及变更管理（ECR/ECO）数据。需验证管理员密码。此操作不可逆，请谨慎操作。
            </p>
            <button
              onClick={() => { setShowResetConfirm(true); setResetPassword(''); }}
              disabled={resetting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {resetting ? '重置中...' : '重置系统数据'}
            </button>
          </div>
        </div>

        {/* ---- Reset Confirm Modal ---- */}
        <Modal open={showResetConfirm} title="确认重置" onClose={() => setShowResetConfirm(false)} width="sm">
          <div className="space-y-4">
              <p className="text-sm text-gray-600">此操作将清空所有业务数据（零件、部件、图文档、附件、自定义字段、看板、构型管理、变更管理、glTF缓存），删除所有非管理员用户，并将 admin 密码重置为 admin123。此操作不可逆，请输入管理员密码确认：</p>
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="请输入管理员密码"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleResetData()}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowResetConfirm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
              <button type="button" onClick={handleResetData} disabled={resetting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {resetting ? '重置中...' : '确认重置'}
              </button>
            </div>
          </div>
        </Modal>
        </>
      )}

      {/* 修改密码 */}
      {activeTab === 'password' && (
        <div className="max-w-md">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-medium mb-4">修改密码</h3>
            <p className="text-sm text-gray-500 mb-4">
              当前用户: <span className="font-medium">{currentUser?.username}</span>
            </p>

            {passwordSuccess ? (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
                {passwordSuccess}
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">原密码</label>
                  <input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                </div>

                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                    {passwordError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={changingPassword}
                  className="w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {changingPassword ? '提交中...' : '确认修改'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 操作日志 */}
      {activeTab === 'logs' && <Logs />}

      {/* 自定义字段 Modal */}
      <Modal
        open={showModal}
        title={editingField ? '编辑字段' : '新增字段'}
        onClose={() => setShowModal(false)}
        width="lg"
      >
        <form onSubmit={handleSubmitField} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">字段名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="例如：采购周期"
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">字段标识</label>
              <input
                type="text"
                value={formData.field_key}
                onChange={(e) => setFormData({ ...formData, field_key: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                placeholder="lead_time"
                disabled={!!editingField}
              />
              <p className="mt-1 text-xs text-gray-400">创建后不可修改，用于API字段映射</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">字段类型</label>
              <select
                value={formData.field_type}
                onChange={(e) => setFormData({ ...formData, field_type: e.target.value as 'text' | 'number' | 'select' })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">排序序号</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="0"
              />
              <p className="mt-1 text-xs text-gray-400">越小越靠前</p>
            </div>
            {formData.field_type === 'select' && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">选项</label>
                <textarea
                  value={formData.options}
                  onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  rows={3}
                  placeholder="每行一个选项"
                />
              </div>
            )}
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 col-span-2">
              <label className="block text-xs text-gray-500 mb-1">适用类型</label>
              <div className="flex gap-4">
                {ENTITY_TYPES.map((type) => (
                  <label key={type.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={formData.applies_to.includes(type.value)}
                      onChange={(e) => {
                        const newAppliesTo = e.target.checked
                          ? [...formData.applies_to, type.value]
                          : formData.applies_to.filter(t => t !== type.value);
                        setFormData({ ...formData, applies_to: newAppliesTo });
                      }}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_required}
                onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700">必填字段</span>
            </label>
          </div>

          {formError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}