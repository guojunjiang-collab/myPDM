import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { customFieldsApi, authApi } from '../services/api';
import api from '../services/api';
import { useAuthStore } from '../stores/auth';
import { isAdmin } from '../stores/auth';
import type { CustomFieldDefinition } from '../types';
import { Modal } from '../components/Modal';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Textarea from '../components/ui/Textarea';
import { useDataStore } from '../stores/data';
import { exportCustomFieldDefs, importCustomFieldDefs } from '../services/importExport';

import Logs from './Logs';
import FeishuBindPanel from '../components/FeishuBindPanel';
import WechatBindPanel from '../components/WechatBindPanel';
import { THEMES, getStoredTheme, setTheme } from '../lib/theme';
import type { ThemeKey } from '../lib/theme';

const FIELD_TYPES = [
  { value: 'text', label: '单行文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
  { value: 'multiselect', label: '多选' },
] as const;

const ENTITY_TYPES = [
  { value: 'component', label: '零部件' },
  { value: 'document', label: '图文档' },
  { value: 'configuration_item', label: '构型项' },
] as const;

interface FieldFormData {
  name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'select' | 'multiselect';
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
  applies_to: ['component'],
  sort_order: 0,
};

export default function Settings() {
  const currentUser = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [loading, setLoading] = useState(true);

  type TabKey = 'password' | 'feishuBind' | 'wechatBind' | 'logs' | 'customFields' | 'dataManagement' | 'theme';

  const [activeTab, setActiveTab] = useState<TabKey>('password');
  const [theme, setThemeState] = useState<ThemeKey>(() => getStoredTheme());

  const handleThemeChange = (key: ThemeKey) => {
    setTheme(key);
    setThemeState(key);
  };

  const renderThemeOption = (t: (typeof THEMES)[number]) => {
    const selected = theme === t.key;
    return (
      <button
        key={t.key}
        type="button"
        onClick={() => handleThemeChange(t.key)}
        className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
          selected
            ? 'border-blue-500 bg-blue-50'
            : 'border-[var(--ui-border)] bg-[var(--ui-bg-surface)] hover:border-gray-300'
        }`}
      >
        <span
          className="w-8 h-8 rounded-full shrink-0 border border-black/10"
          style={{ backgroundColor: t.swatch }}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-[var(--ui-text-primary)]">{t.label}</span>
          <span className="block text-xs text-[var(--ui-text-secondary)]">{t.desc}</span>
        </span>
        {selected && <span className="ml-auto text-blue-600 text-sm">✓</span>}
      </button>
    );
  };

  const tabs: { key: TabKey; label: string; enabled: boolean; adminOnly: boolean }[] = [
    { key: 'theme', label: '界面主题', enabled: true, adminOnly: false },
    { key: 'password', label: '修改密码', enabled: true, adminOnly: false },
    { key: 'feishuBind', label: '飞书绑定', enabled: true, adminOnly: false },
    { key: 'wechatBind', label: '微信绑定', enabled: true, adminOnly: false },
    { key: 'customFields', label: '自定义字段', enabled: true, adminOnly: false },
    { key: 'dataManagement', label: '数据管理', enabled: true, adminOnly: true },
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
  const [batchConverting, setBatchConverting] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const fieldImportRef = useRef<HTMLInputElement>(null);

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
      field_type: field.field_type as 'text' | 'number' | 'select' | 'multiselect',
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
      <div className="flex border-b border-[var(--ui-border)] mb-4">
        {tabs.map((tab) => {
          if (tab.adminOnly && !isAdmin()) return null;
          return (
            <button
              key={tab.key}
              onClick={() => tab.enabled && setActiveTab(tab.key)}
              disabled={!tab.enabled}
              className={`px-4 h-[var(--ui-control-h)] inline-flex items-center text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
              } ${!tab.enabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 界面主题 */}
      {activeTab === 'theme' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[var(--ui-text-secondary)]">选择界面主色风格（徽标状态色保持语义稳定，仅主按钮/链接/输入焦点随主题切换）</p>
          </div>
          <div className="text-xs text-[var(--ui-text-tertiary)] mb-2">浅色</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
            {THEMES.filter((t) => t.key !== 'dark').map((t) => renderThemeOption(t))}
          </div>
          <div className="mt-5">
            <div className="text-xs text-[var(--ui-text-tertiary)] mb-2">深色</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              {THEMES.filter((t) => t.key === 'dark').map((t) => renderThemeOption(t))}
            </div>
          </div>
        </div>
      )}

      {/* 自定义字段 */}
      {activeTab === 'customFields' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[var(--ui-text-secondary)]">自定义字段用于扩展零部件、图文档的结构</p>
            {isAdmin() && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={handleExportFields}>
                  导出字段
                </Button>
                <Button variant="secondary" onClick={() => fieldImportRef.current?.click()}>
                  导入
                </Button>
                <input ref={fieldImportRef} type="file" accept=".xlsx" onChange={handleImportFields} className="hidden" />
                <Button onClick={openCreateModal}>
                  新增字段
                </Button>
              </div>
            )}
          </div>

          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden">
            <table className="w-full">
              <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">名称</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">标识</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">适用类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">必填</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">排序</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-[var(--ui-text-secondary)]">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td>
                  </tr>
                ) : storeCustomFields.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  storeCustomFields.map((field) => (
                    <tr key={field.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => setViewingField(field)}>
                      <td className="px-4 py-3 text-sm font-medium">{field.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-[var(--ui-text-secondary)]">{field.field_key}</td>
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
                      <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)]">{field.sort_order}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {isAdmin() && (
                          <>
                            <Button variant="link" size="xs" className="mr-2"
                              onClick={() => openEditModal(field)}
                            >
                              编辑
                            </Button>
                            <Button variant="danger" size="xs"
                              onClick={() => handleDelete(field.id)}
                            >
                              删除
                            </Button>
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
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">名称</div>
                    <div className="text-sm font-medium">{viewingField.name}</div>
                  </div>
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">标识</div>
                    <div className="text-sm font-mono">{viewingField.field_key}</div>
                  </div>
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">类型</div>
                    <div className="text-sm">{FIELD_TYPES.find(t => t.value === viewingField.field_type)?.label || viewingField.field_type}</div>
                  </div>
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">排序</div>
                    <div className="text-sm">{viewingField.sort_order}</div>
                  </div>
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">必填</div>
                    <div className="text-sm">{viewingField.is_required ? '是' : '否'}</div>
                  </div>
                  <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">适用类型</div>
                    <div className="text-sm flex gap-1 flex-wrap">
                      {(Array.isArray(viewingField.applies_to) ? viewingField.applies_to : [viewingField.applies_to]).map((type) => (
                        <span key={type} className="px-2 py-0.5 text-xs bg-gray-100 rounded">{ENTITY_TYPES.find(e => e.value === type)?.label || type}</span>
                      ))}
                    </div>
                  </div>
                  {viewingField.options && viewingField.options.length > 0 && (
                    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100 col-span-2">
                      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">选项列表</div>
                      <div className="text-sm">{viewingField.options.join('、')}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t mt-4">
                <Button variant="secondary" type="button" onClick={() => setViewingField(null)}>关闭</Button>
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
          <Button variant="primary" onClick={() => { window.location.href = '/data-management'; }}>
            进入管理
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* STP 批量转换 */}
          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-6">
            <h3 className="text-lg font-medium mb-2">STP 批量转换</h3>
            <p className="text-sm text-[var(--ui-text-secondary)] mb-4">
              将系统中所有未转换的 STP/STEP 附件转换为 GLB 格式，方便预览时直接加载。
              建议在空闲时段执行，转换过程使用最多 2 个并发进程。
            </p>
            <div className="flex items-center gap-3">
              <Button onClick={handleBatchConvert} disabled={batchConverting}>
                {batchConverting ? '转换中...' : '批量转换 STP'}
              </Button>
              {batchStatus && (
                <span className="text-sm text-[var(--ui-text-secondary)]">{batchStatus}</span>
              )}
            </div>
          </div>

          {/* 重置系统数据 */}
          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-6">
            <h3 className="text-lg font-medium mb-2">重置系统数据</h3>
            <p className="text-sm text-[var(--ui-text-secondary)] mb-4">
              清空所有零件、部件、图文档、自定义字段、附件文件、看板、构型管理（构型项/构型配置）及变更管理（ECR/ECO）数据。需验证管理员密码。此操作不可逆，请谨慎操作。
            </p>
            <Button variant="danger" onClick={() => { setShowResetConfirm(true); setResetPassword(''); }} disabled={resetting}>
              {resetting ? '重置中...' : '重置系统数据'}
            </Button>
          </div>
        </div>

        {/* ---- Reset Confirm Modal ---- */}
        <Modal open={showResetConfirm} title="确认重置" onClose={() => setShowResetConfirm(false)} width="sm">
          <div className="space-y-4">
              <p className="text-sm text-[var(--ui-text-secondary)]">此操作将清空所有业务数据（零件、部件、图文档、附件、自定义字段、看板、构型管理、变更管理、glTF缓存），删除所有非管理员用户，并将 admin 密码重置为 admin123。此操作不可逆，请输入管理员密码确认：</p>
            <Input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="请输入管理员密码"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleResetData()}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setShowResetConfirm(false)}>取消</Button>
              <Button variant="danger" type="button" onClick={handleResetData} disabled={resetting}>
                {resetting ? '重置中...' : '确认重置'}
              </Button>
            </div>
          </div>
        </Modal>
        </>
      )}

      {/* 修改密码 */}
      {activeTab === 'password' && (
        <div className="max-w-md">
          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-6">
            <h3 className="text-lg font-medium mb-4">修改密码</h3>
            <p className="text-sm text-[var(--ui-text-secondary)] mb-4">
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
                  <Input
                    type="password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, oldPassword: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                  <Input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">确认新密码</label>
                  <Input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    required
                  />
                </div>

                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                    {passwordError}
                  </div>
                )}

                <Button type="submit" disabled={changingPassword} className="w-full">
                  {changingPassword ? '提交中...' : '确认修改'}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 操作日志 */}
      {activeTab === 'logs' && <Logs />}

      {/* 飞书绑定 */}
      {activeTab === 'feishuBind' && <FeishuBindPanel />}

      {/* 微信绑定 */}
      {activeTab === 'wechatBind' && <WechatBindPanel />}

      {/* 自定义字段 Modal */}
      <Modal
        open={showModal}
        title={editingField ? '编辑字段' : '新增字段'}
        onClose={() => setShowModal(false)}
        width="lg"
      >
        <form onSubmit={handleSubmitField} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">字段名称</label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                size="xs"
                placeholder="例如：采购周期"
              />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">字段标识</label>
              <Input
                type="text"
                value={formData.field_key}
                onChange={(e) => setFormData({ ...formData, field_key: e.target.value })}
                size="xs"
                className="font-mono"
                placeholder="lead_time"
                disabled={!!editingField}
              />
              <p className="mt-1 text-xs text-[var(--ui-text-tertiary)]">创建后不可修改，用于API字段映射</p>
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">字段类型</label>
              <Select
                value={formData.field_type}
                onChange={(e) => setFormData({ ...formData, field_type: e.target.value as 'text' | 'number' | 'select' })}
                size="xs"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </Select>
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">排序序号</label>
              <Input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
                size="xs"
                placeholder="0"
              />
              <p className="mt-1 text-xs text-[var(--ui-text-tertiary)]">越小越靠前</p>
            </div>
            {(formData.field_type === 'select' || formData.field_type === 'multiselect') && (
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100 col-span-2">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">选项</label>
                <Textarea
                  value={formData.options}
                  onChange={(e) => setFormData({ ...formData, options: e.target.value })}
                  size="xs"
                  className="resize-none"
                  rows={3}
                  placeholder="每行一个选项"
                />
              </div>
            )}
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100 col-span-2">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">适用类型</label>
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

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ui-border)]">
            <Button
              type="button"
              onClick={() => setShowModal(false)}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
