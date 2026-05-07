import { useEffect, useState } from 'react';
import { customFieldsApi } from '../services/api';
import type { CustomFieldDef } from '../types';

export default function Settings() {
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'customFields' | 'dict'>('customFields');

  useEffect(() => {
    if (activeTab === 'customFields') {
      loadCustomFields();
    }
  }, [activeTab]);

  const loadCustomFields = async () => {
    try {
      const response = await customFieldsApi.list();
      setCustomFields(response.data.items || []);
    } catch (error) {
      console.error('加载自定义字段失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该自定义字段吗？')) return;
    try {
      await customFieldsApi.delete(id);
      loadCustomFields();
    } catch (error) {
      alert('删除失败');
    }
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">系统设置</h2>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('customFields')}
          className={`px-4 py-2 rounded-lg ${
            activeTab === 'customFields'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          自定义字段
        </button>
        <button
          onClick={() => setActiveTab('dict')}
          className={`px-4 py-2 rounded-lg ${
            activeTab === 'dict'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          数据字典
        </button>
      </div>

      {/* 自定义字段 */}
      {activeTab === 'customFields' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">自定义字段用于扩展零件、部件、图文档的结构</p>
            <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
              新增字段
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">实体类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">字段名</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">显示名称</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">类型</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">必填</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {customFields.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  customFields.map((field) => (
                    <tr key={field.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">{field.entity_type}</td>
                      <td className="px-4 py-3 text-sm">{field.field_name}</td>
                      <td className="px-4 py-3 text-sm">{field.field_label}</td>
                      <td className="px-4 py-3 text-sm">{field.field_type}</td>
                      <td className="px-4 py-3 text-sm">
                        {field.required ? '是' : '否'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            field.status === 'active'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {field.status === 'active' ? '启用' : '禁用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-primary-600 hover:text-primary-800 mr-2">
                          编辑
                        </button>
                        <button
                          className="text-red-600 hover:text-red-800"
                          onClick={() => handleDelete(field.id)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 数据字典 */}
      {activeTab === 'dict' && (
        <div>
          <p className="text-sm text-gray-500">数据字典管理 - 待实现</p>
        </div>
      )}
    </div>
  );
}